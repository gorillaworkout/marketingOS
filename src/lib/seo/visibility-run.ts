import { generateContent } from '@/lib/openai';
import {
  CHECK_SYSTEM_PROMPT, HARD_MAX_CHECKS, buildClassifierPrompt, detectMentions, effectiveBrandTerms, hostOf, parseClassifierOutput, planChecks,
  type PlannedCheck, type VisibilitySettings,
} from './visibility';
import {
  finishRun, getVisibilitySettings, insertCheck, listPrompts, startRun, updateRunProgress,
  type NewCheck, type PromptRow,
} from './visibility-store';
import { getSeoSite, type SeoSiteRow } from './sites';

/**
 * Runs AI Visibility checks: every planned prompt x model is sent through
 * generateContent (gateway routing + model fallback, token_logs with
 * task_type `seo-visibility`), then mention detection runs on the answer.
 */

export const VISIBILITY_TASK_TYPE = 'seo-visibility';
export const DEFAULT_CONCURRENCY = 3;
const CHECK_MAX_TOKENS = 1_500;
const CLASSIFIER_MAX_TOKENS = 200;

export interface AskResult { content: string; model: string; inputTokens: number; outputTokens: number; cost: number; fallbackLabel: string | null }
export type AskFn = (model: string, system: string, user: string, options: { temperature: number; maxTokens: number }) => Promise<AskResult>;

export interface ExecuteDeps {
  ask: AskFn;
  saveCheck: (check: NewCheck) => Promise<unknown>;
  progress: (progress: { done: number; failed: number; cost: number }) => Promise<unknown>;
}

export interface ExecuteInput {
  runId: string;
  site: Pick<SeoSiteRow, 'id' | 'name' | 'site_url' | 'gsc_property'>;
  prompts: Map<string, Pick<PromptRow, 'id' | 'prompt' | 'brand_terms' | 'competitors'>>;
  checks: PlannedCheck[];
  settings: Pick<VisibilitySettings, 'classifierEnabled' | 'classifierModel'>;
  concurrency?: number;
}

export interface ExecuteResult { done: number; failed: number; cost: number }

export function siteHostFor(site: Pick<SeoSiteRow, 'site_url' | 'gsc_property'>): string {
  if (site.gsc_property?.startsWith('sc-domain:')) return site.gsc_property.slice('sc-domain:'.length).toLowerCase().replace(/^www\./, '');
  return hostOf(site.site_url) ?? '';
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

export async function executeChecks(input: ExecuteInput, deps: ExecuteDeps): Promise<ExecuteResult> {
  const siteHost = siteHostFor(input.site);
  const totals = { done: 0, failed: 0, cost: 0 };
  const queue = [...input.checks];

  async function runOne(planned: PlannedCheck): Promise<void> {
    const prompt = input.prompts.get(planned.promptId);
    if (!prompt) return;
    const base = {
      runId: input.runId, siteId: input.site.id, promptId: prompt.id, promptText: prompt.prompt, model: planned.model,
    };
    let answer: AskResult;
    try {
      answer = await deps.ask(planned.model, CHECK_SYSTEM_PROMPT, prompt.prompt, { temperature: 0.7, maxTokens: CHECK_MAX_TOKENS });
    } catch (error) {
      totals.failed += 1;
      await deps.saveCheck({
        ...base, answeredModel: null, fallbackLabel: null, response: null, mentioned: null, rankInAnswer: null, citedUrls: [],
        siteCited: false, competitorsMentioned: [], detection: null, classifierEvidence: null, inputTokens: 0, outputTokens: 0, cost: 0,
        error: message(error),
      });
      return;
    }
    const brandTerms = effectiveBrandTerms(prompt.brand_terms, input.site.name);
    const detected = detectMentions({ response: answer.content, brandTerms, competitors: prompt.competitors, siteHost });
    let cost = answer.cost;
    let detection: 'terms' | 'classifier' = 'terms';
    let evidence: string | null = null;
    let mentioned = detected.mentioned;
    if (!mentioned && input.settings.classifierEnabled && answer.content.trim()) {
      try {
        const classifier = buildClassifierPrompt(answer.content, brandTerms, siteHost);
        const verdict = await deps.ask(input.settings.classifierModel, classifier.system, classifier.user, { temperature: 0, maxTokens: CLASSIFIER_MAX_TOKENS });
        cost += verdict.cost;
        const parsed = parseClassifierOutput(verdict.content, answer.content);
        if (parsed.mentioned) { mentioned = true; detection = 'classifier'; evidence = parsed.evidence; }
      } catch (error) {
        console.warn('AI Visibility classifier failed:', message(error));
      }
    }
    totals.done += 1;
    totals.cost += cost;
    await deps.saveCheck({
      ...base, answeredModel: answer.model, fallbackLabel: answer.fallbackLabel, response: answer.content, mentioned,
      rankInAnswer: detection === 'terms' ? detected.rankInAnswer : null, citedUrls: detected.citedUrls, siteCited: detected.siteCited,
      competitorsMentioned: detected.competitorsMentioned, detection, classifierEvidence: evidence,
      inputTokens: answer.inputTokens, outputTokens: answer.outputTokens, cost, error: null,
    });
  }

  const workers = Array.from({ length: Math.max(1, Math.min(input.concurrency ?? DEFAULT_CONCURRENCY, 10)) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await runOne(next);
      await deps.progress({ ...totals });
    }
  });
  await Promise.all(workers);
  return totals;
}

