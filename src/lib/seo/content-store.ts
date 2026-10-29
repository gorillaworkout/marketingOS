import { v4 as uuidv4 } from 'uuid';
import { executeTransaction, queryAll, queryOne } from '@/lib/database';
import type { ContentStatus } from './content-status';

/** Content Studio persistence: drafts, their version history, and the P2 queue link. */
export type VersionSource = 'create' | 'edit' | 'ai-draft' | 'ai-rewrite' | 'restore';

export interface DraftContent { title: string; slug: string; metaDescription: string; bodyMarkdown: string }

export interface DraftRow {
  id: string;
  site_id: string;
  site_name: string;
  site_url: string;
  queue_item_id: string | null;
  keyword: string;
  case_study: string | null;
  instructions: string | null;
  target_page_url: string | null;
  brand_guideline_id: string | null;
  brand_guideline_name: string | null;
  title: string;
  slug: string;
  meta_description: string;
  body_markdown: string;
  status: ContentStatus;
  current_version: number;
  model: string | null;
  fallback_label: string | null;
  published_url: string | null;
  published_at: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export type DraftSummary = Omit<DraftRow, 'body_markdown' | 'case_study' | 'instructions'> & { word_count: number };

export interface VersionRow {
  id: string;
  draft_id: string;
  version: number;
  source: VersionSource;
  title: string;
  slug: string;
  meta_description: string;
  body_markdown?: string;
  note: string | null;
  model: string | null;
  fallback_label: string | null;
  created_by_name: string | null;
  created_at: string;
}

export class VersionConflictError extends Error {
  constructor() { super('This article was changed by someone else. Reload to see the latest version.'); }
}

export class QueueItemTakenError extends Error {
  constructor() { super('This queue item was already started in Content Studio.'); }
}

const DRAFT_COLUMNS = `d.id, d.site_id, s.name AS site_name, s.site_url, d.queue_item_id, d.keyword, d.target_page_url,
  d.brand_guideline_id, d.brand_guideline_name, d.title, d.slug, d.meta_description, d.status, d.current_version,
  d.model, d.fallback_label, d.published_url, d.published_at, ua.name AS approved_by_name, d.approved_at,
  d.created_by, uc.name AS created_by_name, uu.name AS updated_by_name, d.created_at, d.updated_at`;
const DRAFT_FROM = `FROM seo_content_drafts d
  JOIN seo_sites s ON s.id = d.site_id
  LEFT JOIN users uc ON uc.id = d.created_by
  LEFT JOIN users uu ON uu.id = d.updated_by
  LEFT JOIN users ua ON ua.id = d.approved_by`;

export interface NewDraft {
  siteId: string;
  queueItemId: string | null;
  keyword: string;
  caseStudy: string | null;
  instructions: string | null;
  targetPageUrl: string | null;
  brandGuidelineId: string | null;
  brandGuidelineName: string;
  content: DraftContent;
  source: 'create' | 'ai-draft';
  model: string | null;
  fallbackLabel: string | null;
  userId: string;
}

/** Inserts the draft with version 1 and marks the queue item in-progress, atomically. */
export async function createDraft(input: NewDraft, newId: () => string = uuidv4): Promise<string> {
  const id = newId();
  await executeTransaction(async tx => {
    await tx.execute(
      `INSERT INTO seo_content_drafts (id, site_id, queue_item_id, keyword, case_study, instructions, target_page_url, brand_guideline_id,
         brand_guideline_name, title, slug, meta_description, body_markdown, status, current_version, model, fallback_label, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?)`,
      [id, input.siteId, input.queueItemId, input.keyword, input.caseStudy, input.instructions, input.targetPageUrl, input.brandGuidelineId,
        input.brandGuidelineName, input.content.title, input.content.slug, input.content.metaDescription, input.content.bodyMarkdown,
        input.model, input.fallbackLabel, input.userId, input.userId],
    );
    await tx.execute(
      `INSERT INTO seo_content_versions (id, draft_id, version, source, title, slug, meta_description, body_markdown, model, fallback_label, created_by)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId(), id, input.source, input.content.title, input.content.slug, input.content.metaDescription, input.content.bodyMarkdown,
        input.model, input.fallbackLabel, input.userId],
    );
    if (input.queueItemId) {
      const claimed = await tx.execute(
        `UPDATE seo_content_queue SET status = 'in-progress', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND site_id = ? AND status = 'pending'`,
        [input.queueItemId, input.siteId],
      );
      if (claimed === 0) throw new QueueItemTakenError();
    }
  });
  return id;
}

export async function getDraft(id: string): Promise<DraftRow | undefined> {
  return queryOne<DraftRow & Record<string, unknown>>(
    `SELECT ${DRAFT_COLUMNS}, d.body_markdown, d.case_study, d.instructions ${DRAFT_FROM} WHERE d.id = ?`,
    [id],
  );
}

export async function listDrafts(siteId: string, status: ContentStatus | 'all', limit = 300): Promise<DraftSummary[]> {
  const filter = status === 'all' ? '' : ' AND d.status = ?';
  const rows = await queryAll<DraftSummary & Record<string, unknown>>(
    `SELECT ${DRAFT_COLUMNS},
       CASE WHEN trim(d.body_markdown) = '' THEN 0 ELSE array_length(regexp_split_to_array(trim(d.body_markdown), E'\\\\s+'), 1) END AS word_count
     ${DRAFT_FROM} WHERE d.site_id = ?${filter} ORDER BY d.updated_at DESC LIMIT ?`,
    status === 'all' ? [siteId, limit] : [siteId, status, limit],
  );
  return rows.map(row => ({ ...row, word_count: Number(row.word_count) }));
}

export interface SaveVersion {
  draftId: string;
  expectedVersion: number;
  content: DraftContent;
  source: Exclude<VersionSource, 'create' | 'ai-draft'>;
  nextStatus: ContentStatus;
  note: string | null;
  model: string | null;
  fallbackLabel: string | null;
  userId: string;
}

/**
 * Writes a new current version. Fails with VersionConflictError when someone
 * else saved first (optimistic locking on current_version).
 */
export async function saveVersion(input: SaveVersion, newId: () => string = uuidv4): Promise<number> {
  const next = input.expectedVersion + 1;
  await executeTransaction(async tx => {
    const changed = await tx.execute(
      `UPDATE seo_content_drafts SET title = ?, slug = ?, meta_description = ?, body_markdown = ?, status = ?, current_version = ?,
         model = COALESCE(?, model), fallback_label = CASE WHEN ? = 'ai-rewrite' THEN ? ELSE fallback_label END,
         approved_by = CASE WHEN ? = 'approved' THEN approved_by ELSE NULL END,
         approved_at = CASE WHEN ? = 'approved' THEN approved_at ELSE NULL END,
         updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND current_version = ?`,
      [input.content.title, input.content.slug, input.content.metaDescription, input.content.bodyMarkdown, input.nextStatus, next,
        input.model, input.source, input.fallbackLabel, input.nextStatus, input.nextStatus, input.userId, input.draftId, input.expectedVersion],
    );
    if (changed === 0) throw new VersionConflictError();
    await tx.execute(
      `INSERT INTO seo_content_versions (id, draft_id, version, source, title, slug, meta_description, body_markdown, note, model, fallback_label, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId(), input.draftId, next, input.source, input.content.title, input.content.slug, input.content.metaDescription,
        input.content.bodyMarkdown, input.note, input.model, input.fallbackLabel, input.userId],
    );
  });
  return next;
}

export async function listVersions(draftId: string): Promise<VersionRow[]> {
  return queryAll<VersionRow & Record<string, unknown>>(
    `SELECT v.id, v.draft_id, v.version, v.source, v.title, v.slug, v.meta_description, v.note, v.model, v.fallback_label,
       u.name AS created_by_name, v.created_at
     FROM seo_content_versions v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.draft_id = ? ORDER BY v.version DESC`,
    [draftId],
  );
}

export async function getVersion(draftId: string, versionId: string): Promise<VersionRow | undefined> {
  return queryOne<VersionRow & Record<string, unknown>>(
    `SELECT v.id, v.draft_id, v.version, v.source, v.title, v.slug, v.meta_description, v.body_markdown, v.note, v.model, v.fallback_label,
       u.name AS created_by_name, v.created_at
     FROM seo_content_versions v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.draft_id = ? AND v.id = ?`,
    [draftId, versionId],
  );
}

export interface StatusChange {
  draftId: string;
  from: ContentStatus;
  to: ContentStatus;
  userId: string;
  publishedUrl?: string | null;
}

/** Moves the status only if it is still `from`. Publishing also closes the queue item. */
export async function changeStatus(change: StatusChange): Promise<boolean> {
  let changed = 0;
  await executeTransaction(async tx => {
    changed = await tx.execute(
      `UPDATE seo_content_drafts SET status = ?,
         approved_by = CASE WHEN ? = 'approved' THEN ? WHEN ? IN ('queued', 'published') THEN approved_by ELSE NULL END,
         approved_at = CASE WHEN ? = 'approved' THEN CURRENT_TIMESTAMP WHEN ? IN ('queued', 'published') THEN approved_at ELSE NULL END,
         published_url = CASE WHEN ? = 'published' THEN ? ELSE published_url END,
         published_at = CASE WHEN ? = 'published' THEN CURRENT_TIMESTAMP ELSE published_at END,
         updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = ?`,
      [change.to, change.to, change.userId, change.to, change.to, change.to, change.to, change.publishedUrl ?? null, change.to,
        change.userId, change.draftId, change.from],
    );
    if (changed > 0 && change.to === 'published') {
      await tx.execute(
        `UPDATE seo_content_queue SET status = 'done', updated_at = CURRENT_TIMESTAMP
         WHERE id = (SELECT queue_item_id FROM seo_content_drafts WHERE id = ?) AND status IN ('pending', 'in-progress')`,
        [change.draftId],
      );
    }
  });
  return changed > 0;
}

/** A queue item Content Studio may start from: same site and still pending. */
export async function getPendingQueueItem(siteId: string, id: string): Promise<{
  id: string; keyword: string; opportunity_type: string; target_page_url: string | null; metrics: Record<string, unknown> | null; note: string | null;
} | undefined> {
  return queryOne(
    `SELECT id, keyword, opportunity_type, target_page_url, metrics, note FROM seo_content_queue WHERE id = ? AND site_id = ? AND status = 'pending'`,
    [id, siteId],
  );
}

export async function draftForQueueItem(queueItemId: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>('SELECT id FROM seo_content_drafts WHERE queue_item_id = ? ORDER BY created_at LIMIT 1', [queueItemId]);
  return row?.id ?? null;
}

export async function countDraftsByStatus(siteId: string): Promise<Record<string, number>> {
  const rows = await queryAll<{ status: string; count: string }>(
    'SELECT status, COUNT(*)::text AS count FROM seo_content_drafts WHERE site_id = ? GROUP BY status',
    [siteId],
  );
  return Object.fromEntries(rows.map(row => [row.status, Number(row.count)]));
}
