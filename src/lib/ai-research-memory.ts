/**
 * Per-user memory for AI Research.
 * Learns who the user is and which questions they already asked, then feeds
 * that into the next answer. Local embeddings only. When ai_memory_enabled
 * is off, nothing here is read or written.
 */

import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { execute, queryAll, queryOne } from './database';
import { cosineSimilarity, getEmbedding } from './embeddings';
import {
  clearUserMemoryGraph,
  mirrorQaTurn,
  mirrorUserMemory,
  removeQaTurnsFromGraph,
  removeUserMemoryFromGraph,
} from './ai-research-memory-graph';

export const SAME_QUESTION_SCORE = 0.8;
export const RELATED_QUESTION_SCORE = 0.6;
export const MEMORY_MERGE_SCORE = 0.86;
export const PROFILE_CHAR_LIMIT = 900;
export const PROFILE_MEMORY_LIMIT = 12;
export const PRIOR_QUESTION_LIMIT = 3;
/** Cheap model already on the AI Research allowlist. */
export const AI_RESEARCH_MEMORY_MODEL = 'ag/gemini-3-flash';
export const USER_PROFILE_HEADER = 'USER PROFILE (learned memory)';
export const PRIOR_ANSWERS_HEADER = 'PRIOR ANSWERS FROM THIS USER';

const MEMORY_KINDS = ['role', 'interest', 'preference', 'style', 'context'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

const KIND_LABEL: Record<MemoryKind, string> = {
  role: 'Role',
  interest: 'Interests',
  preference: 'Preferences',
  style: 'Style',
  context: 'Context',
};

const SENSITIVE_MEMORY = [
  /\bpasswords?\b/i,
  /\bapi[_ -]?keys?\b/i,
  /\bsecrets?\b/i,
  /\bcredentials?\b/i,
  /\bprivate[_ -]?keys?\b/i,
  /\baccess[_ -]?tokens?\b/i,
  /\bbearer\b/i,
  /\bssn\b/i,
  /\bcredit[_ -]?cards?\b/i,
  /\bcvv\b/i,
  /\bnomor induk\b/i,
  /\bdiagnos(?:is|ed)\b/i,
  /\bdiabetes\b/i,
  /\bcancer\b/i,
  /\bhiv\b/i,
  /\bpregnan(?:t|cy)\b/i,
  /\bdepress(?:ion|ed)\b/i,
  /\bmedications?\b/i,
  /\breligion\b/i,
  /\bmuslims?\b/i,
  /\bislam(?:ic)?\b/i,
  /\bchristians?\b/i,
  /\bcatholics?\b/i,
  /\bhindus?\b/i,
  /\bbuddhists?\b/i,
  /\bjewish\b/i,
  /\bath(?:eist|eism)\b/i,
  /\bagama\b/i,
  /\bsk-[A-Za-z0-9]{8,}\b/,
  /\bghp_[A-Za-z0-9]{8,}\b/,
  /-----BEGIN/,
];

export interface MemoryRow {
  id: string;
  userId: string;
  kind: MemoryKind;
  content: string;
  contentHash: string;
  embedding: number[] | null;
  sourceConversationId: string | null;
  mentionCount: number;
  confidence: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractedMemory {
  kind: MemoryKind;
  content: string;
  confidence: number;
  explicit: boolean;
}

export interface QaRow {
  id: string;
  userId: string;
  conversationId: string | null;
  question: string;
  questionNorm: string;
  answerSummary: string;
  sources: Array<{ title: string; url: string }>;
  embedding: number[] | null;
  createdAt: string;
}

export interface PriorQuestionMatch {
  conversationId: string | null;
  question: string;
  date: string;
  score: number;
  relation: 'same' | 'related';
  answerSummary: string;
  userId: string;
  createdAt: string;
}

export interface PublicMemory {
  id: string;
  kind: MemoryKind;
  content: string;
  mentionCount: number;
  confidence: number;
  updatedAt: string;
}

export interface MemoryIo {
  isEnabled(userId: string): Promise<boolean>;
  listMemories(userId: string): Promise<MemoryRow[]>;
  upsertMemory(row: MemoryRow): Promise<void>;
  listQa(userId: string): Promise<QaRow[]>;
  insertQa(row: QaRow): Promise<void>;
  complete(input: { userId: string; question: string; answer: string }): Promise<string>;
  touchMemories?(userId: string, ids: string[]): Promise<void>;
}

export function questionRelation(score: number): 'same' | 'related' | null {
  if (!Number.isFinite(score)) return null;
  if (score >= SAME_QUESTION_SCORE) return 'same';
  if (score >= RELATED_QUESTION_SCORE) return 'related';
  return null;
}

export function normalizeQuestion(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_000);
}

export function memoryContentHash(kind: string, content: string): string {
  const normalized = content.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(`${kind}\n${normalized}`).digest('hex');
}

export function isSensitiveMemory(content: string): boolean {
  const text = content.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  return SENSITIVE_MEMORY.some(pattern => pattern.test(text));
}

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value);
}

