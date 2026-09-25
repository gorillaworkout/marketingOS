/** Matches the brief length used when a knowledge entry is first saved. */
export const KNOWLEDGE_ENTRY_TITLE_MAX = 2_000;

/** Title edits write the display title only. Audience and the saved body stay put. */
export const KNOWLEDGE_ENTRY_TITLE_SQL = 'UPDATE knowledge_entries SET brief = ? WHERE id = ?';

/** Same edge cleanup as other knowledge deletes: both directions, this entry only. */
export const KNOWLEDGE_ENTRY_EDGE_DELETE_SQL = 'DELETE FROM knowledge_edges WHERE source_id = ? OR target_id = ?';

export const KNOWLEDGE_ENTRY_DELETE_SQL = 'DELETE FROM knowledge_entries WHERE id = ?';

const ENTRY_ID = /^[A-Za-z0-9_-]{8,80}$/;

export function normalizeKnowledgeEntryId(value: unknown): { id: string } | { error: string } {
  if (typeof value !== 'string' || !ENTRY_ID.test(value.trim())) return { error: 'Knowledge entry is not valid.' };
  return { id: value.trim() };
}

export function normalizeKnowledgeEntryTitle(value: unknown): { title: string } | { error: string } {
  if (typeof value !== 'string') return { error: 'Title is required.' };
  const title = value.replace(/\s+/g, ' ').trim();
  if (!title) return { error: 'Title is required.' };
  if (title.length > KNOWLEDGE_ENTRY_TITLE_MAX) return { error: 'Title is too long.' };
  return { title };
}

/** Read-only label. Company and IT-only are access levels; other text is the stored audience. */
export function knowledgeAudienceLabel(value: string | null | undefined): string {
  const audience = (value || '').trim();
  if (audience === 'company') return 'Company';
  if (audience === 'it-only') return 'IT-only';
  return audience;
}
