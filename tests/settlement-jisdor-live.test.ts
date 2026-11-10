/**
 * Read-only fetch of the official BI JISDOR page. Skipped unless JISDOR_LIVE=1.
 * A block, a missing table, and a parser miss are different failures.
 * Nothing in this file is a substitute for rows the page did not publish.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JISDOR_PAGE_URL, parseJisdorDate, parseJisdorHtml } from '../src/lib/settlement/jisdor';

const enabled = process.env.JISDOR_LIVE === '1';
const testUrl = process.env.SETTLEMENT_TEST_DATABASE_URL ?? '';
const localDb = /^postgres(?:ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)(?::\d+)?\//.test(testUrl);

test('live BI JISDOR page parses the published table and does not fill gaps', { skip: enabled ? false : 'JISDOR_LIVE=1 is required for the read-only BI fetch' }, async () => {
  const load = await fetch(JISDOR_PAGE_URL, { headers: { 'User-Agent': 'MarketingOS settlement' } });
  const html = await load.text();
  const blocked = /cloudflare|attention required|just a moment|access denied|captcha/i.test(html);
  const tableAt = html.indexOf('id="tableData"');
  const table = tableAt >= 0 ? html.slice(tableAt, tableAt + 12000) : '';
  const dateCells = [...table.matchAll(/<td\b[^>]*>\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*<\/td>/gi)].map(match => match[1]);
  const rateCells = [...table.matchAll(/Rp\s+(\d{1,3}(?:\.\d{3})*,\d{2})/g)].map(match => match[1]);
  const parsed = parseJisdorHtml(html);
  console.log(`JISDOR_LIVE status=${load.status} bytes=${html.length} blocked=${blocked} table=${tableAt >= 0} dateCells=${dateCells.length} rateCells=${rateCells.length} parsed=${parsed.length}`);
  assert.equal(load.ok, true, `JISDOR page returned ${load.status}. Nothing was parsed.`);
  assert.equal(blocked, false, 'The response is a block page, not a JISDOR table. The parser was not judged against it.');
  assert.ok(tableAt >= 0, 'The response has no tableData element. This is a missing table, not a parser result.');
  assert.ok(dateCells.length > 0 && rateCells.length > 0, 'The table element has no Tanggal/Kurs cells.');
  assert.equal(parsed.length, dateCells.length, 'The parser dropped or invented rows relative to the published table.');
  assert.equal(parsed.length, rateCells.length);
  const publishedRows = dateCells.map((cell, index) => ({ date: parseJisdorDate(cell), rate: Number(rateCells[index].replace(/\./g, '').replace(',', '.')) })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  assert.deepEqual(parsed, publishedRows);
  const published = new Set(parsed.map(row => row.date));
  const first = parsed[0]?.date;
  const last = parsed.at(-1)?.date;
  assert.ok(first && last);
  for (let cursor = new Date(`${first}T00:00:00Z`); cursor <= new Date(`${last}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) continue;
    const date = cursor.toISOString().slice(0, 10);
    assert.equal(published.has(date), false, `${date} is a weekend and was not published; it must stay absent`);
  }
  const categories = html.match(/xAxis:\s*\{[\s\S]*?categories:\s*\[(.*?)\]/)?.[1] ?? '';
  const chartLabels = [...categories.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  console.log(`JISDOR_LIVE chartLabels=${chartLabels.length} tableDates=${parsed.map(row => row.date).join(',')}`);
  if (localDb) {
    process.env.DATABASE_URL = testUrl;
    const { migrate } = await import('../scripts/migrate');
    const { closeDb, execute, queryAll } = await import('../src/lib/database');
    const { saveJisdorFixings, listJisdorFixings } = await import('../src/lib/settlement/jisdor-store');
    try {
      await migrate(false);
      await saveJisdorFixings(parsed);
      const stored = await listJisdorFixings();
      for (const row of parsed) {
        assert.equal(stored.find(item => item.date === row.date)?.rate, row.rate);
      }
      const extras = await queryAll<{ fixing_date: string }>(
        `SELECT to_char(fixing_date, 'YYYY-MM-DD') AS fixing_date FROM settlement_fx_rates
         WHERE fixing_date >= ?::date AND fixing_date <= ?::date AND fixing_date <> ALL(?::date[])`,
        [first, last, parsed.map(row => row.date)],
      );
      assert.deepEqual(extras, []);
      await execute(`DELETE FROM settlement_fx_rates WHERE fixing_date = ANY(?::date[])`, [parsed.map(row => row.date)]);
    } finally {
      await closeDb();
    }
  }
});
