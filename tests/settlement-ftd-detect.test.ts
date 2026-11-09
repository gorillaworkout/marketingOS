import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectSettlementKind } from '../src/lib/settlement/detect';
import { parseSettlementFtd } from '../src/lib/settlement/ftd-parse';
import { crmDepositXlsx, crmWithdrawalXlsx, dayDeals, dayDeposits, dayWithdrawals, ftdRows, ftdXlsx, mt5DwText } from './fixtures/settlement';

describe('settlement FTD (Initial Margin) parser', () => {
  it('reads the Dealing FTD list: header below the title, server time → UTC, rate from login', () => {
    const result = parseSettlementFtd(ftdXlsx(ftdRows));
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows.length, 3);
    assert.deepEqual(result.rows[0], { login: '2400022', accountType: 'micro', serverTime: '2026-11-06 04:00:30', ftdAt: '2026-11-06T02:00:30.000Z', balanceUsd: 50, rate: 14000 });
    assert.deepEqual(result.summary.byStatus, { micro: 1, standard: 2 });
  });

  it('errors without the FTD header', () => {
    assert.match(parseSettlementFtd(crmDepositXlsx(dayDeposits)).errors[0], /No header with Login/);
  });
});

describe('settlement detect', () => {
  it('detects the three kinds by content', () => {
    assert.equal(detectSettlementKind(crmDepositXlsx(dayDeposits)), 'settlement_crm_deposit');
    assert.equal(detectSettlementKind(crmWithdrawalXlsx(dayWithdrawals)), 'settlement_crm_withdrawal');
    assert.equal(detectSettlementKind(mt5DwText(dayDeals)), 'settlement_mt5_dw');
    assert.equal(detectSettlementKind(mt5DwText(dayDeals, { encoding: 'utf8', separator: ';' })), 'settlement_mt5_dw');
    assert.equal(detectSettlementKind(ftdXlsx(ftdRows)), 'settlement_ftd');
  });

  it('returns null for unrelated files (e.g. an Onboarding CSV)', () => {
    assert.equal(detectSettlementKind(Buffer.from('Client ID,Registration Date\n1,2026-10-01\n')), null);
    assert.equal(detectSettlementKind(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0])), null);
  });
});
