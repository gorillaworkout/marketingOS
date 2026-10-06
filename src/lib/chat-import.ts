import { v4 as uuidv4 } from 'uuid';
import {
  memoryContentHash,
  normalizeQuestion,
  type MemoryKind,
} from './ai-research-memory';
import { mirrorQaTurn, mirrorUserMemory } from './ai-research-memory-graph';
import {
  applyApproval,
  completeImportExtraction,
  emptyImportDraft,
  FACT_EXTRACTION_FAILED,
  readStoredDraft,
  requestImportDraft,
  type ImportDraft,
} from './chat-import-extract';
import {
  INSERT_IMPORTED_CHAT_NODE_SQL,
  importedChatNodeFields,
  isUniqueViolation,
} from './chat-import-graph';
import {
  IMPORT_FILE_BYTE_LIMIT,
  MultiChatImportError,
  isChatImportSource,
  parseImportedChat,
  type ChatImportSource,
  type ImportParser,
} from './chat-import-parse';
import { execute, executeTransaction, queryAll, queryOne } from './database';
import { getEmbedding } from './embeddings';

export type ChatImportStatus = 'review' | 'extract_failed' | 'approved' | 'chat_only';

export interface ApproveCounts {
  factsSaved: number;
  factsAlreadySaved: number;
  qaSaved: number;
  qaAlreadySaved: number;
}

export interface ChatImportRow {
  id: string;
  userId: string;
  source: ChatImportSource;
  parser: ImportParser;
  parserFallback: boolean;
  title: string;
  transcript: string;
  contentHash: string;
  status: ChatImportStatus;
  draft: ImportDraft;
  knowledgeEntryId: string | null;
  error: string | null;
  approveResult: ApproveCounts | null;
  createdAt: string;
}

export interface PublicImport {
  id: string;
  source: ChatImportSource;
  parser: ImportParser;
  parserFallback: boolean;
  title: string;
  status: ChatImportStatus;
  knowledgeEntryId: string | null;
  memoryEnabled: boolean;
  draft: ImportDraft;
  error: string | null;
}

export interface PublicImportListItem {
  id: string;
  title: string;
  status: ChatImportStatus;
  source: ChatImportSource;
  parserFallback: boolean;
  createdAt: string;
  knowledgeEntryId: string | null;
}

export interface PublicImportDetail extends PublicImport {
  transcript: string;
}

export interface ChatImportDeps {
  createId(): string;
  isMemoryEnabled(userId: string): Promise<boolean>;
  findByHash(userId: string, contentHash: string): Promise<ChatImportRow | null>;
  findById(userId: string, id: string): Promise<ChatImportRow | null>;
  list(userId: string): Promise<ChatImportRow[]>;
  insertSavedChat(row: ChatImportRow): Promise<'inserted' | 'duplicate'>;
  saveDraft(userId: string, id: string, draft: ImportDraft): Promise<void>;
  saveExtractFailure(userId: string, id: string): Promise<void>;
  findMemory(userId: string, contentHash: string): Promise<{ id: string; mentionCount: number } | null>;
  bumpMemory(userId: string, id: string): Promise<void>;
  writeMemory(row: { id: string; userId: string; kind: MemoryKind; content: string; contentHash: string; mentionCount: number; confidence: number }): Promise<string>;
  findQa(userId: string, questionNorm: string): Promise<{ id: string } | null>;
  writeQa(row: { id: string; userId: string; question: string; questionNorm: string; answerSummary: string }): Promise<string>;
  mirrorMemory(input: { userId: string; memoryId: string; kind: string; content: string; embedding: number[] | null }): Promise<string | null>;
  mirrorQa(input: { userId: string; qaId: string; question: string; answerSummary: string; embedding: number[] | null }): Promise<string | null>;
  linkLearnedFrom(sourceNodeId: string, importNodeId: string): Promise<void>;
  markApproved(userId: string, id: string, result: ApproveCounts): Promise<void>;
  markChatOnly(userId: string, id: string): Promise<void>;
  embed(text: string): Promise<number[]>;
  complete(userId: string, prompt: string): Promise<string>;
  log(id: string, status: string): void;
}

