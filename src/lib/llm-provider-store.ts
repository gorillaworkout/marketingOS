import { v4 as uuidv4 } from 'uuid';
import { execute, executeTransaction, queryAll, queryOne } from '@/lib/database';
import { decryptSecret, encryptSecret, maskSecret, scrubSecrets } from '@/lib/llm-crypto';
import {
  DEFAULT_LLM_MODEL_MAPPINGS,
  DEFAULT_OPENROUTER_CHAT_FALLBACKS,
  DEFAULT_OPENROUTER_CHAT_MODEL,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_IMAGE_MODEL,
  type LlmKind,
  type LlmMode,
  type LlmModelMapping,
} from '@/lib/llm-provider-defaults';

export const LLM_SETTINGS_CACHE_MS = 5_000;

export type LlmSettings = {
  mode: LlmMode;
  openrouterKey: string;
  keyHint: string | null;
  keyConfigured: boolean;
  keyReadable: boolean;
  defaultChatModel: string;
  defaultImageModel: string;
  defaultEmbeddingModel: string;
  chatFallbacks: string[];
  mappings: LlmModelMapping[];
  status: {
    activeProvider: 'dupoin' | 'openrouter';
    lastFailoverAt: string | null;
    lastError: string | null;
    circuitOpenUntil: string | null;
    consecutiveFailures: number;
  };
};

export type LlmAuditRow = {
  id: string;
  actorId: string | null;
  action: string;
  detail: string;
  createdAt: string;
};

type SettingsRow = {
  mode: string;
  openrouter_key_ciphertext: string | null;
  openrouter_key_hint: string | null;
  default_chat_model: string;
  default_image_model: string;
  default_embedding_model: string;
  chat_fallbacks: string | null;
};

type StatusRow = {
  active_provider: string;
  last_failover_at: Date | string | null;
  last_error: string | null;
  circuit_open_until: Date | string | null;
  consecutive_failures: number;
};

const EMPTY_STATUS: LlmSettings['status'] = {
  activeProvider: 'dupoin',
  lastFailoverAt: null,
  lastError: null,
  circuitOpenUntil: null,
  consecutiveFailures: 0,
};

let cache: { at: number; value: LlmSettings } | null = null;

export function defaultLlmSettings(): LlmSettings {
  return {
    mode: 'dupoin',
    openrouterKey: '',
    keyHint: null,
    keyConfigured: false,
    keyReadable: true,
    defaultChatModel: DEFAULT_OPENROUTER_CHAT_MODEL,
    defaultImageModel: DEFAULT_OPENROUTER_IMAGE_MODEL,
    defaultEmbeddingModel: DEFAULT_OPENROUTER_EMBEDDING_MODEL,
    chatFallbacks: [...DEFAULT_OPENROUTER_CHAT_FALLBACKS],
    mappings: DEFAULT_LLM_MODEL_MAPPINGS.map(row => ({ ...row })),
    status: { ...EMPTY_STATUS },
  };
}

export function invalidateLlmSettingsCache(): void {
  cache = null;
}

export function parseChatFallbacks(raw: string | null | undefined): string[] {
  if (raw == null || raw.trim() === '') return [...DEFAULT_OPENROUTER_CHAT_FALLBACKS];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_OPENROUTER_CHAT_FALLBACKS];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 8);
  } catch {
    return [...DEFAULT_OPENROUTER_CHAT_FALLBACKS];
  }
}

function asMode(value: string): LlmMode {
  return value === 'openrouter' || value === 'auto' ? value : 'dupoin';
}

