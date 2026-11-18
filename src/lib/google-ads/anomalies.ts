/**
 * Daily anomaly detection for Google Ads (pure). Compares the recent window
 * (default 7 days ending yesterday) with the trailing baseline (28 days
 * before it), using daily averages, per account and per campaign.
 */
import { ALERTS } from './insights-config';

export type AlertKind = 'spend_spike' | 'cpc_rise' | 'cpa_rise' | 'conversions_drop' | 'spend_stopped';
export type AlertSeverity = 'warning' | 'critical';

export interface DayMetrics { date: string; cost: number; clicks: number; impressions: number; conversions: number }

export interface ScopeSeries {
  customerId: string;
  accountName: string;
  campaignId: string; // '' for account level
  campaignName: string;
  campaignStatus?: string;
  currency: string;
  days: DayMetrics[];
}

export interface DetectedAlert {
  customerId: string; accountName: string; campaignId: string; campaignName: string;
  kind: AlertKind; severity: AlertSeverity; asOf: string;
  recentValue: number; baselineValue: number; changeRatio: number | null;
  message: string;
  details: Record<string, number | string | null>;
}

export type AlertThresholds = typeof ALERTS;

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function windows(asOf: string, t: Pick<AlertThresholds, 'recentDays' | 'baselineDays'> = ALERTS) {
  const recentStart = addDays(asOf, -(t.recentDays - 1));
  const baselineEnd = addDays(recentStart, -1);
  return { recent: { start: recentStart, end: asOf }, baseline: { start: addDays(baselineEnd, -(t.baselineDays - 1)), end: baselineEnd } };
}

interface WindowTotals { cost: number; clicks: number; conversions: number; days: number; activeDays: number }

function totals(days: DayMetrics[], start: string, end: string, length: number): WindowTotals {
  const inRange = days.filter(day => day.date >= start && day.date <= end);
  return {
    cost: inRange.reduce((sum, day) => sum + day.cost, 0),
    clicks: inRange.reduce((sum, day) => sum + day.clicks, 0),
    conversions: inRange.reduce((sum, day) => sum + day.conversions, 0),
    days: length,
    activeDays: inRange.filter(day => day.cost > 0).length,
  };
}

const money = (value: number, currency: string) => `${currency} ${Math.round(value).toLocaleString('en-US')}`;
const pct = (ratio: number) => `${ratio >= 1 ? '+' : '−'}${Math.abs((ratio - 1) * 100).toFixed(0)}%`;