export type ChatImportResult = {
  ok: true;
  status: 200;
  body: Record<string, unknown>;
} | {
  ok: false;
  status: 400 | 404 | 409;
  body: { error: string; existingImportId?: string; knowledgeEntryId?: string | null };
};

export const LIST_CHAT_IMPORTS_SQL = `SELECT id, user_id, source, parser, parser_fallback, title, transcript, content_hash, status, draft, knowledge_entry_id, error, approve_result, created_at FROM chat_imports WHERE user_id = ? ORDER BY created_at DESC`;
export const READ_CHAT_IMPORT_SQL = `SELECT id, user_id, source, parser, parser_fallback, title, transcript, content_hash, status, draft, knowledge_entry_id, error, approve_result, created_at FROM chat_imports WHERE id = ? AND user_id = ?`;
export const INSERT_CHAT_IMPORT_SQL = `INSERT INTO chat_imports SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, NULL, NULL, NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM chat_imports WHERE user_id = ? AND content_hash = ?)`;
export const SAVE_DRAFT_SQL = `UPDATE chat_imports SET status = 'review', draft = ?::jsonb, error = NULL, updated_at = NOW() WHERE id = ? AND user_id = ? AND status IN ('extract_failed', 'chat_only')`;
export const SAVE_EXTRACT_FAILURE_SQL = `UPDATE chat_imports SET status = 'extract_failed', draft = '{"facts":[],"qa":[]}'::jsonb, error = 'Fact extraction failed.', updated_at = NOW() WHERE id = ? AND user_id = ?`;
export const EXTRACT_SUCCESS_SQL = `UPDATE chat_imports SET status = 'review', draft = ?::jsonb, error = NULL, updated_at = NOW() WHERE id = ? AND user_id = ? AND status IN ('extract_failed', 'chat_only')`;
export const EXTRACT_FAILURE_SQL = `UPDATE chat_imports SET status = 'extract_failed', draft = '{"facts":[],"qa":[]}'::jsonb, error = 'Fact extraction failed.', updated_at = NOW() WHERE id = ? AND user_id = ?`;
export const APPROVE_CHAT_IMPORT_SQL = `UPDATE chat_imports SET status = 'approved', draft = '{"facts":[],"qa":[]}'::jsonb, error = NULL, approve_result = ?::jsonb, updated_at = NOW() WHERE id = ? AND user_id = ?`;
export const CANCEL_CHAT_IMPORT_SQL = `UPDATE chat_imports SET status = 'chat_only', draft = '{"facts":[],"qa":[]}'::jsonb, error = NULL, updated_at = NOW() WHERE id = ? AND user_id = ? AND status IN ('review', 'extract_failed')`;

const NOT_FOUND = 'Import was not found.';
const DUPLICATE = 'This chat is already imported.';
const STATUSES = new Set<ChatImportStatus>(['review', 'extract_failed', 'approved', 'chat_only']);

type DbImport = {
  id: string;
  user_id: string;
  source: string;
  parser: string;
  parser_fallback: boolean | null;
  title: string;
  transcript: string;
  content_hash: string;
  status: string;
  draft: unknown;
  knowledge_entry_id: string | null;
  error: string | null;
  approve_result: unknown;
  created_at: string | Date;
};

function notFound(): ChatImportResult {
  return { ok: false, status: 404, body: { error: NOT_FOUND } };
}

function duplicateOf(row: ChatImportRow): ChatImportResult {
  return {
    ok: false,
    status: 409,
    body: {
      error: DUPLICATE,
      existingImportId: row.id,
      knowledgeEntryId: row.knowledgeEntryId,
    },
  };
}

function asIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value || '') : parsed.toISOString();
}

function isParser(value: string): value is ImportParser {
  return value === 'codex' || value === 'claude' || value === 'text';
}

