/**
 * Google Ads alerts: load daily series, detect anomalies, store them.
 *
 * Persistence rules (per account/campaign + kind):
 * - An open alert is refreshed (values, last_seen_date) while the condition holds.
 * - An acknowledged or dismissed alert stays quiet while the condition repeats
 *   within ALERTS.snoozeDays of its last sighting; after that a new alert opens.
 * - Open alerts whose condition no longer holds on this evaluation are marked
 *   resolved.
 * In-app only. Nothing is emailed or posted.
 */
import { v4 as uuidv4 } from 'uuid';
import { execute, executeTransaction, queryAll, queryOne } from '@/lib/database';
import { addDays, detectAnomalies, windows, type DetectedAlert, type ScopeSeries } from './anomalies';
import { ALERTS } from './insights-config';
import { dateInTimeZone, DEFAULT_TIME_ZONE } from './sync';

export type AlertStatus = 'open' | 'acknowledged' | 'dismissed' | 'resolved';
export const ALERT_ACTIONS = { acknowledge: 'acknowledged', dismiss: 'dismissed', reopen: 'open' } as const;
export type AlertAction = keyof typeof ALERT_ACTIONS;

export async function loadAlertSeries(asOf: string): Promise<ScopeSeries[]> {
  const w = windows(asOf);
  const rows = await queryAll<{ customer_id: string; account_name: string; currency: string; campaign_id: string; campaign_name: string; campaign_status: string; date: string; cost: number; clicks: number; impressions: number; conversions: number }>(`
    SELECT c.customer_id, COALESCE(a.descriptive_name, '') AS account_name, COALESCE(NULLIF(a.currency_code, ''), 'IDR') AS currency,
      c.campaign_id, c.campaign_name, c.campaign_status, to_char(c.date, 'YYYY-MM-DD') AS date,
      (c.cost_micros::numeric / 1000000)::float8 AS cost, c.clicks::float8 AS clicks, c.impressions::float8 AS impressions, c.conversions::float8 AS conversions
    FROM google_ads_campaign_daily c JOIN google_ads_accounts a ON a.customer_id = c.customer_id
    WHERE a.active AND c.date BETWEEN ? AND ?
    ORDER BY c.customer_id, c.campaign_id, c.date`, [w.baseline.start, w.recent.end]);
  const accounts = new Map<string, ScopeSeries>();
  const campaigns = new Map<string, ScopeSeries>();
  for (const row of rows) {
    const day = { date: row.date, cost: Number(row.cost), clicks: Number(row.clicks), impressions: Number(row.impressions), conversions: Number(row.conversions) };
    const account = accounts.get(row.customer_id) ?? { customerId: row.customer_id, accountName: row.account_name, campaignId: '', campaignName: '', currency: row.currency, days: [] };
    const existing = account.days.find(item => item.date === day.date);
    if (existing) { existing.cost += day.cost; existing.clicks += day.clicks; existing.impressions += day.impressions; existing.conversions += day.conversions; } else account.days.push({ ...day });
    accounts.set(row.customer_id, account);
    const key = `${row.customer_id}|${row.campaign_id}`;
    const campaign = campaigns.get(key) ?? { customerId: row.customer_id, accountName: row.account_name, campaignId: row.campaign_id, campaignName: row.campaign_name, campaignStatus: row.campaign_status, currency: row.currency, days: [] };
    campaign.days.push(day);
    campaign.campaignName = row.campaign_name; campaign.campaignStatus = row.campaign_status; // rows are date-ordered: latest wins
    campaigns.set(key, campaign);
  }
  return [...accounts.values(), ...campaigns.values()];
}

export interface AlertEvaluation { asOf: string; detected: number; opened: number; refreshed: number; snoozed: number; resolved: number }

/** Yesterday in Jakarta: the last complete day. */
export function defaultAlertAsOf(now = new Date()): string {
  return addDays(dateInTimeZone(now, DEFAULT_TIME_ZONE), -1);
}

