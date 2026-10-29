import { MAX_KEYWORD_LENGTH, normalizeKeyword } from './keywords';

/** Pure request parsing, prompt building and AI-output parsing for Content Studio. */
export const MAX_CASE_STUDY_LENGTH = 20_000;
export const MAX_INSTRUCTIONS_LENGTH = 4_000;
export const MAX_BODY_LENGTH = 200_000;
export const MAX_TITLE_LENGTH = 300;
export const MAX_META_LENGTH = 500;
export const MAX_SLUG_LENGTH = 200;
export const DEFAULT_GUIDELINE_ID = 'default';

export interface CreateRequest {
  keyword: string;
  caseStudy: string | null;
  instructions: string | null;
  queueItemId: string | null;
  /** null = the built-in Dupoin default guideline. */
  brandGuidelineId: string | null;
  targetPageUrl: string;
  mode: 'ai' | 'blank';
  /** Optional SEO OS SOP whose body is added to the AI instructions. */
  sopId: string | null;
}

function text(value: unknown, max: number, label: string): string | null | { error: string } {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return { error: `${label} must be text` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `${label} is longer than ${max} characters` };
  return trimmed || null;
}

export function parseCreateRequest(body: unknown): CreateRequest | { error: string } {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const keyword = typeof input.keyword === 'string' ? input.keyword.replace(/\s+/g, ' ').trim() : '';
  if (!normalizeKeyword(keyword)) return { error: 'keyword is required' };
  if (keyword.length > MAX_KEYWORD_LENGTH) return { error: `keyword is longer than ${MAX_KEYWORD_LENGTH} characters` };
  const caseStudy = text(input.caseStudy, MAX_CASE_STUDY_LENGTH, 'Case study');
  if (caseStudy && typeof caseStudy === 'object') return caseStudy;
  const instructions = text(input.instructions, MAX_INSTRUCTIONS_LENGTH, 'Instructions');
  if (instructions && typeof instructions === 'object') return instructions;
  const guideline = typeof input.brandGuidelineId === 'string' ? input.brandGuidelineId.trim() : '';
  return {
    keyword,
    caseStudy: caseStudy as string | null,
    instructions: instructions as string | null,
    queueItemId: typeof input.queueItemId === 'string' && input.queueItemId.trim() ? input.queueItemId.trim() : null,
    brandGuidelineId: guideline && guideline !== DEFAULT_GUIDELINE_ID ? guideline : null,
    targetPageUrl: typeof input.targetPageUrl === 'string' ? input.targetPageUrl.trim() : '',
    mode: input.mode === 'blank' ? 'blank' : 'ai',
    sopId: typeof input.sopId === 'string' && input.sopId.trim() ? input.sopId.trim() : null,
  };
}

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

const OUTPUT_CONTRACT = `Respond with ONLY a JSON object, no code fences:
{"title": "SEO title, max 60 characters, includes the keyword",
 "slug": "url-slug-with-hyphens",
 "meta_description": "max 155 characters, includes the keyword, invites the click",
 "body_markdown": "the full article in Markdown"}`;

const SYSTEM = `You are a senior SEO content writer. You write helpful, accurate, people-first articles that rank on Google and can be quoted by AI assistants.
Rules:
- Match the search intent of the target keyword. Put the keyword in the title, the first 100 words and at least one H2, naturally — never stuff it.
- Structure: a short intro that answers the query, H2/H3 sections, short paragraphs, lists where they help, and a FAQ section (3-5 questions) near the end.
- Use the case study as first-hand evidence (experience, specifics, numbers). Never invent facts, statistics, quotes or results that are not in the brief or case study.
- Do not add an H1 inside body_markdown; the title is the H1.
- Write in the language the brief asks for; default to the language of the keyword.
- Body length: 900-1600 words unless the instructions say otherwise.
${OUTPUT_CONTRACT}`;

export interface DraftPromptInput {
  siteName: string;
  siteUrl: string;
  keyword: string;
  caseStudy: string | null;
  targetPageUrl: string | null;
  opportunityType?: string | null;
  metrics?: { clicks?: number; impressions?: number; position?: number; bestPage?: string } | null;
  instructions?: string | null;
}