function readApproveResult(value: unknown): ApproveCounts | null {
  if (typeof value === 'string') {
    try {
      return readApproveResult(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<ApproveCounts>;
  return {
    factsSaved: Number(row.factsSaved) || 0,
    factsAlreadySaved: Number(row.factsAlreadySaved) || 0,
    qaSaved: Number(row.qaSaved) || 0,
    qaAlreadySaved: Number(row.qaAlreadySaved) || 0,
  };
}

function mapRow(row: DbImport): ChatImportRow | null {
  if (!isChatImportSource(row.source) || !isParser(row.parser) || !STATUSES.has(row.status as ChatImportStatus)) return null;
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source,
    parser: row.parser,
    parserFallback: row.parser_fallback === true,
    title: row.title,
    transcript: row.transcript || '',
    contentHash: row.content_hash,
    status: row.status as ChatImportStatus,
    draft: readStoredDraft(row.draft),
    knowledgeEntryId: row.knowledge_entry_id,
    error: row.error,
    approveResult: readApproveResult(row.approve_result),
    createdAt: asIso(row.created_at),
  };
}

export function presentImport(row: ChatImportRow, memoryEnabled: boolean): PublicImport {
  return {
    id: row.id,
    source: row.source,
    parser: row.parser,
    parserFallback: row.parserFallback,
    title: row.title,
    status: row.status,
    knowledgeEntryId: row.knowledgeEntryId,
    memoryEnabled,
    draft: row.draft,
    error: row.error,
  };
}

export function presentImportDetail(row: ChatImportRow, memoryEnabled: boolean): PublicImportDetail {
  return { ...presentImport(row, memoryEnabled), transcript: row.transcript };
}

export function presentImportListItem(row: ChatImportRow): PublicImportListItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    source: row.source,
    parserFallback: row.parserFallback,
    createdAt: row.createdAt,
    knowledgeEntryId: row.knowledgeEntryId,
  };
}

async function reload(userId: string, id: string, fallback: ChatImportRow, deps: ChatImportDeps): Promise<ChatImportRow> {
  return await deps.findById(userId, id) || fallback;
}

export async function createChatImport(userId: string, source: ChatImportSource, raw: string, deps: ChatImportDeps): Promise<ChatImportResult> {
  let parsed;
  try {
    parsed = parseImportedChat(source, raw);
  } catch (error) {
    if (error instanceof MultiChatImportError) return { ok: false, status: 400, body: { error: error.message } };
    throw error;
  }
  const existing = await deps.findByHash(userId, parsed.contentHash);
  if (existing) return duplicateOf(existing);
  const id = deps.createId();
  const knowledgeEntryId = deps.createId();
  const row: ChatImportRow = {
    id,
    userId,
    source,
    parser: parsed.parser,
    parserFallback: parsed.parserFallback,
    title: parsed.title,
    transcript: parsed.transcript,
    contentHash: parsed.contentHash,
    status: 'extract_failed',
    draft: emptyImportDraft(),
    knowledgeEntryId,
    error: null,
    approveResult: null,
    createdAt: new Date().toISOString(),
  };
  const inserted = await deps.insertSavedChat(row);
  if (inserted === 'duplicate') {
    const raced = await deps.findByHash(userId, parsed.contentHash);
    return raced ? duplicateOf(raced) : notFound();
  }
  deps.log(id, 'extract_failed');
  const memoryEnabled = await deps.isMemoryEnabled(userId);
  const extracted = await requestImportDraft({
    transcript: row.transcript,
    complete: prompt => deps.complete(userId, prompt),
    createId: deps.createId,
  });
  if (!extracted.ok) {
    await deps.saveExtractFailure(userId, id);
    deps.log(id, 'extract_failed');
    const saved = await reload(userId, id, { ...row, error: FACT_EXTRACTION_FAILED }, deps);
    return { ok: true, status: 200, body: { import: presentImport(saved, memoryEnabled) } };
  }
  await deps.saveDraft(userId, id, extracted.draft);
  deps.log(id, 'review');
  const saved = await reload(userId, id, { ...row, status: 'review', draft: extracted.draft, error: null }, deps);
  return { ok: true, status: 200, body: { import: presentImport(saved, memoryEnabled) } };
}

