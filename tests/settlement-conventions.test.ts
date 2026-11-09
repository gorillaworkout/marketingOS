import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inWindow, isOfficeHour, mt5ServerToUtc, parseCrmDate, parseMoney, rateFromAccount, reconciliationWindow, wibDateOf } from '../src/lib/settlement/conventions';
import { parseMt5Comment } from '../src/lib/settlement/comment-parse';

describe('settlement conventions', () => {
  it('derives the rate from the 2nd account digit', () => {
    assert.equal(rateFromAccount('2041125'), 10000);
    assert.equal(rateFromAccount('2200001'), 12000);
    assert.equal(rateFromAccount(2443172), 14000);
    assert.equal(rateFromAccount('2901960'), 1);
    assert.equal(rateFromAccount('2507000'), null);
    assert.equal(rateFromAccount(''), null);
  });

  it('parses CRM money and WIB dates', () => {
    assert.deepEqual(parseMoney('IDR 4000000.00000'), { currency: 'IDR', value: 4000000 });
    assert.deepEqual(parseMoney('USD -12.5'), { currency: 'USD', value: -12.5 });
    assert.equal(parseMoney('--'), null);
    assert.equal(parseCrmDate('05/11/2026 12:00:01'), '2026-11-05T05:00:01.000Z');
    assert.equal(parseCrmDate('--'), null);
    assert.equal(parseCrmDate('31/02/2026 10:00:00'), null);
  });

  it('converts MT5 server time (EET/EEST) to UTC across the October switch', () => {
    assert.equal(mt5ServerToUtc('2026.10.20 08:00:00'), '2026-10-20T05:00:00.000Z'); // EEST, 12:00 WIB
    assert.equal(mt5ServerToUtc('2026.11.05 07:00:00'), '2026-11-05T05:00:00.000Z'); // EET, 12:00 WIB
    assert.equal(mt5ServerToUtc('2026.10.25 02:30:00'), '2026-10-24T23:30:00.000Z'); // before the switch
    assert.equal(mt5ServerToUtc('2026.10.25 05:00:00'), '2026-10-25T03:00:00.000Z'); // after the switch
    assert.equal(mt5ServerToUtc('2026-10-25 05:00'), null);
  });

  it('builds the 12:00 → 12:00 WIB window, every day including weekends', () => {
    const w = reconciliationWindow('2026-11-09'); // Monday
    assert.equal(w.start, '2026-11-08T05:00:00.000Z');
    assert.equal(w.end, '2026-11-09T05:00:00.000Z');
    assert.equal(w.label, '2026-11-08 12:00:01 – 2026-11-09 12:00:00 WIB');
    assert.equal(inWindow(parseCrmDate('08/11/2026 12:00:00'), w), false);
    assert.equal(inWindow(parseCrmDate('08/11/2026 12:00:01'), w), true);
    assert.equal(inWindow(parseCrmDate('09/11/2026 12:00:00'), w), true);
    assert.equal(inWindow(null, w), false);
  });

  it('classifies office hours (Mon–Fri 09:00–18:00 WIB, holidays excluded)', () => {
    const at = (s: string) => parseCrmDate(s) as string;
    assert.equal(isOfficeHour(at('06/11/2026 08:59:59')), false);
    assert.equal(isOfficeHour(at('06/11/2026 09:00:00')), true);
    assert.equal(isOfficeHour(at('06/11/2026 17:59:59')), true);
    assert.equal(isOfficeHour(at('06/11/2026 18:00:00')), false);
    assert.equal(isOfficeHour(at('07/11/2026 10:00:00')), false); // Saturday
    assert.equal(isOfficeHour(at('25/12/2026 10:00:00'), new Set(['2026-12-25'])), false);
    assert.equal(wibDateOf(at('06/11/2026 00:30:00')), '2026-11-06');
  });

  it('parses every MT5 comment kind', () => {
    assert.deepEqual(parseMt5Comment('CRM-D-692176'), { kind: 'D', crmReference: '692176', swapDate: null });
    assert.deepEqual(parseMt5Comment('CRM-W-331362'), { kind: 'W', crmReference: '331362', swapDate: null });
    assert.deepEqual(parseMt5Comment('CRM-WC-331362'), { kind: 'WC', crmReference: '331362', swapDate: null });
    assert.deepEqual(parseMt5Comment('CRM-S-2320523,260930,Swap'), { kind: 'S', crmReference: null, swapDate: '2026-09-30' });
    assert.equal(parseMt5Comment('CRM-SR-Swap-Refund').kind, 'SR');
    assert.equal(parseMt5Comment('CRM-TI-1').kind, 'TI');
    assert.equal(parseMt5Comment('CRM-TO-1').kind, 'TO');
    assert.equal(parseMt5Comment('CRM-AD-Inactive').kind, 'AD');
    assert.equal(parseMt5Comment('Rollover').kind, 'OTHER');
    assert.equal(parseMt5Comment(null).kind, 'OTHER');
  });
});
