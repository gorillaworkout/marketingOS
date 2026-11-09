/**
 * Acceptance against the real Oct/Nov 2026 exports. The files contain personal data and are NEVER committed:
 * set SETTLEMENT_DATA_DIR to the folder with CRM/ and Meta/ (default /workspace/settlement/Settlement Data).
 * Skipped when the folder is absent (CI).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parseCrmDeposits, parseCrmWithdrawals } from '../src/lib/settlement/crm-parse';
import { applications, formatDuration, marginInOut, processingTime, swapReport, withdrawalPercentage } from '../src/lib/settlement/metrics';
import { parseSettlementFtd } from '../src/lib/settlement/ftd-parse';
import { parseMt5DepositWithdrawal } from '../src/lib/settlement/mt5-parse';
import { buildDailyReconciliation } from '../src/lib/settlement/reconcile';

const DIR = process.env.SETTLEMENT_DATA_DIR ?? '/workspace/settlement/Settlement Data';
const FTD_FILE = process.env.SETTLEMENT_FTD_FILE ?? '/workspace/settlement/extra/FTD Oktober 2026.xlsx';
const skip = existsSync(join(DIR, 'CRM')) && existsSync(join(DIR, 'Meta')) ? false : `no raw data at ${DIR}`;

function load() {
  const files = (sub: string, pattern: RegExp) => readdirSync(join(DIR, sub)).filter(f => pattern.test(f)).map(f => readFileSync(join(DIR, sub, f)));
  const crm = (pattern: RegExp) => [...files('CRM/Oktober', pattern), ...files('CRM/November', pattern)];
  return {
    deposits: crm(/^Reports_funds_deposit_.*\.xlsx$/).flatMap(b => parseCrmDeposits(b).rows),
    withdrawals: crm(/^Reports_funds_withdrawal_.*\.xlsx$/).flatMap(b => parseCrmWithdrawals(b).rows),
    deals: files('Meta', /^Deposit and Withdrawal .*\.csv$/).flatMap(b => parseMt5DepositWithdrawal(b).rows),
  };
}

describe('settlement acceptance (real files)', { skip }, () => {
  const data = skip ? null : load();
  const rate = (block: { byRate: Array<{ rate: number; deposit: number; withdrawal: number }> }, r: number) => {
    const l = block.byRate.find(x => x.rate === r);
    return [l?.deposit, l?.withdrawal];
  };

  it('parses every real export without errors (row counts)', () => {
    const one = (sub: string, name: RegExp) => readFileSync(join(DIR, sub, readdirSync(join(DIR, sub)).find(f => name.test(f))!));
    const dep = parseCrmDeposits(one('CRM/Oktober', /^Reports_funds_deposit_/));
    assert.deepEqual([dep.errors, dep.summary.rows, dep.summary.invalid, dep.summary.byStatus], [[], 29544, 0, { Successful: 27448, Unsuccessful: 2093, Processing: 3 }]);
    assert.equal(parseCrmWithdrawals(one('CRM/Oktober', /^Reports_funds_withdrawal_/)).summary.rows, 11010);
    assert.equal(parseCrmDeposits(one('CRM/November', /^Reports_funds_deposit_/)).summary.rows, 8354);
    assert.equal(parseCrmWithdrawals(one('CRM/November', /^Reports_funds_withdrawal_/)).summary.rows, 2628);
    const oct = parseMt5DepositWithdrawal(one('Meta', /Oktober/));
    assert.deepEqual([oct.errors, oct.warnings, oct.summary.rows], [[], [], 80441]);
    assert.deepEqual(oct.summary.byStatus, { S: 28815, SR: 9282, D: 27370, TO: 1651, TI: 1651, W: 11010, WC: 128, AD: 498, OTHER: 36 });
    assert.equal(parseMt5DepositWithdrawal(one('Meta', /November/)).summary.rows, 19636);
    if (existsSync(FTD_FILE)) assert.deepEqual(parseSettlementFtd(readFileSync(FTD_FILE)).summary.byStatus, { micro: 2303, standard: 431 });
  });

  it('daily 05-06 Nov reconciliation', () => {
    const { deposits, withdrawals, deals } = data!;
    const r = buildDailyReconciliation('2026-11-06', deposits, withdrawals, deals);
    assert.deepEqual(r.mt5.clients, { deposit: 1306, withdrawal: 445, reject: 2 });
    assert.deepEqual(rate(r.mt5, 1), [687.11, -1790]);
    assert.deepEqual(rate(r.mt5, 10000), [162828.81, -160166.22]);
    assert.deepEqual(rate(r.mt5, 12000), [4324.94, -54]);
    assert.deepEqual(rate(r.mt5, 14000), [132340.33, -231796.44]);
    assert.equal(r.mt5.differences[0].amount, 7200);
    assert.deepEqual(r.crm.clients, { deposit: 1390, withdrawal: 445, reject: 88 });
    assert.deepEqual(rate(r.crm, 10000), [200660.51, -160166.22]);
    assert.deepEqual(rate(r.crm, 14000), [179442.31, -231796.44]);
    assert.deepEqual(r.crm.differences.map(d => d.amount), [92133.68, -7200, -716.36]);
    assert.equal(r.crm.differences[2].count, 4);
  });

  it('week 02–08 Nov applications and processing time', () => {
    const { deposits, withdrawals } = data!;
    const range = { from: '2026-11-02', to: '2026-11-08' };
    assert.deepEqual(applications(deposits, withdrawals, range), { deposit: 7300, depositRejected: 427, withdrawal: 2264, withdrawalRejected: 20 });
    const p = processingTime(deposits, withdrawals, range);
    const d = p.deposits[0];
    assert.deepEqual([formatDuration(d.officeManual.avgSeconds), d.officeManual.hits, formatDuration(d.officeApi.avgSeconds), d.officeApi.hits], ['00:03:50', 329, '00:00:29', 303]);
    assert.deepEqual([formatDuration(d.afterManual.avgSeconds), d.afterManual.hits, formatDuration(d.afterApi.avgSeconds), d.afterApi.hits], ['00:11:44', 426, '00:00:29', 433]);
    assert.deepEqual(p.withdrawals.map(w => `${formatDuration(w.office.avgSeconds)}/${w.office.hits}`), ['00:10:08/410', '00:09:58/428', '00:11:16/440', '00:09:43/395', '00:10:27/475']);
    assert.deepEqual([formatDuration(p.summary.depositApi), formatDuration(p.summary.depositManual), formatDuration(p.summary.withdrawal)], ['00:00:30', '00:04:27', '00:10:18']);
  });

  it('withdrawal % weeks (Mon–Sun)', () => {
    const weeks = withdrawalPercentage(data!.withdrawals);
    const pick = (start: string) => { const w = weeks.find(x => x.weekStart === start); return [w?.office, w?.secondWithdrawal, w?.total]; };
    assert.deepEqual(pick('2026-10-05'), [2081, 80, 2161]);
    assert.deepEqual(pick('2026-10-12'), [2289, 114, 2403]);
    assert.deepEqual(pick('2026-10-19'), [2433, 112, 2545]);
    assert.deepEqual(pick('2026-10-26'), [2768, 135, 2903]);
    assert.deepEqual(pick('2026-11-02'), [2167, 97, 2264]);
  });

  it('margin In–Out October (USD × rate)', () => {
    const oct = marginInOut(data!.deposits, data!.withdrawals).find(m => m.month === '2026-10');
    assert.deepEqual(oct, {
      month: '2026-10', idrDeposit: 114993576400, idrWithdrawal: 59445380860, usdDeposit: 99940, usdWithdrawal: 60597.41,
      idrInitialMargin: null, usdInitialMargin: null, idrDepositExIm: null, usdDepositExIm: null,
    });
  });

  it('margin October with the Dealing FTD list (Initial Margin split)', { skip: existsSync(FTD_FILE) ? false : `no FTD file at ${FTD_FILE}` }, () => {
    const ftd = parseSettlementFtd(readFileSync(FTD_FILE));
    assert.equal(ftd.rows.length, 2734);
    const oct = marginInOut(data!.deposits, data!.withdrawals, ftd.rows).find(m => m.month === '2026-10');
    assert.equal(oct?.idrInitialMargin, 16583230080);
    assert.equal(oct?.usdInitialMargin, 5553.08);
    assert.equal(oct?.idrDepositExIm, 98410346320);
    assert.equal(oct?.usdDepositExIm, 94386.92);
  });

  it('swap October (CRM-S / CRM-SR by posting date)', () => {
    const s = swapReport(data!.deals, { from: '2026-10-01', to: '2026-10-31' });
    assert.deepEqual(s.totalSwap, { 1: -6366.19, 10000: -213166.4, 12000: -2044.32, 14000: -139330.48 });
    assert.deepEqual(s.totalRefund, { 1: 410.5, 10000: 61984.34, 12000: 544.61, 14000: 49972.04 });
    assert.deepEqual(s.days[0].swap, { 1: -487.04, 10000: -24554.55, 12000: -209.19, 14000: -14440.91 });
  });
});
