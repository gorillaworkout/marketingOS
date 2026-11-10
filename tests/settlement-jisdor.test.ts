import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JisdorSection } from '../src/components/settlement/report/JisdorSection';
import { jisdorSheetRows } from '../src/lib/settlement/export';
import { JISDOR_MONTH_UNAVAILABLE, applyFixings, jisdorMonthTable, parseJisdorHtml, parseJisdorRate } from '../src/lib/settlement/jisdor';
import type { SettlementReport } from '../src/lib/settlement/report';

const html = `<table><tr><th>Tanggal</th><th>Kurs</th></tr>
<tr><td>9 November 2026</td><td>Rp 18.103,00</td></tr>
<tr><td>6 November 2026</td><td>Rp 18.130,00</td></tr>
<tr><td>30 Oktober 2026</td><td>Rp 18.138,00</td></tr>
</table>`;

test('parses published JISDOR rows and does not fill the missing weekend', () => {
  assert.equal(parseJisdorRate('Rp 18.103,00'), 18103);
  assert.equal(parseJisdorRate('18.103'), null);
  assert.equal(parseJisdorHtml('<html>Attention Required Cloudflare</html>').length, 0);
  const rows = parseJisdorHtml(html);
  assert.deepEqual(rows.map(row => row.date), ['2026-10-30', '2026-11-06', '2026-11-09']);
  assert.equal(rows.find(row => row.date === '2026-11-07'), undefined);
  assert.equal(rows.find(row => row.date === '2026-11-08'), undefined);
  const merged = applyFixings([{ date: '2026-11-06', rate: 1 }], rows);
  assert.equal(merged.find(row => row.date === '2026-11-06')?.rate, 18130);
  assert.equal(merged.find(row => row.date === '2026-11-07'), undefined);
  assert.equal(parseJisdorHtml('<p>no table</p>').length, 0);
});

test('JISDOR is on-demand display, not a cron and not a report conversion', () => {
  const route = readFileSync('src/app/api/settlement-report/jisdor/route.ts', 'utf8');
  const panel = readFileSync('src/components/settlement/report/JisdorSection.tsx', 'utf8');
  const pkg = readFileSync('package.json', 'utf8');
  assert.match(route, /requireSettlementReport/);
  assert.match(route, /Unrecognized JISDOR page/);
  assert.match(panel, /not applied to commission or swap/);
  assert.doesNotMatch(route, /node-cron|setInterval/);
  assert.doesNotMatch(pkg, /jisdor/);
  const migration = readFileSync('db/migrations/048_settlement_jisdor.sql', 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS settlement_fx_rates/);
  assert.match(migration, /DROP TABLE IF EXISTS settlement_fx_rates/);
  assert.doesNotMatch(migration.replace(/--.*$/gm, ''), /INSERT INTO settlement_fx_rates/);
  assert.match(route, /fetchPublishedJisdor/);
  assert.match(route, /JISDOR_MONTH_UNAVAILABLE/);
});

const published = [
  { date: '2026-10-30', rate: 18138 },
  { date: '2026-11-06', rate: 18130 },
  { date: '2026-11-09', rate: 18103 },
];

test('groups a month newest first and measures the change against the previous published fixing', () => {
  const november = jisdorMonthTable(published, '2026-11');
  assert.deepEqual(november.map(row => row.date), ['2026-11-09', '2026-11-06']);
  assert.equal(november.find(row => row.date === '2026-11-07'), undefined);
  assert.equal(november.find(row => row.date === '2026-11-08'), undefined);
  assert.equal(november[0]?.change, -27);
  assert.equal(november[1]?.change, -8);
  assert.equal(jisdorMonthTable(published, '2026-10')[0]?.change, null);
  assert.deepEqual(jisdorMonthTable(published, '2026-09'), []);
});

test('the month table lists rates newest first and a failed month says it is unavailable', () => {
  const html = renderToStaticMarkup(createElement(JisdorSection, { variant: 'screen', month: '2026-11', fixings: published }));
  const ninth = html.indexOf('9 Nov 2026');
  const sixth = html.indexOf('6 Nov 2026');
  assert.ok(ninth >= 0 && sixth > ninth);
  assert.match(html, /Rp 18,103\.00/);
  assert.match(html, /−27\.00/);
  assert.doesNotMatch(html, /7 Nov 2026/);
  assert.doesNotMatch(html, /8 Nov 2026/);
  assert.doesNotMatch(html, new RegExp(JISDOR_MONTH_UNAVAILABLE));

  const empty = renderToStaticMarkup(createElement(JisdorSection, { variant: 'screen', month: '2026-09', fixings: published }));
  assert.match(empty, /No JISDOR fixings for this month/);
  assert.doesNotMatch(empty, new RegExp(JISDOR_MONTH_UNAVAILABLE));

  const failed = renderToStaticMarkup(createElement(JisdorSection, { variant: 'screen', month: '2026-08', fixings: [], unavailable: true }));
  assert.match(failed, new RegExp(JISDOR_MONTH_UNAVAILABLE));
  assert.doesNotMatch(failed, /Rp /);

  const sheet = jisdorSheetRows({ period: { anchor: '2026-11-06' }, jisdor: published } as SettlementReport);
  assert.deepEqual(sheet[0], ['JISDOR', '2026-11']);
  assert.deepEqual(sheet[2], ['2026-11-09', 18103, -27]);
  assert.deepEqual(sheet[3], ['2026-11-06', 18130, -8]);
  const missing = jisdorSheetRows({ period: { anchor: '2026-08-01' }, jisdor: published } as SettlementReport);
  assert.deepEqual(missing, [['JISDOR', '2026-08'], [JISDOR_MONTH_UNAVAILABLE]]);
});
