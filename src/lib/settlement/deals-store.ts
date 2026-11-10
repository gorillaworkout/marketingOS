/**
 * SQL for Deals History. Placeholders are `?`. Abort never deletes fact rows.
 * Commit upserts only the staged deals, then rebuilds the daily cache from the fact table.
 */
import { execute, executeTransaction, queryAll } from '@/lib/database';
import { eachDate, MAX_CHUNK_DEALS } from './deals-parse';
import { dealsHistoryFromDaily, type DealCoverageStatus, type DealsDay } from './deals-report';
import { attestedRange, footerMatches, mergeIncoming, type DealFact } from './deals-engine';

export const UPSERT_FACT_SQL = `INSERT INTO settlement_mt5_deal_facts
  (deal, login, server_time, entry, volume, commission, fee, swap, profit, currency, rate, session_id)
VALUES (?, ?, ?::timestamp, ?, ?::numeric, ?::numeric, ?::numeric, ?::numeric, ?::numeric, ?, ?::integer, ?)
ON CONFLICT (deal) DO UPDATE SET
  login = EXCLUDED.login, server_time = EXCLUDED.server_time, entry = EXCLUDED.entry,
  volume = EXCLUDED.volume, commission = EXCLUDED.commission, fee = EXCLUDED.fee,
  swap = EXCLUDED.swap, profit = EXCLUDED.profit, currency = EXCLUDED.currency,
  rate = EXCLUDED.rate, session_id = EXCLUDED.session_id, updated_at = CURRENT_TIMESTAMP
WHERE settlement_mt5_deal_facts.login IS DISTINCT FROM EXCLUDED.login
   OR settlement_mt5_deal_facts.server_time IS DISTINCT FROM EXCLUDED.server_time
   OR settlement_mt5_deal_facts.entry IS DISTINCT FROM EXCLUDED.entry
   OR settlement_mt5_deal_facts.volume IS DISTINCT FROM EXCLUDED.volume
   OR settlement_mt5_deal_facts.commission IS DISTINCT FROM EXCLUDED.commission
   OR settlement_mt5_deal_facts.fee IS DISTINCT FROM EXCLUDED.fee
   OR settlement_mt5_deal_facts.swap IS DISTINCT FROM EXCLUDED.swap
   OR settlement_mt5_deal_facts.profit IS DISTINCT FROM EXCLUDED.profit
   OR settlement_mt5_deal_facts.rate IS DISTINCT FROM EXCLUDED.rate`;

export const REBUILD_DELETE_SQL = 'DELETE FROM settlement_dh_daily WHERE server_date = ANY(?::date[])';

export const REBUILD_INSERT_SQL = `INSERT INTO settlement_dh_daily (server_date, rate, commission_in, swap_amount, deals)
SELECT server_time::date, rate,
       COALESCE(SUM(commission) FILTER (WHERE entry = 'in'), 0),
       COALESCE(SUM(swap), 0),
       COUNT(*)::integer
FROM settlement_mt5_deal_facts
WHERE rate IS NOT NULL AND server_time::date = ANY(?::date[])
GROUP BY 1, 2`;

/**
 * One writer lock for the whole commit. A lock per Deal does not fit:
 * max_locks_per_transaction is 64, and 390,366 deals exhaust shared memory.
 * hashtext returns int4; the cast selects pg_advisory_xact_lock(bigint).
 */
export const LOCK_WRITER_SQL = `SELECT pg_advisory_xact_lock(hashtext('settlement-dh-writer')::bigint)`;
/** After the writer lock, dates ascending. Same-day commits cannot rebuild past each other. */
export const LOCK_DAYS_SQL = `SELECT pg_advisory_xact_lock(hashtext('dh-day:' || day)::bigint) FROM (SELECT unnest(?::text[]) AS day ORDER BY 1) days`;
export const EXPIRE_STAGING_SQL = `DELETE FROM settlement_dh_staging WHERE session_id IN (
  SELECT id FROM settlement_dh_sessions WHERE status = 'open' AND created_at < CURRENT_TIMESTAMP - INTERVAL '24 hours')`;
export const EXPIRE_SESSION_SQL = `UPDATE settlement_dh_sessions SET status = 'aborted'
  WHERE status = 'open' AND created_at < CURRENT_TIMESTAMP - INTERVAL '24 hours'`;
export const ABORT_STAGING_SQL = 'DELETE FROM settlement_dh_staging WHERE session_id = ?';
export const ABORT_CHUNKS_SQL = 'DELETE FROM settlement_dh_chunks WHERE session_id = ?';

