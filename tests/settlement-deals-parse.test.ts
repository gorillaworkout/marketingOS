import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  emptyUtf16LineState, finishUtf16LeLines, parseDealsFooter, parseDealsHeader, parseDealsRow, parseDealsTitle, pushUtf16LeLines, serverDateOf,
} from '../src/lib/settlement/deals-parse';

const header = 'Deal\tLogin\tName\tTime\tEntry\tVolume\tCommission\tFee\tSwap\tProfit\tCurrency\tComment';

function utf16(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

describe('deals history text', () => {
  it('carries a split UTF-16 code unit and a split line', () => {
    const bytes = utf16('Trades\\Deals History Report for \'*\' from \'2026.10.01\' to \'2026.10.05\'\r\nDeal\tLogin\r\n');
    const mid = Math.floor(bytes.length / 2);
    if (mid % 2 === 0) {
      // force an odd split so the second push starts with a leftover low or high byte
    }
    const cut = mid % 2 === 0 ? mid + 1 : mid;
    let state = emptyUtf16LineState();
    const first = pushUtf16LeLines(state, bytes.subarray(0, cut));
    state = first.state;
    const second = pushUtf16LeLines(state, bytes.subarray(cut));
    const lines = [...first.lines, ...second.lines, ...finishUtf16LeLines(second.state)];
    assert.match(lines[0], /Deals History Report for '\*'/);
    assert.equal(lines[1], 'Deal\tLogin');
  });

  it('reads the official title shape and the footer columns', () => {
    const title = parseDealsTitle("Trades\\Deals History Report for '*' from '2026.10.01' to '2026.10.05'");
    assert.deepEqual(title, { filter: '*', from: '2026-10-01', to: '2026-10-05', star: true });
    const parsedHeader = parseDealsHeader(header);
    assert.ok(parsedHeader);
    assert.deepEqual(parseDealsFooter(parsedHeader, 'Total\t\t\t\t\t15173.56\t-51486.70\t0\t0\t-565062.11\t\t'), { commission: -51486.7, swap: 0 });
  });

  it('parses a row without name or comment and keeps the server date across the October switch', () => {
    const parsedHeader = parseDealsHeader(header);
    assert.ok(parsedHeader);
    const row = parseDealsRow(parsedHeader, '100\t2400001\tClient\t2026.10.25 03:00:00.123\tin\t1.00\t-1.50\t0\t0\t2\tUSD\tEA note');
    assert.ok(row);
    assert.equal(row.serverDate, '2026-10-25');
    assert.equal(row.serverTime, '2026-10-25 03:00:00');
    assert.equal(row.rate, 14000);
    assert.equal('name' in row, false);
    assert.equal('comment' in row, false);
    assert.equal(serverDateOf('2026.10.25 03:00:00')?.serverDate, '2026-10-25');
  });
});
