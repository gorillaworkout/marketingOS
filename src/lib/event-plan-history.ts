import { DEFAULT_EVENT_LOCATION } from './event-plan-budget';

export const EVENT_PLAN_HISTORY_TYPE = 'event-plan' as const;

export interface EventPlanHistoryTask {
  id: string;
  title: string;
  brief?: string;
  output_data?: string;
  created_at: string;
  type?: string;
}

export interface RestoredEventPlan {
  eventName: string;
  theme: string;
  location: string;
  budget: string;
  targetDate: string;
  researchLinks: string;
  options: Array<Record<string, unknown>>;
  model?: string;
  historyId: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readOptionList(output: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(output.options)) {
    const options = output.options.flatMap((item) => {
      const option = asRecord(item);
      return option ? [option] : [];
    });
    if (options.length) return options;
  }
  const planData = asRecord(output.planData);
  if (planData) return [planData];
  if (output.concept || output.objective || output.venue || output.budget || output.timeline) return [output];
  return [];
}

function sanitizeResearch(value: unknown): Record<string, unknown> | undefined {
  const research = asRecord(value);
  if (!research) return undefined;
  const status = research.status === 'researched' || research.status === 'source-provided' || research.status === 'unverified'
    ? research.status
    : 'unverified';
  const sources = Array.isArray(research.sources) ? research.sources.filter((source) => asRecord(source)) : [];
  const contacts = Array.isArray(research.contacts)
    ? research.contacts.flatMap((contact) => {
      const entry = asRecord(contact);
      if (!entry) return [];
      return [{
        vendor: typeof entry.vendor === 'string' ? entry.vendor : '',
        phone: typeof entry.phone === 'string' ? entry.phone : '',
        email: typeof entry.email === 'string' ? entry.email : '',
        sourceUrl: typeof entry.sourceUrl === 'string' ? entry.sourceUrl : '',
        verified: false as const,
      }];
    })
    : [];
  const queries = Array.isArray(research.queries)
    ? research.queries.filter((query): query is string => typeof query === 'string')
    : undefined;
  return { status, sources, contacts, ...(queries ? { queries } : {}) };
}

function normalizeOption(option: Record<string, unknown>, index: number): Record<string, unknown> {
  const style = typeof option.style === 'string' && option.style.trim() ? option.style : `plan-${index + 1}`;
  const styleLabel = typeof option.styleLabel === 'string' && option.styleLabel.trim() ? option.styleLabel : style;
  const research = sanitizeResearch(option.research);
  return research ? { ...option, style, styleLabel, research } : { ...option, style, styleLabel };
}

function restoreBudget(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return String(Math.floor(value));
  if (typeof value === 'string') return value.replace(/\D/g, '');
  return '';
}

function restoreDate(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function restoreLinks(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.filter((url): url is string => typeof url === 'string' && url.trim().length > 0).join('\n');
}

function restoreEventName(input: Record<string, unknown> | null, task: EventPlanHistoryTask): string {
  if (typeof input?.eventName === 'string' && input.eventName.trim()) return input.eventName.trim();
  if (typeof task.brief === 'string' && task.brief.trim()) return task.brief.trim();
  const title = task.title.replace(/^Event Plan:\s*/i, '').trim();
  return title || 'Event plan';
}

export function isEventPlanHistoryType(type: string | null | undefined): boolean {
  return type === EVENT_PLAN_HISTORY_TYPE;
}

export function restoreEventPlan(task: EventPlanHistoryTask): RestoredEventPlan {
  let stored: unknown;
  try {
    stored = JSON.parse(task.output_data || '{}');
  } catch {
    throw new Error('Saved event plan is incomplete.');
  }
  const output = asRecord(stored);
  if (!output) throw new Error('Saved event plan is incomplete.');
  const options = readOptionList(output).map(normalizeOption);
  if (!options.length) throw new Error('Saved event plan is incomplete.');

  const input = asRecord(output.input);
  const location = typeof input?.location === 'string' && input.location.trim()
    ? input.location.trim()
    : DEFAULT_EVENT_LOCATION;
  const model = typeof output.model === 'string' && output.model.trim() ? output.model.trim() : undefined;

  return {
    eventName: restoreEventName(input, task),
    theme: typeof input?.theme === 'string' ? input.theme : '',
    location,
    budget: restoreBudget(input?.budget),
    targetDate: restoreDate(input?.targetDate),
    researchLinks: restoreLinks(input?.researchUrls),
    options,
    ...(model ? { model } : {}),
    historyId: task.id,
  };
}