export function isPromotedMemory(memory: { kind: MemoryKind; mentionCount: number; confidence: number }): boolean {
  if (memory.kind === 'interest') return memory.mentionCount >= 2 || memory.confidence >= 0.8;
  return memory.confidence >= 0.5;
}

export function summarizeAnswer(answer: string): string {
  return answer.replace(/\s+/g, ' ').trim().slice(0, 500);
}

export function priorQuestionChipLabel(date: string): string {
  return `You asked something similar on ${date} — View answer`;
}

export function formatJakartaDate(value: string | Date, now: Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).formatToParts(date);
  const month = parts.find(part => part.type === 'month')?.value || '';
  const day = parts.find(part => part.type === 'day')?.value || '';
  const year = parts.find(part => part.type === 'year')?.value || '';
  const nowYear = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric' }).format(now);
  if (year && year === nowYear) return `${month} ${day}`;
  return `${month} ${day}, ${year}`;
}

function stripFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

export function parseExtractedMemories(raw: string): ExtractedMemory[] {
  const text = stripFence(typeof raw === 'string' ? raw : '');
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return [];
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const memories = (parsed as { memories?: unknown }).memories;
  if (!Array.isArray(memories)) return [];
  const extracted: ExtractedMemory[] = [];
  for (const item of memories) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { kind?: unknown; content?: unknown; confidence?: unknown; explicit?: unknown };
    if (!isMemoryKind(record.kind)) continue;
    const content = typeof record.content === 'string'
      ? record.content.replace(/\s+/g, ' ').trim().slice(0, 280)
      : '';
    if (content.length < 3 || isSensitiveMemory(content)) continue;
    const confidence = typeof record.confidence === 'number' && Number.isFinite(record.confidence)
      ? Math.min(1, Math.max(0, record.confidence))
      : 0.5;
    extracted.push({
      kind: record.kind,
      content,
      confidence,
      explicit: record.explicit === true,
    });
    if (extracted.length >= 4) break;
  }
  return extracted;
}

export function validateMemoryContent(value: unknown): { ok: true; content: string } | { ok: false; error: string } {
  if (typeof value !== 'string') return { ok: false, error: 'Enter the memory text.' };
  const content = value.replace(/\s+/g, ' ').trim().slice(0, 280);
  if (content.length < 3) return { ok: false, error: 'Enter the memory text.' };
  if (isSensitiveMemory(content)) return { ok: false, error: 'That memory can\'t be saved.' };
  return { ok: true, content };
}

function initialConfidence(item: ExtractedMemory): number {
  if (item.kind === 'interest' && !item.explicit) return Math.min(item.confidence, 0.6);
  return item.confidence;
}

function profileScore(memory: { confidence: number; mentionCount: number; updatedAt?: string | null; lastUsedAt?: string | null }, nowMs: number): number {
  const stamp = Date.parse(memory.lastUsedAt || memory.updatedAt || '') || nowMs;
  const ageDays = Math.max(0, (nowMs - stamp) / 86_400_000);
  return memory.confidence * 3 + Math.log2(1 + memory.mentionCount) + Math.exp(-ageDays / 45);
}

