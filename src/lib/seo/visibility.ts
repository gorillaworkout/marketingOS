import { AVAILABLE_MODELS } from '@/lib/openai';
import { parseCsv } from './csv';

/**
 * Pure helpers for SEO OS AI Visibility: prompt validation, mention
 * detection, rank and citation extraction, run planning and classifier
 * prompt/parse. No database or network access here.
 */

export { VISIBILITY_DISCLAIMER } from './visibility-copy';
export const DEFAULT_VISIBILITY_MODELS = ['cc/claude-sonnet-5-5', 'cx/gpt-5.6-sol', 'ag/gemini-3-flash'] as const;
export const DEFAULT_CLASSIFIER_MODEL = 'ag/gemini-3-flash';
export const DEFAULT_MAX_CHECKS = 60;
export const HARD_MAX_CHECKS = 300;
export const MAX_MODELS = 10;
export const MAX_PROMPT_LENGTH = 1_000;
export const MAX_TERMS = 20;
export const MAX_TERM_LENGTH = 120;
export const MAX_PROMPTS_PER_SITE = 500;
export const MAX_CITED_URLS = 50;

export interface VisibilitySettings {
  models: string[];
  classifierEnabled: boolean;
  classifierModel: string;
  maxChecksPerRun: number;
}

export const DEFAULT_SETTINGS: VisibilitySettings = {
  models: [...DEFAULT_VISIBILITY_MODELS],
  classifierEnabled: false,
  classifierModel: DEFAULT_CLASSIFIER_MODEL,
  maxChecksPerRun: DEFAULT_MAX_CHECKS,
};

const KNOWN_MODELS = new Set(AVAILABLE_MODELS.map(model => model.id));

function cleanTerm(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Accepts an array or a string split on newlines, commas or semicolons; dedupes case-insensitively. */
export function parseTermList(value: unknown, label: string): string[] | { error: string } {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,;]+/) : value == null ? [] : null;
  if (!raw) return { error: `${label} must be a list` };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const term = cleanTerm(item);
    if (!term) continue;
    if (term.length > MAX_TERM_LENGTH) return { error: `${label}: "${term.slice(0, 40)}" is longer than ${MAX_TERM_LENGTH} characters` };
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  if (out.length > MAX_TERMS) return { error: `${label}: at most ${MAX_TERMS} entries` };
  return out;
}

export interface PromptInput {
  prompt: string;
  brandTerms: string[];
  competitors: string[];
  active: boolean;
}

export function parsePromptInput(body: unknown): PromptInput | { error: string } {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const prompt = typeof input.prompt === 'string' ? input.prompt.replace(/\s+/g, ' ').trim() : '';
  if (!prompt) return { error: 'prompt is required' };
  if (prompt.length > MAX_PROMPT_LENGTH) return { error: `prompt is longer than ${MAX_PROMPT_LENGTH} characters` };
  const brandTerms = parseTermList(input.brandTerms, 'Brand terms');
  if ('error' in brandTerms) return brandTerms;
  const competitors = parseTermList(input.competitors, 'Competitors');
  if ('error' in competitors) return competitors;
  return { prompt, brandTerms, competitors, active: input.active === undefined ? true : input.active === true };
}

export function parseSettingsInput(body: unknown): VisibilitySettings | { error: string } {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!Array.isArray(input.models)) return { error: 'models must be a list of model ids' };
  const models = [...new Set(input.models.map(cleanTerm).filter(Boolean))];
  if (!models.length) return { error: 'Pick at least one model' };
  if (models.length > MAX_MODELS) return { error: `At most ${MAX_MODELS} models` };
  const unknown = models.find(model => !KNOWN_MODELS.has(model));
  if (unknown) return { error: `Unknown model: ${unknown}` };
  const classifierModel = cleanTerm(input.classifierModel) || DEFAULT_CLASSIFIER_MODEL;
  if (!KNOWN_MODELS.has(classifierModel)) return { error: `Unknown classifier model: ${classifierModel}` };
  const max = Number(input.maxChecksPerRun ?? DEFAULT_MAX_CHECKS);
  if (!Number.isInteger(max) || max < 1 || max > HARD_MAX_CHECKS) return { error: `Max checks per run must be between 1 and ${HARD_MAX_CHECKS}` };
  return { models, classifierEnabled: input.classifierEnabled === true, classifierModel, maxChecksPerRun: max };
}