export function detectScopeAnomalies(series: ScopeSeries, asOf: string, t: AlertThresholds = ALERTS): DetectedAlert[] {
  const w = windows(asOf, t);
  const recent = totals(series.days, w.recent.start, w.recent.end, t.recentDays);
  const baseline = totals(series.days, w.baseline.start, w.baseline.end, t.baselineDays);
  const level = series.campaignId ? 'campaign' : 'account';
  const who = series.campaignId ? `${series.campaignName} (${series.accountName})` : series.accountName;
  const alerts: DetectedAlert[] = [];
  const push = (kind: AlertKind, recentValue: number, baselineValue: number, message: string, critical: boolean, extra: Record<string, number | string | null> = {}) => {
    alerts.push({
      customerId: series.customerId, accountName: series.accountName, campaignId: series.campaignId, campaignName: series.campaignName,
      kind, severity: critical ? 'critical' : 'warning', asOf, recentValue, baselineValue,
      changeRatio: baselineValue ? recentValue / baselineValue : null, message,
      details: {
        recentStart: w.recent.start, recentEnd: w.recent.end, baselineStart: w.baseline.start, baselineEnd: w.baseline.end,
        recentCost: recent.cost, baselineCost: baseline.cost, recentClicks: recent.clicks, baselineClicks: baseline.clicks,
        recentConversions: recent.conversions, baselineConversions: baseline.conversions, currency: series.currency, ...extra,
      },
    });
  };

  const recentDailyCost = recent.cost / recent.days;
  const baselineDailyCost = baseline.cost / baseline.days;

  // Spend stopped: steady spend in the baseline, then nothing on the last N days.
  const lastDays = totals(series.days, addDays(asOf, -(t.stoppedDays - 1)), asOf, t.stoppedDays);
  const stopped = baseline.activeDays >= t.stoppedMinActiveDays && baselineDailyCost >= t.stoppedMinDailyCost && lastDays.cost === 0 && series.campaignStatus !== 'REMOVED';
  if (stopped) {
    const status = series.campaignStatus && series.campaignStatus !== 'ENABLED' ? ` Campaign status is ${series.campaignStatus.toLowerCase()}.` : '';
    push('spend_stopped', 0, baselineDailyCost, `${who}: no spend on the last ${t.stoppedDays} days after ${money(baselineDailyCost, series.currency)}/day in the baseline.${status}`, series.campaignStatus === 'ENABLED' || !series.campaignId, { campaignStatus: series.campaignStatus ?? null });
    return alerts; // The other rules are meaningless while spend is 0.
  }

  if (baselineDailyCost > 0 && recentDailyCost >= baselineDailyCost * t.spendSpikeRatio && recentDailyCost - baselineDailyCost >= t.spendSpikeMinDailyIncrease[level] && baseline.activeDays >= t.recentDays) {
    const ratio = recentDailyCost / baselineDailyCost;
    push('spend_spike', recentDailyCost, baselineDailyCost, `${who}: spend ${money(recentDailyCost, series.currency)}/day in the last ${t.recentDays} days vs ${money(baselineDailyCost, series.currency)}/day before (${pct(ratio)}).`, ratio >= t.criticalRatio);
  }

  if (recent.clicks >= t.cpcMinClicks && baseline.clicks >= t.cpcMinClicks) {
    const recentCpc = recent.cost / recent.clicks;
    const baselineCpc = baseline.cost / baseline.clicks;
    if (baselineCpc > 0 && recentCpc >= baselineCpc * t.cpcRiseRatio) {
      const ratio = recentCpc / baselineCpc;
      push('cpc_rise', recentCpc, baselineCpc, `${who}: average CPC ${money(recentCpc, series.currency)} vs ${money(baselineCpc, series.currency)} before (${pct(ratio)}).`, ratio >= t.criticalRatio);
    }
  }

  if (recent.conversions >= t.cpaMinRecentConversions && baseline.conversions >= t.cpaMinBaselineConversions) {
    const recentCpa = recent.cost / recent.conversions;
    const baselineCpa = baseline.cost / baseline.conversions;
    if (baselineCpa > 0 && recentCpa >= baselineCpa * t.cpaRiseRatio) {
      const ratio = recentCpa / baselineCpa;
      push('cpa_rise', recentCpa, baselineCpa, `${who}: cost per conversion ${money(recentCpa, series.currency)} vs ${money(baselineCpa, series.currency)} before (${pct(ratio)}).`, ratio >= t.criticalRatio);
    }
  }

  if (baseline.conversions >= t.conversionsDropMinBaseline) {
    const recentDaily = recent.conversions / recent.days;
    const baselineDaily = baseline.conversions / baseline.days;
    if (recentDaily <= baselineDaily * t.conversionsDropRatio && recent.cost > 0) {
      const ratio = baselineDaily ? recentDaily / baselineDaily : 0;
      push('conversions_drop', recentDaily, baselineDaily, `${who}: ${recentDaily.toFixed(1)} conversions/day in the last ${t.recentDays} days vs ${baselineDaily.toFixed(1)}/day before (${pct(ratio)}).`, ratio <= 1 / t.criticalRatio);
    }
  }
  return alerts;
}

export function detectAnomalies(series: ScopeSeries[], asOf: string, t: AlertThresholds = ALERTS): DetectedAlert[] {
  return series.flatMap(scope => detectScopeAnomalies(scope, asOf, t));
}