export function formatUserProfileBlock(
  memories: Array<Pick<MemoryRow, 'kind' | 'content' | 'mentionCount' | 'confidence'> & { updatedAt?: string | null; lastUsedAt?: string | null }>,
  nowMs = Date.now(),
): string {
  const ranked = memories
    .filter(isPromotedMemory)
    .sort((left, right) => profileScore(right, nowMs) - profileScore(left, nowMs))
    .slice(0, PROFILE_MEMORY_LIMIT);
  if (!ranked.length) return '';
  const grouped = new Map<MemoryKind, string[]>();
  for (const memory of ranked) {
    const list = grouped.get(memory.kind) || [];
    if (!list.includes(memory.content)) list.push(memory.content);
    grouped.set(memory.kind, list);
  }
  const lines = [USER_PROFILE_HEADER];
  for (const kind of MEMORY_KINDS) {
    const items = grouped.get(kind);
    if (!items?.length) continue;
    lines.push(`${KIND_LABEL[kind]}: ${items.join('; ')}`);
  }
  lines.push('Tailor depth, examples, and terminology to this profile. Do not announce that you remember the user. Do not cite this profile as a source.');
  const text = lines.join('\n');
  if (text.length <= PROFILE_CHAR_LIMIT) return text;
  return `${text.slice(0, PROFILE_CHAR_LIMIT - 1).trimEnd()}…`;
}

export function formatPriorAnswersBlock(matches: Array<Pick<PriorQuestionMatch, 'question' | 'date' | 'relation' | 'answerSummary'>>): string {
  if (!matches.length) return '';
  const lines = [PRIOR_ANSWERS_HEADER];
  matches.slice(0, PRIOR_QUESTION_LIMIT).forEach((match, index) => {
    const summary = match.answerSummary.replace(/\s+/g, ' ').trim().slice(0, 280);
    lines.push(`${index + 1}. [${match.relation}, ${match.date}] ${match.question.trim()}`);
    if (summary) lines.push(`   Earlier answer: ${summary}`);
  });
  lines.push('If the current question matches one of these, briefly reference that earlier answer and its date, say what changed, and re-verify prices, news, and licences with fresh sources. Never cite these prior answers as a public source.');
  return lines.join('\n');
}

export function rankPastQuestions(
  rows: QaRow[],
  options: {
    userId: string;
    questionEmbedding: number[];
    excludeConversationId?: string | null;
    now?: Date;
    limit?: number;
  },
): PriorQuestionMatch[] {
  const scored: PriorQuestionMatch[] = [];
  for (const row of rows) {
    if (row.userId !== options.userId) continue;
    if (options.excludeConversationId && row.conversationId === options.excludeConversationId) continue;
    if (!row.embedding?.length) continue;
    const score = cosineSimilarity(options.questionEmbedding, row.embedding);
    const relation = questionRelation(score);
    if (!relation) continue;
    scored.push({
      conversationId: row.conversationId,
      question: row.question,
      date: formatJakartaDate(row.createdAt, options.now),
      score,
      relation,
      answerSummary: row.answerSummary,
      userId: row.userId,
      createdAt: row.createdAt,
    });
  }
  scored.sort((left, right) => right.score - left.score || Date.parse(right.createdAt) - Date.parse(left.createdAt));
  return scored.slice(0, options.limit ?? PRIOR_QUESTION_LIMIT);
}

