import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_FEATURE_LABELS, canAccessFeature, type FeaturePrincipal } from './authorization';
import {
  createApiToken,
  hashApiToken,
  listApiTokens,
  postgresApiTokenDeps,
  renameApiToken,
  revokeApiToken,
  type PublicApiToken,
} from './api-tokens';
import {
  approveChatImport,
  createChatImport,
  postgresChatImportDeps,
  presentImport,
  type ChatImportDeps,
  type PublicImport,
} from './chat-import';
import { importPasteError, isChatImportSource, type ChatImportSource } from './chat-import-parse';
import { queryAll, queryOne } from './database';
import { rateLimit } from './rate-limit';
import type { MemoryKind, PublicMemory } from './ai-research-memory';

export interface SyncQa {
  id: string;
  question: string;
  answerSummary: string;
  createdAt: string;
}

export interface SyncMemoryBody {
  memoryEnabled: boolean;
  facts: PublicMemory[];
  qa: SyncQa[];
}

export interface SyncHandlerDeps {
  lookup(hash: string): Promise<{ id: string; userId: string } | null>;
  loadPrincipal(userId: string): Promise<FeaturePrincipal | null>;
  touch(tokenId: string, userId: string): Promise<void>;
  readMemory(userId: string, q: string | null): Promise<SyncMemoryBody>;
  importChat(userId: string, input: { source: ChatImportSource; text: string; autoApprove: boolean }): Promise<{ status: number; body: Record<string, unknown> }>;
  authorize(request: NextRequest): Promise<{ id: string; role: string; departmentId: string | null; departmentName: string | null; features: string[] } | { error: string; status: number }>;
  listTokens(userId: string): Promise<PublicApiToken[]>;
  createToken(userId: string, name: unknown): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }>;
  renameToken(userId: string, id: string, name: unknown): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }>;
  revokeToken(userId: string, id: string): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }>;
}

interface MemoryReader {
  isEnabled(userId: string): Promise<boolean>;
  listFacts(userId: string, pattern: string | null): Promise<Array<PublicMemory & Record<string, unknown>>>;
  listQa(userId: string, pattern: string | null): Promise<Array<SyncQa & Record<string, unknown>>>;
}

const MEMORY_KINDS = new Set<MemoryKind>(['role', 'interest', 'preference', 'style', 'context']);
const TOKEN_PATTERN = /^Bearer (mos_[A-Za-z0-9_-]{43})$/;

export const SYNC_FACTS_SQL = `SELECT id, kind, content, mention_count, confidence, updated_at FROM user_memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT 80`;
export const SYNC_FACTS_SEARCH_SQL = `SELECT id, kind, content, mention_count, confidence, updated_at FROM user_memories WHERE user_id = ? AND content ILIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 80`;
export const SYNC_QA_SQL = `SELECT id, question, answer_summary, created_at FROM ai_research_qa_index WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`;
export const SYNC_QA_SEARCH_SQL = `SELECT id, question, answer_summary, created_at FROM ai_research_qa_index WHERE user_id = ? AND (question ILIKE ? ESCAPE '\\' OR answer_summary ILIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT 20`;

function json(body: object, status = 200) {
  return NextResponse.json(body, { status });
}

function unauthorized() {
  return json({ error: 'Unauthorized' }, 401);
}

function logSync(id: string, status: string) {
  console.info('[sync]', { id, status });
}