export function runStatus(result: ExecuteResult, planned: number): 'succeeded' | 'partial' | 'failed' {
  if (planned > 0 && result.done === 0) return 'failed';
  return result.failed > 0 ? 'partial' : 'succeeded';
}

export function gatewayAsk(userId: string): AskFn {
  return async (model, system, user, options) => {
    const result = await generateContent(system, user, userId, undefined, {
      model, temperature: options.temperature, maxTokens: options.maxTokens, taskType: VISIBILITY_TASK_TYPE,
    });
    return {
      content: result.content,
      model: result.usage.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cost: result.usage.cost,
      fallbackLabel: result.fallbackLabel ?? null,
    };
  };
}

export class NothingToCheckError extends Error {
  constructor() { super('This site has no active AI Visibility prompts yet. Add prompts first.'); }
}

export interface StartedRun { runId: string; planned: number; skippedPrompts: number; done: Promise<ExecuteResult> }

/**
 * Plans and locks a run, then starts the checks. `done` settles when the
 * run is finished and recorded; callers may await it (cron) or not (Run now).
 */
export async function startVisibilityRun(options: {
  siteId: string;
  trigger: 'manual' | 'cron';
  triggeredBy: string | null;
  tokenUserId: string;
  maxChecks?: number;
  concurrency?: number;
  ask?: AskFn;
}): Promise<StartedRun> {
  const site = await getSeoSite(options.siteId);
  if (!site) throw new Error('SEO site not found');
  const settings = await getVisibilitySettings(site.id);
  const prompts = await listPrompts(site.id, true);
  if (!prompts.length) throw new NothingToCheckError();
  const cap = Math.min(options.maxChecks ?? settings.maxChecksPerRun, HARD_MAX_CHECKS);
  const plan = planChecks(prompts.map(p => ({ id: p.id, lastCheckedAt: p.last_checked_at, createdAt: p.created_at })), settings.models, cap);
  const runId = await startRun({
    siteId: site.id, models: [...new Set(plan.checks.map(check => check.model))], classifierEnabled: settings.classifierEnabled,
    checksPlanned: plan.checks.length, promptsSkipped: plan.skippedPrompts, trigger: options.trigger, triggeredBy: options.triggeredBy,
  });

  const done = (async () => {
    let result: ExecuteResult = { done: 0, failed: 0, cost: 0 };
    try {
      result = await executeChecks({
        runId, site, prompts: new Map(prompts.map(p => [p.id, p])), checks: plan.checks, settings, concurrency: options.concurrency,
      }, {
        ask: options.ask ?? gatewayAsk(options.tokenUserId),
        saveCheck: insertCheck,
        progress: progress => updateRunProgress(runId, progress),
      });
      const status = runStatus(result, plan.checks.length);
      await finishRun(runId, status, result, status === 'failed' ? 'Every check failed. See the check errors.' : null);
    } catch (error) {
      await finishRun(runId, 'failed', result, message(error)).catch(() => undefined);
    }
    return result;
  })();
  return { runId, planned: plan.checks.length, skippedPrompts: plan.skippedPrompts, done };
}
