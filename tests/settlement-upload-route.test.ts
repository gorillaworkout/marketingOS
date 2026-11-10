import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectSettlementKind } from '../src/lib/settlement/detect';
import { parseMt5DepositWithdrawal } from '../src/lib/settlement/mt5-parse';
import { routeSettlementFile } from '../src/lib/settlement/upload-route';
import { dayDeals, mt5DwText } from './fixtures/settlement';

const utf16 = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);

const DW_HEAD = [
  "Trades\\Deposit and Withdrawal Report for '*' from '2026.11.01' to '2026.11.10'",
  'Deal\tLogin\tName\tTime\tComment\tAmount\tCurrency',
].join('\r\n');

const DEALS_HEAD = [
  "Trades\\Deals History Report for '*' from '2026.10.01' to '2026.10.05'",
  'Deal\tLogin\tTime\tEntry\tVolume\tCommission\tFee\tSwap\tProfit\tCurrency',
].join('\r\n');

describe('settlement upload routing', () => {
  it('keeps an MT5 Deposit and Withdrawal UTF-16 head on the standard path', () => {
    assert.equal(routeSettlementFile(utf16(DW_HEAD), 'Deposit and Withdrawal 2026.11.01-10.csv'), 'standard');
    const file = mt5DwText(dayDeals);
    assert.equal(routeSettlementFile(file.subarray(0, 512), 'Deposit and Withdrawal.csv'), 'standard');
    assert.equal(detectSettlementKind(file), 'settlement_mt5_dw');
    assert.deepEqual(parseMt5DepositWithdrawal(file).errors, []);
  });

  it('sends a Deals History UTF-16 head to the chunked flow', () => {
    assert.equal(routeSettlementFile(utf16(DEALS_HEAD), 'Deals-History-Oct1-5.csv'), 'deals_history');
  });

  it('leaves xlsx, plain csv, and a UTF-16 file without the Deals History title on the standard path', () => {
    assert.equal(routeSettlementFile(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'crm_deposit.xlsx'), 'standard');
    assert.equal(routeSettlementFile(Buffer.from('Deal,Login\n1,2\n'), 'plain.csv'), 'standard');
    assert.equal(routeSettlementFile(utf16('Deal\tLogin\tCommission'), 'notes.csv'), 'standard');
    assert.equal(routeSettlementFile(utf16('Login\tAmount'), 'notes.csv'), 'standard');
  });
});