function asIso(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export function ilikeContainsPattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, char => `\\${char}`)}%`;
}

export function parseSyncQuery(value: string | null): { ok: true; q: string | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, q: null };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, q: null };
  if (trimmed.length > 200) return { ok: false, error: 'Search is limited to 200 characters.' };
  return { ok: true, q: trimmed };
}

function presentFact(row: PublicMemory): PublicMemory | null {
  if (!MEMORY_KINDS.has(row.kind)) return null;
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    mentionCount: Number(row.mentionCount) || 0,
    confidence: Number(row.confidence) || 0,
    updatedAt: row.updatedAt,
  };
}

function presentQa(row: SyncQa): SyncQa {
  return {
    id: row.id,
    question: row.question,
    answerSummary: row.answerSummary,
    createdAt: row.createdAt,
  };
}

export async function readSyncedMemory(userId: string, q: string | null, deps: MemoryReader): Promise<SyncMemoryBody> {
  const pattern = q ? ilikeContainsPattern(q) : null;
  const [memoryEnabled, facts, qa] = await Promise.all([
    deps.isEnabled(userId),
    deps.listFacts(userId, pattern),
    deps.listQa(userId, pattern),
  ]);
  return {
    memoryEnabled,
    facts: facts.flatMap(row => {
      const fact = presentFact(row);
      return fact ? [fact] : [];
    }).slice(0, 80),
    qa: qa.map(presentQa).slice(0, 20),
  };
}

function publicImport(row: PublicImport): Record<string, unknown> {
  return {
    id: row.id,
    source: row.source,
    parser: row.parser,
    parserFallback: row.parserFallback,
    title: row.title,
    status: row.status,
    knowledgeEntryId: row.knowledgeEntryId,
    memoryEnabled: row.memoryEnabled,
    draft: row.draft,
    error: row.error,
  };
}

export async function importSyncedChat(
  userId: string,
  input: { source: ChatImportSource; text: string; autoApprove: boolean },
  deps: ChatImportDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const pasteError = importPasteError(input.text);
  if (pasteError) return { status: pasteError.status, body: { error: pasteError.error } };
  const created = await createChatImport(userId, input.source, input.text, deps);
  if (!created.ok) return { status: created.status, body: { ...created.body } };
  const imported = created.body.import as PublicImport;
  if (!input.autoApprove || imported.status !== 'review') {
    return { status: 200, body: { import: publicImport(imported), autoApproved: false } };
  }
  const approved = await approveChatImport(userId, imported.id, {
    facts: imported.draft.facts.map(fact => ({
      id: fact.id,
      kind: fact.kind,
      content: fact.content,
      included: true,
    })),
    qa: imported.draft.qa.map(row => ({
      id: row.id,
      question: row.question,
      answerSummary: row.answerSummary,
      included: true,
    })),
  }, deps);
  if (!approved.ok) return { status: approved.status, body: { ...approved.body } };
  const reread = await deps.findById(userId, imported.id);
  const memoryEnabled = reread ? await deps.isMemoryEnabled(userId) : imported.memoryEnabled;
  const next = reread ? presentImport(reread, memoryEnabled) : { ...imported, status: 'approved' as const, draft: { facts: [], qa: [] } };
  return {
    status: 200,
    body: {
      import: publicImport(next),
      autoApproved: true,
      factsSaved: Number(approved.body.factsSaved) || 0,
      factsAlreadySaved: Number(approved.body.factsAlreadySaved) || 0,
      qaSaved: Number(approved.body.qaSaved) || 0,
      qaAlreadySaved: Number(approved.body.qaAlreadySaved) || 0,
    },
  };
}

function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  const hostname = value.startsWith('[')
    ? value.slice(0, value.indexOf(']') + 1)
    : value.replace(/:\d+$/, '');
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

export function rejectCleartext(request: NextRequest): NextResponse | null {
  const host = request.headers.get('host') || request.nextUrl.host || '';
  if (isLoopbackHost(host)) return null;
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded != null) {
    const first = forwarded.split(',')[0]?.trim().toLowerCase();
    if (first === 'https') return null;
    return json({ error: 'Use HTTPS.' }, 400);
  }
  return json({ error: 'Use HTTPS.' }, 400);
}

async function authenticateSync(request: NextRequest, deps: SyncHandlerDeps): Promise<{ ok: true; tokenId: string; userId: string } | { ok: false; response: NextResponse }> {
  const header = request.headers.get('authorization') || '';
  if (header.length > 256) {
    const limited = rateLimit(request);
    if (limited) return { ok: false, response: limited };
    return { ok: false, response: unauthorized() };
  }
  const ipLimited = rateLimit(request);
  if (ipLimited) return { ok: false, response: ipLimited };
  const match = header.match(TOKEN_PATTERN);
  if (match) {
    const tokenLimited = rateLimit(request, `sync:${hashApiToken(match[1])}`);
    if (tokenLimited) return { ok: false, response: tokenLimited };
  }
  const httpsError = rejectCleartext(request);
  if (httpsError) return { ok: false, response: httpsError };
  if (!match) return { ok: false, response: unauthorized() };
  const token = await deps.lookup(hashApiToken(match[1]));
  if (!token) return { ok: false, response: unauthorized() };
  const principal = await deps.loadPrincipal(token.userId);
  if (!principal) return { ok: false, response: unauthorized() };
  if (!canAccessFeature(principal, 'ai-research')) {
    return { ok: false, response: json({ error: `Forbidden: your department does not allow ${ACCOUNT_FEATURE_LABELS['ai-research']}` }, 403) };
  }
  try {
    await deps.touch(token.id, token.userId);
  } catch {
    // A failed last_used_at update does not block the sync.
  }
  return { ok: true, tokenId: token.id, userId: token.userId };
}

async function guardSettings(request: NextRequest, deps: SyncHandlerDeps) {
  const limited = rateLimit(request);
  if (limited) return limited;
  const httpsError = rejectCleartext(request);
  if (httpsError) return httpsError;
  const auth = await deps.authorize(request);
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  const userLimited = rateLimit(request, `settings-tokens:${auth.id}`);
  if (userLimited) return userLimited;
  return auth;
}

export async function handleSyncMemory(request: NextRequest, deps: SyncHandlerDeps) {
  const auth = await authenticateSync(request, deps);
  if (!auth.ok) return auth.response;
  const parsed = parseSyncQuery(request.nextUrl.searchParams.get('q'));
  if (!parsed.ok) {
    logSync(auth.tokenId, 'failed');
    return json({ error: parsed.error }, 400);
  }
  try {
    const body = await deps.readMemory(auth.userId, parsed.q);
    logSync(auth.tokenId, 'read');
    return json(body);
  } catch {
    logSync(auth.tokenId, 'failed');
    return json({ error: 'Could not load memory.' }, 500);
  }
}

export async function handleSyncImport(request: NextRequest, deps: SyncHandlerDeps) {
  const auth = await authenticateSync(request, deps);
  if (!auth.ok) return auth.response;
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    logSync(auth.tokenId, 'failed');
    return json({ error: 'Send the chat as JSON.' }, 400);
  }
  let body: { source?: unknown; text?: unknown; autoApprove?: unknown };
  try {
    body = await request.json();
  } catch {
    logSync(auth.tokenId, 'failed');
    return json({ error: 'Send the chat as JSON.' }, 400);
  }
  if (!isChatImportSource(body.source)) {
    logSync(auth.tokenId, 'failed');
    return json({ error: 'Choose a source.' }, 400);
  }
  if (typeof body.text !== 'string') {
    logSync(auth.tokenId, 'failed');
    return json({ error: 'Add a chat to import.' }, 400);
  }
  if (body.autoApprove !== undefined && typeof body.autoApprove !== 'boolean') {
    logSync(auth.tokenId, 'failed');
    return json({ error: 'autoApprove must be true or false.' }, 400);
  }
  try {
    const result = await deps.importChat(auth.userId, {
      source: body.source,
      text: body.text,
      autoApprove: body.autoApprove === true,
    });
    const imported = result.body.import;
    const importId = imported && typeof imported === 'object' && 'id' in imported ? String((imported as { id: unknown }).id) : auth.tokenId;
    logSync(importId, result.status >= 400 ? 'failed' : 'imported');
    return json(result.body, result.status);
  } catch {
    logSync(auth.tokenId, 'failed');
    return json({ error: 'Could not import that chat.' }, 500);
  }
}

export async function handleSettingsTokens(request: NextRequest, deps: SyncHandlerDeps) {
  const auth = await guardSettings(request, deps);
  if (auth instanceof NextResponse) return auth;
  try {
    if (request.method === 'POST') {
      let body: { name?: unknown } = {};
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Name the token.' }, 400);
      }
      const created = await deps.createToken(auth.id, body.name);
      return json(created.body, created.status);
    }
    const tokens = await deps.listTokens(auth.id);
    return json({ tokens });
  } catch {
    return json({ error: 'Could not load API tokens.' }, 500);
  }
}

export async function handleSettingsToken(request: NextRequest, id: string, deps: SyncHandlerDeps) {
  const auth = await guardSettings(request, deps);
  if (auth instanceof NextResponse) return auth;
  try {
    if (request.method === 'DELETE') {
      const revoked = await deps.revokeToken(auth.id, id);
      return json(revoked.body, revoked.status);
    }
    let body: { name?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Name the token.' }, 400);
    }
    const renamed = await deps.renameToken(auth.id, id, body.name);
    return json(renamed.body, renamed.status);
  } catch {
    return json({ error: 'Could not update that token.' }, 500);
  }
}

type DbFact = {
  id: string;
  kind: string;
  content: string;
  mention_count: number | string;
  confidence: number | string;
  updated_at: string | Date;
};

type DbQa = {
  id: string;
  question: string;
  answer_summary: string | null;
  created_at: string | Date;
};

function postgresMemoryReader(): MemoryReader {
  return {
    isEnabled: async userId => {
      const row = await queryOne<{ ai_memory_enabled: boolean | null }>(
        'SELECT ai_memory_enabled FROM users WHERE id = ?',
        [userId],
      );
      if (!row) return false;
      return row.ai_memory_enabled !== false;
    },
    listFacts: async (userId, pattern) => {
      const rows = await queryAll<DbFact>(pattern ? SYNC_FACTS_SEARCH_SQL : SYNC_FACTS_SQL, pattern ? [userId, pattern] : [userId]);
      return rows.flatMap(row => {
        if (!MEMORY_KINDS.has(row.kind as MemoryKind)) return [];
        return [{
          id: row.id,
          kind: row.kind as MemoryKind,
          content: row.content,
          mentionCount: Number(row.mention_count) || 0,
          confidence: Number(row.confidence) || 0,
          updatedAt: asIso(row.updated_at),
        }];
      });
    },
    listQa: async (userId, pattern) => {
      const rows = await queryAll<DbQa>(
        pattern ? SYNC_QA_SEARCH_SQL : SYNC_QA_SQL,
        pattern ? [userId, pattern, pattern] : [userId],
      );
      return rows.map(row => ({
        id: row.id,
        question: row.question,
        answerSummary: row.answer_summary || '',
        createdAt: asIso(row.created_at),
      }));
    },
  };
}

async function loadSyncPrincipal(userId: string): Promise<FeaturePrincipal | null> {
  const user = await queryOne<{ role: string; permitted_features: string[] | null }>(
    `SELECT u.role, d.permitted_features
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id = ?`,
    [userId],
  );
  if (!user) return null;
  return { role: user.role, features: user.permitted_features || [] };
}

export function postgresSyncDeps(): SyncHandlerDeps {
  const tokens = postgresApiTokenDeps();
  return {
    lookup: hash => tokens.findActiveByHash(hash),
    loadPrincipal: loadSyncPrincipal,
    touch: (tokenId, userId) => tokens.touch(tokenId, userId),
    readMemory: (userId, q) => readSyncedMemory(userId, q, postgresMemoryReader()),
    importChat: (userId, input) => importSyncedChat(userId, input, postgresChatImportDeps()),
    authorize: async () => ({ error: 'Unauthorized', status: 401 }),
    listTokens: userId => listApiTokens(userId, tokens),
    createToken: async (userId, name) => {
      const result = await createApiToken(userId, name, tokens);
      return { ok: result.ok, status: result.status, body: result.body };
    },
    renameToken: async (userId, id, name) => {
      const result = await renameApiToken(userId, id, name, tokens);
      return { ok: result.ok, status: result.status, body: result.body };
    },
    revokeToken: async (userId, id) => {
      const result = await revokeApiToken(userId, id, tokens);
      return { ok: result.ok, status: result.status, body: result.body };
    },
  };
}