export async function listChatImports(userId: string, deps: ChatImportDeps): Promise<PublicImportListItem[]> {
  const rows = await deps.list(userId);
  return rows.map(presentImportListItem);
}

export async function readChatImport(userId: string, id: string, deps: ChatImportDeps): Promise<ChatImportResult> {
  const row = await deps.findById(userId, id);
  if (!row) return notFound();
  const memoryEnabled = await deps.isMemoryEnabled(userId);
  return { ok: true, status: 200, body: { import: presentImportDetail(row, memoryEnabled) } };
}

const EMPTY_COUNTS: ApproveCounts = { factsSaved: 0, factsAlreadySaved: 0, qaSaved: 0, qaAlreadySaved: 0 };

export async function approveChatImport(
  userId: string,
  id: string,
  body: { facts?: unknown; qa?: unknown },
  deps: ChatImportDeps,
): Promise<ChatImportResult> {
  const row = await deps.findById(userId, id);
  if (!row) return notFound();
  if (row.status === 'approved') {
    return {
      ok: true,
      status: 200,
      body: { status: 'approved', ...(row.approveResult || EMPTY_COUNTS), alreadyApproved: true },
    };
  }
  if (row.status !== 'review') return { ok: false, status: 409, body: { error: 'Extract facts before approving.' } };
  const selection = applyApproval(row.draft, body);
  if (!selection.ok) return { ok: false, status: 400, body: { error: selection.error } };
  const counts = { ...EMPTY_COUNTS };
  for (const fact of selection.facts) {
    const contentHash = memoryContentHash(fact.kind, fact.content);
    let memoryId: string | null = null;
    const existing = await deps.findMemory(userId, contentHash);
    if (existing) {
      await deps.bumpMemory(userId, existing.id);
      counts.factsAlreadySaved += 1;
      memoryId = existing.id;
    } else {
      const createdId = deps.createId();
      try {
        memoryId = await deps.writeMemory({
          id: createdId,
          userId,
          kind: fact.kind,
          content: fact.content,
          contentHash,
          mentionCount: 1,
          confidence: Math.max(0.8, fact.confidence),
        });
        counts.factsSaved += 1;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const again = await deps.findMemory(userId, contentHash);
        if (again) {
          await deps.bumpMemory(userId, again.id);
          memoryId = again.id;
        }
        counts.factsAlreadySaved += 1;
      }
    }
    if (!memoryId) continue;
    const embedding = await deps.embed(fact.content);
    const nodeId = await deps.mirrorMemory({
      userId,
      memoryId,
      kind: fact.kind,
      content: fact.content,
      embedding,
    });
    if (nodeId && row.knowledgeEntryId) await deps.linkLearnedFrom(nodeId, row.knowledgeEntryId);
  }
  for (const qa of selection.qa) {
    const questionNorm = normalizeQuestion(qa.question);
    const existing = await deps.findQa(userId, questionNorm);
    if (existing) {
      counts.qaAlreadySaved += 1;
      continue;
    }
    const qaId = deps.createId();
    await deps.writeQa({
      id: qaId,
      userId,
      question: qa.question,
      questionNorm,
      answerSummary: qa.answerSummary,
    });
    counts.qaSaved += 1;
    const embedding = await deps.embed(qa.question);
    const nodeId = await deps.mirrorQa({
      userId,
      qaId,
      question: qa.question,
      answerSummary: qa.answerSummary,
      embedding,
    });
    if (nodeId && row.knowledgeEntryId) await deps.linkLearnedFrom(nodeId, row.knowledgeEntryId);
  }
  await deps.markApproved(userId, id, counts);
  deps.log(id, 'approved');
  return { ok: true, status: 200, body: { status: 'approved', ...counts } };
}

