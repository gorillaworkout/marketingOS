/**
 * Self-check for db/migrations/041_monthly_report.sql and the Monthly Report
 * store: applies the migration twice (idempotent), checks the constraints,
 * loads the synthetic fixtures through the same upserts as the uploads, and
 * asserts the SQL aggregates equal the pure functions in metrics.ts.
 *
 * Usage:
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5599/postgres \
 *     npx tsx scripts/verify-monthly-report-migration.ts
 *
 * Never point TEST_DATABASE_URL at production: it deletes Monthly Report rows.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  console.error('Refusing to run without TEST_DATABASE_URL (never point this at production).');
  process.exit(1);
}
process.env.DATABASE_URL = TEST_DATABASE_URL;

async function main() {
  const { execute, queryAll, queryOne, closeDb } = await import('../src/lib/database');
  const store = await import('../src/lib/monthly-report/store');
  const metrics = await import('../src/lib/monthly-report/metrics');
  const { parseOnboardingWorkbook } = await import('../src/lib/monthly-report/onboarding-parse');
  const { parseFtdFile } = await import('../src/lib/monthly-report/ftd-parse');
  const fixtures = await import('../tests/fixtures/monthly-report-onboarding');

  const sql = await readFile(path.join(process.cwd(), 'db/migrations/041_monthly_report.sql'), 'utf8');
  await execute(sql);
  await execute(sql);

  // Department feature is assignable.
  const department = await queryOne<{ id: string }>('SELECT id FROM departments LIMIT 1');
  assert.ok(department);
  await execute(`UPDATE departments SET permitted_features = array_append(array_remove(permitted_features, 'monthly-report'), 'monthly-report') WHERE id = ?`, [department.id]);
  await assert.rejects(execute(`UPDATE departments SET permitted_features = array_append(permitted_features, 'not-a-feature') WHERE id = ?`, [department.id]));
  await execute(`UPDATE departments SET permitted_features = array_remove(permitted_features, 'monthly-report') WHERE id = ?`, [department.id]);

  for (const table of ['onboarding_rejection_reasons', 'onboarding_ftd', 'onboarding_events', 'monthly_report_access', 'monthly_report_uploads']) await execute(`DELETE FROM ${table}`);
  await assert.rejects(execute(`INSERT INTO monthly_report_uploads (id, kind, file_name) VALUES ('x', 'registrations', 'x')`), 'unknown upload kind is rejected');
  await assert.rejects(execute(`INSERT INTO onboarding_rejection_reasons (id, reason_date, reason) VALUES ('x', '2026-10-01', 'r')`), 'a reason needs a document id or uid');
  await assert.rejects(execute(`INSERT INTO onboarding_ftd (account_no, ftd_at, amount, source) VALUES ('1', now(), 1, 'manual')`), 'source must be upload or api');

  const actor = { id: null, name: 'verify' };
  const onboarding = parseOnboardingWorkbook(fixtures.syntheticOnboardingWorkbook(), { offset: '+07:00' });
  const ftd = parseFtdFile(Buffer.from(fixtures.syntheticFtdReportCsv()), { fileName: 'ftd.csv', offset: '+07:00' });
  const first = await store.saveOnboardingEvents(onboarding.rows, { fileName: 'synthetic.xlsx', offset: '+07:00', actor, skipped: 0, range: onboarding.summary.wibRange });
  assert.deepEqual(first.counts, { total: 11, inserted: 11, updated: 0, unchanged: 0, skipped: 0 });
  const again = await store.saveOnboardingEvents(onboarding.rows, { fileName: 'synthetic.xlsx', offset: '+07:00', actor, skipped: 0, range: onboarding.summary.wibRange });
  assert.deepEqual(again.counts, { total: 11, inserted: 0, updated: 0, unchanged: 11, skipped: 0 });
  const changed = onboarding.rows.map((row, i) => (i === 0 ? { ...row, remarks: 'changed' } : row));
  const third = await store.saveOnboardingEvents(changed, { fileName: 'synthetic.xlsx', offset: '+07:00', actor, skipped: 0, range: onboarding.summary.wibRange });
  assert.deepEqual(third.counts, { total: 11, inserted: 0, updated: 1, unchanged: 10, skipped: 0 });
  const ftdSaved = await store.saveFtd(ftd.rows, { fileName: 'ftd.csv', offset: '+07:00', actor, skipped: 0, range: ftd.summary.wibRange });
  assert.equal(ftdSaved.counts.inserted, 5);

  for (const range of [{ from: '2026-10-01', to: '2026-10-31' }, { from: '2026-10-02', to: '2026-10-12' }, { from: '2026-09-01', to: '2026-09-30' }]) {
    const inRange = onboarding.rows.filter(row => metrics.aggregateEventsByDay([row])[0].date >= range.from && metrics.aggregateEventsByDay([row])[0].date <= range.to);
    assert.deepEqual(await store.loadDailyOnboarding(range), metrics.aggregateEventsByDay(inRange), `daily ${range.from}`);
    assert.equal(await store.loadUniqueActivated(range), metrics.distinctActivatedAccounts(inRange), `unique ${range.from}`);
    const ftdIn = ftd.rows.filter(row => { const d = metrics.aggregateFtdByDay([row])[0].date; return d >= range.from && d <= range.to; });
    assert.deepEqual(await store.loadDailyFtd(range), metrics.aggregateFtdByDay(ftdIn), `ftd ${range.from}`);
    assert.deepEqual(await store.loadFtdCohort(range), metrics.ftdCohortStats(onboarding.rows, ftd.rows, range), `cohort ${range.from}`);
  }
  assert.deepEqual(await store.loadFtdCoverage(), { from: '2026-10-01', to: '2026-10-31' });

  const uploads = await store.listUploads();
  assert.equal(uploads.length, 4);
  assert.equal(uploads.find(u => u.kind === 'ftd')?.rows_inserted, 5);

  const details = await store.listDetails('bank_info_pending', { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(details.total, 1);
  assert.equal(details.rows[0].remarks, 'NPWP Failed');

  const member = await queryOne<{ id: string }>(`SELECT id FROM users WHERE role <> 'admin' ORDER BY username LIMIT 1`);
  assert.ok(member);
  await store.setUserAccess(member.id, { view: true, upload: true }, member.id);
  let access = (await store.listAccessUsers()).find(u => u.id === member.id)!;
  assert.deepEqual([access.personal_grant, access.can_upload], [true, true]);
  await store.setUserAccess(member.id, { view: false, upload: false }, member.id);
  access = (await store.listAccessUsers()).find(u => u.id === member.id)!;
  assert.deepEqual([access.personal_grant, access.can_upload], [false, false]);

  const tables = await queryAll<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('monthly_report_access','monthly_report_uploads','onboarding_events','onboarding_ftd','onboarding_rejection_reasons') ORDER BY 1`);
  assert.equal(tables.length, 5);

  for (const table of ['onboarding_rejection_reasons', 'onboarding_ftd', 'onboarding_events', 'monthly_report_access', 'monthly_report_uploads']) await execute(`DELETE FROM ${table}`);
  await closeDb();
  console.log('041_monthly_report: idempotent, constraints hold, SQL aggregates match metrics.ts');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
