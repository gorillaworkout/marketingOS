import { createHash, randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { execute, executeTransaction, queryAll, queryOne } from './database';

export const ACTIVE_API_TOKEN_LIMIT = 5;

export interface ApiTokenRow {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface PublicApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiTokenDeps {
  createId(): string;
  now(): Date;
  randomBytes(size: number): Buffer;
  list(userId: string): Promise<ApiTokenRow[]>;
  insertIfUnderCap(row: ApiTokenRow): Promise<'inserted' | 'limit'>;
  findOwned(userId: string, id: string): Promise<ApiTokenRow | null>;
  rename(userId: string, id: string, name: string): Promise<boolean>;
  revoke(userId: string, id: string, at: string): Promise<boolean>;
  findActiveByHash(hash: string): Promise<{ id: string; userId: string } | null>;
  touch(id: string, userId: string): Promise<void>;
}

export type TokenSuccess<T> = { ok: true; status: number; body: T };
export type TokenFailure = { ok: false; status: 400 | 404 | 409; body: { error: string } };

export const LIST_USER_API_TOKENS_SQL = `SELECT id, user_id, name, token_prefix, last_used_at, revoked_at, created_at FROM user_api_tokens WHERE user_id = ? ORDER BY created_at DESC`;
export const INSERT_ACTIVE_API_TOKEN_SQL = `INSERT INTO user_api_tokens (id, user_id, name, token_hash, token_prefix, created_at) SELECT ?, ?, ?, ?, ?, NOW() WHERE (SELECT COUNT(*) FROM user_api_tokens WHERE user_id = ? AND revoked_at IS NULL) < 5`;
export const RENAME_API_TOKEN_SQL = `UPDATE user_api_tokens SET name = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`;
export const REVOKE_API_TOKEN_SQL = `UPDATE user_api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`;
export const FIND_ACTIVE_API_TOKEN_SQL = `SELECT id, user_id FROM user_api_tokens WHERE token_hash = ? AND revoked_at IS NULL`;
export const TOUCH_API_TOKEN_SQL = `UPDATE user_api_tokens SET last_used_at = NOW() WHERE id = ? AND user_id = ? AND revoked_at IS NULL`;

const NAME_REQUIRED = 'Name the token.';
const NAME_TOO_LONG = 'Use 40 characters or fewer.';
const NAME_PLAIN = 'Use a plain name.';
const TOKEN_CAP = 'You can have 5 active tokens. Revoke one to create another.';
const TOKEN_MISSING = 'Token was not found.';
const TOKEN_REVOKED = 'This token is revoked.';

type DbToken = {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  last_used_at: string | Date | null;
  revoked_at: string | Date | null;
  created_at: string | Date;
};

function logSettings(tokenId: string, status: 'created' | 'renamed' | 'revoked') {
  console.info('[settings] api token', { tokenId, status });
}

function asIso(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function present(row: ApiTokenRow): PublicApiToken {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

function mapRow(row: DbToken): ApiTokenRow {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    tokenHash: '',
    tokenPrefix: row.token_prefix,
    lastUsedAt: asIso(row.last_used_at),
    revokedAt: asIso(row.revoked_at),
    createdAt: asIso(row.created_at) || new Date(0).toISOString(),
  };
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function validateTokenName(input: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof input !== 'string') return { ok: false, error: NAME_REQUIRED };
  const name = input.trim();
  if (!name) return { ok: false, error: NAME_REQUIRED };
  if ([...name].length > 40) return { ok: false, error: NAME_TOO_LONG };
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return { ok: false, error: NAME_PLAIN };
  }
  return { ok: true, name };
}

export async function listApiTokens(userId: string, deps: ApiTokenDeps): Promise<PublicApiToken[]> {
  const rows = await deps.list(userId);
  return rows.map(present);
}

export async function createApiToken(userId: string, name: unknown, deps: ApiTokenDeps): Promise<TokenSuccess<{ token: string; apiToken: PublicApiToken }> | TokenFailure> {
  const validated = validateTokenName(name);
  if (!validated.ok) return { ok: false, status: 400, body: { error: validated.error } };
  const secret = `mos_${deps.randomBytes(32).toString('base64url')}`;
  const row: ApiTokenRow = {
    id: deps.createId(),
    userId,
    name: validated.name,
    tokenHash: hashApiToken(secret),
    tokenPrefix: secret.slice(0, 12),
    lastUsedAt: null,
    revokedAt: null,
    createdAt: deps.now().toISOString(),
  };
  const inserted = await deps.insertIfUnderCap(row);
  if (inserted === 'limit') return { ok: false, status: 409, body: { error: TOKEN_CAP } };
  logSettings(row.id, 'created');
  return { ok: true, status: 201, body: { token: secret, apiToken: present(row) } };
}

export async function renameApiToken(userId: string, id: string, name: unknown, deps: ApiTokenDeps): Promise<TokenSuccess<{ apiToken: PublicApiToken }> | TokenFailure> {
  const validated = validateTokenName(name);
  if (!validated.ok) return { ok: false, status: 400, body: { error: validated.error } };
  const current = await deps.findOwned(userId, id);
  if (!current) return { ok: false, status: 404, body: { error: TOKEN_MISSING } };
  if (current.revokedAt) return { ok: false, status: 409, body: { error: TOKEN_REVOKED } };
  const renamed = await deps.rename(userId, id, validated.name);
  if (!renamed) return { ok: false, status: 404, body: { error: TOKEN_MISSING } };
  logSettings(id, 'renamed');
  return { ok: true, status: 200, body: { apiToken: present({ ...current, name: validated.name }) } };
}

export async function revokeApiToken(userId: string, id: string, deps: ApiTokenDeps): Promise<TokenSuccess<{ revoked: true; alreadyRevoked: boolean }> | TokenFailure> {
  const current = await deps.findOwned(userId, id);
  if (!current) return { ok: false, status: 404, body: { error: TOKEN_MISSING } };
  if (current.revokedAt) return { ok: true, status: 200, body: { revoked: true, alreadyRevoked: true } };
  const at = deps.now().toISOString();
  await deps.revoke(userId, id, at);
  logSettings(id, 'revoked');
  return { ok: true, status: 200, body: { revoked: true, alreadyRevoked: false } };
}

export function postgresApiTokenDeps(): ApiTokenDeps {
  return {
    createId: () => uuidv4(),
    now: () => new Date(),
    randomBytes: size => randomBytes(size),
    list: async userId => {
      const rows = await queryAll<DbToken>(LIST_USER_API_TOKENS_SQL, [userId]);
      return rows.map(mapRow);
    },
    insertIfUnderCap: async row => {
      const inserted = await executeTransaction(async transaction => {
        await transaction.execute('SELECT pg_advisory_xact_lock(881029, hashtext(?))', [row.userId]);
        return transaction.execute(INSERT_ACTIVE_API_TOKEN_SQL, [
          row.id,
          row.userId,
          row.name,
          row.tokenHash,
          row.tokenPrefix,
          row.userId,
        ]);
      });
      return inserted > 0 ? 'inserted' : 'limit';
    },
    findOwned: async (userId, id) => {
      const row = await queryOne<DbToken>(
        `SELECT id, user_id, name, token_prefix, last_used_at, revoked_at, created_at FROM user_api_tokens WHERE id = ? AND user_id = ?`,
        [id, userId],
      );
      return row ? mapRow(row) : null;
    },
    rename: async (userId, id, name) => (await execute(RENAME_API_TOKEN_SQL, [name, id, userId])) > 0,
    revoke: async (userId, id, at) => (await execute(REVOKE_API_TOKEN_SQL, [at, id, userId])) > 0,
    findActiveByHash: async hash => {
      const row = await queryOne<{ id: string; user_id: string }>(FIND_ACTIVE_API_TOKEN_SQL, [hash]);
      return row ? { id: row.id, userId: row.user_id } : null;
    },
    touch: async (id, userId) => {
      await execute(TOUCH_API_TOKEN_SQL, [id, userId]);
    },
  };
}