/** "Name|alias|alias" -> { name, terms }. */
export function parseCompetitor(entry: string): { name: string; terms: string[] } {
  const terms = entry.split('|').map(cleanTerm).filter(Boolean);
  return { name: terms[0] ?? entry.trim(), terms };
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch { return null; }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive, Unicode-aware whole-term regex ("ICA" does not match "Africa"). */
export function termRegex(term: string): RegExp {
  const body = escapeRegex(term.trim()).replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu');
}

/** First character index of any term in text, or -1. */
export function firstIndexOf(text: string, terms: string[]): number {
  let best = -1;
  for (const term of terms) {
    if (!term.trim()) continue;
    const match = termRegex(term).exec(text);
    if (match && (best === -1 || match.index < best)) best = match.index;
  }
  return best;
}

const URL_PATTERN = /https?:\/\/[^\s<>()[\]{}"'`|\\^]+/giu;

export function extractUrls(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(/[.,;:!?*_~]+$/u, '');
    if (url.length > 2_000 || !hostOf(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_CITED_URLS) break;
  }
  return out;
}

export function hostMatches(host: string | null, siteHost: string): boolean {
  if (!host || !siteHost) return false;
  return host === siteHost || host.endsWith(`.${siteHost}`);
}

/** Top-level numbered or bulleted list items with their character spans, in order. */
export function listItems(text: string): Array<{ start: number; end: number }> {
  const items: Array<{ start: number; end: number }> = [];
  const pattern = /^(?: {0,3})(?:\d{1,2}[.)]|[-*+•])\s+\S/gmu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) items.push({ start: match.index, end: text.length });
  for (let i = 0; i < items.length - 1; i += 1) items[i].end = items[i + 1].start;
  // A trailing paragraph after the last item is not part of it.
  if (items.length) {
    const last = items[items.length - 1];
    const blank = text.slice(last.start).search(/\n\s*\n(?! {2,}|\t)/u);
    if (blank !== -1) last.end = last.start + blank;
  }
  return items;
}

export interface DetectionInput {
  response: string;
  brandTerms: string[];
  competitors: string[];
  siteHost: string;
}

export interface DetectionResult {
  mentioned: boolean;
  rankInAnswer: number | null;
  citedUrls: string[];
  siteCited: boolean;
  competitorsMentioned: string[];
}

/**
 * Brand mention = any brand term or the site host appears as a whole term,
 * or the answer cites a URL on the site. Rank = the 1-based list item the
 * brand first appears in when the answer is a list (2+ items); otherwise
 * its position among the brand and competitors by first mention.
 */
export function detectMentions(input: DetectionInput): DetectionResult {
  const text = input.response ?? '';
  const brandTerms = [...input.brandTerms, input.siteHost].filter(term => term && term.trim());
  const citedUrls = extractUrls(text);
  const siteCited = citedUrls.some(url => hostMatches(hostOf(url), input.siteHost));
  let brandIndex = firstIndexOf(text, brandTerms);
  if (brandIndex === -1 && siteCited) {
    const url = citedUrls.find(candidate => hostMatches(hostOf(candidate), input.siteHost))!;
    brandIndex = text.indexOf(url);
  }

  const competitorHits = input.competitors
    .map(parseCompetitor)
    .map(competitor => ({ name: competitor.name, index: firstIndexOf(text, competitor.terms) }))
    .filter(hit => hit.index !== -1);
  const competitorsMentioned = [...new Set(competitorHits.map(hit => hit.name))];

  let rankInAnswer: number | null = null;
  if (brandIndex !== -1) {
    const items = listItems(text);
    const item = items.length >= 2 ? items.findIndex(span => brandIndex >= span.start && brandIndex < span.end) : -1;
    if (item !== -1) rankInAnswer = item + 1;
    else rankInAnswer = 1 + competitorHits.filter(hit => hit.index < brandIndex).length;
  }

  return { mentioned: brandIndex !== -1, rankInAnswer, citedUrls, siteCited, competitorsMentioned };
}

/** Brand terms for a prompt: its own list, or the site name when empty. */
export function effectiveBrandTerms(promptTerms: string[], siteName: string): string[] {
  return promptTerms.length ? promptTerms : [siteName].filter(Boolean);
}

export interface PlannablePrompt { id: string; lastCheckedAt: string | Date | null; createdAt: string | Date }
export interface PlannedCheck { promptId: string; model: string }

/**
 * Every selected prompt is asked on every model, so model rates compare the
 * same prompts. When prompts x models exceeds the cap, the prompts checked
 * least recently (never-checked first) go first; the rest wait for the next run.
 */
