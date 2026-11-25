/** Dashboard aggregation (pure). Empty counts are summed as 0. */
import { CATEGORY_FIELDS, CHANNEL_FIELDS, COUNT_FIELDS, type CategoryKey, type ChannelKey, type CountKey, type CsStatus } from './fields';
import { daysBetween } from './dates';
import type { Complaint, DailyEntry, WeeklyNote } from './types';

const RESOLVED_RE = /^(solved|resolved|closed|done|completed)$/i;

export function isResolvedStatus(status: string): boolean {
  return RESOLVED_RE.test(status.trim());
}

export function conversations(entry: Pick<DailyEntry, ChannelKey>): number {
  return CHANNEL_FIELDS.reduce((sum, field) => sum + (entry[field.key] ?? 0), 0);
}

export interface ComplaintKpis {
  total: number;
  resolved: number;
  resolvedWithinSla: number;
  slaUnknown: number;
  open: number;
  closedRate: number | null; // 0..1
}

/**
 * Resolved = status Solved/Resolved/Closed/Done/Completed.
 * Resolved within SLA = resolved and sla_met is not false; imported cases have no
 * SLA flag (null) and count as within SLA when resolved (slaUnknown says how many).
 */
export function complaintKpis(complaints: Pick<Complaint, 'status' | 'slaMet'>[]): ComplaintKpis {
  let resolved = 0; let within = 0; let unknown = 0;
  for (const c of complaints) {
    if (!isResolvedStatus(c.status)) continue;
    resolved += 1;
    if (c.slaMet !== false) within += 1;
    if (c.slaMet === null) unknown += 1;
  }
  const total = complaints.length;
  return { total, resolved, resolvedWithinSla: within, slaUnknown: unknown, open: total - resolved, closedRate: total ? resolved / total : null };
}

export interface AgentRow {
  agentId: string;
  agentName: string;
  days: number;
  present: number;
  sick: number;
  annualLeave: number;
  conversations: number;
  channels: Record<ChannelKey, number>;
  categories: Record<CategoryKey, number>;
  unsolvedIssues: number;
  unsolvedCompleted: number;
  notFollowedUp: number;
  complaints: number;
}

export interface DayPoint {
  date: string;
  conversations: number;
  channels: Record<ChannelKey, number>;
  notFollowedUp: number;
  agentsPresent: number;
  agentsOnLeave: number;
}

export interface RecapDay {
  date: string;
  rows: DailyEntry[];
  total: Record<CountKey, number>;
}

export interface QuestionItem {
  date: string; // entry date or week start
  dateTo: string | null; // week end for weekly notes
  source: 'daily' | 'weekly';
  who: string; // agent name or channel
  kind: 'frequent' | 'difficult';
  text: string;
}

export interface CsDashboard {
  from: string;
  to: string;
  kpis: {
    conversations: number;
    channels: Record<ChannelKey, number>;
    categories: Record<CategoryKey, number>;
    notFollowedUp: number;
    unsolvedIssues: number;
    unsolvedCompleted: number;
    entries: number;
    sickDays: number;
    annualLeaveDays: number;
    complaints: ComplaintKpis;
    followUpMinutes: number[];
  };
  trend: DayPoint[];
  agents: AgentRow[];
  recap: RecapDay[];
  questions: QuestionItem[];
  complaints: Complaint[];
}

function zero<K extends string>(keys: readonly { key: K }[]): Record<K, number> {
  return Object.fromEntries(keys.map(field => [field.key, 0])) as Record<K, number>;
}

