import { queryOne } from '@/lib/database';
import { DUPOIN_DEFAULT_BRAND_GUIDELINE } from '@/lib/dupoin-default-brand-guideline';
import { generateContent, getUserPreferredModel, type BrandGuidelines } from '@/lib/openai';
import { buildDraftPrompt, buildRewritePrompt, parseDraftOutput, type DraftOutput, type DraftPromptInput, type RewritePromptInput } from './content-prompt';

/**
 * AI calls for Content Studio. Everything goes through generateContent, which
 * routes via callApi/runWithModelFallback (automatic model fallback) and logs
 * a token_logs row with task_type `seo-content`.
 */
export const DEFAULT_GUIDELINE_NAME = `${DUPOIN_DEFAULT_BRAND_GUIDELINE.brand_name} (default)`;

function defaultGuideline(): BrandGuidelines {
  const guideline = DUPOIN_DEFAULT_BRAND_GUIDELINE;
  return {
    id: 'default',
    brand_name: guideline.brand_name,
    tone_of_voice: guideline.tone_of_voice,
    target_market: guideline.target_market,
    key_messages: guideline.key_messages,
    do_list: [...guideline.do_list],
    dont_list: [...guideline.dont_list],
    examples: guideline.examples,
  };
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(typeof value === 'string' ? value : '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

/**
 * The brand guideline `id` (checked against `userId` when given, so people
 * can only pick their own), or the built-in Dupoin default when `id` is null.
 * Returns null for an unknown or foreign id. Rewrites pass userId = null to
 * reuse the guideline the draft was created with, whoever owns it.
 */
export async function resolveBrandGuideline(userId: string | null, id: string | null): Promise<BrandGuidelines | null> {
  if (!id) return defaultGuideline();
  const columns = 'SELECT id, brand_name, tone_of_voice, target_market, key_messages, do_list, dont_list, examples FROM brand_guidelines WHERE id = ?';
  const row = userId
    ? await queryOne<Record<string, unknown>>(`${columns} AND user_id = ?`, [id, userId])
    : await queryOne<Record<string, unknown>>(columns, [id]);
  if (!row) return null;
  return {
    id: String(row.id),
    brand_name: String(row.brand_name),
    tone_of_voice: (row.tone_of_voice as string) || undefined,
    target_market: (row.target_market as string) || undefined,
    key_messages: (row.key_messages as string) || undefined,
    do_list: parseList(row.do_list),
    dont_list: parseList(row.dont_list),
    examples: (row.examples as string) || undefined,
  };
}

export interface AiDraftResult extends DraftOutput { model: string; fallbackLabel: string | null }

async function run(userId: string, prompt: { system: string; user: string }, keyword: string, guideline: BrandGuidelines): Promise<AiDraftResult> {
  const model = await getUserPreferredModel(userId, 'seo-content');
  const result = await generateContent(prompt.system, prompt.user, userId, undefined, {
    brandGuidelines: guideline,
    responseFormat: { type: 'json_object' },
    model,
    temperature: 0.6,
    maxTokens: 10_000,
    taskType: 'seo-content',
  });
  return { ...parseDraftOutput(result.content, keyword), model: result.usage.model, fallbackLabel: result.fallbackLabel ?? null };
}

export function generateSeoDraft(userId: string, input: DraftPromptInput, guideline: BrandGuidelines): Promise<AiDraftResult> {
  return run(userId, buildDraftPrompt(input), input.keyword, guideline);
}

export function rewriteSeoDraft(userId: string, input: RewritePromptInput, guideline: BrandGuidelines): Promise<AiDraftResult> {
  return run(userId, buildRewritePrompt(input), input.keyword, guideline);
}
