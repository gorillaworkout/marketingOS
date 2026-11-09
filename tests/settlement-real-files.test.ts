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
import { parseSettlementFtd } from '../src/lib/settlement/ftd-parse';
import { parseMt5DepositWithdrawal } from '../src/lib/settlement/mt5-parse';

const DIR = process.env.SETTLEMENT_DATA_DIR ?? '/workspace/settlement/Settlement Data';
const FTD_FILE = process.env.SETTLEMENT_FTD_FILE ?? '/workspace/settlement/extra/FTD Oktober 2026.xlsx';
const skip = existsSync(join(DIR, 'CRM')) && existsSync(join(DIR, 'Meta')) ? false : `no raw data at ${DIR}`;

describe('settlement acceptance (real files)', { skip }, () => {
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
});
