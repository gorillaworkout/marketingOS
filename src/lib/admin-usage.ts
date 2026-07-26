import { queryAll } from '@/lib/database';
import { AVAILABLE_MODELS } from '@/lib/openai';

export type UsagePeriod = 'month' | 'quarter' | 'year' | 'all' | `${number}-${number}`;

export interface UsageRecord {
  id: string;
  userId: string;
  username: string;
  department: string;
  model: string;
  provider: string;
  accountSource: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  taskId: string | null;
}

export interface PeriodRange {
  period: UsagePeriod;
  start: Date | null;
  end: Date | null;
}

const modelNames = new Map(AVAILABLE_MODELS.map(model => [model.id, model.name]));

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Parses the analytics period without accepting arbitrary date filters. */
export function getUsagePeriod(value: string | null, now = new Date()): PeriodRange {
  const period = value || 'month';
  if (period === 'all') return { period, start: null, end: null };

  const currentMonth = monthStart(now);
  if (period === 'quarter') {
    return { period, start: new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - 2, 1)), end: now };
  }
  if (period === 'year') {
    return { period, start: new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - 11, 1)), end: now };
  }
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    const [year, month] = period.split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    return { period: period as UsagePeriod, start, end };
  }
  return { period: 'month', start: currentMonth, end: now };
}

export function modelLabel(model: string): string {
  return modelNames.get(model) || model;
}

export async function getUsageRecords(periodValue: string | null): Promise<{ records: UsageRecord[]; range: PeriodRange }> {
  const range = getUsagePeriod(periodValue);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (range.start && range.end) {
    conditions.push('l.created_at >= ?', 'l.created_at < ?');
    params.push(range.start.toISOString(), range.end.toISOString());
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await queryAll<{
    id: string; user_id: string; username: string | null; department: string | null;
    model: string; provider: string | null; account_source: string | null;
    input_tokens: number | string; output_tokens: number | string; cost: number | string; task_id: string | null;
  }>(`
    SELECT l.id, l.user_id, u.username, d.name AS department, l.model, l.provider, l.account_source,
      l.input_tokens, l.output_tokens, l.cost, l.task_id
    FROM token_logs l
    LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN departments d ON d.id = l.department_id
    ${where}
  `, params);

  return {
    range,
    records: rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      username: row.username || 'Unknown user',
      department: row.department || 'Unassigned',
      model: row.model || 'Unknown model',
      provider: row.provider || 'openrouter',
      accountSource: row.account_source || 'office',
      inputTokens: Number(row.input_tokens) || 0,
      outputTokens: Number(row.output_tokens) || 0,
      cost: Number(row.cost) || 0,
      taskId: row.task_id,
    })),
  };
}

export function tokenCount(record: UsageRecord): number {
  return record.inputTokens + record.outputTokens;
}

function topValue(values: Map<string, { tokens: number; cost: number }>): string | null {
  return [...values.entries()].sort((a, b) => b[1].tokens - a[1].tokens || b[1].cost - a[1].cost || a[0].localeCompare(b[0]))[0]?.[0] || null;
}

export function buildSummary(records: UsageRecord[], range: PeriodRange) {
  const users = new Set(records.map(record => record.userId));
  const providers = new Map<string, { tokens: number; cost: number }>();
  const departments = new Map<string, { tokens: number; cost: number }>();
  let totalTokens = 0;
  let totalCost = 0;
  for (const record of records) {
    const tokens = tokenCount(record);
    totalTokens += tokens;
    totalCost += record.cost;
    for (const [key, collection] of [[record.provider, providers], [record.department, departments]] as const) {
      const value = collection.get(key) || { tokens: 0, cost: 0 };
      value.tokens += tokens;
      value.cost += record.cost;
      collection.set(key, value);
    }
  }
  return {
    totalTokens,
    totalCost,
    activeUsers: users.size,
    avgTokensPerUser: users.size ? totalTokens / users.size : 0,
    topProvider: topValue(providers),
    topDepartment: topValue(departments),
    periodStart: range.start?.toISOString() || null,
    periodEnd: range.end?.toISOString() || null,
  };
}

