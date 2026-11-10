import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettlementReportView } from '../src/components/settlement/report/SettlementReportView';
import { WITHDRAWAL_PCT_KPI, WITHDRAWAL_PCT_LABEL } from '../src/lib/settlement/kpi-config';
import { reconciliationWindow } from '../src/lib/settlement/conventions';
import type { SettlementReport } from '../src/lib/settlement/report';

const emptyRates = { 1: 0, 10000: 0, 12000: 0, 14000: 0 };

function report(): SettlementReport {
  const period = { preset: 'day' as const, anchor: '2026-11-06', range: { from: '2026-11-06', to: '2026-11-06' }, basis: 'noon' as const, window: reconciliationWindow('2026-11-06') };
  return {
    period,
    applications: { deposit: 4, depositRejected: 1, withdrawal: 2, withdrawalRejected: 0 },
    processing: { deposits: [], withdrawals: [], summary: { depositApi: 30, depositManual: 180, deposit: 252, withdrawal: 600 } },
    withdrawalWeeks: [{ weekStart: '2026-11-02', label: 'Nov 02 – Nov 06', office: 8, afterOffice: 2, secondWithdrawal: 1, total: 11 }],
    margin: [{ month: '2026-11', idrDeposit: 48_210_770_000, idrWithdrawal: 1_000, usdDeposit: 10, usdWithdrawal: 1, idrInitialMargin: 0, usdInitialMargin: 0, idrDepositExIm: 48_210_770_000, usdDepositExIm: 10 }],
    swap: { days: [], totalSwap: { ...emptyRates }, totalRefund: { ...emptyRates }, idrSwap: 0, idrRefund: 0 },
    swapLabel: 'Swap',
    coverage: { settlement_crm_deposit: '2026-11-06' },
    previousRange: { from: '2026-11-05', to: '2026-11-05' },
    daily: [{ date: '2026-11-06', depositIdr: 48_210_770_000, withdrawalIdr: 1_000, depositUsd: 10, withdrawalUsd: 1, netIdr: 48_210_769_000, depositCount: 4, withdrawalCount: 2, officeHourPct: 80 }],
    dealsHistory: [{ date: '2026-11-06', status: 'missing', commission: null, swap: null, outCommission: null }],
    summary: {
      current: {
        range: period.range,
        totals: { deposit: { idr: 48_210_770_000, usd: 10, count: 4 }, withdrawal: { idr: 1_000, usd: 1, count: 2 }, netIdr: 48_210_769_000, withdrawalPct: { officeHourPct: 80, ofDepositsPct: 0.002, office: 8, second: 2, total: 10 } },
        processing: { deposit: 252, withdrawal: 600 },
        commission: { status: 'pending', commissionByRate: { ...emptyRates }, swapByRate: { ...emptyRates }, commissionIdr: 0, commissionUsd: 0, observedDays: 0, attestedDays: 0, pendingDays: 1, totalDays: 1, lastCoveredDate: null },
      },
      previous: {
        range: { from: '2026-11-05', to: '2026-11-05' },
        totals: { deposit: { idr: 1_000, usd: 1, count: 1 }, withdrawal: { idr: 100, usd: 0, count: 1 }, netIdr: 900, withdrawalPct: { officeHourPct: 50, ofDepositsPct: 10, office: 1, second: 1, total: 2 } },
        processing: { deposit: 290, withdrawal: 400 },
        commission: { status: 'pending', commissionByRate: { ...emptyRates }, swapByRate: { ...emptyRates }, commissionIdr: 0, commissionUsd: 0, observedDays: 0, attestedDays: 0, pendingDays: 1, totalDays: 1, lastCoveredDate: null },
      },
    },
  };
}

describe('settlement report view', () => {
  it('renders the report document with pending commission and no access tab', () => {
    const html = renderToStaticMarkup(createElement(SettlementReportView, {
      variant: 'screen',
      report: report(),
      recon: null,
      reconDate: '2026-11-06',
      list: 'all',
      onPreset: () => undefined,
      onShift: () => undefined,
      jisdor: [{ date: '2026-10-30', rate: 16412 }, { date: '2026-10-31', rate: 16450 }],
    }));
    const withdrawalLabel = WITHDRAWAL_PCT_KPI === 'wd-over-dep' ? WITHDRAWAL_PCT_LABEL['wd-over-dep'] : WITHDRAWAL_PCT_LABEL['office-hour'];
    for (const label of ['Deposits', 'Withdrawals', 'Net margin in–out', withdrawalLabel, 'Avg processing', 'Commission']) {
      assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(html, /Withdrawal timing split/);
    assert.match(html, /48,210,770,000/);
    assert.equal(html.includes('48,210,770,000.00'), false);
    assert.match(html, /data-pending="true"/);
    assert.match(html, />Pending</);
    assert.doesNotMatch(html, /data-pending="true"[^<]{0,120}0\.00/);
    for (const id of ['overview', 'reconciliation', 'processing', 'withdrawal-timing', 'margin', 'commission-swap', 'jisdor', 'methodology']) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.equal(html.includes('Access'), false);
    assert.match(html, /05–06 Nov/);
  });

  it('renders the print variant without calling print when noprint markup is static', () => {
    const html = renderToStaticMarkup(createElement(SettlementReportView, {
      variant: 'print',
      report: report(),
      recon: null,
      reconDate: '2026-11-06',
      list: 'all',
      generatedAt: '2026-11-10 12:00 WIB',
      jisdor: [],
    }));
    assert.match(html, /Dupoin · Settlement Report/);
    assert.match(html, /Generated 2026-11-10 12:00 WIB/);
    assert.equal(html.includes('Export PDF'), false);
  });
});