export function planChecks(prompts: PlannablePrompt[], models: string[], cap: number): { checks: PlannedCheck[]; skippedPrompts: number } {
  const limit = Math.max(1, Math.min(HARD_MAX_CHECKS, Math.floor(cap)));
  const usedModels = models.slice(0, limit);
  if (!usedModels.length || !prompts.length) return { checks: [], skippedPrompts: prompts.length };
  const time = (value: string | Date | null) => (value === null ? -Infinity : new Date(value).getTime());
  const ordered = [...prompts].sort((a, b) =>
    time(a.lastCheckedAt) - time(b.lastCheckedAt) || time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id));
  const promptCount = Math.max(1, Math.floor(limit / usedModels.length));
  const selected = ordered.slice(0, promptCount);
  return {
    checks: selected.flatMap(prompt => usedModels.map(model => ({ promptId: prompt.id, model }))),
    skippedPrompts: prompts.length - selected.length,
  };
}

export const CHECK_SYSTEM_PROMPT = 'You are a helpful assistant. Answer the user\'s question directly and helpfully. When it helps, name specific organisations, products, services or websites, and include source URLs you are confident about.';

export function buildClassifierPrompt(response: string, brandTerms: string[], siteHost: string): { system: string; user: string } {
  return {
    system: 'You check whether a text mentions a specific brand. Reply with JSON only: {"mentioned": true|false, "evidence": "exact quote from the text, or empty"}.',
    user: [
      `Brand: ${[...brandTerms, siteHost].filter(Boolean).join(' / ')}`,
      'Count indirect references (abbreviations, translated or misspelled names, its website) as a mention. Do not count other organisations with similar names.',
      '',
      'Text:',
      response.slice(0, 12_000),
    ].join('\n'),
  };
}

/** Accepts the classifier verdict only when its evidence quote really appears in the answer. */
export function parseClassifierOutput(output: string, response: string): { mentioned: boolean; evidence: string | null } {
  const json = output.match(/\{[\s\S]*\}/u)?.[0];
  if (!json) return { mentioned: false, evidence: null };
  try {
    const parsed = JSON.parse(json) as { mentioned?: unknown; evidence?: unknown };
    const evidence = typeof parsed.evidence === 'string' ? parsed.evidence.trim().slice(0, 300) : '';
    if (parsed.mentioned !== true || evidence.length < 2) return { mentioned: false, evidence: null };
    const normalize = (value: string) => value.replace(/\s+/g, ' ').toLowerCase();
    return normalize(response).includes(normalize(evidence)) ? { mentioned: true, evidence } : { mentioned: false, evidence: null };
  } catch { return { mentioned: false, evidence: null }; }
}

export interface PromptCsvResult { rows: PromptInput[]; errors: Array<{ line: number; error: string }>; dataRows: number }

/** CSV columns: prompt (required), brand_terms, competitors, active. Separate several terms in one cell with ";". */
export function parsePromptCsv(text: string): PromptCsvResult {
  const table = parseCsv(text).filter(row => row.some(cell => cell.trim()));
  if (!table.length) return { rows: [], errors: [{ line: 1, error: 'The file is empty' }], dataRows: 0 };
  const header = table[0].map(cell => cell.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const column = (names: string[]) => header.findIndex(cell => names.includes(cell));
  const promptCol = column(['prompt', 'question', 'query']);
  if (promptCol === -1) return { rows: [], errors: [{ line: 1, error: 'Missing a "prompt" column' }], dataRows: table.length - 1 };
  const brandCol = column(['brand_terms', 'brand', 'brands']);
  const compCol = column(['competitors', 'competitor']);
  const activeCol = column(['active']);
  const rows: PromptInput[] = [];
  const errors: Array<{ line: number; error: string }> = [];
  const seen = new Set<string>();
  table.slice(1).forEach((cells, index) => {
    const line = index + 2;
    const activeCell = activeCol === -1 ? '' : (cells[activeCol] ?? '').trim().toLowerCase();
    const parsed = parsePromptInput({
      prompt: cells[promptCol] ?? '',
      brandTerms: brandCol === -1 ? [] : (cells[brandCol] ?? '').split(/;/),
      competitors: compCol === -1 ? [] : (cells[compCol] ?? '').split(/;/),
      active: !['false', 'no', '0', 'inactive'].includes(activeCell),
    });
    if ('error' in parsed) { errors.push({ line, error: parsed.error }); return; }
    const key = parsed.prompt.toLowerCase();
    if (seen.has(key)) { errors.push({ line, error: 'Duplicate prompt in file' }); return; }
    seen.add(key);
    rows.push(parsed);
  });
  return { rows, errors, dataRows: table.length - 1 };
}

export function rate(mentioned: number, total: number): number | null {
  return total > 0 ? Math.round((mentioned / total) * 1000) / 10 : null;
}
