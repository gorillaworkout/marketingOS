import { queryAll } from '@/lib/database';
import type { DealsDay } from './deals-report';
import { loadDealsHistoryDays } from './deals-store';
import type { SettlementReport } from './report';
import { dealsHistorySummary } from './summary';

/** Pure attachment used by the report, export and print routes. */
export function applyDealsHistory(report: SettlementReport, currentDays: DealsDay[], previousDays: DealsDay[]): SettlementReport {
  report.dealsHistory = currentDays;
  report.summary.current.commission = dealsHistorySummary(currentDays);
  report.summary.previous.commission = dealsHistorySummary(previousDays);
  return report;
}

export async function loadDealsHistoryThrough(): Promise<string | null> {
  const rows = await queryAll<{ through: string | null }>(
    `SELECT to_char(MAX(server_date), 'YYYY-MM-DD') AS through FROM (
       SELECT server_date FROM settlement_dh_daily
       UNION ALL
       SELECT server_date FROM settlement_dh_coverage
     ) sources`,
  );
  return rows[0]?.through ?? null;
}

export async function attachDealsHistory(report: SettlementReport): Promise<SettlementReport> {
  const [currentDays, previousDays] = await Promise.all([
    loadDealsHistoryDays(report.period.range.from, report.period.range.to),
    loadDealsHistoryDays(report.previousRange.from, report.previousRange.to),
  ]);
  return applyDealsHistory(report, currentDays, previousDays);
}