function stamp(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function readSettings(): Promise<LlmSettings> {
  const row = await queryOne<SettingsRow>('SELECT mode, openrouter_key_ciphertext, openrouter_key_hint, default_chat_model, default_image_model, default_embedding_model, chat_fallbacks FROM llm_provider_settings WHERE id = ?', ['default']);
  const mappingRows = await queryAll<{ dupoin_model: string; openrouter_model: string; kind: string }>('SELECT dupoin_model, openrouter_model, kind FROM llm_model_mappings ORDER BY kind, dupoin_model');
  const status = await queryOne<StatusRow>('SELECT active_provider, last_failover_at, last_error, circuit_open_until, consecutive_failures FROM llm_provider_status WHERE id = ?', ['default']);
  const base = defaultLlmSettings();
  if (!row && mappingRows.length === 0 && !status) return base;

  let openrouterKey = '';
  let keyReadable = !row?.openrouter_key_ciphertext;
  if (row?.openrouter_key_ciphertext) {
    try {
      openrouterKey = decryptSecret(row.openrouter_key_ciphertext);
      keyReadable = true;
    } catch (error) {
      console.error('[llm-provider] stored OpenRouter key could not be read:', error instanceof Error ? error.message : error);
      keyReadable = false;
    }
  }

  return {
    mode: asMode(row?.mode || 'dupoin'),
    openrouterKey,
    keyHint: row?.openrouter_key_hint || (openrouterKey ? maskSecret(openrouterKey) : null),
    keyConfigured: Boolean(row?.openrouter_key_ciphertext),
    keyReadable,
    defaultChatModel: row?.default_chat_model || base.defaultChatModel,
    defaultImageModel: row?.default_image_model || base.defaultImageModel,
    defaultEmbeddingModel: row?.default_embedding_model || base.defaultEmbeddingModel,
    chatFallbacks: parseChatFallbacks(row?.chat_fallbacks),
    mappings: mappingRows.length > 0
      ? mappingRows.map(mapping => ({
        dupoinModel: mapping.dupoin_model,
        openrouterModel: mapping.openrouter_model,
        kind: mapping.kind === 'image' ? 'image' : mapping.kind === 'embedding' ? 'embedding' : 'chat',
      }))
      : base.mappings,
    status: status ? {
      activeProvider: status.active_provider === 'openrouter' ? 'openrouter' : 'dupoin',
      lastFailoverAt: stamp(status.last_failover_at),
      lastError: status.last_error,
      circuitOpenUntil: stamp(status.circuit_open_until),
      consecutiveFailures: Number(status.consecutive_failures) || 0,
    } : base.status,
  };
}

/** Cached for a few seconds. A database miss keeps the Dupoin env gateway. */
export async function getLlmSettings(): Promise<LlmSettings> {
  const now = Date.now();
  if (cache && now - cache.at < LLM_SETTINGS_CACHE_MS) return cache.value;
  try {
    const value = await readSettings();
    cache = { at: now, value };
    return value;
  } catch (error) {
    console.error('[llm-provider] settings unavailable, using Dupoin env gateway:', error instanceof Error ? error.message : error);
    const value = defaultLlmSettings();
    cache = { at: now, value };
    return value;
  }
}

export async function listLlmAudit(limit = 20): Promise<LlmAuditRow[]> {
  try {
    const rows = await queryAll<{ id: string; actor_id: string | null; action: string; detail: string; created_at: Date | string }>(
      'SELECT id, actor_id, action, detail, created_at FROM llm_provider_audit ORDER BY created_at DESC LIMIT ?',
      [limit],
    );
    return rows.map(row => ({
      id: row.id,
      actorId: row.actor_id,
      action: row.action,
      detail: row.detail,
      createdAt: stamp(row.created_at) || new Date(0).toISOString(),
    }));
  } catch (error) {
    console.error('[llm-provider] audit unavailable:', error instanceof Error ? error.message : error);
    return [];
  }
}

export async function writeLlmAudit(action: string, detail: Record<string, unknown>, actorId: string | null): Promise<void> {
  const safe = scrubSecrets(JSON.stringify(detail));
  await execute(
    'INSERT INTO llm_provider_audit (id, actor_id, action, detail) VALUES (?, ?, ?, ?)',
    [uuidv4(), actorId, action, safe],
  );
}

export async function saveLlmProviderSettings(input: {
  mode: LlmMode;
  defaultChatModel: string;
  defaultImageModel: string;
  defaultEmbeddingModel: string;
  chatFallbacks: string[];
  openrouterKey: string | null | undefined;
  mappings: LlmModelMapping[];
  actorId: string;
}): Promise<void> {
  const current = await getLlmSettings();
  let ciphertext: string | null = null;
  let hint: string | null = current.keyHint;
  let keyUpdated = false;
  let keyCleared = false;
  if (input.openrouterKey === null) {
    ciphertext = null;
    hint = null;
    keyCleared = current.keyConfigured;
  } else if (typeof input.openrouterKey === 'string') {
    ciphertext = encryptSecret(input.openrouterKey.trim());
    hint = maskSecret(input.openrouterKey.trim());
    keyUpdated = true;
  } else if (current.keyConfigured) {
    const row = await queryOne<{ openrouter_key_ciphertext: string | null; openrouter_key_hint: string | null }>(
      'SELECT openrouter_key_ciphertext, openrouter_key_hint FROM llm_provider_settings WHERE id = ?',
      ['default'],
    );
    ciphertext = row?.openrouter_key_ciphertext ?? null;
    hint = row?.openrouter_key_hint ?? current.keyHint;
  }

  await executeTransaction(async tx => {
    await tx.execute(
      `INSERT INTO llm_provider_settings (id, mode, openrouter_key_ciphertext, openrouter_key_hint, default_chat_model, default_image_model, default_embedding_model, chat_fallbacks, updated_by, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         mode = EXCLUDED.mode,
         openrouter_key_ciphertext = EXCLUDED.openrouter_key_ciphertext,
         openrouter_key_hint = EXCLUDED.openrouter_key_hint,
         default_chat_model = EXCLUDED.default_chat_model,
         default_image_model = EXCLUDED.default_image_model,
         default_embedding_model = EXCLUDED.default_embedding_model,
         chat_fallbacks = EXCLUDED.chat_fallbacks,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
      [input.mode, ciphertext, hint, input.defaultChatModel, input.defaultImageModel, input.defaultEmbeddingModel, JSON.stringify(input.chatFallbacks), input.actorId],
    );
    await tx.execute('DELETE FROM llm_model_mappings');
    for (const mapping of input.mappings) {
      await tx.execute(
        'INSERT INTO llm_model_mappings (dupoin_model, openrouter_model, kind) VALUES (?, ?, ?)',
        [mapping.dupoinModel, mapping.openrouterModel, mapping.kind],
      );
    }
    await tx.execute(
      'INSERT INTO llm_provider_audit (id, actor_id, action, detail) VALUES (?, ?, ?, ?)',
      [uuidv4(), input.actorId, 'settings.update', scrubSecrets(JSON.stringify({
        mode: input.mode,
        defaultChatModel: input.defaultChatModel,
        defaultImageModel: input.defaultImageModel,
        defaultEmbeddingModel: input.defaultEmbeddingModel,
        chatFallbacks: input.chatFallbacks,
        keyUpdated,
        keyCleared,
        mappingCount: input.mappings.length,
      }))],
    );
  });
  invalidateLlmSettingsCache();
}

export async function markProviderRecovered(activeProvider: 'dupoin' | 'openrouter'): Promise<void> {
  await execute(
    `INSERT INTO llm_provider_status (id, active_provider, consecutive_failures, circuit_open_until, updated_at)
     VALUES ('default', ?, 0, NULL, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       active_provider = EXCLUDED.active_provider,
       consecutive_failures = 0,
       circuit_open_until = NULL,
       updated_at = CURRENT_TIMESTAMP`,
    [activeProvider],
  );
  invalidateLlmSettingsCache();
}

export async function recordProviderFailover(input: {
  reason: string;
  upstreamModel: string;
  circuitOpenUntil: number;
  consecutiveFailures: number;
  activeProvider: 'dupoin' | 'openrouter';
}): Promise<void> {
  const reason = scrubSecrets(input.reason);
  const openUntil = input.circuitOpenUntil > 0 ? new Date(input.circuitOpenUntil).toISOString() : null;
  await execute(
    `INSERT INTO llm_provider_status (id, active_provider, last_failover_at, last_error, circuit_open_until, consecutive_failures, updated_at)
     VALUES ('default', ?, CURRENT_TIMESTAMP, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       active_provider = EXCLUDED.active_provider,
       last_failover_at = CURRENT_TIMESTAMP,
       last_error = EXCLUDED.last_error,
       circuit_open_until = EXCLUDED.circuit_open_until,
       consecutive_failures = EXCLUDED.consecutive_failures,
       updated_at = CURRENT_TIMESTAMP`,
    [input.activeProvider, reason, openUntil, input.consecutiveFailures],
  );
  await writeLlmAudit('failover', {
    from: 'dupoin',
    to: 'openrouter',
    reason,
    upstreamModel: input.upstreamModel,
    circuitOpen: Boolean(openUntil),
  }, null);
  invalidateLlmSettingsCache();
}

export type StoredModelHealth = {
  provider: 'dupoin' | 'openrouter';
  model: string;
  kind: 'chat' | 'image' | 'embedding';
  status: 'active' | 'rate_limited' | 'blocked' | 'credits' | 'error';
  httpStatus: number | null;
  latencyMs: number;
  message: string;
  testedAt: string;
};

export async function listModelHealth(): Promise<StoredModelHealth[]> {
  try {
    const rows = await queryAll<{
      provider: string;
      model: string;
      kind: string;
      status: string;
      http_status: number | null;
      latency_ms: number;
      message: string;
      tested_at: Date | string;
    }>('SELECT provider, model, kind, status, http_status, latency_ms, message, tested_at FROM llm_model_health ORDER BY tested_at DESC');
    return rows.map(row => ({
      provider: row.provider === 'openrouter' ? 'openrouter' : 'dupoin',
      model: row.model,
      kind: row.kind === 'image' ? 'image' : row.kind === 'embedding' ? 'embedding' : 'chat',
      status: row.status === 'active' || row.status === 'rate_limited' || row.status === 'blocked' || row.status === 'credits' ? row.status : 'error',
      httpStatus: row.http_status,
      latencyMs: Number(row.latency_ms) || 0,
      message: scrubSecrets(row.message || ''),
      testedAt: stamp(row.tested_at) || new Date(0).toISOString(),
    }));
  } catch (error) {
    console.error('[llm-provider] health unavailable:', error instanceof Error ? error.message : error);
    return [];
  }
}

export async function saveModelHealth(row: StoredModelHealth): Promise<void> {
  await execute(
    `INSERT INTO llm_model_health (provider, model, kind, status, http_status, latency_ms, message, tested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (provider, model, kind) DO UPDATE SET
       status = EXCLUDED.status,
       http_status = EXCLUDED.http_status,
       latency_ms = EXCLUDED.latency_ms,
       message = EXCLUDED.message,
       tested_at = CURRENT_TIMESTAMP`,
    [row.provider, row.model, row.kind, row.status, row.httpStatus, row.latencyMs, scrubSecrets(row.message).slice(0, 300)],
  );
}

export function assertMapping(row: LlmModelMapping): LlmModelMapping {
  const dupoinModel = row.dupoinModel.trim();
  const openrouterModel = row.openrouterModel.trim();
  const kind: LlmKind = row.kind === 'image' ? 'image' : row.kind === 'embedding' ? 'embedding' : 'chat';
  if (!dupoinModel || dupoinModel.length > 200) throw new Error('Each Dupoin model id is required and must be 200 characters or fewer.');
  if (!openrouterModel || openrouterModel.length > 200) throw new Error('Each OpenRouter model id is required and must be 200 characters or fewer.');
  if (row.kind !== 'chat' && row.kind !== 'image' && row.kind !== 'embedding') throw new Error('Mapping kind must be chat, image, or embedding.');
  return { dupoinModel, openrouterModel, kind };
}