function mergeRow(existing: MemoryRow, incoming: ExtractedMemory, nowIso: string): MemoryRow {
  const incomingConfidence = initialConfidence(incoming);
  return {
    ...existing,
    mentionCount: existing.mentionCount + 1,
    confidence: Math.min(0.98, Math.max(existing.confidence, incomingConfidence) + 0.04),
    lastUsedAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function foldExtractedMemories(
  userId: string,
  existing: MemoryRow[],
  extracted: ExtractedMemory[],
  options?: { nowIso?: string; conversationId?: string | null; createId?: () => string },
): Promise<MemoryRow[]> {
  const nowIso = options?.nowIso || new Date().toISOString();
  const createId = options?.createId || uuidv4;
  const working = existing.filter(row => row.userId === userId).map(row => ({ ...row }));
  const saved: MemoryRow[] = [];

  for (const item of extracted) {
    if (!isMemoryKind(item.kind) || isSensitiveMemory(item.content)) continue;
    const content = item.content.replace(/\s+/g, ' ').trim().slice(0, 280);
    if (content.length < 3) continue;
    if (item.kind === 'context' && item.confidence < 0.7 && !item.explicit) continue;
    const normalized: ExtractedMemory = { ...item, content };
    const contentHash = memoryContentHash(normalized.kind, content);
    const byHash = working.find(row => row.kind === normalized.kind && row.contentHash === contentHash);
    if (byHash) {
      Object.assign(byHash, mergeRow(byHash, normalized, nowIso));
      saved.push({ ...byHash });
      continue;
    }

    const embedding = await getEmbedding(content);
    let similar: MemoryRow | null = null;
    let best = 0;
    for (const row of working) {
      if (row.kind !== normalized.kind) continue;
      let vector = row.embedding;
      if (!vector || vector.length !== embedding.length) {
        vector = await getEmbedding(row.content);
        row.embedding = vector;
      }
      const score = cosineSimilarity(embedding, vector);
      if (score >= MEMORY_MERGE_SCORE && score > best) {
        best = score;
        similar = row;
      }
    }
    if (similar) {
      Object.assign(similar, mergeRow(similar, normalized, nowIso));
      saved.push({ ...similar });
      continue;
    }

    const created: MemoryRow = {
      id: createId(),
      userId,
      kind: normalized.kind,
      content,
      contentHash,
      embedding,
      sourceConversationId: options?.conversationId || null,
      mentionCount: 1,
      confidence: initialConfidence(normalized),
      lastUsedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    working.push(created);
    saved.push(created);
  }
  return saved;
}

const MEMORY_EXTRACT_SYSTEM = `You extract durable facts about the USER for a private memory. Return only JSON: {"memories":[{"kind":"role"|"interest"|"preference"|"style"|"context","content":"short fact","confidence":0.0-1.0,"explicit":true|false}]}.

Rules:
- Facts are about who the user is, not about the world. Examples: role "Frontend engineer"; interest "React, Next.js, and CSS"; preference "prefers code-level examples"; style "direct and concise".
- explicit is true only when the user states it about themselves ("I am a frontend engineer", "I always want short answers").
- An interest inferred from a single question is explicit false. Do not treat one question as a stable interest unless they say they work on it or keep studying it.
- Never include secrets, passwords, API keys, credentials, health, religion, politics, government IDs, or other sensitive personal data.
- Skip one-off task details that will not matter next week.
- At most 4 memories. If nothing durable is present, return {"memories":[]}.`;

function cleanSources(sources: Array<{ title?: string; url?: string }> | undefined): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = [];
  for (const source of sources || []) {
    const url = typeof source?.url === 'string' ? source.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) continue;
    const title = (typeof source.title === 'string' && source.title.trim() ? source.title : url)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
    if (out.some(item => item.url === url)) continue;
    out.push({ title, url });
    if (out.length >= 8) break;
  }
  return out;
}

function asIso(value: string | Date | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function readEmbedding(raw: unknown): number[] | null {
  if (Array.isArray(raw)) {
    return raw.every(value => typeof value === 'number') ? raw as number[] : null;
  }
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some(value => typeof value !== 'number')) return null;
    return parsed as number[];
  } catch {
    return null;
  }
}

function readSources(raw: unknown): Array<{ title: string; url: string }> {
  const value = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : raw;
  if (!Array.isArray(value)) return [];
  return cleanSources(value as Array<{ title?: string; url?: string }>);
}

type DbMemory = {
  id: string;
  user_id: string;
  kind: string;
  content: string;
  content_hash: string;
  embedding: string | null;
  source_conversation_id: string | null;
  mention_count: number | string;
  confidence: number | string;
  last_used_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type DbQa = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  question: string;
  question_norm: string;
  answer_summary: string;
  sources: unknown;
  embedding: string | null;
  created_at: string | Date;
};

function mapMemory(row: DbMemory): MemoryRow | null {
  if (!isMemoryKind(row.kind)) return null;
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    content: row.content,
    contentHash: row.content_hash,
    embedding: readEmbedding(row.embedding),
    sourceConversationId: row.source_conversation_id,
    mentionCount: Number(row.mention_count) || 1,
    confidence: Number(row.confidence) || 0,
    lastUsedAt: row.last_used_at ? asIso(row.last_used_at) : null,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function mapQa(row: DbQa): QaRow {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    question: row.question,
    questionNorm: row.question_norm,
    answerSummary: row.answer_summary || '',
    sources: readSources(row.sources),
    embedding: readEmbedding(row.embedding),
    createdAt: asIso(row.created_at),
  };
}

