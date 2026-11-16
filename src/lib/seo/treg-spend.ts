import { randomUUID } from 'node:crypto';
import { execute, executeTransaction, queryAll, queryOne } from '@/lib/database';
export { estimateKeywordGapMicro } from './treg-endpoints';

/** Spend ledger for paid data providers (migration 061). Amounts are integer micro-USD. */

export type SpendStatus = 'reserved' | 'succeeded' | 'fallback' | 'failed';
export type CostSource = 'reported' | 'estimate';

export class DailyLimitError extends Error {
  readonly spentMicro: number;
  readonly limitMicro: number;
  readonly estimateMicro: number;
  constructor(spentMicro: number, limitMicro: number, estimateMicro: number) {
    const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;
    super(`Daily treg spend limit reached: ${usd(spentMicro)} of ${usd(limitMicro)} used today (Asia/Jakarta), and this run is estimated at ${usd(estimateMicro)}. Use Free mode or try again tomorrow.`);
    this.spentMicro = spentMicro;
    this.limitMicro = limitMicro;
    this.estimateMicro = estimateMicro;
  }
}

/** Today's spend: the actual charge when known, otherwise the reserved estimate. */
const SPENT_TODAY_SQL = `SELECT COALESCE(SUM(COALESCE(actual_micro, CASE WHEN status = 'reserved' THEN estimated_micro ELSE 0 END)), 0)::bigint AS spent
  FROM seo_data_provider_spend
  WHERE provider = 'treg' AND created_at >= (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')`;

export async function tregSpentTodayMicro(): Promise<number> {
  const row = await queryOne<{ spent: string | number }>(SPENT_TODAY_SQL);
  return Number(row?.spent) || 0;
}

/**
 * Reserves the estimate against today's limit. A transaction-level advisory lock
 * serialises concurrent reservations so two runs cannot both squeeze under the cap.
 */
export async function reserveTregSpend(input: { feature: string; refId: string | null; userId: string; estimateMicro: number; calls: number; limitMicro: number; balanceBeforeMicro?: number | null }): Promise<string> {
  return executeTransaction(async transaction => {
    await transaction.execute(`SELECT pg_advisory_xact_lock(hashtext('seo_data_provider_spend:treg'))`);
    const row = await transaction.queryOne<{ spent: string | number }>(SPENT_TODAY_SQL);
    const spent = Number(row?.spent) || 0;
    if (spent + input.estimateMicro > input.limitMicro) throw new DailyLimitError(spent, input.limitMicro, input.estimateMicro);
    const id = randomUUID();
    await transaction.execute(
      `INSERT INTO seo_data_provider_spend (id, provider, feature, ref_id, user_id, status, estimated_micro, calls, balance_before_micro)
       VALUES (?, 'treg', ?, ?, ?, 'reserved', ?, ?, ?)`,
      [id, input.feature, input.refId, input.userId, input.estimateMicro, input.calls, input.balanceBeforeMicro ?? null],
    );
    return id;
  });
}

export async function attachSpendRef(id: string, refId: string): Promise<void> {
  await execute('UPDATE seo_data_provider_spend SET ref_id = ? WHERE id = ?', [refId, id]);
}

export async function settleTregSpend(id: string, input: { status: Exclude<SpendStatus, 'reserved'>; actualMicro: number; costSource: CostSource; calls: number; callIds: string[]; note: string | null; balanceAfterMicro?: number | null }): Promise<void> {
  await execute(
    `UPDATE seo_data_provider_spend SET status = ?, actual_micro = ?, cost_source = ?, calls = ?, call_ids = ?::jsonb, note = ?,
       balance_after_micro = ?, finished_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [input.status, Math.max(0, Math.round(input.actualMicro)), input.costSource, input.calls, JSON.stringify(input.callIds.slice(0, 50)), input.note ? input.note.slice(0, 300) : null, input.balanceAfterMicro ?? null, id],
  );
}

/** A reservation whose run died (restart) stops counting once it is an hour old: nothing was settled. */
export async function expireStaleReservations(): Promise<void> {
  await execute(
    `UPDATE seo_data_provider_spend SET status = 'failed', actual_micro = estimated_micro, cost_source = 'estimate',
       note = 'The run stopped before treg reported a cost; the estimate is recorded.', finished_at = CURRENT_TIMESTAMP
     WHERE status = 'reserved' AND created_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'`,
  );
}

export interface SpendRow {
  id: string;
  provider: string;
  feature: string;
  ref_id: string | null;
  user_id: string | null;
  username: string | null;
  status: SpendStatus;
  estimated_micro: number;
  actual_micro: number | null;
  cost_source: CostSource | null;
  calls: number;
  note: string | null;
  balance_before_micro: number | null;
  balance_after_micro: number | null;
  created_at: string;
}

function mapSpend(row: Record<string, unknown>): SpendRow {
  return {
    id: String(row.id),
    provider: String(row.provider),
    feature: String(row.feature),
    ref_id: row.ref_id ? String(row.ref_id) : null,
    user_id: row.user_id ? String(row.user_id) : null,
    username: row.username ? String(row.username) : null,
    status: row.status as SpendStatus,
    estimated_micro: Number(row.estimated_micro) || 0,
    actual_micro: row.actual_micro === null || row.actual_micro === undefined ? null : Number(row.actual_micro),
    cost_source: (row.cost_source as CostSource | null) ?? null,
    calls: Number(row.calls) || 0,
    note: row.note ? String(row.note) : null,
    balance_before_micro: row.balance_before_micro === null || row.balance_before_micro === undefined ? null : Number(row.balance_before_micro),
    balance_after_micro: row.balance_after_micro === null || row.balance_after_micro === undefined ? null : Number(row.balance_after_micro),
    created_at: String(row.created_at),
  };
}

export async function spendForRefs(refIds: string[]): Promise<Map<string, SpendRow>> {
  if (!refIds.length) return new Map();
  const rows = await queryAll<Record<string, unknown>>(
    `SELECT s.*, u.username FROM seo_data_provider_spend s LEFT JOIN users u ON u.id = s.user_id WHERE s.ref_id = ANY(?::text[])`,
    [refIds],
  );
  return new Map(rows.map(row => [String(row.ref_id), mapSpend(row)]));
}

export async function listSpend(range: { start: Date | null; end: Date | null }, limit = 200): Promise<SpendRow[]> {
  const params: unknown[] = [];
  let where = '';
  if (range.start && range.end) {
    where = 'WHERE s.created_at >= ? AND s.created_at < ?';
    params.push(range.start.toISOString(), range.end.toISOString());
  }
  params.push(limit);
  const rows = await queryAll<Record<string, unknown>>(
    `SELECT s.*, u.username FROM seo_data_provider_spend s LEFT JOIN users u ON u.id = s.user_id ${where} ORDER BY s.created_at DESC LIMIT ?`,
    params,
  );
  return rows.map(mapSpend);
}
