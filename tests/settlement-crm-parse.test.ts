import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCrmDeposits, parseCrmWithdrawals } from '../src/lib/settlement/crm-parse';
import { crmDepositXlsx, crmWithdrawalXlsx, dayDeposits, dayWithdrawals } from './fixtures/settlement';

describe('settlement CRM parser', () => {
  it('parses deposits: WIB times, "--" → null, rate from account, Transfer kept', () => {
    const result = parseCrmDeposits(crmDepositXlsx(dayDeposits));
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows.length, 6);
    const tx = result.rows.find(r => r.reference === '1002');
    assert.equal(tx?.completedAt, '2026-11-05T05:00:01.000Z');
    assert.equal(tx?.amountUsd, 20);
    assert.equal(tx?.transferAmount, 200000);
    assert.equal(tx?.transferCurrency, 'IDR');
    assert.equal(tx?.rate, 10000);
    assert.equal(tx?.ticket, null); // "0" → null
    assert.deepEqual(result.summary.byStatus, { Successful: 5, Unsuccessful: 1 });
    assert.deepEqual(result.summary.wibRange, { from: '2026-11-05', to: '2026-11-06' });
  });

  it('keeps the last row for a repeated Reference and counts it', () => {
    const rows = [dayDeposits[0], { ...dayDeposits[0], status: 'Unsuccessful' }];
    const result = parseCrmDeposits(crmDepositXlsx(rows));
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].status, 'Unsuccessful');
    assert.equal(result.summary.duplicatesInFile, 1);
  });

  it('rejects a withdrawal file given to the deposit parser and reports bad rows', () => {
    assert.match(parseCrmDeposits(crmWithdrawalXlsx(dayWithdrawals)).errors[0], /Missing columns: Credited amount/);
    const bad = parseCrmWithdrawals(crmWithdrawalXlsx([{ ...dayWithdrawals[0], request: '2026-11-05 12:00' }]));
    assert.equal(bad.rows.length, 0);
    assert.match(bad.issues[0].message, /Request/);
    const processing = parseCrmWithdrawals(crmWithdrawalXlsx([{ ...dayWithdrawals[0], complete: '--', status: 'Processing' }]));
    assert.equal(processing.rows[0].completedAt, null);
  });
});