function breakdown(records: UsageRecord[], field: 'model' | 'provider') {
  const grouped = new Map<string, { tokens: number; cost: number }>();
  for (const record of records) {
    const key = field === 'model' ? modelLabel(record.model) : record.provider;
    const value = grouped.get(key) || { tokens: 0, cost: 0 };
    value.tokens += tokenCount(record);
    value.cost += record.cost;
    grouped.set(key, value);
  }
  return [...grouped.entries()]
    .map(([key, value]) => ({ [field]: key, ...value }))
    .sort((a, b) => b.tokens - a.tokens || b.cost - a.cost);
}

export function buildUsers(records: UsageRecord[], limit?: number) {
  const groups = new Map<string, UsageRecord[]>();
  for (const record of records) groups.set(record.userId, [...(groups.get(record.userId) || []), record]);
  const users = [...groups.values()].map(userRecords => {
    const tokens = userRecords.reduce((sum, record) => sum + tokenCount(record), 0);
    const cost = userRecords.reduce((sum, record) => sum + record.cost, 0);
    const models = new Map<string, { tokens: number; cost: number }>();
    const providers = new Map<string, { tokens: number; cost: number }>();
    for (const record of userRecords) {
      for (const [key, collection] of [[modelLabel(record.model), models], [record.provider, providers]] as const) {
        const value = collection.get(key) || { tokens: 0, cost: 0 };
        value.tokens += tokenCount(record); value.cost += record.cost; collection.set(key, value);
      }
    }
    return {
      userId: userRecords[0].userId, username: userRecords[0].username, department: userRecords[0].department,
      totalTokens: tokens, totalCost: cost,
      taskCount: new Set(userRecords.map(record => record.taskId || record.id)).size,
      topModel: topValue(models), topProvider: topValue(providers),
    };
  }).sort((a, b) => b.totalCost - a.totalCost || b.totalTokens - a.totalTokens || a.username.localeCompare(b.username));
  return (limit ? users.slice(0, limit) : users).map((user, index) => ({ rank: index + 1, ...user }));
}

export function buildDepartments(records: UsageRecord[]) {
  const groups = new Map<string, UsageRecord[]>();
  for (const record of records) groups.set(record.department, [...(groups.get(record.department) || []), record]);
  return [...groups.entries()].map(([department, departmentRecords]) => ({
    department,
    totalTokens: departmentRecords.reduce((sum, record) => sum + tokenCount(record), 0),
    totalCost: departmentRecords.reduce((sum, record) => sum + record.cost, 0),
    userCount: new Set(departmentRecords.map(record => record.userId)).size,
    taskCount: new Set(departmentRecords.map(record => record.taskId || record.id)).size,
    modelBreakdown: breakdown(departmentRecords, 'model'),
    providerBreakdown: breakdown(departmentRecords, 'provider'),
  })).sort((a, b) => b.totalCost - a.totalCost || b.totalTokens - a.totalTokens || a.department.localeCompare(b.department));
}

export function buildProviders(records: UsageRecord[]) {
  const groups = new Map<string, UsageRecord[]>();
  for (const record of records) {
    const key = `${record.provider}\u0000${record.accountSource}`;
    groups.set(key, [...(groups.get(key) || []), record]);
  }
  return [...groups.values()].map(providerRecords => ({
    provider: providerRecords[0].provider,
    accountSource: providerRecords[0].accountSource,
    totalTokens: providerRecords.reduce((sum, record) => sum + tokenCount(record), 0),
    totalCost: providerRecords.reduce((sum, record) => sum + record.cost, 0),
    modelBreakdown: breakdown(providerRecords, 'model'),
  })).sort((a, b) => b.totalCost - a.totalCost || b.totalTokens - a.totalTokens || a.provider.localeCompare(b.provider));
}

export function buildTopUsers(records: UsageRecord[], limit: number) {
  return buildUsers(records, limit).map(({ taskCount, ...user }) => ({
    ...user,
    avgTokensPerTask: taskCount ? user.totalTokens / taskCount : 0,
  }));
}