export const REPLACE_CHUNK_SQL = 'DELETE FROM settlement_dh_staging WHERE session_id = ? AND seq = ?';

export const STAGE_SQL = `INSERT INTO settlement_dh_staging
  (session_id, deal, seq, login, server_time, entry, volume, commission, fee, swap, profit, currency, rate)
VALUES (?, ?, ?, ?, ?::timestamp, ?, ?::numeric, ?::numeric, ?::numeric, ?::numeric, ?::numeric, ?, ?::integer)
ON CONFLICT (session_id, deal) DO UPDATE SET
  seq = EXCLUDED.seq, login = EXCLUDED.login, server_time = EXCLUDED.server_time, entry = EXCLUDED.entry,
  volume = EXCLUDED.volume, commission = EXCLUDED.commission, fee = EXCLUDED.fee, swap = EXCLUDED.swap,
  profit = EXCLUDED.profit, currency = EXCLUDED.currency, rate = EXCLUDED.rate
WHERE settlement_dh_staging.seq <= EXCLUDED.seq`;

interface SessionRow { id: string; owner_id: string; status: string; title_filter: string | null; range_from: string | null; range_to: string | null; footer_commission: string | null; footer_swap: string | null }

function toFact(row: Record<string, unknown>): DealFact {
  const serverTime = String(row.server_time).replace('T', ' ').slice(0, 19);
  return {
    deal: String(row.deal), login: String(row.login), serverTime, serverDate: serverTime.slice(0, 10),
    entry: String(row.entry), volume: Number(row.volume), commission: Number(row.commission), fee: Number(row.fee),
    swap: Number(row.swap), profit: Number(row.profit), currency: String(row.currency ?? 'USD'),
    rate: row.rate === null || row.rate === undefined ? null : Number(row.rate) as DealFact['rate'],
  };
}

export type CommitResult = { aborted: true; error: string } | { aborted: false; inserted: number; updated: number; unchanged: number };

async function abortOpenSession(tx: { execute(sql: string, values?: unknown[]): Promise<number> }, sessionId: string, error: string): Promise<CommitResult> {
  await tx.execute(ABORT_STAGING_SQL, [sessionId]);
  await tx.execute(ABORT_CHUNKS_SQL, [sessionId]);
  await tx.execute(`UPDATE settlement_dh_sessions SET status = 'aborted', eof_confirmed = FALSE WHERE id = ?`, [sessionId]);
  return { aborted: true, error };
}

