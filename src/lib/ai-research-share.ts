import { createHmac, timingSafeEqual } from 'node:crypto';
import { validateStoredSources, type AiResearchSourceRef } from './ai-research';
import { queryOne } from './database';

/** Read-only research shares. HMAC token + a 30-day row. The answer is not embedded in the URL. */

export const AI_RESEARCH_SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const AI_RESEARCH_SHARE_TTL_DAYS = 30;

const TOKEN_VERSION = 'v1';

export interface ShareTokenClaims {
  id: string;
  exp: number;
}

export interface ShareSnapshot {
  query: string;
  answer: string;
  sources: AiResearchSourceRef[];
}

export interface PublicResearchShare extends ShareSnapshot {
  expiresAt: string;
  createdAt: string;
}

type ShareMessage = {
  role: string;
  content: string;
  sources?: unknown;
};

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function researchShareSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = (env.AI_RESEARCH_SHARE_SECRET || env.JWT_SECRET || '').trim();
  if (!secret) {
    throw new Error('Set AI_RESEARCH_SHARE_SECRET or JWT_SECRET before creating share links.');
  }
  return secret;
}

export function signResearchShareToken(claims: ShareTokenClaims, secret: string, now = Date.now()): string {
  if (!secret.trim()) throw new Error('Share signing secret is required');
  if (!/^[0-9a-f-]{36}$/i.test(claims.id)) throw new Error('Invalid id');
  if (!Number.isFinite(claims.exp) || claims.exp <= now) throw new Error('Invalid expiry');
  const payload = Buffer.from(JSON.stringify({ id: claims.id, exp: claims.exp }), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(`${TOKEN_VERSION}~${payload}`).digest('base64url');
  return `${TOKEN_VERSION}~${payload}~${sig}`;
}

export function verifyResearchShareToken(token: string, secret: string, now = Date.now()): ShareTokenClaims | null {
  if (!secret.trim() || !token) return null;
  const parts = token.split('~');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const payload = parts[1];
  const sig = parts[2];
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(`${TOKEN_VERSION}~${payload}`).digest('base64url');
  const actual = Buffer.from(sig);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  let parsed: { id?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { id?: unknown; exp?: unknown };
  } catch {
    return null;
  }
  if (typeof parsed.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(parsed.id)) return null;
  if (typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp) || parsed.exp <= now) return null;
  return { id: parsed.id, exp: parsed.exp };
}

export function researchSharePath(token: string): string {
  return `/share/ai-research/${encodeURIComponent(token)}`;
}

/** Bind a share to an assistant turn that is already stored on the conversation. */
export function matchShareSnapshot(messages: ShareMessage[], answer: string): ShareSnapshot | null {
  const wanted = squash(answer);
  if (!wanted) return null;
  let matchIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant' && squash(message.content || '') === wanted) {
      matchIndex = index;
      break;
    }
  }
  if (matchIndex < 0) return null;
  const matched = messages[matchIndex];
  let query = '';
  for (let index = matchIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user' && squash(message.content || '')) {
      query = squash(message.content).slice(0, 2_000);
      break;
    }
  }
  return {
    query: query || 'Dupoin AI research',
    answer: matched.content.trim().slice(0, 40_000),
    sources: validateStoredSources(matched.sources),
  };
}

export function shareExpiryFromNow(now = Date.now()): number {
  return now + AI_RESEARCH_SHARE_TTL_MS;
}

type ShareRow = {
  query_text: string;
  answer: string;
  sources: unknown;
  expires_at: string | Date;
  created_at: string | Date;
};

function asTime(value: string | Date): number {
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return time;
}

export function isShareTokenShape(token: string): boolean {
  const parts = token.split('~');
  return parts.length === 3 && parts[0] === TOKEN_VERSION && Boolean(parts[1] && parts[2]);
}

export async function loadPublicResearchShare(token: string, now = Date.now()): Promise<PublicResearchShare | null> {
  if (!isShareTokenShape(token)) return null;
  const claims = verifyResearchShareToken(token, researchShareSecret(), now);
  if (!claims) return null;
  const row = await queryOne<ShareRow>(
    'SELECT query_text, answer, sources, expires_at, created_at FROM ai_research_shares WHERE id = ?',
    [claims.id],
  );
  if (!row) return null;
  const expires = asTime(row.expires_at);
  if (!Number.isFinite(expires) || expires <= now) return null;
  const sources = validateStoredSources(typeof row.sources === 'string' ? JSON.parse(row.sources) : row.sources);
  return {
    query: row.query_text,
    answer: row.answer,
    sources,
    expiresAt: new Date(expires).toISOString(),
    createdAt: new Date(asTime(row.created_at)).toISOString(),
  };
}