const OPPORTUNITY_HINTS: Record<string, string> = {
  push: 'The site already ranks just outside the top results for this keyword; write the strongest page on the topic so it can move into the top 3.',
  're-optimize': 'An existing page ranks for this keyword but underperforms; write an improved, more complete version of that page.',
  'no-page': 'The site has no page for this keyword yet; write a new page that targets it.',
  homepage: 'Only the homepage ranks for this keyword; write a dedicated page so the homepage is not the landing page.',
};

export function buildDraftPrompt(input: DraftPromptInput): { system: string; user: string } {
  const lines = [
    `Website: ${input.siteName} (${input.siteUrl})`,
    `Target keyword: ${input.keyword}`,
  ];
  if (input.targetPageUrl) lines.push(`Target page URL: ${input.targetPageUrl}`);
  if (input.opportunityType) {
    lines.push(`Opportunity: ${input.opportunityType}. ${OPPORTUNITY_HINTS[input.opportunityType] ?? ''}`.trim());
  }
  const metrics = input.metrics ?? {};
  const facts = [
    metrics.position !== undefined ? `average position ${metrics.position}` : null,
    metrics.impressions !== undefined ? `${metrics.impressions} impressions` : null,
    metrics.clicks !== undefined ? `${metrics.clicks} clicks` : null,
    metrics.bestPage ? `best ranking page ${metrics.bestPage}` : null,
  ].filter(Boolean);
  if (facts.length) lines.push(`Google Search Console (recent): ${facts.join(', ')}`);
  lines.push('', 'Case study / first-hand material:', input.caseStudy || '(none provided — keep claims general and verifiable)');
  if (input.instructions) lines.push('', `Extra instructions: ${input.instructions}`);
  lines.push('', 'Write the article now.');
  return { system: SYSTEM, user: lines.join('\n') };
}

export interface RewritePromptInput {
  keyword: string;
  title: string;
  metaDescription: string;
  bodyMarkdown: string;
  instruction: string;
  /** SOP block (see sopInstructions) the article follows, if any. */
  sop?: string | null;
}

export function buildRewritePrompt(input: RewritePromptInput): { system: string; user: string } {
  const user = [
    `Target keyword: ${input.keyword}`,
    `Rewrite instruction: ${input.instruction}`,
    ...(input.sop ? ['', input.sop] : []),
    '',
    'Current title:', input.title,
    'Current meta description:', input.metaDescription,
    'Current article (Markdown):',
    input.bodyMarkdown,
    '',
    'Apply the instruction and return the complete updated article (not only the changed part). Keep facts that are already in the article; do not invent new ones.',
  ].join('\n');
  return { system: SYSTEM, user };
}

export interface DraftOutput { title: string; slug: string; metaDescription: string; bodyMarkdown: string }

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Accepts the JSON contract, JSON inside a code fence, or plain Markdown. */
export function parseDraftOutput(content: string, keyword: string): DraftOutput {
  const raw = content.trim();
  const fenced = raw.match(/^```(json)*\s*([\s\S]*)```$/i);
  const candidate = fenced ? fenced[2].trim() : raw;
  let parsed: Record<string, unknown> | null = null;
  if (candidate.startsWith('{')) {
    try { parsed = JSON.parse(candidate) as Record<string, unknown>; } catch { parsed = null; }
  }
  let title: string;
  let body: string;
  let slug: string;
  let meta: string;
  if (parsed) {
    title = str(parsed.title);
    body = str(parsed.body_markdown) || str(parsed.body);
    slug = str(parsed.slug);
    meta = str(parsed.meta_description);
  } else {
    body = raw;
    title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '';
    slug = '';
    meta = '';
  }
  title = (title || keyword).slice(0, MAX_TITLE_LENGTH);
  return {
    title,
    slug: slugify(slug || title) || slugify(keyword),
    metaDescription: meta.slice(0, MAX_META_LENGTH),
    bodyMarkdown: body.slice(0, MAX_BODY_LENGTH),
  };
}