export async function commitOwnedSession(
  sessionId: string,
  actorId: string,
  footer: { commission: number; swap: number } | undefined,
  confirmation: { eof: boolean; declaredCount: number },
  hooks?: { beforeRebuild?: () => Promise<void> },
): Promise<CommitResult> {
  const footerCommission = footer?.commission;
  const footerSwap = footer?.swap;
  return executeTransaction(async tx => {
    if (footerCommission !== undefined && footerSwap !== undefined) {
      await tx.execute('UPDATE settlement_dh_sessions SET footer_commission = ?::numeric, footer_swap = ?::numeric WHERE id = ? AND status = \'open\'', [footerCommission, footerSwap, sessionId]);
    }
    const session = await tx.queryOne<SessionRow>('SELECT id, owner_id, status, title_filter, range_from::text, range_to::text, footer_commission::text, footer_swap::text FROM settlement_dh_sessions WHERE id = ? FOR UPDATE', [sessionId]);
    if (!session) throw new Error('Session not found');
    if (session.owner_id !== actorId) throw new Error('You cannot change another user\'s upload session');
    if (session.status !== 'open') throw new Error('Session is not open');
    const staged = await tx.queryAll<Record<string, unknown>>('SELECT deal, login, server_time::text, entry, volume::text, commission::text, fee::text, swap::text, profit::text, currency, rate FROM settlement_dh_staging WHERE session_id = ?', [sessionId]);
    const incoming = staged.map(toFact);
    const title = session.range_from && session.range_to && session.title_filter
      ? { filter: session.title_filter, from: session.range_from, to: session.range_to, star: session.title_filter === '*' }
      : null;
    const persistedFooter = { commission: Number(session.footer_commission), swap: Number(session.footer_swap) };
    if (!title) return abortOpenSession(tx, sessionId, 'The file title was not parsed');
    if (incoming.some(deal => deal.serverDate < title.from || deal.serverDate > title.to)) {
      return abortOpenSession(tx, sessionId, 'A deal date is outside the title range');
    }
    if (!confirmation.eof || confirmation.declaredCount !== incoming.length || !footerMatches(incoming, persistedFooter)) {
      return abortOpenSession(tx, sessionId, 'Footer, end of file, or deal count does not match the staged rows');
    }
    await tx.execute(LOCK_WRITER_SQL);
    const existingRows = await tx.queryAll<Record<string, unknown>>(
      `SELECT f.deal, f.login, f.server_time::text, f.entry, f.volume::text, f.commission::text, f.fee::text, f.swap::text, f.profit::text, f.currency, f.rate
       FROM settlement_mt5_deal_facts f
       WHERE EXISTS (SELECT 1 FROM settlement_dh_staging s WHERE s.session_id = ? AND s.deal = f.deal)`,
      [sessionId],
    );
    const existing: Record<string, DealFact> = {};
    for (const row of existingRows) { const fact = toFact(row); existing[fact.deal] = fact; }
    const merged = mergeIncoming(existing, incoming);
    const dates = [...new Set([...merged.touchedDates, ...incoming.map(deal => deal.serverDate), ...Object.values(existing).map(deal => deal.serverDate)])].sort();
    if (dates.length) await tx.execute(LOCK_DAYS_SQL, [dates]);
    for (const deal of merged.upserts) {
      await tx.execute(UPSERT_FACT_SQL, [deal.deal, deal.login, deal.serverTime, deal.entry, deal.volume, deal.commission, deal.fee, deal.swap, deal.profit, deal.currency, deal.rate, sessionId]);
    }
    await hooks?.beforeRebuild?.();
    if (dates.length) {
      await tx.execute(REBUILD_DELETE_SQL, [dates]);
      await tx.execute(REBUILD_INSERT_SQL, [dates]);
    }
    const covered = attestedRange(title);
    for (const date of covered.attested) {
      await tx.execute(`INSERT INTO settlement_dh_coverage (server_date, status, session_id) VALUES (?::date, 'attested', ?)
        ON CONFLICT (server_date) DO UPDATE SET status = 'attested', session_id = EXCLUDED.session_id`, [date, sessionId]);
    }
    for (const date of covered.partial) {
      await tx.execute(`INSERT INTO settlement_dh_coverage (server_date, status, session_id) VALUES (?::date, 'partial', ?)
        ON CONFLICT (server_date) DO UPDATE SET status = CASE WHEN settlement_dh_coverage.status = 'attested' THEN 'attested' ELSE 'partial' END,
        session_id = CASE WHEN settlement_dh_coverage.status = 'attested' THEN settlement_dh_coverage.session_id ELSE EXCLUDED.session_id END`, [date, sessionId]);
    }
    await tx.execute(`UPDATE settlement_dh_sessions SET status = 'committed', eof_confirmed = TRUE, deal_count = ?, committed_at = CURRENT_TIMESTAMP WHERE id = ?`, [incoming.length, sessionId]);
    await tx.execute(ABORT_STAGING_SQL, [sessionId]);
    return { aborted: false, inserted: merged.inserted, updated: merged.updated, unchanged: merged.unchanged };
  });
}

export async function abortOwnedSession(sessionId: string, actorId: string): Promise<void> {
  await executeTransaction(async tx => {
    const session = await tx.queryOne<{ owner_id: string }>('SELECT owner_id FROM settlement_dh_sessions WHERE id = ? AND status = \'open\'', [sessionId]);
    if (!session) throw new Error('Session not found');
    if (session.owner_id !== actorId) throw new Error('You cannot change another user\'s upload session');
    await tx.execute(ABORT_STAGING_SQL, [sessionId]);
    await tx.execute(ABORT_CHUNKS_SQL, [sessionId]);
    await tx.execute(`UPDATE settlement_dh_sessions SET status = 'aborted' WHERE id = ?`, [sessionId]);
  });
}

export async function loadDealsCoverage(from: string, to: string): Promise<Record<string, { status: DealCoverageStatus }>> {
  const rows = await queryAll<{ server_date: string; status: DealCoverageStatus }>(
    `SELECT to_char(server_date, 'YYYY-MM-DD') AS server_date, status FROM settlement_dh_coverage WHERE server_date BETWEEN ?::date AND ?::date`,
    [from, to],
  );
  return Object.fromEntries(rows.map(row => [row.server_date, { status: row.status }]));
}

