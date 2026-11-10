import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCrmDeposits, parseCrmWithdrawals } from '../src/lib/settlement/crm-parse';
import { parseMt5DepositWithdrawal } from '../src/lib/settlement/mt5-parse';
import { parseSettlementFtd } from '../src/lib/settlement/ftd-parse';
import { settlementDayOf } from '../src/lib/settlement/conventions';
import { applications, formatDuration, marginInOut, processingTime, swapReport, withdrawalPercentage } from '../src/lib/settlement/metrics';
import { crmDepositXlsx, crmWithdrawalXlsx, dayDeals, dayDeposits, dayWithdrawals, ftdRows, ftdXlsx, mt5DwText, type CrmRowInput } from './fixtures/settlement';

const deposits = parseCrmDeposits(crmDepositXlsx(dayDeposits)).rows;
const withdrawals = parseCrmWithdrawals(crmWithdrawalXlsx(dayWithdrawals)).rows;
const deals = parseMt5DepositWithdrawal(mt5DwText(dayDeals)).rows;

describe('settlement period metrics', () => {
  it('counts applications by WIB request date', () => {
    assert.deepEqual(applications(deposits, withdrawals, { from: '2026-11-06', to: '2026-11-06' }), { deposit: 4, depositRejected: 1, withdrawal: 3, withdrawalRejected: 1 });
  });

  it('averages processing time by office hour × API/Manual and the weekly mean of daily averages', () => {
    const dep: CrmRowInput[] = [
      { reference: '1', account: '2000001', request: '02/11/2026 09:00:00', complete: '02/11/2026 09:00:30', usd: 1, method: 'Auto' },
      { reference: '2', account: '2000001', request: '02/11/2026 10:00:00', complete: '02/11/2026 10:04:00', usd: 1 },
      { reference: '3', account: '2000001', request: '02/11/2026 11:00:00', complete: '02/11/2026 11:02:00', usd: 1 },
      { reference: '4', account: '2000001', request: '02/11/2026 20:00:00', complete: '02/11/2026 20:10:00', usd: 1 },
      { reference: '5', account: '2000001', request: '03/11/2026 09:00:00', complete: '03/11/2026 09:06:00', usd: 1 },
      { reference: '6', account: '2000001', request: '03/11/2026 09:10:00', usd: 1, status: 'Processing' },
    ];
    const wd: CrmRowInput[] = [
      { reference: '7', account: '2000001', request: '02/11/2026 09:00:00', complete: '02/11/2026 09:10:00', usd: 1 },
      { reference: '8', account: '2000001', request: '02/11/2026 17:00:00', complete: '03/11/2026 09:00:00', usd: 1 },
      { reference: '9', account: '2000001', request: '03/11/2026 10:00:00', complete: '03/11/2026 10:20:00', usd: 1 },
    ];
    const p = processingTime(parseCrmDeposits(crmDepositXlsx(dep)).rows, parseCrmWithdrawals(crmWithdrawalXlsx(wd)).rows, { from: '2026-11-02', to: '2026-11-08' });
    assert.deepEqual(p.deposits[0], { date: '2026-11-02', officeApi: { avgSeconds: 30, hits: 1 }, officeManual: { avgSeconds: 180, hits: 2 }, afterApi: { avgSeconds: null, hits: 0 }, afterManual: { avgSeconds: 600, hits: 1 } });
    assert.equal(p.summary.depositManual, 270); // mean(180, 360)
    assert.equal(p.summary.depositApi, 30);
    assert.deepEqual(p.withdrawals[0], { date: '2026-11-02', office: { avgSeconds: 600, hits: 1 }, secondWithdrawal: { avgSeconds: 57600, hits: 1 } });
    assert.equal(p.summary.withdrawal, 900); // mean(600, 1200)
    assert.equal(formatDuration(p.summary.withdrawal), '00:15:00');
    assert.equal(formatDuration(null), '—');
  });

  it('groups Withdrawal % by Monday–Sunday weeks', () => {
    const weeks = withdrawalPercentage(withdrawals);
    assert.deepEqual(weeks.map(w => [w.weekStart, w.label, w.office, w.secondWithdrawal, w.total]), [['2026-11-02', 'Nov 02 – Nov 06', 3, 1, 4]]);
    const sunday = withdrawalPercentage(parseCrmWithdrawals(crmWithdrawalXlsx([{ ...dayWithdrawals[0], request: '08/11/2026 10:00:00', complete: '08/11/2026 10:05:00' }])).rows);
    assert.equal(sunday[0].weekStart, '2026-11-02');
    assert.equal(sunday[0].afterOffice, 1);
  });

  it('computes Margin In–Out as USD × account rate (successful only)', () => {
    const [nov] = marginInOut(deposits, withdrawals);
    assert.equal(nov.month, '2026-11');
    assert.equal(nov.idrDeposit, 10 * 10000 + 20 * 10000 + 30 * 14000 + 60 * 12000);
    assert.equal(nov.usdDeposit, 50);
    assert.equal(nov.idrWithdrawal, 15 * 10000 + 25 * 14000);
    assert.equal(nov.usdWithdrawal, 45);
    assert.equal(nov.idrInitialMargin, null); // no FTD upload → "Pending"
    assert.equal(nov.idrDepositExIm, null);
  });

  it('splits Initial Margin (FTD Balance × rate) from Deposit when the FTD list is loaded', () => {
    const [nov] = marginInOut(deposits, withdrawals, parseSettlementFtd(ftdXlsx(ftdRows)).rows);
    assert.equal(nov.idrInitialMargin, 50 * 14000 + 20 * 10000);
    assert.equal(nov.usdInitialMargin, 50);
    assert.equal(nov.idrDepositExIm, nov.idrDeposit - 900000);
    assert.equal(nov.usdDepositExIm, 0);
  });

  it('counts a noon window by settlement day and leaves the calendar key unchanged', () => {
    const noon = { from: '2026-11-10', to: '2026-11-10' };
    const rows = parseCrmWithdrawals(crmWithdrawalXlsx([
      { reference: 'a', account: '2000001', request: '10/11/2026 11:59:00', complete: '10/11/2026 12:10:00', usd: 1 },
      { reference: 'b', account: '2000001', request: '10/11/2026 12:30:00', complete: '10/11/2026 12:40:00', usd: 1 },
    ])).rows;
    assert.equal(applications([], rows, noon, settlementDayOf).withdrawal, 1);
    assert.equal(applications([], rows, { from: '2026-11-11', to: '2026-11-11' }, settlementDayOf).withdrawal, 1);
    const timed = processingTime([], rows, { from: '2026-11-10', to: '2026-11-11' }, new Set(), settlementDayOf);
    assert.deepEqual(timed.withdrawals.map(row => row.date), ['2026-11-10', '2026-11-11']);
    assert.equal(applications(deposits, withdrawals, { from: '2026-11-06', to: '2026-11-06' }).deposit, 4);
  });

  it('sums CRM-S and CRM-SR separately by MT5 server date and rate', () => {
    const s = swapReport(deals, { from: '2026-11-01', to: '2026-11-30' });
    assert.equal(s.days.length, 1);
    assert.equal(s.days[0].date, '2026-11-06');
    assert.equal(s.totalSwap[10000], -1.5);
    assert.equal(s.totalRefund[10000], 0.5);
    assert.equal(s.idrSwap, -15000);
  });
});