function presentMemory(row: MemoryRow): PublicMemory {
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    mentionCount: row.mentionCount,
    confidence: row.confidence,
    updatedAt: row.updatedAt,
  };
}

async function defaultIsEnabled(userId: string): Promise<boolean> {
  const row = await queryOne<{ ai_memory_enabled: boolean | null }>(
    'SELECT ai_memory_enabled FROM users WHERE id = ?',
    [userId],
  );
  if (!row) return false;
  return row.ai_memory_enabled !== false;
}

async function defaultListMemories(userId: string): Promise<MemoryRow[]> {
  const rows = await queryAll<DbMemory>(
    `SELECT id, user_id, kind, content, content_hash, embedding, source_conversation_id,
            mention_count, confidence, last_used_at, created_at, updated_at
     FROM user_memories
     WHERE user_id = ?
     ORDER BY updated_at DESC
     LIMIT 80`,
    [userId],
  );
  return rows.flatMap(row => {
    const mapped = mapMemory(row);
    return mapped ? [mapped] : [];
  });
}

async function defaultUpsertMemory(row: MemoryRow): Promise<void> {
  const embedding = row.embedding?.length ? JSON.stringify(row.embedding) : null;
  const updated = await execute(
    `UPDATE user_memories
     SET kind = ?, content = ?, content_hash = ?, embedding = COALESCE(?::text, embedding),
         mention_count = ?, confidence = ?, last_used_at = ?, updated_at = ?,
         source_conversation_id = COALESCE(source_conversation_id, ?::text)
     WHERE id = ? AND user_id = ?`,
    [
      row.kind,
      row.content,
      row.contentHash,
      embedding,
      row.mentionCount,
      row.confidence,
      row.lastUsedAt,
      row.updatedAt,
      row.sourceConversationId,
      row.id,
      row.userId,
    ],
  );
  if (updated > 0) {
    await mirrorStoredMemory(row);
    return;
  }
  const stored = await queryOne<{ id: string }>(
    `INSERT INTO user_memories (
       id, user_id, kind, content, content_hash, embedding, source_conversation_id,
       mention_count, confidence, last_used_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, content_hash) DO UPDATE SET
       mention_count = GREATEST(user_memories.mention_count, EXCLUDED.mention_count),
       confidence = LEAST(0.98, GREATEST(user_memories.confidence, EXCLUDED.confidence)),
       embedding = COALESCE(EXCLUDED.embedding, user_memories.embedding),
       last_used_at = EXCLUDED.last_used_at,
       updated_at = EXCLUDED.updated_at
     RETURNING id`,
    [
      row.id,
      row.userId,
      row.kind,
      row.content,
      row.contentHash,
      embedding,
      row.sourceConversationId,
      row.mentionCount,
      row.confidence,
      row.lastUsedAt,
      row.createdAt,
      row.updatedAt,
    ],
  );
  await mirrorStoredMemory(stored?.id ? { ...row, id: stored.id } : row);
}

async function mirrorStoredMemory(row: MemoryRow): Promise<void> {
  try {
    await mirrorUserMemory({
      userId: row.userId,
      memoryId: row.id,
      kind: row.kind,
      content: row.content,
      conversationId: row.sourceConversationId,
      embedding: row.embedding,
    });
  } catch (error) {
    console.warn('[ai-research] memory graph mirror failed:', error);
  }
}

async function defaultListQa(userId: string): Promise<QaRow[]> {
  const rows = await queryAll<DbQa>(
    `SELECT id, user_id, conversation_id, question, question_norm, answer_summary, sources, embedding, created_at
     FROM ai_research_qa_index
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 200`,
    [userId],
  );
  return rows.map(mapQa);
}

async function defaultInsertQa(row: QaRow): Promise<void> {
  await execute(
    `INSERT INTO ai_research_qa_index (
       id, user_id, conversation_id, question, question_norm, answer_summary, sources, embedding, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)`,
    [
      row.id,
      row.userId,
      row.conversationId,
      row.question,
      row.questionNorm,
      row.answerSummary,
      JSON.stringify(row.sources),
      row.embedding?.length ? JSON.stringify(row.embedding) : null,
      row.createdAt,
    ],
  );
}

