import { v4 as uuidv4 } from 'uuid';
import { execute, queryAll, queryOne } from '@/lib/database';
import { MAX_KEYWORD_LENGTH, normalizeKeyword, validateTargetUrl } from './keywords';

/**
 * Hand-off from SEO OS opportunities to Content Studio. Phase 2 only writes
 * `pending` items; Content Studio (Phase 3) picks them up and moves them to
 * `in-progress` and `done`.
 */
export const OPPORTUNITY_TYPES = ['push', 're-optimize', 'no-page', 'homepage'] as const;
export type OpportunityType = typeof OPPORTUNITY_TYPES[number];
export const QUEUE_STATUSES = ['pending', 'in-progress', 'done', 'dismissed'] as const;
export type QueueStatus = typeof QUEUE_STATUSES[number];

export interface QueueRequest {
  keyword: string;
  normalized: string;
  opportunityType: OpportunityType;
  targetPageUrl: string | null;
  metrics: { clicks?: number; impressions?: number; position?: number; bestPage?: string; rangeStart?: string; rangeEnd?: string };
  note: string | null;
}

export interface QueueItem {
  id: string;
  site_id: string;
  keyword: string;
  opportunity_type: OpportunityType;
  target_page_url: string | null;
  metrics: QueueRequest['metrics'];
  note: string | null;
  status: QueueStatus;
  requested_by_name: string | null;
  created_at: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function finite(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

/** Validates a "send to Content Studio" body. Only known metric fields are kept. */
export function parseQueueRequest(body: unknown, rootHost: string | null): QueueRequest | { error: string } {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const keyword = typeof input.keyword === 'string' ? input.keyword.replace(/\s+/g, ' ').trim() : '';
  const normalized = normalizeKeyword(keyword);
  if (!normalized) return { error: 'keyword is required' };
  if (normalized.length > MAX_KEYWORD_LENGTH) return { error: `keyword is longer than ${MAX_KEYWORD_LENGTH} characters` };
  if (!OPPORTUNITY_TYPES.includes(input.opportunityType as OpportunityType)) return { error: `opportunityType must be one of ${OPPORTUNITY_TYPES.join(', ')}` };
  const target = validateTargetUrl(typeof input.targetPageUrl === 'string' ? input.targetPageUrl.trim() : '', rootHost);
  if ('error' in target) return { error: target.error };
  const rawMetrics = (input.metrics && typeof input.metrics === 'object' ? input.metrics : {}) as Record<string, unknown>;
  const metrics: QueueRequest['metrics'] = {};
  for (const key of ['clicks', 'impressions', 'position'] as const) {
    const value = finite(rawMetrics[key]);
    if (value !== undefined) metrics[key] = value;
  }
  if (typeof rawMetrics.bestPage === 'string' && rawMetrics.bestPage.length <= 1000 && /^https?:\/\//.test(rawMetrics.bestPage)) metrics.bestPage = rawMetrics.bestPage;
  for (const key of ['rangeStart', 'rangeEnd'] as const) {
    if (typeof rawMetrics[key] === 'string' && ISO_DATE.test(rawMetrics[key] as string)) metrics[key] = rawMetrics[key] as string;
  }
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 1000) : null;
  return { keyword, normalized, opportunityType: input.opportunityType as OpportunityType, targetPageUrl: target.url, metrics, note };
}

const SELECT_ITEM = `SELECT c.id, c.site_id, c.keyword, c.opportunity_type, c.target_page_url, c.metrics, c.note, c.status, u.name AS requested_by_name, c.created_at
FROM seo_content_queue c LEFT JOIN users u ON u.id = c.requested_by`;

/** Creates a pending item, or returns the existing pending one for the same keyword. */
export async function enqueueContent(siteId: string, request: QueueRequest, userId: string | null, newId: () => string = uuidv4): Promise<{ item: QueueItem; created: boolean }> {
  const id = newId();
  const inserted = await execute(
    `INSERT INTO seo_content_queue (id, site_id, keyword, keyword_normalized, opportunity_type, target_page_url, metrics, note, requested_by)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)
     ON CONFLICT (site_id, keyword_normalized) WHERE status = 'pending' DO NOTHING`,
    [id, siteId, request.keyword, request.normalized, request.opportunityType, request.targetPageUrl, JSON.stringify(request.metrics), request.note, userId],
  );
  const item = await queryOne<QueueItem & Record<string, unknown>>(
    `${SELECT_ITEM} WHERE c.site_id = ? AND c.keyword_normalized = ? AND c.status = 'pending'`,
    [siteId, request.normalized],
  );
  if (!item) throw new Error('Content queue item was not saved');
  return { item, created: inserted > 0 };
}

export async function listQueue(siteId: string, status: QueueStatus | 'all' = 'pending', limit = 200): Promise<QueueItem[]> {
  const filter = status === 'all' ? '' : ' AND c.status = ?';
  return queryAll<QueueItem & Record<string, unknown>>(
    `${SELECT_ITEM} WHERE c.site_id = ?${filter} ORDER BY c.created_at DESC LIMIT ?`,
    status === 'all' ? [siteId, limit] : [siteId, status, limit],
  );
}

/** Phase 2 only lets people dismiss a pending item; Content Studio owns the other transitions. */
export async function dismissQueueItem(id: string): Promise<boolean> {
  return (await execute(`UPDATE seo_content_queue SET status = 'dismissed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`, [id])) > 0;
}