export function buildCsDashboard(input: { from: string; to: string; entries: DailyEntry[]; complaints: Complaint[]; notes: WeeklyNote[] }): CsDashboard {
  const { from, to } = input;
  const entries = input.entries.filter(entry => entry.date >= from && entry.date <= to);
  const complaints = input.complaints.filter(c => c.date >= from && c.date <= to);
  const channels = zero(CHANNEL_FIELDS);
  const categories = zero(CATEGORY_FIELDS);
  let notFollowedUp = 0; let unsolvedIssues = 0; let unsolvedCompleted = 0; let sickDays = 0; let annualLeaveDays = 0;
  const minutes = new Set<number>();
  const agents = new Map<string, AgentRow>();
  const days = new Map<string, DayPoint>();
  for (const date of daysBetween(from, to)) days.set(date, { date, conversations: 0, channels: zero(CHANNEL_FIELDS), notFollowedUp: 0, agentsPresent: 0, agentsOnLeave: 0 });

  for (const entry of entries) {
    const conv = conversations(entry);
    let agent = agents.get(entry.agentId);
    if (!agent) {
      agent = { agentId: entry.agentId, agentName: entry.agentName, days: 0, present: 0, sick: 0, annualLeave: 0, conversations: 0, channels: zero(CHANNEL_FIELDS), categories: zero(CATEGORY_FIELDS), unsolvedIssues: 0, unsolvedCompleted: 0, notFollowedUp: 0, complaints: 0 };
      agents.set(entry.agentId, agent);
    }
    agent.days += 1;
    const statusKey: Record<CsStatus, 'present' | 'sick' | 'annualLeave'> = { present: 'present', sick: 'sick', annual_leave: 'annualLeave' };
    agent[statusKey[entry.status]] += 1;
    if (entry.status === 'sick') sickDays += 1;
    if (entry.status === 'annual_leave') annualLeaveDays += 1;
    agent.conversations += conv;
    const day = days.get(entry.date);
    for (const field of CHANNEL_FIELDS) {
      const n = entry[field.key] ?? 0;
      channels[field.key] += n; agent.channels[field.key] += n;
      if (day) day.channels[field.key] += n;
    }
    for (const field of CATEGORY_FIELDS) {
      const n = entry[field.key] ?? 0;
      categories[field.key] += n; agent.categories[field.key] += n;
    }
    agent.unsolvedIssues += entry.unsolvedIssues ?? 0; unsolvedIssues += entry.unsolvedIssues ?? 0;
    agent.unsolvedCompleted += entry.unsolvedCompleted ?? 0; unsolvedCompleted += entry.unsolvedCompleted ?? 0;
    agent.notFollowedUp += entry.notFollowedUp ?? 0; notFollowedUp += entry.notFollowedUp ?? 0;
    if (entry.notFollowedUp !== null) minutes.add(entry.followUpMinutes);
    if (day) {
      day.conversations += conv;
      day.notFollowedUp += entry.notFollowedUp ?? 0;
      if (entry.status === 'present') day.agentsPresent += 1; else day.agentsOnLeave += 1;
    }
  }
  for (const c of complaints) {
    if (c.agentId && agents.has(c.agentId)) agents.get(c.agentId)!.complaints += 1;
  }

  const recapMap = new Map<string, DailyEntry[]>();
  for (const entry of entries) recapMap.set(entry.date, [...(recapMap.get(entry.date) ?? []), entry]);
  const recap: RecapDay[] = [...recapMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => {
    const total = zero(COUNT_FIELDS);
    for (const row of rows) for (const field of COUNT_FIELDS) total[field.key] += row[field.key] ?? 0;
    return { date, rows: [...rows].sort((x, y) => x.agentName.localeCompare(y.agentName)), total };
  });

  const questions: QuestionItem[] = [];
  for (const entry of entries) {
    if (entry.frequentQuestion) questions.push({ date: entry.date, dateTo: null, source: 'daily', who: entry.agentName, kind: 'frequent', text: entry.frequentQuestion });
    if (entry.difficultQuestion) questions.push({ date: entry.date, dateTo: null, source: 'daily', who: entry.agentName, kind: 'difficult', text: entry.difficultQuestion });
  }
  for (const note of input.notes) {
    if (note.weekEnd < from || note.weekStart > to) continue;
    if (note.frequentQuestion) questions.push({ date: note.weekStart, dateTo: note.weekEnd, source: 'weekly', who: note.channel, kind: 'frequent', text: note.frequentQuestion });
    if (note.difficultQuestion) questions.push({ date: note.weekStart, dateTo: note.weekEnd, source: 'weekly', who: note.channel, kind: 'difficult', text: note.difficultQuestion });
  }
  questions.sort((a, b) => b.date.localeCompare(a.date) || a.who.localeCompare(b.who));

  return {
    from, to,
    kpis: {
      conversations: Object.values(channels).reduce((a, b) => a + b, 0),
      channels, categories, notFollowedUp, unsolvedIssues, unsolvedCompleted,
      entries: entries.length, sickDays, annualLeaveDays,
      complaints: complaintKpis(complaints),
      followUpMinutes: [...minutes].sort((a, b) => a - b),
    },
    trend: [...days.values()],
    agents: [...agents.values()].sort((a, b) => a.agentName.localeCompare(b.agentName)),
    recap,
    questions,
    complaints: [...complaints].sort((a, b) => b.date.localeCompare(a.date)),
  };
}