async function defaultComplete(input: { userId: string; question: string; answer: string }): Promise<string> {
  const { generateContent } = await import('./openai');
  const question = input.question.replace(/\s+/g, ' ').trim().slice(0, 1_500);
  const answer = input.answer.replace(/\s+/g, ' ').trim().slice(0, 1_500);
  const result = await generateContent(
    MEMORY_EXTRACT_SYSTEM,
    `User question:\n${question}\n\nAssistant answer:\n${answer}`,
    input.userId,
    undefined,
    {
      model: AI_RESEARCH_MEMORY_MODEL,
      responseFormat: { type: 'json_object' },
      temperature: 0.1,
      maxTokens: 500,
      taskType: 'ai-research',
      jsonRepairAttempts: 0,
    },
  );
  return result.content;
}

async function defaultTouchMemories(userId: string, ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, PROFILE_MEMORY_LIMIT);
  if (!unique.length) return;
  const placeholders = unique.map(() => '?').join(', ');
  await execute(
    `UPDATE user_memories SET last_used_at = NOW() WHERE user_id = ? AND id IN (${placeholders})`,
    [userId, ...unique],
  );
}

const defaultMemoryIo: MemoryIo = {
  isEnabled: defaultIsEnabled,
  listMemories: defaultListMemories,
  upsertMemory: defaultUpsertMemory,
  listQa: defaultListQa,
  insertQa: defaultInsertQa,
  complete: defaultComplete,
  touchMemories: defaultTouchMemories,
};

function resolveIo(override?: Partial<MemoryIo>): MemoryIo {
  return { ...defaultMemoryIo, ...override };
}

export async function indexQaTurn(
  input: {
    userId: string;
    conversationId?: string | null;
    question: string;
    answer: string;
    sources?: Array<{ title?: string; url?: string }>;
  },
  io?: Partial<MemoryIo>,
): Promise<void> {
  try {
    const store = resolveIo(io);
    if (!input.userId || !(await store.isEnabled(input.userId))) return;
    const question = input.question.replace(/\s+/g, ' ').trim().slice(0, 2_000);
    if (question.length < 3) return;
    const createdAt = new Date().toISOString();
    const row: QaRow = {
      id: uuidv4(),
      userId: input.userId,
      conversationId: input.conversationId || null,
      question,
      questionNorm: normalizeQuestion(question),
      answerSummary: summarizeAnswer(input.answer || ''),
      sources: cleanSources(input.sources),
      embedding: await getEmbedding(question),
      createdAt,
    };
    await store.insertQa(row);
    if (!io) {
      try {
        await mirrorQaTurn({
          userId: row.userId,
          qaId: row.id,
          conversationId: row.conversationId,
          question: row.question,
          answerSummary: row.answerSummary,
          embedding: row.embedding,
        });
      } catch (error) {
        console.warn('[ai-research] Q&A graph mirror failed:', error);
      }
    }
  } catch (error) {
    console.warn('[ai-research] QA index failed:', error);
  }
}

export async function findSimilarPastQuestions(
  userId: string,
  question: string,
  excludeConversationId?: string | null,
  io?: Partial<MemoryIo>,
): Promise<PriorQuestionMatch[]> {
  try {
    const trimmed = question.replace(/\s+/g, ' ').trim();
    if (!userId || trimmed.length < 3) return [];
    const store = resolveIo(io);
    if (!(await store.isEnabled(userId))) return [];
    const rows = await store.listQa(userId);
    return rankPastQuestions(rows, {
      userId,
      questionEmbedding: await getEmbedding(trimmed),
      excludeConversationId,
    });
  } catch (error) {
    console.warn('[ai-research] past-question lookup failed:', error);
    return [];
  }
}

export async function extractUserMemories(
  input: {
    userId: string;
    conversationId?: string | null;
    question: string;
    answer: string;
  },
  io?: Partial<MemoryIo>,
): Promise<void> {
  try {
    if (!input.userId || input.question.trim().length < 3) return;
    const store = resolveIo(io);
    if (!(await store.isEnabled(input.userId))) return;
    const raw = await store.complete({
      userId: input.userId,
      question: input.question,
      answer: input.answer,
    });
    const extracted = parseExtractedMemories(raw);
    if (!extracted.length) return;
    const existing = (await store.listMemories(input.userId)).filter(row => row.userId === input.userId);
    const writes = await foldExtractedMemories(input.userId, existing, extracted, {
      conversationId: input.conversationId,
    });
    for (const row of writes) await store.upsertMemory(row);
  } catch (error) {
    console.warn('[ai-research] memory extraction failed:', error);
  }
}