export async function cancelChatImport(userId: string, id: string, deps: ChatImportDeps): Promise<ChatImportResult> {
  const row = await deps.findById(userId, id);
  if (!row) return notFound();
  if (row.status === 'approved') return { ok: false, status: 409, body: { error: 'This import is already approved.' } };
  if (row.status !== 'chat_only') {
    await deps.markChatOnly(userId, id);
    deps.log(id, 'chat_only');
  }
  return { ok: true, status: 200, body: { status: 'chat_only', id: row.id, knowledgeEntryId: row.knowledgeEntryId } };
}

export async function retryChatImport(userId: string, id: string, deps: ChatImportDeps): Promise<ChatImportResult> {
  const row = await deps.findById(userId, id);
  if (!row) return notFound();
  if (row.status === 'review' || row.status === 'approved') {
    return { ok: false, status: 409, body: { error: 'Nothing to extract.' } };
  }
  const memoryEnabled = await deps.isMemoryEnabled(userId);
  const extracted = await requestImportDraft({
    transcript: row.transcript,
    complete: prompt => deps.complete(userId, prompt),
    createId: deps.createId,
  });
  if (!extracted.ok) {
    await deps.saveExtractFailure(userId, id);
    deps.log(id, 'extract_failed');
    const saved = await reload(userId, id, { ...row, status: 'extract_failed', draft: emptyImportDraft(), error: FACT_EXTRACTION_FAILED }, deps);
    return { ok: true, status: 200, body: { import: presentImport(saved, memoryEnabled) } };
  }
  await deps.saveDraft(userId, id, extracted.draft);
  deps.log(id, 'review');
  const saved = await reload(userId, id, { ...row, status: 'review', draft: extracted.draft, error: null }, deps);
  return { ok: true, status: 200, body: { import: presentImport(saved, memoryEnabled) } };
}

