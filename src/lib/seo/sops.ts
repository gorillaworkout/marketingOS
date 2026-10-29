/** Pure validation for SEO OS SOPs. */
export const SOP_CATEGORIES = ['on-page', 'content', 'linking', 'technical', 'research', 'other'] as const;
export type SopCategory = typeof SOP_CATEGORIES[number];
export const SOP_CATEGORY_LABELS: Record<SopCategory, string> = {
  'on-page': 'On-page',
  content: 'Content',
  linking: 'Internal linking',
  technical: 'Technical / schema',
  research: 'Keyword research',
  other: 'Other',
};
export const MAX_SOP_TITLE_LENGTH = 200;
export const MAX_SOP_BODY_LENGTH = 100_000;
/** Content Studio passes at most this much of an SOP to the model. */
export const MAX_SOP_PROMPT_LENGTH = 6_000;
export const SEEDED_SOP_IDS = [
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000203',
  '00000000-0000-0000-0000-000000000204',
  '00000000-0000-0000-0000-000000000205',
] as const;

export interface SopInput { title: string; category: SopCategory; bodyMd: string }

export function isSopCategory(value: unknown): value is SopCategory {
  return typeof value === 'string' && (SOP_CATEGORIES as readonly string[]).includes(value);
}

export function parseSopInput(body: unknown): SopInput | { error: string } {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim() : '';
  if (!title) return { error: 'title is required' };
  if (title.length > MAX_SOP_TITLE_LENGTH) return { error: `title is longer than ${MAX_SOP_TITLE_LENGTH} characters` };
  const category = input.category === undefined ? 'other' : input.category;
  if (!isSopCategory(category)) return { error: 'Unknown category' };
  if (input.bodyMd !== undefined && typeof input.bodyMd !== 'string') return { error: 'body must be text' };
  const bodyMd = typeof input.bodyMd === 'string' ? input.bodyMd.replace(/\r\n/g, '\n') : '';
  if (bodyMd.length > MAX_SOP_BODY_LENGTH) return { error: `body is longer than ${MAX_SOP_BODY_LENGTH} characters` };
  return { title, category, bodyMd };
}

/** The SOP block appended to Content Studio prompts. */
export function sopInstructions(sop: { title: string; body_md: string }): string {
  const body = sop.body_md.trim();
  const clipped = body.length > MAX_SOP_PROMPT_LENGTH ? `${body.slice(0, MAX_SOP_PROMPT_LENGTH)}\n[SOP truncated]` : body;
  return `Follow this team SOP ("${sop.title}") where it applies to writing the article:\n${clipped}`;
}