export async function loadDealsDaily(from: string, to: string): Promise<Array<{ date: string; rate: DealFact['rate']; commissionIn: number; swap: number }>> {
  const rows = await queryAll<{ server_date: string; rate: number; commission_in: string; swap_amount: string }>(
    `SELECT to_char(server_date, 'YYYY-MM-DD') AS server_date, rate, commission_in::text, swap_amount::text
     FROM settlement_dh_daily WHERE server_date BETWEEN ?::date AND ?::date`,
    [from, to],
  );
  return rows.map(row => ({ date: row.server_date, rate: row.rate as DealFact['rate'], commissionIn: Number(row.commission_in), swap: Number(row.swap_amount) }));
}

export async function loadDealsHistoryDays(from: string, to: string): Promise<DealsDay[]> {
  const [daily, coverage] = await Promise.all([loadDealsDaily(from, to), loadDealsCoverage(from, to)]);
  return dealsHistoryFromDaily(daily.flatMap(row => row.rate === null ? [] : [{ date: row.date, rate: row.rate, commissionIn: row.commissionIn, swap: row.swap }]), coverage, eachDate(from, to));
}

export async function loadDealsFacts(from: string, to: string): Promise<DealFact[]> {
  const rows = await queryAll<Record<string, unknown>>(
    `SELECT deal, login, server_time::text, entry, volume::text, commission::text, fee::text, swap::text, profit::text, currency, rate
     FROM settlement_mt5_deal_facts WHERE server_time >= ?::date AND server_time < (?::date + 1)`,
    [from, to],
  );
  return rows.map(toFact);
}

export async function expireAbandonedSessions(): Promise<void> {
  await executeTransaction(async tx => {
    await tx.execute(EXPIRE_STAGING_SQL);
    await tx.execute('DELETE FROM settlement_dh_chunks WHERE session_id IN (SELECT id FROM settlement_dh_sessions WHERE status = \'open\' AND created_at < CURRENT_TIMESTAMP - INTERVAL \'24 hours\')');
    await tx.execute(EXPIRE_SESSION_SQL);
  });
}

export async function openOwnedSession(input: { id: string; ownerId: string; fileName: string; titleFilter: string | null; from: string | null; to: string | null; footerCommission: number; footerSwap: number }): Promise<void> {
  await expireAbandonedSessions();
  await execute(`INSERT INTO settlement_dh_sessions (id, owner_id, file_name, status, title_filter, range_from, range_to, footer_commission, footer_swap)
    VALUES (?, ?, ?, 'open', ?, ?::date, ?::date, ?::numeric, ?::numeric)`,
  [input.id, input.ownerId, input.fileName, input.titleFilter, input.from, input.to, input.footerCommission, input.footerSwap]);
}

export async function stageOwnedChunk(input: { sessionId: string; actorId: string; seq: number; hash: string; deals: DealFact[] }): Promise<{ idempotent: boolean }> {
  return executeTransaction(async tx => {
    const session = await tx.queryOne<{ owner_id: string; status: string }>('SELECT owner_id, status FROM settlement_dh_sessions WHERE id = ? FOR UPDATE', [input.sessionId]);
    if (!session) throw new Error('Session not found');
    if (session.owner_id !== input.actorId) throw new Error('You cannot change another user\'s upload session');
    if (session.status !== 'open') throw new Error('Session is not open');
    if (input.deals.length > MAX_CHUNK_DEALS) throw new Error(`A chunk can contain at most ${MAX_CHUNK_DEALS} deals`);
    const prior = await tx.queryOne<{ content_hash: string }>('SELECT content_hash FROM settlement_dh_chunks WHERE session_id = ? AND seq = ?', [input.sessionId, input.seq]);
    if (prior?.content_hash === input.hash) return { idempotent: true };
    await tx.execute(REPLACE_CHUNK_SQL, [input.sessionId, input.seq]);
    for (const deal of input.deals) {
      await tx.execute(STAGE_SQL, [input.sessionId, deal.deal, input.seq, deal.login, deal.serverTime, deal.entry, deal.volume, deal.commission, deal.fee, deal.swap, deal.profit, deal.currency, deal.rate]);
    }
    await tx.execute(`INSERT INTO settlement_dh_chunks (session_id, seq, content_hash, deal_count) VALUES (?, ?, ?, ?)
      ON CONFLICT (session_id, seq) DO UPDATE SET content_hash = EXCLUDED.content_hash, deal_count = EXCLUDED.deal_count`,
    [input.sessionId, input.seq, input.hash, input.deals.length]);
    return { idempotent: false };
  });
}