export async function persistAlerts(detected: DetectedAlert[], asOf: string): Promise<AlertEvaluation> {
  return executeTransaction(async transaction => {
    const result: AlertEvaluation = { asOf, detected: detected.length, opened: 0, refreshed: 0, snoozed: 0, resolved: 0 };
    const seen: Array<[string, string, string]> = [];
    for (const alert of detected) {
      seen.push([alert.customerId, alert.campaignId, alert.kind]);
      const latest = await transaction.queryOne<{ id: string; status: AlertStatus; last_seen_date: string }>(
        `SELECT id, status, to_char(last_seen_date, 'YYYY-MM-DD') AS last_seen_date FROM google_ads_alerts
         WHERE customer_id = ? AND campaign_id = ? AND kind = ? ORDER BY (status = 'open') DESC, last_seen_date DESC, created_at DESC LIMIT 1`,
        [alert.customerId, alert.campaignId, alert.kind],
      );
      const values = [alert.severity, alert.recentValue, alert.baselineValue, alert.changeRatio, alert.message, JSON.stringify(alert.details), alert.campaignName];
      if (latest && (latest.status === 'open' || ((latest.status === 'acknowledged' || latest.status === 'dismissed') && latest.last_seen_date >= addDays(asOf, -ALERTS.snoozeDays)))) {
        await transaction.execute(
          `UPDATE google_ads_alerts SET severity = ?, recent_value = ?, baseline_value = ?, change_ratio = ?, message = ?, details = ?::jsonb, campaign_name = ?,
             last_seen_date = GREATEST(last_seen_date, ?::DATE), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [...values, asOf, latest.id],
        );
        if (latest.status === 'open') result.refreshed += 1; else result.snoozed += 1;
        continue;
      }
      await transaction.execute(
        `INSERT INTO google_ads_alerts (id, customer_id, campaign_id, kind, first_seen_date, last_seen_date, severity, recent_value, baseline_value, change_ratio, message, details, campaign_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?)`,
        [uuidv4(), alert.customerId, alert.campaignId, alert.kind, asOf, asOf, ...values],
      );
      result.opened += 1;
    }
    const open = await transaction.queryAll<{ id: string; customer_id: string; campaign_id: string; kind: string }>(`SELECT id, customer_id, campaign_id, kind FROM google_ads_alerts WHERE status = 'open'`, []);
    const seenKeys = new Set(seen.map(parts => parts.join('|')));
    for (const row of open) {
      if (seenKeys.has(`${row.customer_id}|${row.campaign_id}|${row.kind}`)) continue;
      await transaction.execute(`UPDATE google_ads_alerts SET status = 'resolved', status_at = CURRENT_TIMESTAMP, status_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [row.id]);
      result.resolved += 1;
    }
    return result;
  });
}

/** Detect and store alerts for asOf (default yesterday, Jakarta). Read-only on Google Ads; uses synced data only. */
export async function evaluateGoogleAdsAlerts(asOf = defaultAlertAsOf()): Promise<AlertEvaluation> {
  const series = await loadAlertSeries(asOf);
  return persistAlerts(detectAnomalies(series, asOf), asOf);
}

export interface AlertRow {
  id: string; customerId: string; accountName: string; campaignId: string; campaignName: string; kind: string; severity: string; status: AlertStatus;
  firstSeenDate: string; lastSeenDate: string; recentValue: number | null; baselineValue: number | null; changeRatio: number | null;
  message: string; details: Record<string, unknown>; statusBy: string | null; statusAt: string | null; createdAt: string;
}

export async function listAlerts(filter: { status: 'open' | 'all'; customerId: string | null; limit?: number }): Promise<AlertRow[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filter.status === 'open') where.push(`g.status = 'open'`);
  if (filter.customerId) { where.push('g.customer_id = ?'); values.push(filter.customerId); }
  const rows = await queryAll<Record<string, unknown>>(`
    SELECT g.id, g.customer_id, COALESCE(a.descriptive_name, '') AS account_name, g.campaign_id, g.campaign_name, g.kind, g.severity, g.status,
      to_char(g.first_seen_date, 'YYYY-MM-DD') AS first_seen_date, to_char(g.last_seen_date, 'YYYY-MM-DD') AS last_seen_date,
      g.recent_value, g.baseline_value, g.change_ratio, g.message, g.details, u.name AS status_by, g.status_at, g.created_at
    FROM google_ads_alerts g LEFT JOIN google_ads_accounts a ON a.customer_id = g.customer_id LEFT JOIN users u ON u.id = g.status_by
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY (g.status = 'open') DESC, (g.severity = 'critical') DESC, g.last_seen_date DESC, g.created_at DESC LIMIT ?`, [...values, Math.min(500, filter.limit ?? 200)]);
  return rows.map(row => ({
    id: String(row.id), customerId: String(row.customer_id), accountName: String(row.account_name), campaignId: String(row.campaign_id), campaignName: String(row.campaign_name),
    kind: String(row.kind), severity: String(row.severity), status: row.status as AlertStatus, firstSeenDate: String(row.first_seen_date), lastSeenDate: String(row.last_seen_date),
    recentValue: row.recent_value == null ? null : Number(row.recent_value), baselineValue: row.baseline_value == null ? null : Number(row.baseline_value),
    changeRatio: row.change_ratio == null ? null : Number(row.change_ratio), message: String(row.message),
    details: (typeof row.details === 'string' ? JSON.parse(row.details) : row.details ?? {}) as Record<string, unknown>,
    statusBy: (row.status_by as string | null) ?? null, statusAt: row.status_at ? new Date(row.status_at as string).toISOString() : null,
    createdAt: new Date(row.created_at as string).toISOString(),
  }));
}

export async function openAlertCounts(): Promise<{ open: number; critical: number }> {
  const row = await queryOne<{ open: string | number; critical: string | number }>(
    `SELECT COUNT(*) AS open, COUNT(*) FILTER (WHERE severity = 'critical') AS critical FROM google_ads_alerts WHERE status = 'open'`, []);
  return { open: Number(row?.open ?? 0), critical: Number(row?.critical ?? 0) };
}

export class AlertActionError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function setAlertStatus(id: string, action: string, userId: string): Promise<AlertRow['status']> {
  if (!(action in ALERT_ACTIONS)) throw new AlertActionError('action must be acknowledge, dismiss, or reopen.', 400);
  const next = ALERT_ACTIONS[action as AlertAction];
  const alert = await queryOne<{ id: string; status: AlertStatus; customer_id: string; campaign_id: string; kind: string }>('SELECT id, status, customer_id, campaign_id, kind FROM google_ads_alerts WHERE id = ?', [id]);
  if (!alert) throw new AlertActionError('Alert not found.', 404);
  if (next === 'open') {
    const other = await queryOne('SELECT id FROM google_ads_alerts WHERE customer_id = ? AND campaign_id = ? AND kind = ? AND status = \'open\' AND id <> ?', [alert.customer_id, alert.campaign_id, alert.kind, id]);
    if (other) throw new AlertActionError('A newer open alert exists for this campaign and kind.', 409);
  }
  await execute('UPDATE google_ads_alerts SET status = ?, status_by = ?, status_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [next, userId, id]);
  return next;
}
