import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { execute, queryAll, queryOne } from './database';
import { cosineSimilarity, getEmbedding } from './embeddings';
import {
  AI_RESEARCH_KNOWLEDGE_TASK,
  extractPinnableClaims,
  knowledgeBriefFromFact,
  normalizeOptionalRecordId,
  normalizePinnedSourceUrls,
} from './knowledge-pin';

/** Task types that participate in the shared knowledge graph. */
export const KNOWLEDGE_TASK_TYPES = [
  'social-post',
  'video-script',
  'event-plan',
  'market-research',
  'article-market-news',
  'ai-research',
] as const;

export type KnowledgeTaskType = (typeof KNOWLEDGE_TASK_TYPES)[number];

export type KnowledgePersistAction = 'select' | 'approve' | 'publish' | 'complete' | 'pin';

/** Identical content inside this window is one record, even across task ids. */
export const KNOWLEDGE_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

export const AUTO_RESEARCH_CLAIM_LIMIT = 3;

const OUTPUT_CHAR_LIMIT = 8_000;
const SIMILARITY_THRESHOLD = 0.75;

export type KnowledgeDedupeRow = {
  id: string;
  taskId: string | null;
  contentHash: string | null;
  fingerprint: string;
  qualityScore: number;
  createdAtMs: number;
};

export type PersistKnowledgeInput = {
  userId: string;
  taskType: string;
  brief: string;
  selectedOutput: unknown;
  rejectedOutputs?: unknown;
  platform?: string | null;
  audience?: string | null;
  taskId?: string | null;
  action: KnowledgePersistAction;
  sourceUrls?: string[];
  conversationId?: string | null;
  projectId?: string | null;
  /** Defaults to the marketing-selection policy. Research pins stay opted out. */
  updateStylePreferences?: boolean;
  nowMs?: number;
};

export type PersistKnowledgeResult = {
  knowledgeId: string | null;
  connectionsCount: number;
  deduped: boolean;
  skipped: boolean;
  qualityScore: number;
};

type DbKnowledgeRow = {
  id: string;
  task_id: string | null;
  content_hash: string | null;
  selected_output: string;
  quality_score: number | string | null;
  created_at: string | Date;
};

export function qualityScoreForAction(action: KnowledgePersistAction): number {
  switch (action) {
    case 'publish':
    case 'pin':
      return 1;
    case 'approve':
      return 0.9;
    case 'complete':
      return 0.7;
    case 'select':
      return 0.55;
    default:
      return 0.55;
  }
}

/** Style learning follows explicit marketing choices, not research citations or auto-saved reports. */
export function shouldUpdateStylePreferences(taskType: string, action: KnowledgePersistAction): boolean {
  if (action !== 'select' && action !== 'approve' && action !== 'publish') return false;
  if (taskType === AI_RESEARCH_KNOWLEDGE_TASK || taskType === 'market-research') return false;
  return true;
}

export function knowledgeFingerprint(value: unknown): string {
  return normalizeKnowledgeText(value).replace(/\s+/g, ' ').trim();
}

export function knowledgeContentHash(value: unknown): string {
  return createHash('sha256').update(knowledgeFingerprint(value)).digest('hex');
}

export function readClientTaskId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Decide whether this write is the same knowledge the user already stored.
 * Approve/publish collapses to the row already saved for that task, so a later
 * status change raises quality instead of copying the post again.
 */
export function chooseKnowledgeDedupe(
  rows: KnowledgeDedupeRow[],
  candidate: {
    taskId: string | null;
    contentHash: string;
    fingerprint: string;
    nowMs: number;
    windowMs?: number;
    action: KnowledgePersistAction;
  },
): KnowledgeDedupeRow | null {
  const windowMs = candidate.windowMs ?? KNOWLEDGE_DEDUPE_WINDOW_MS;
  const recent = (row: KnowledgeDedupeRow) => candidate.nowMs - row.createdAtMs <= windowMs;
  const sameBody = (row: KnowledgeDedupeRow) =>
    row.contentHash === candidate.contentHash || row.fingerprint === candidate.fingerprint;

  if (candidate.taskId && (candidate.action === 'approve' || candidate.action === 'publish')) {
    const forTask = rows
      .filter(row => row.taskId === candidate.taskId)
      .sort((left, right) => right.createdAtMs - left.createdAtMs);
    if (forTask[0]) return forTask[0];
  }

  if (candidate.action === 'approve' || candidate.action === 'publish' || candidate.action === 'pin') {
    const identical = rows.filter(sameBody).sort((left, right) => right.createdAtMs - left.createdAtMs);
    if (identical[0]) return identical[0];
  }

  for (const row of rows) {
    if (candidate.taskId && row.taskId === candidate.taskId && sameBody(row)) return row;
    if (row.contentHash === candidate.contentHash && recent(row)) return row;
    if (row.fingerprint === candidate.fingerprint && !candidate.taskId && !row.taskId) return row;
    if (row.fingerprint === candidate.fingerprint && recent(row)) return row;
  }
  return null;
}