async function edgeExists(sourceId: string, targetId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM knowledge_edges
     WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)`,
    [sourceId, targetId, targetId, sourceId],
  );
  return Boolean(row);
}

export function postgresChatImportDeps(): ChatImportDeps {
  return {
    createId: () => uuidv4(),
    isMemoryEnabled: async userId => {
      const row = await queryOne<{ ai_memory_enabled: boolean | null }>(
        'SELECT ai_memory_enabled FROM users WHERE id = ?',
        [userId],
      );
      if (!row) return false;
      return row.ai_memory_enabled !== false;
    },
    findByHash: async (userId, contentHash) => {
      const row = await queryOne<DbImport>(
        `SELECT id, user_id, source, parser, parser_fallback, title, transcript, content_hash, status, draft, knowledge_entry_id, error, approve_result, created_at
         FROM chat_imports WHERE user_id = ? AND content_hash = ? LIMIT 1`,
        [userId, contentHash],
      );
      return row ? mapRow(row) : null;
    },
    findById: async (userId, id) => {
      const row = await queryOne<DbImport>(READ_CHAT_IMPORT_SQL, [id, userId]);
      return row ? mapRow(row) : null;
    },
    list: async userId => {
      const rows = await queryAll<DbImport>(LIST_CHAT_IMPORTS_SQL, [userId]);
      return rows.flatMap(row => {
        const mapped = mapRow(row);
        return mapped ? [mapped] : [];
      });
    },
    insertSavedChat: async row => {
      const knowledgeEntryId = row.knowledgeEntryId || uuidv4();
      const fields = importedChatNodeFields({
        id: row.id,
        title: row.title,
        transcript: row.transcript,
        contentHash: row.contentHash,
        knowledgeEntryId,
      });
      const embedding = await getEmbedding(fields.embeddingInput);
      try {
        const count = await executeTransaction(async transaction => {
          await transaction.execute(INSERT_IMPORTED_CHAT_NODE_SQL, [
            fields.id,
            row.userId,
            fields.brief,
            fields.taskType,
            fields.selectedOutput,
            JSON.stringify(embedding),
            fields.qualityScore,
            fields.taskId,
            fields.contentHash,
          ]);
          return transaction.execute(INSERT_CHAT_IMPORT_SQL, [
            row.id,
            row.userId,
            row.source,
            row.parser,
            row.parserFallback,
            row.title,
            row.transcript,
            row.contentHash,
            row.status,
            JSON.stringify(row.draft),
            knowledgeEntryId,
            row.userId,
            row.contentHash,
          ]);
        });
        return count > 0 ? 'inserted' : 'duplicate';
      } catch (error) {
        if (isUniqueViolation(error)) return 'duplicate';
        throw error;
      }
    },
    saveDraft: async (userId, id, draft) => {
      await execute(EXTRACT_SUCCESS_SQL, [JSON.stringify(draft), id, userId]);
    },
    saveExtractFailure: async (userId, id) => {
      await execute(EXTRACT_FAILURE_SQL, [id, userId]);
    },
    findMemory: async (userId, contentHash) => {
      const row = await queryOne<{ id: string; mention_count: number }>(
        'SELECT id, mention_count FROM user_memories WHERE user_id = ? AND content_hash = ?',
        [userId, contentHash],
      );
      return row ? { id: row.id, mentionCount: Number(row.mention_count) || 0 } : null;
    },
    bumpMemory: async (userId, id) => {
      await execute(
        'UPDATE user_memories SET mention_count = mention_count + 1, updated_at = NOW() WHERE id = ? AND user_id = ?',
        [id, userId],
      );
    },
    writeMemory: async row => {
      const embedding = JSON.stringify(await getEmbedding(row.content));
      await execute(
        `INSERT INTO user_memories (
           id, user_id, kind, content, content_hash, embedding, source_conversation_id,
           mention_count, confidence, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NOW(), NOW())`,
        [row.id, row.userId, row.kind, row.content, row.contentHash, embedding, row.mentionCount, row.confidence],
      );
      return row.id;
    },
    findQa: async (userId, questionNorm) => {
      const row = await queryOne<{ id: string }>(
        'SELECT id FROM ai_research_qa_index WHERE user_id = ? AND question_norm = ? LIMIT 1',
        [userId, questionNorm],
      );
      return row || null;
    },
    writeQa: async row => {
      const embedding = JSON.stringify(await getEmbedding(row.question));
      await execute(
        `INSERT INTO ai_research_qa_index (
           id, user_id, conversation_id, question, question_norm, answer_summary, sources, embedding, created_at
         ) VALUES (?, ?, NULL, ?, ?, ?, '[]'::jsonb, ?, NOW())`,
        [row.id, row.userId, row.question, row.questionNorm, row.answerSummary, embedding],
      );
      return row.id;
    },
    mirrorMemory: async input => {
      try {
        return await mirrorUserMemory({ ...input, conversationId: null });
      } catch {
        console.warn('[ai-research] chat import', { id: input.memoryId, status: 'mirror_failed' });
        return null;
      }
    },
    mirrorQa: async input => {
      try {
        return await mirrorQaTurn({ ...input, conversationId: null });
      } catch {
        console.warn('[ai-research] chat import', { id: input.qaId, status: 'mirror_failed' });
        return null;
      }
    },
    linkLearnedFrom: async (sourceNodeId, importNodeId) => {
      if (await edgeExists(sourceNodeId, importNodeId)) return;
      await execute(
        'INSERT INTO knowledge_edges (id, source_id, target_id, relationship, weight, metadata) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), sourceNodeId, importNodeId, 'learned_from', 1, JSON.stringify({ auto_generated: true })],
      );
    },
    markApproved: async (userId, id, result) => {
      await execute(APPROVE_CHAT_IMPORT_SQL, [JSON.stringify(result), id, userId]);
    },
    markChatOnly: async (userId, id) => {
      await execute(CANCEL_CHAT_IMPORT_SQL, [id, userId]);
    },
    embed: text => getEmbedding(text),
    complete: (userId, prompt) => completeImportExtraction(userId, prompt),
    log: (id, status) => {
      console.info('[ai-research] chat import', { id, status });
    },
  };
}

export { IMPORT_FILE_BYTE_LIMIT };
