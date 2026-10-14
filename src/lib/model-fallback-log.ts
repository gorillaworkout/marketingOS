import { v4 as uuidv4 } from 'uuid';
import { execute, queryAll } from '@/lib/database';
import type { FallbackEvent, FallbackLogger } from '@/lib/model-fallback';

const MAX_ERROR_LENGTH = 1_000;

export async function recordModelFallback(
  feature: string,
  event: FallbackEvent,
  userId?: string | null,
): Promise<void> {
  console.warn(
    `[model-fallback] ${feature}: ${event.failedModel} failed${event.afterPartial ? ' mid-stream' : ''}; trying ${event.fallbackModel}. ${event.error.slice(0, 300)}`,
  );
  await execute(
    `INSERT INTO model_fallback_events
       (id, feature, failed_model, fallback_model, error, after_partial, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      feature || 'unknown',
      event.failedModel,
      event.fallbackModel,
      event.error.slice(0, MAX_ERROR_LENGTH),
      event.afterPartial,
      userId || null,
      event.at,
    ],
  );
}

export function modelFallbackLogger(feature: string, userId?: string | null): FallbackLogger {
  return event => recordModelFallback(feature, event, userId);
}

export type ModelFallbackEventRow = {
  id: string;
  feature: string;
  failed_model: string;
  fallback_model: string;
  error: string;
  after_partial: boolean;
  user_id: string | null;
  created_at: string;
};

export async function listModelFallbackEvents(limit = 100): Promise<ModelFallbackEventRow[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500);
  return queryAll<ModelFallbackEventRow>(
    `SELECT id, feature, failed_model, fallback_model, error, after_partial, user_id, created_at
       FROM model_fallback_events
      ORDER BY created_at DESC
      LIMIT ${safeLimit}`,
  );
}