export function primarySocialPostOutput(outputData: unknown): unknown | null {
  let data = outputData;
  if (typeof outputData === 'string') {
    const trimmed = outputData.trim();
    if (!trimmed) return null;
    try {
      data = JSON.parse(trimmed);
    } catch {
      return trimmed.length >= 8 ? trimmed : null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.options) && record.options.length > 0) return record.options[0];
  if (record.captionData && typeof record.captionData === 'object') return record.captionData;
  if (typeof record.caption === 'string' && record.caption.trim()) return record;
  return null;
}

export function summarizeVideoScriptKnowledge(option: {
  styleLabel?: unknown;
  hook?: unknown;
  fullScript?: unknown;
} | null | undefined): string | null {
  if (!option) return null;
  const fullScript = typeof option.fullScript === 'string' ? option.fullScript.trim() : '';
  if (fullScript.length < 40) return null;
  const hook = typeof option.hook === 'string' ? option.hook.trim() : '';
  const label = typeof option.styleLabel === 'string' ? option.styleLabel.trim() : '';
  return [label, hook, fullScript].filter(Boolean).join('\n\n').slice(0, OUTPUT_CHAR_LIMIT);
}

export function summarizeEventPlanKnowledge(input: {
  eventName: string;
  theme?: string;
  location?: string;
  options: Array<{ styleLabel?: unknown; concept?: unknown; objective?: unknown }>;
}): { brief: string; selectedOutput: string } | null {
  const lines = input.options.map(option => {
    const concept = textValue(option.concept);
    const objective = textValue(option.objective);
    const body = concept || objective;
    if (!body) return '';
    const label = textValue(option.styleLabel) || 'Option';
    return `${label}: ${body}`;
  }).filter(Boolean);
  if (!lines.length) return null;
  const brief = textValue(input.eventName).slice(0, 240) || 'Event plan';
  const selectedOutput = [
    brief,
    textValue(input.theme) ? `Theme: ${textValue(input.theme)}` : '',
    textValue(input.location) ? `Location: ${textValue(input.location)}` : '',
    ...lines,
  ].filter(Boolean).join('\n').slice(0, OUTPUT_CHAR_LIMIT);
  return { brief, selectedOutput };
}

export function summarizeMarketResearchKnowledge(input: {
  brief: string;
  researchDate?: string;
  items: Array<{ articleTitle?: unknown; newsSource?: unknown; mainEvent?: unknown; symbol?: unknown; articleUrl?: unknown }>;
}): { brief: string; selectedOutput: string; sourceUrls: string[] } | null {
  if (!input.items.length) return null;
  const lines = input.items.map(item => {
    const title = textValue(item.articleTitle);
    const event = textValue(item.mainEvent);
    if (!title && !event) return '';
    const symbol = textValue(item.symbol);
    const source = textValue(item.newsSource);
    return [symbol, title || event, source ? `(${source})` : '', event && title ? `— ${event}` : ''].filter(Boolean).join(' ');
  }).filter(Boolean);
  if (!lines.length) return null;
  const brief = [textValue(input.brief) || 'Market research', textValue(input.researchDate)].filter(Boolean).join(' · ').slice(0, 240);
  return {
    brief,
    selectedOutput: lines.join('\n').slice(0, OUTPUT_CHAR_LIMIT),
    sourceUrls: safeSourceUrls(input.items.map(item => item.articleUrl)),
  };
}

export function summarizeArticleKnowledge(input: {
  keyword?: string;
  title: string;
  articleMarkdown: string;
  sourceUrls?: unknown[];
}): { brief: string; selectedOutput: string; sourceUrls: string[] } | null {
  const title = textValue(input.title);
  const article = textValue(input.articleMarkdown);
  if (title.length < 3 || article.length < 40) return null;
  const brief = (textValue(input.keyword) || title).slice(0, 240);
  return {
    brief,
    selectedOutput: `${title}\n\n${article}`.slice(0, OUTPUT_CHAR_LIMIT),
    sourceUrls: safeSourceUrls(input.sourceUrls || []),
  };
}

export type ResearchKnowledgePiece = {
  text: string;
  sourceUrls: string[];
  brief: string;
  taskKey: string;
};

