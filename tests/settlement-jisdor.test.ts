import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyFixings, parseJisdorHtml, parseJisdorRate } from '../src/lib/settlement/jisdor';

const html = `<table><tr><th>Tanggal</th><th>Kurs</th></tr>
<tr><td>9 November 2026</td><td>Rp 18.103,00</td></tr>
<tr><td>6 November 2026</td><td>Rp 18.130,00</td></tr>
<tr><td>30 Oktober 2026</td><td>Rp 18.138,00</td></tr>
</table>`;

test('parses published JISDOR rows and does not fill the missing weekend', () => {
  assert.equal(parseJisdorRate('Rp 18.103,00'), 18103);
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
  const panel = readFileSync('src/components/settlement/JisdorPanel.tsx', 'utf8');
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
});