export async function loadUserProfileBlock(userId: string, io?: Partial<MemoryIo>): Promise<string> {
  try {
    if (!userId) return '';
    const store = resolveIo(io);
    if (!(await store.isEnabled(userId))) return '';
    const memories = (await store.listMemories(userId)).filter(row => row.userId === userId);
    const block = formatUserProfileBlock(memories);
    if (!block) return '';
    const shown = memories
      .filter(isPromotedMemory)
      .sort((left, right) => profileScore(right, Date.now()) - profileScore(left, Date.now()))
      .slice(0, PROFILE_MEMORY_LIMIT);
    try {
      if (!io || io.touchMemories) {
        await store.touchMemories?.(userId, shown.map(memory => memory.id));
      }
    } catch (error) {
      console.warn('[ai-research] memory touch failed:', error);
    }
    return block;
  } catch (error) {
    console.warn('[ai-research] profile load failed:', error);
    return '';
  }
}

export async function deleteQaForConversation(userId: string, conversationId: string): Promise<void> {
  if (!userId || !conversationId) return;
  const rows = await queryAll<{ id: string }>(
    'SELECT id FROM ai_research_qa_index WHERE user_id = ? AND conversation_id = ?',
    [userId, conversationId],
  );
  await removeQaTurnsFromGraph(userId, rows.map(row => row.id));
  await execute(
    'DELETE FROM ai_research_qa_index WHERE user_id = ? AND conversation_id = ?',
    [userId, conversationId],
  );
}

export async function listMemorySettings(userId: string): Promise<{ enabled: boolean; memories: PublicMemory[] }> {
  const enabled = await defaultIsEnabled(userId);
  const memories = (await defaultListMemories(userId))
    .filter(row => row.userId === userId)
    .map(presentMemory);
  return { enabled, memories };
}

export async function setAiMemoryEnabled(userId: string, enabled: boolean): Promise<boolean> {
  await execute('UPDATE users SET ai_memory_enabled = ?, updated_at = NOW() WHERE id = ?', [enabled, userId]);
  return enabled;
}

export async function updateMemoryContent(
  userId: string,
  id: string,
  content: string,
): Promise<{ ok: true; memory: PublicMemory } | { ok: false; status: number; error: string }> {
  const validated = validateMemoryContent(content);
  if (!validated.ok) return { ok: false, status: 400, error: validated.error };
  const current = await queryOne<DbMemory>(
    `SELECT id, user_id, kind, content, content_hash, embedding, source_conversation_id,
            mention_count, confidence, last_used_at, created_at, updated_at
     FROM user_memories WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  const mapped = current ? mapMemory(current) : null;
  if (!mapped) return { ok: false, status: 404, error: 'Memory not found.' };
  const contentHash = memoryContentHash(mapped.kind, validated.content);
  const clash = await queryOne<{ id: string }>(
    'SELECT id FROM user_memories WHERE user_id = ? AND content_hash = ? AND id <> ?',
    [userId, contentHash, id],
  );
  if (clash) return { ok: false, status: 409, error: 'A memory with that text already exists.' };
  const embedding = await getEmbedding(validated.content);
  const updatedAt = new Date().toISOString();
  await execute(
    `UPDATE user_memories
     SET content = ?, content_hash = ?, embedding = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [validated.content, contentHash, JSON.stringify(embedding), updatedAt, id, userId],
  );
  await mirrorStoredMemory({ ...mapped, content: validated.content, contentHash, embedding, updatedAt });
  return {
    ok: true,
    memory: presentMemory({ ...mapped, content: validated.content, contentHash, embedding, updatedAt }),
  };
}

export async function deleteMemory(userId: string, id: string): Promise<boolean> {
  await removeUserMemoryFromGraph(userId, id);
  const removed = await execute('DELETE FROM user_memories WHERE id = ? AND user_id = ?', [id, userId]);
  return removed > 0;
}

export async function clearMemories(userId: string): Promise<number> {
  await clearUserMemoryGraph(userId);
  return execute('DELETE FROM user_memories WHERE user_id = ?', [userId]);
}