export function shouldPersistResearchAnswer(answer: string, aborted: boolean): boolean {
  return !aborted && answer.trim().length >= 40;
}

/** Top grounded claims, or one sourced summary when the answer has no pinnable claim. */
export function selectResearchKnowledgePieces(input: {
  answer: string;
  query: string;
  sources?: Array<{ title?: string; url: string }>;
}): ResearchKnowledgePiece[] {
  const answer = input.answer.trim();
  if (answer.length < 40) return [];
  const sources = input.sources || [];
  const claims = extractPinnableClaims(answer, sources).slice(0, AUTO_RESEARCH_CLAIM_LIMIT);
  const queryBrief = textValue(input.query).slice(0, 240);
  if (claims.length) {
    return claims.map(claim => ({
      text: claim.text,
      sourceUrls: claim.sourceUrls,
      brief: queryBrief || knowledgeBriefFromFact(claim.text),
      taskKey: knowledgeContentHash(claim.text).slice(0, 16),
    }));
  }
  const sourceUrls = safeSourceUrls(sources.map(source => source.url));
  if (!sourceUrls.length || answer.length < 80) return [];
  const text = answer.replace(/\s+/g, ' ').trim().slice(0, 700);
  return [{
    text,
    sourceUrls: sourceUrls.slice(0, 8),
    brief: queryBrief || text.slice(0, 240),
    taskKey: 'summary',
  }];
}

export function researchKnowledgeTaskId(conversationId: string | null, answer: string, taskKey: string): string {
  const turn = knowledgeContentHash(answer).slice(0, 12);
  const scope = conversationId && conversationId.trim() ? conversationId.trim() : 'turn';
  return `ai-research:${scope}:${turn}:${taskKey}`;
}

export async function findStoredKnowledgeDuplicate(input: {
  userId: string;
  taskType: string;
  taskId?: string | null;
  selectedOutput: unknown;
  action: KnowledgePersistAction;
  nowMs?: number;
}): Promise<KnowledgeDedupeRow | null> {
  const fingerprint = knowledgeFingerprint(input.selectedOutput);
  if (fingerprint.length < 8) return null;
  const stored = stringifyKnowledgeOutput(input.selectedOutput);
  const contentHash = knowledgeContentHash(input.selectedOutput);
  const taskId = input.taskId || null;
  const rows = await loadDedupeCandidates(input.userId, input.taskType, taskId, contentHash, stored);
  return chooseKnowledgeDedupe(rows, {
    taskId,
    contentHash,
    fingerprint,
    nowMs: input.nowMs ?? Date.now(),
    action: input.action,
  });
}

