/**
 * Self-check for db/migrations/041_monthly_report.sql, 043_onboarding_event_natural_key.sql
 * and the Monthly Report store: applies each migration twice (idempotent),
 * checks that 043 keeps rows stored under the old Document-ID key, checks the
 * constraints, loads the synthetic fixtures through the same inserts as the
 * uploads (re-import = 0 inserted, other events of a known Document ID kept),
 * and asserts the SQL aggregates equal the pure functions in metrics.ts.
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
  const naturalKey = await readFile(path.join(process.cwd(), 'db/migrations/043_onboarding_event_natural_key.sql'), 'utf8');
  const rollback = naturalKey.split('\n').filter(line => line.startsWith('--   ')).map(line => line.slice(5)).join('\n')
    .replace(/DELETE FROM schema_migrations[^;]*;/, '');
  const pkColumns = async () => (await queryAll<{ attname: string }>(
    `SELECT a.attname FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.conrelid = 'onboarding_events'::regclass AND c.contype = 'p' ORDER BY k.ord`)).map(r => r.attname);
  await execute(sql);
  await execute(sql);
  if ((await pkColumns()).length === 3) await execute(rollback); // start from the pre-043 schema

  // Rows stored under PRIMARY KEY (document_id) survive 043 unchanged.
  await execute('DELETE FROM onboarding_events');
  await execute(`INSERT INTO onboarding_events (document_id, event_at, step, step_status) VALUES ('old-1', '2026-10-01T00:00:00Z', 'manual_kyc', 'Approved'), ('old-2', '2026-10-02T00:00:00Z', 'auto_kyc', 'Pending')`);
  const before = await queryAll<Record<string, unknown>>('SELECT * FROM onboarding_events ORDER BY document_id');
  await execute(naturalKey);
  await execute(naturalKey);
  assert.deepEqual(await pkColumns(), ['document_id', 'event_at', 'step']);
  assert.deepEqual(await queryAll<Record<string, unknown>>('SELECT * FROM onboarding_events ORDER BY document_id'), before, '043 keeps existing rows');
  await execute(sql); // 041 re-run after 043 keeps the natural key
  assert.deepEqual(await pkColumns(), ['document_id', 'event_at', 'step']);
  // The documented rollback works while each Document ID has one row, and refuses otherwise.
  await execute(rollback);
  assert.deepEqual(await pkColumns(), ['document_id']);
  await execute(naturalKey);
  await execute(`INSERT INTO onboarding_events (document_id, event_at, step, step_status) VALUES ('old-1', '2026-11-01T00:00:00Z', 'manual_kyc', 'Approved')`);
  // Only the guard (a DO block is atomic on its own; a failed BEGIN…COMMIT would leave a pooled connection aborted).
  await assert.rejects(execute(rollback.match(/DO \$\$[\s\S]*?END \$\$;/)![0]), /several events/);
  assert.deepEqual(await pkColumns(), ['document_id', 'event_at', 'step']);

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
  const meta = { fileName: 'synthetic.xlsx', offset: '+07:00', actor, skipped: 0, duplicatesInFile: 0, range: onboarding.summary.wibRange };
  const first = await store.saveOnboardingEvents(onboarding.rows, meta);
  assert.deepEqual(first.counts, { total: 11, inserted: 11, skippedDuplicate: 0, duplicatesInFile: 0, invalid: 0 });
  const again = await store.saveOnboardingEvents(onboarding.rows, meta);
  assert.deepEqual(again.counts, { total: 11, inserted: 0, skippedDuplicate: 11, duplicatesInFile: 0, invalid: 0 });
  // A re-export with a changed value is the same event: skipped, the stored row is kept.
  const changed = onboarding.rows.map((row, i) => (i === 0 ? { ...row, remarks: 'changed' } : row));
  const third = await store.saveOnboardingEvents(changed, { ...meta, skipped: 2, duplicatesInFile: 1 });
  assert.deepEqual(third.counts, { total: 14, inserted: 0, skippedDuplicate: 12, duplicatesInFile: 1, invalid: 2 });
  assert.equal((await queryOne<{ remarks: string }>('SELECT remarks FROM onboarding_events WHERE document_id = ?', [onboarding.rows[0].documentId]))?.remarks, onboarding.rows[0].remarks);
  // Another event of a known Document ID (a later month) is stored alongside.
  const later = { ...onboarding.rows[2], eventAt: '2026-11-03T02:00:00.000Z', stepStatus: 'Approved', accountStatus: 'KYC Done' };
  const fourth = await store.saveOnboardingEvents([later], { ...meta, range: { from: '2026-11-03', to: '2026-11-03' } });
  assert.equal(fourth.counts.inserted, 1);
  assert.equal(Number((await queryOne<{ n: string }>('SELECT COUNT(*)::text AS n FROM onboarding_events WHERE document_id = ?', [later.documentId]))?.n), 2);
  assert.equal((await store.loadStoredEvents([later.documentId])).length, 2);
  await execute('DELETE FROM onboarding_events WHERE upload_id = ?', [fourth.uploadId]);
  await execute('DELETE FROM monthly_report_uploads WHERE id = ?', [fourth.uploadId]);
  const history = (await store.listUploads()).find(u => u.id === third.uploadId);
  assert.deepEqual([history?.rows_total, history?.rows_inserted, history?.rows_duplicate, history?.rows_skipped], [14, 0, 12, 2]);
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
  console.log('041 + 043: idempotent, existing rows kept, rollback works, re-import inserts 0, SQL aggregates match metrics.ts');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
