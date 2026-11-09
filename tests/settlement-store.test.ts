import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { SEEDED_HOLIDAYS } from '../src/lib/settlement/conventions';
import { parseCrmDeposits } from '../src/lib/settlement/crm-parse';
import { parseSettlementFtd } from '../src/lib/settlement/ftd-parse';
import { parseMt5DepositWithdrawal } from '../src/lib/settlement/mt5-parse';
import { FTD_PLAN, MT5_PLAN, crmPlan, toCrmTransaction } from '../src/lib/settlement/store';
import { crmDepositXlsx, dayDeals, dayDeposits, ftdRows, ftdXlsx, mt5DwText } from './fixtures/settlement';

describe('settlement store plans', () => {
  it('maps a CRM row to the column order of settlement_crm_deposits', () => {
    const plan = crmPlan('deposit');
    assert.equal(plan.kind, 'settlement_crm_deposit');
    assert.equal(plan.table, 'settlement_crm_deposits');
    assert.equal(crmPlan('withdrawal').table, 'settlement_crm_withdrawals');
    const row = parseCrmDeposits(crmDepositXlsx(dayDeposits)).rows.find(r => r.reference === '1002')!;
    const values = plan.values(row, 'u1');
    assert.equal(values.length, plan.columns.length);
    assert.deepEqual(Object.fromEntries(plan.columns.map((c, i) => [c, values[i]])), {
      reference: '1002', ticket: null, account_no: '2000011', uid: '9000001', funding_method: 'Manual',
      requested_at: '2026-11-05T04:59:00.000Z', completed_at: '2026-11-05T05:00:01.000Z', status: 'Successful',
      amount_usd: '20', transfer_amount: '200000', transfer_currency: 'IDR', rate: 10000, channel: 'BCA', payment_method: 'Bank transfer',
      gateway_reference: null, source: 'upload', upload_id: 'u1',
    });
  });

  it('maps MT5 deals and FTD entries', () => {
    const deal = parseMt5DepositWithdrawal(mt5DwText(dayDeals)).rows[0];
    const v = MT5_PLAN.values(deal, 'u2');
    assert.equal(v.length, MT5_PLAN.columns.length);
    assert.deepEqual(v.slice(0, 4), ['501', '2000011', 'Client 1', '2026-11-05 07:00:01']);
    assert.equal(v[MT5_PLAN.columns.indexOf('amount_usd')], '20.00');
    const ftd = parseSettlementFtd(ftdXlsx(ftdRows)).rows[0];
    assert.deepEqual(FTD_PLAN.values(ftd, 'u3'), ['2400022', 'micro', '2026-11-06 04:00:30', '2026-11-06T02:00:30.000Z', '50.00', 14000, 'upload', 'u3']);
  });

  it('turns DB rows back into CrmTransaction', () => {
    const tx = toCrmTransaction('withdrawal', { reference: '9', ticket: null, account_no: '2400022', uid: null, funding_method: 'Manual', requested_at: new Date('2026-11-06T01:00:00Z'), completed_at: null, status: 'Processing', amount_usd: '25.00000', transfer_amount: null, transfer_currency: null, rate: 14000 });
    assert.equal(tx.requestedAt, '2026-11-06T01:00:00.000Z');
    assert.equal(tx.amountUsd, 25);
    assert.equal(tx.completedAt, null);
  });
});

describe('migration 046', () => {
  const sql = readFileSync('db/migrations/046_settlement_phase1.sql', 'utf8');
  it('widens the upload kinds, creates the five tables, seeds 9 holidays, documents the rollback', () => {
    for (const kind of ['settlement_crm_deposit', 'settlement_crm_withdrawal', 'settlement_mt5_dw', 'settlement_ftd']) assert.match(sql, new RegExp(`'${kind}'`));
    for (const table of ['settlement_crm_deposits', 'settlement_crm_withdrawals', 'settlement_mt5_deals', 'settlement_ftd', 'settlement_holidays']) {
      assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
      assert.match(sql, new RegExp(`--   DROP TABLE IF EXISTS ${table};`));
    }
    assert.equal((sql.match(/\('2026-\d{2}-\d{2}', '/g) ?? []).length, 9);
    for (const [day, label] of SEEDED_HOLIDAYS) assert.ok(sql.includes(`('${day}', '${label}')`), day);
    assert.match(sql, /ON CONFLICT \(holiday_date\) DO NOTHING/);
    assert.match(sql, /DELETE FROM schema_migrations WHERE name = '046_settlement_phase1.sql'/);
  });
});