export async function persistKnowledgeEntry(input: PersistKnowledgeInput): Promise<PersistKnowledgeResult> {
  const fingerprint = knowledgeFingerprint(input.selectedOutput);
  const qualityScore = qualityScoreForAction(input.action);
  if (!input.userId || !input.taskType || fingerprint.length < 8) {
    return { knowledgeId: null, connectionsCount: 0, deduped: false, skipped: true, qualityScore: 0 };
  }

  const selectedOutput = stringifyKnowledgeOutput(input.selectedOutput);
  const contentHash = knowledgeContentHash(input.selectedOutput);
  const taskId = input.taskId?.trim() || null;
  const nowMs = input.nowMs ?? Date.now();
  const duplicate = await findStoredKnowledgeDuplicate({
    userId: input.userId,
    taskType: input.taskType,
    taskId,
    selectedOutput: input.selectedOutput,
    action: input.action,
    nowMs,
  });

  if (duplicate) {
    await execute(
      `UPDATE knowledge_entries
       SET quality_score = GREATEST(quality_score, ?),
           task_id = COALESCE(task_id, ?),
           content_hash = COALESCE(content_hash, ?)
       WHERE id = ? AND user_id = ?`,
      [qualityScore, taskId, contentHash, duplicate.id, input.userId],
    );
    return {
      knowledgeId: duplicate.id,
      connectionsCount: 0,
      deduped: true,
      skipped: false,
      qualityScore: Math.max(duplicate.qualityScore, qualityScore),
    };
  }

  let embedding: number[] = [];
  try {
    embedding = await getEmbedding(selectedOutput);
  } catch (error) {
    console.warn('Embedding generation failed, saving without vector:', error);
  }

  const knowledgeId = uuidv4();
  const brief = (textValue(input.brief) || fingerprint).slice(0, 2_000);
  await execute(
    `INSERT INTO knowledge_entries (
      id, user_id, brief, task_type, selected_output, rejected_outputs, platform, audience, embedding,
      source_urls, conversation_id, project_id, quality_score, task_id, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      knowledgeId,
      input.userId,
      brief,
      input.taskType,
      selectedOutput,
      JSON.stringify(Array.isArray(input.rejectedOutputs) ? input.rejectedOutputs : []),
      textValue(input.platform) || null,
      textValue(input.audience) || null,
      embedding.length ? JSON.stringify(embedding) : null,
      serializeSourceUrls(input.sourceUrls),
      optionalRecordId(input.conversationId),
      optionalRecordId(input.projectId),
      qualityScore,
      taskId,
      contentHash,
    ],
  );

  const connectionsCount = await linkSimilarEntries(input.userId, knowledgeId, embedding);
  const updateStyle = input.updateStylePreferences ?? shouldUpdateStylePreferences(input.taskType, input.action);
  if (updateStyle) {
    try {
      await recordMarketingStyleSelection(input.userId, input.taskType);
    } catch (error) {
      console.warn('Style preference update failed:', error);
    }
  }

  return { knowledgeId, connectionsCount, deduped: false, skipped: false, qualityScore };
}

export async function persistKnowledgeQuietly(input: PersistKnowledgeInput): Promise<PersistKnowledgeResult | null> {
  try {
    return await persistKnowledgeEntry(input);
  } catch (error) {
    console.warn('Knowledge persist failed:', error);
    return null;
  }
}

export async function persistCompletedResearchAnswer(input: {
  userId: string;
  conversationId?: string | null;
  projectId?: string | null;
  query: string;
  answer: string;
  sources?: Array<{ title?: string; url: string }>;
  aborted?: boolean;
}): Promise<{ saved: number; deduped: number }> {
  try {
    if (!shouldPersistResearchAnswer(input.answer, Boolean(input.aborted))) return { saved: 0, deduped: 0 };
    const pieces = selectResearchKnowledgePieces({
      answer: input.answer,
      query: input.query,
      sources: input.sources,
    });
    let saved = 0;
    let deduped = 0;
    for (const piece of pieces) {
      try {
        const result = await persistKnowledgeEntry({
          userId: input.userId,
          taskType: AI_RESEARCH_KNOWLEDGE_TASK,
          brief: piece.brief,
          selectedOutput: piece.text,
          action: 'pin',
          sourceUrls: piece.sourceUrls,
          conversationId: input.conversationId,
          projectId: input.projectId,
          taskId: researchKnowledgeTaskId(input.conversationId || null, input.answer, piece.taskKey),
          updateStylePreferences: false,
        });
        if (result.skipped) continue;
        if (result.deduped) deduped += 1;
        else saved += 1;
      } catch (error) {
        console.warn('Research knowledge persist failed:', error);
      }
    }
    return { saved, deduped };
  } catch (error) {
    console.warn('Research knowledge persist failed:', error);
    return { saved: 0, deduped: 0 };
  }
}

async function loadDedupeCandidates(
  userId: string,
  taskType: string,
  taskId: string | null,
  contentHash: string,
  selectedOutput: string,
): Promise<KnowledgeDedupeRow[]> {
  const targeted = await queryAll<DbKnowledgeRow>(
    `SELECT id, task_id, content_hash, selected_output, quality_score, created_at
     FROM knowledge_entries
     WHERE user_id = ? AND task_type = ?
       AND (
         (? IS NOT NULL AND task_id = ?)
         OR content_hash = ?
         OR selected_output = ?
       )
     ORDER BY created_at DESC
     LIMIT 20`,
    [userId, taskType, taskId, taskId, contentHash, selectedOutput],
  );
  const recent = await queryAll<DbKnowledgeRow>(
    `SELECT id, task_id, content_hash, selected_output, quality_score, created_at
     FROM knowledge_entries
     WHERE user_id = ? AND task_type = ?
     ORDER BY created_at DESC
     LIMIT 25`,
    [userId, taskType],
  );
  const merged = new Map<string, KnowledgeDedupeRow>();
  for (const row of [...targeted, ...recent]) merged.set(row.id, toDedupeRow(row));
  return [...merged.values()];
}

function toDedupeRow(row: DbKnowledgeRow): KnowledgeDedupeRow {
  return {
    id: row.id,
    taskId: row.task_id || null,
    contentHash: row.content_hash || null,
    fingerprint: knowledgeFingerprint(row.selected_output),
    qualityScore: Number(row.quality_score || 0),
    createdAtMs: toMillis(row.created_at),
  };
}

async function linkSimilarEntries(userId: string, knowledgeId: string, embedding: number[]): Promise<number> {
  if (!embedding.length) return 0;
  const existing = await queryAll<{ id: string; embedding: string }>(
    'SELECT id, embedding FROM knowledge_entries WHERE user_id = ? AND id != ? AND embedding IS NOT NULL',
    [userId, knowledgeId],
  );
  let connections = 0;
  for (const row of existing) {
    try {
      const other = JSON.parse(row.embedding) as number[];
      const similarity = cosineSimilarity(embedding, other);
      if (similarity > SIMILARITY_THRESHOLD) {
        await execute(
          'INSERT INTO knowledge_edges (id, source_id, target_id, relationship, weight) VALUES (?, ?, ?, ?, ?)',
          [uuidv4(), knowledgeId, row.id, 'cosine_similarity', similarity],
        );
        connections += 1;
      }
    } catch {
      // Skip malformed embeddings already stored on older rows.
    }
  }
  return connections;
}

async function recordMarketingStyleSelection(userId: string, taskType: string): Promise<void> {
  const prefRow = await queryOne<{ total_selections?: number | string | null }>(
    'SELECT total_selections FROM user_style_preferences WHERE user_id = ?',
    [userId],
  );
  const totalSelections = Number(prefRow?.total_selections || 0) + 1;
  if (prefRow) {
    await execute(
      'UPDATE user_style_preferences SET total_selections = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [totalSelections, userId],
    );
  } else {
    await execute(
      'INSERT INTO user_style_preferences (id, user_id, total_selections) VALUES (?, ?, ?)',
      [uuidv4(), userId, totalSelections],
    );
  }

  if (totalSelections % 5 !== 0) return;
  try {
    const recent = await queryAll<{ selected_output: string; task_type: string; platform: string | null }>(
      'SELECT selected_output, task_type, platform FROM knowledge_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [userId],
    );
    const samples = recent.map((row, index) => `${index + 1}. [${row.task_type}/${row.platform}] ${row.selected_output}`).join('\n');
    const { generateContent, getUserPreferredModel } = await import('./openai');
    const { isGenerationFeature } = await import('./model-routing');
    const analysisFeature = isGenerationFeature(taskType) ? taskType : 'social-post';
    const model = await getUserPreferredModel(userId, analysisFeature);
    const { content: analysis } = await generateContent(
      'Analyze these marketing content selections and identify style patterns. Return JSON: { "styleSummary": string, "tonePreferences": {tone: count}, "hookPreferences": {hookType: count} }',
      samples,
      userId,
      undefined,
      { model, responseFormat: { type: 'json_object' }, taskType: analysisFeature },
    );
    const parsed = JSON.parse(analysis);
    await execute(
      'UPDATE user_style_preferences SET style_summary = ?, tone_preferences = ?, hook_preferences = ?, last_analyzed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [parsed.styleSummary, JSON.stringify(parsed.tonePreferences), JSON.stringify(parsed.hookPreferences), userId],
    );
  } catch (error) {
    console.warn('Auto style analysis failed:', error);
  }
}

function stringifyKnowledgeOutput(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= OUTPUT_CHAR_LIMIT) return text;
  return `${text.slice(0, OUTPUT_CHAR_LIMIT - 1)}…`;
}

function serializeSourceUrls(urls: string[] | undefined): string | null {
  const safe = safeSourceUrls(urls || []);
  return safe.length ? JSON.stringify(safe) : null;
}

function safeSourceUrls(values: unknown[]): string[] {
  const urls: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      for (const url of normalizePinnedSourceUrls([value])) {
        if (!urls.includes(url)) urls.push(url);
      }
    } catch {
      // Drop invalid or private URLs instead of failing the knowledge write.
    }
    if (urls.length >= 12) break;
  }
  return urls;
}

function optionalRecordId(value: unknown): string | null {
  try {
    return normalizeOptionalRecordId(value);
  } catch {
    return null;
  }
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalizeKnowledgeText(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return normalizeKnowledgeText(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (Array.isArray(value)) return value.map(item => normalizeKnowledgeText(item)).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferred = ['caption', 'hook', 'fullScript', 'concept', 'objective', 'articleMarkdown', 'title', 'mainEvent']
      .map(key => record[key])
      .filter(item => typeof item === 'string' && item.trim())
      .map(item => String(item).trim());
    if (preferred.length) return preferred.join('\n');
    return Object.keys(record).sort().map(key => {
      const text = normalizeKnowledgeText(record[key]);
      return text ? `${key}:${text}` : '';
    }).filter(Boolean).join('\n');
  }
  if (value == null) return '';
  return String(value).trim();
}

function toMillis(value: string | Date): number {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
