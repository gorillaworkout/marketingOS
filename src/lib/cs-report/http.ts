import { daysBetween, isIsoDate, type PeriodKind } from './dates';

export const MAX_RANGE_DAYS = 400;

export function readRange(params: URLSearchParams): { from: string; to: string } | { error: string } {
  const from = params.get('from');
  const to = params.get('to');
  if (!isIsoDate(from) || !isIsoDate(to)) return { error: 'from and to must be dates (YYYY-MM-DD).' };
  if (from > to) return { error: 'from must be on or before to.' };
  if (daysBetween(from, to).length > MAX_RANGE_DAYS) return { error: `The range can be at most ${MAX_RANGE_DAYS} days.` };
  return { from, to };
}

export function readAgentId(params: URLSearchParams): string | null {
  const value = params.get('agentId');
  return value && /^[\w-]{1,80}$/.test(value) ? value : null;
}

/** Period preset for export titles; anything else (or missing) is a custom range. */
export function readPeriodKind(params: URLSearchParams): PeriodKind {
  const value = params.get('kind');
  return value === 'day' || value === 'week' || value === 'month' ? value : 'custom';
}
