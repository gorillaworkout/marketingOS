import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMt5DepositWithdrawal } from '../src/lib/settlement/mt5-parse';
import { decodeText, readTextTable } from '../src/lib/settlement/text-read';
import { dayDeals, mt5DwText } from './fixtures/settlement';

describe('settlement text-read', () => {
  it('decodes UTF-16LE with BOM and UTF-8, splits tab and ; tables, peels the Total footer', () => {
    const utf16 = mt5DwText(dayDeals.slice(0, 2));
    assert.match(decodeText(utf16), /^Trades\\Deposit and Withdrawal Report/);
    const table = readTextTable(utf16, 'Deal');
    assert.ok(table);
    assert.equal(table.separator, '\t');
    assert.equal(table.rows.length, 2);
    assert.equal(table.footer?.[0], 'Total');
    const semi = readTextTable(mt5DwText(dayDeals.slice(0, 2), { encoding: 'utf8', separator: ';' }), 'Deal');
    assert.equal(semi?.separator, ';');
    assert.equal(semi?.rows[1][4], 'CRM-D-1003');
    assert.equal(readTextTable(Buffer.from('hello\nworld'), 'Deal'), null);
  });
});

describe('settlement MT5 D&W parser', () => {
  it('parses deals with kind, reference, server time and UTC instant', () => {
    const result = parseMt5DepositWithdrawal(mt5DwText(dayDeals));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.rows.length, 11);
    const d = result.rows.find(r => r.deal === '501');
    assert.equal(d?.kind, 'D');
    assert.equal(d?.crmReference, '1002');
    assert.equal(d?.serverTime, '2026-11-05 07:00:01');
    assert.equal(d?.occurredAt, '2026-11-05T05:00:01.000Z');
    assert.equal(d?.rate, 10000);
    assert.equal(result.rows.find(r => r.deal === '509')?.swapDate, '2026-11-05');
  });

  it('warns when the Total footer does not match the rows', () => {
    const result = parseMt5DepositWithdrawal(mt5DwText(dayDeals, { total: 999 }));
    assert.match(result.warnings[0], /Footer Total/);
  });

  it('errors on a file without the Deal header', () => {
    assert.match(parseMt5DepositWithdrawal(Buffer.from('a\tb\n1\t2')).errors[0], /No "Deal" header/);
  });
});
