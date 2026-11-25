import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { COUNT_FIELDS } from '../src/lib/cs-report/fields';
import { buildSyntheticWorkbook } from './fixtures/cs-report-workbook';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';

test('migration 069 + CS Report store on PostgreSQL: upsert, edit, delete, complaints, bulk upload dedupe, name linking, dashboard, rollback', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `csreport_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE departments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, permitted_features TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT departments_permitted_features_valid CHECK (permitted_features <@ ARRAY['social-post','google-ads']::TEXT[])
      );
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', department_id TEXT REFERENCES departments(id));
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO departments (id, name, permitted_features) VALUES ('d1', 'Marketing', ARRAY['social-post']);
      INSERT INTO users (id, username, name, password_hash, role) VALUES ('admin-1', 'admin', 'Admin', 'hash', 'admin');
      INSERT INTO schema_migrations (name) VALUES ('069_cs_report.sql');
    `);
    const up = readFileSync('db/migrations/069_cs_report.sql', 'utf8');
    await client.query(up);
    await client.query(up);
    const dept = await client.query(`SELECT id, permitted_features FROM departments WHERE name = 'Customer Service'`);
    assert.deepEqual(dept.rows[0], { id: '00000000-0000-0000-0000-000000000008', permitted_features: ['cs-report'] });
    await client.query(`
      INSERT INTO users (id, username, name, password_hash, department_id) VALUES
        ('u-alpha', 'alpha', 'Agent Alpha', 'hash', '00000000-0000-0000-0000-000000000008'),
        ('u-bravo', 'bravo', 'Bravo Real Name', 'hash', '00000000-0000-0000-0000-000000000008'),
        ('u-mkt', 'mkt', 'Agent Charlie', 'hash', 'd1');
    `);
    await assert.rejects(client.query(`UPDATE departments SET permitted_features = ARRAY['nope'] WHERE id = 'd1'`));

    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    const store = await import('../src/lib/cs-report/store');
    const service = await import('../src/lib/cs-report/service');
    const { parseCsWorkbook } = await import('../src/lib/cs-report/parse');
    const { closeDb } = await import('../src/lib/database');
    try {
      // Web daily entry: upsert by agent + date.
      const alphaAgent = await store.ensureAgentForUser('u-alpha');
      assert.equal(alphaAgent.displayName, 'Agent Alpha');
      assert.equal((await store.ensureAgentForUser('u-alpha')).id, alphaAgent.id, 'one agent per user');
      const counts = Object.fromEntries(COUNT_FIELDS.map(f => [f.key, 1]));
      const input = { date: '2026-06-01', status: 'present' as const, ...counts, unsolvedUids: '', followUpMinutes: 4, frequentQuestion: 'Q1', difficultQuestion: '' };
      await store.upsertEntry(alphaAgent.id, input as never, 'u-alpha');
      const updated = await store.upsertEntry(alphaAgent.id, { ...input, imReception: 99, frequentQuestion: 'Q2' } as never, 'u-alpha');
      assert.equal(updated.imReception, 99);
      assert.equal(updated.frequentQuestion, 'Q2');
      assert.equal((await store.listEntries('2026-06-01', '2026-06-01', null)).length, 1, 'saving the same date again updates');
      assert.equal(updated.updatedByName, 'Agent Alpha', 'who last edited is recorded');
      assert.match(updated.updatedAt ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'updatedAt is an ISO UTC timestamp');

      // Complaints: insert, duplicate rejected, update, delete.
      const c = { date: '2026-06-10', clientName: 'Client X', uid: '42', account: 'A', platform: 'MT5', description: 'Late fill', cause: '', resolution: '', completionDate: null, status: 'On Progress', slaMet: null, urgency: '', category: '' };
      const saved = await store.insertComplaint(alphaAgent.id, c, 'u-alpha');
      assert.equal(saved.agentName, 'Agent Alpha');
      await assert.rejects(store.insertComplaint(alphaAgent.id, { ...c, description: 'late  FILL' }, 'u-alpha'), store.DuplicateComplaintError);
      const changed = await store.updateComplaint(saved.id, { ...c, status: 'Solved', slaMet: true, completionDate: '2026-06-11' }, 'u-alpha');
      assert.equal(changed.status, 'Solved');
      assert.equal(changed.completionDate, '2026-06-11');

      // Bulk upload preview: Alpha matches the existing agent, Bravo/Charlie do not (Charlie's user is not in CS).
      const workbook = await buildSyntheticWorkbook();
      const parsed = await parseCsWorkbook(workbook);
      const preview = await service.previewUpload(workbook, 'synthetic.xlsx');
      assert.deepEqual(preview.names.map(n => [n.excelName, n.reason]), [['Agent Alpha', 'alias'], ['Agent Bravo', 'none'], ['Agent Charlie', 'none']]);
      assert.deepEqual(preview.users.map(u => u.id).sort(), ['u-alpha', 'u-bravo']);
      assert.equal(preview.totals.entries, parsed.entries.length);
      assert.equal(preview.totals.entriesExisting, 1, 'Alpha 2026-06-01 already exists from the web form');
      await assert.rejects(service.commitUploadFile(workbook, 'x.xlsx', { 'Agent Charlie': 'user:u-mkt' }, { id: 'admin-1', name: 'Admin' }), /does not have CS Report access/);

      const first = await service.commitUploadFile(workbook, 'synthetic.xlsx', {}, { id: 'admin-1', name: 'Admin' });
      assert.deepEqual(first.entries, { total: parsed.entries.length, inserted: parsed.entries.length - 1, skipped: 1 });
      assert.deepEqual(first.complaints, { total: 3, inserted: 3, skipped: 0 });
      assert.equal(first.notes.inserted, parsed.notes.length);
      assert.equal((await store.getEntry(alphaAgent.id, '2026-06-01'))?.imReception, 99, 'an upload never overwrites a web entry');
      const agents = await store.listAgents();
      assert.deepEqual(agents.map(a => [a.displayName, Boolean(a.userId)]), [['Agent Alpha', true], ['Agent Bravo', false], ['Agent Charlie', false]]);

      const again = await service.commitUploadFile(workbook, 'synthetic.xlsx', {}, { id: 'admin-1', name: 'Admin' });
      assert.deepEqual([again.entries.inserted, again.complaints.inserted, again.notes.inserted], [0, 0, 0], 'same file twice inserts nothing');

      // Linking a name-only agent to a user later keeps its rows.
      const bravoName = agents.find(a => a.displayName === 'Agent Bravo')!;
      const linked = await service.commitUploadFile(workbook, 'synthetic.xlsx', { 'Agent Bravo': 'user:u-bravo' }, { id: 'admin-1', name: 'Admin' });
      assert.equal(linked.entries.inserted, 0);
      assert.equal((await store.agentForUser('u-bravo'))?.id, bravoName.id);
      assert.equal((await store.listAgents()).length, 3);

      const uploads = await store.listUploads();
      assert.equal(uploads.length, 3);
      assert.equal(uploads[2].entriesInserted, parsed.entries.length - 1);
      assert.equal(uploads[0].uploadedByName, 'Admin');
      assert.ok(uploads[0].warnings.length > 0);

      const dashboard = await service.getDashboard('2026-06-01', '2026-06-30', null);
      assert.equal(dashboard.kpis.entries, parsed.entries.filter(e => e.date <= '2026-06-30').length);
      assert.equal(dashboard.kpis.sickDays, 3);
      assert.equal(dashboard.kpis.complaints.total, 3);
      assert.equal(dashboard.kpis.complaints.resolved, 2);
      const alphaOnly = await service.getDashboard('2026-06-01', '2026-06-30', alphaAgent.id);
      assert.ok(alphaOnly.agents.every(a => a.agentId === alphaAgent.id));
      assert.equal(alphaOnly.kpis.complaints.total, 1, 'imported complaints have no agent');
      const exported = await service.exportWorkbook('2026-06-01', '2026-07-31', null);
      const reparsed = await parseCsWorkbook(exported.buffer);
      assert.equal(reparsed.entries.length, dashboard.kpis.entries + (await store.listEntries('2026-07-01', '2026-07-31', null)).length);

      // Editing: an admin corrects an agent's past entry; the edit is attributed to the admin.
      const before = await store.getEntry(alphaAgent.id, '2026-06-01');
      const fixed = await store.upsertEntry(alphaAgent.id, { ...input, imReception: 7 } as never, 'admin-1');
      assert.equal(fixed.id, before!.id, 'editing a past date updates the same row');
      assert.equal(fixed.imReception, 7);
      assert.equal(fixed.updatedByName, 'Admin');
      // Imported rows (entries and agent-less complaints) are editable too and keep their source.
      const imported = (await store.listEntries('2026-06-01', '2026-06-30', bravoName.id))[0];
      assert.equal(imported.source, 'upload');
      assert.equal(imported.updatedByName, 'Admin', 'imported rows show the uploader');
      const importedComplaint = (await store.listComplaints('2026-01-01', '2026-12-31', null)).find(x => x.agentId === null)!;
      assert.ok(importedComplaint, 'the workbook has agent-less complaints');
      const ic = importedComplaint;
      const complaintInput = { date: ic.date, clientName: ic.clientName, uid: ic.uid, account: ic.account, platform: ic.platform, description: ic.description, cause: ic.cause, resolution: ic.resolution, completionDate: ic.completionDate, status: ic.status, slaMet: ic.slaMet, urgency: ic.urgency, category: ic.category };
      const editedImported = await store.updateComplaint(ic.id, { ...complaintInput, status: 'Solved', resolution: 'Refunded' }, 'admin-1');
      assert.deepEqual([editedImported.status, editedImported.resolution, editedImported.source, editedImported.agentId, editedImported.updatedByName], ['Solved', 'Refunded', 'upload', null, 'Admin']);

      // Admin delete of a daily entry: the row goes, the agent's complaints stay.
      assert.equal((await store.getEntryById(fixed.id))?.date, '2026-06-01');
      assert.equal(await store.deleteEntry(fixed.id), true);
      assert.equal(await store.deleteEntry(fixed.id), false, 'deleting twice is a no-op');
      assert.equal(await store.getEntry(alphaAgent.id, '2026-06-01'), null);
      assert.equal((await store.getComplaint(saved.id))?.agentId, alphaAgent.id, 'complaints are not deleted with the entry');

      await store.deleteComplaint(saved.id);
      assert.equal(await store.getComplaint(saved.id), null);
    } finally {
      await closeDb();
    }

    await client.query(readFileSync('db/rollbacks/069_cs_report_down.sql', 'utf8'));
    const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'cs\\_%'`, [schema]);
    assert.equal(tables.rowCount, 0);
    const features = await client.query(`SELECT permitted_features FROM departments WHERE name = 'Customer Service'`);
    assert.deepEqual(features.rows[0].permitted_features, []);
    assert.equal((await client.query(`SELECT 1 FROM schema_migrations WHERE name = '069_cs_report.sql'`)).rowCount, 0);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});

test('migration 070 adds Customer Service at ...0009 when ...0008 is DPM, leaves DPM alone, and rolls back safely', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `csdept_${Date.now()}`;
  const up069 = readFileSync('db/migrations/069_cs_report.sql', 'utf8');
  const up070 = readFileSync('db/migrations/070_cs_department.sql', 'utf8');
  const down070 = readFileSync('db/rollbacks/070_cs_department_down.sql', 'utf8');
  const id8 = '00000000-0000-0000-0000-000000000008';
  const id9 = '00000000-0000-0000-0000-000000000009';
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE departments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, permitted_features TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT departments_permitted_features_valid CHECK (permitted_features <@ ARRAY['social-post','google-ads']::TEXT[])
      );
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', department_id TEXT REFERENCES departments(id));
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO departments (id, name, permitted_features) VALUES ('${id8}', 'DPM', ARRAY[]::TEXT[]);
    `);

    // Prod-like: ...0008 is already DPM, so 069 must not rename it or invent Customer Service there.
    await client.query(up069);
    await client.query(up069);
    const after069 = await client.query(`SELECT id, name, permitted_features FROM departments ORDER BY name`);
    assert.deepEqual(after069.rows, [{ id: id8, name: 'DPM', permitted_features: [] }]);
    assert.equal((await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'cs_agents'`, [schema])).rowCount, 1);

    await client.query(up070);
    await client.query(up070);
    const dpm = await client.query(`SELECT id, name, permitted_features FROM departments WHERE id = $1`, [id8]);
    assert.deepEqual(dpm.rows[0], { id: id8, name: 'DPM', permitted_features: [] }, 'DPM at ...0008 is unchanged');
    const cs = await client.query(`SELECT id, name, permitted_features FROM departments WHERE name = 'Customer Service'`);
    assert.deepEqual(cs.rows[0], { id: id9, name: 'Customer Service', permitted_features: ['cs-report'] });
    await client.query(`INSERT INTO schema_migrations (name) VALUES ('069_cs_report.sql'), ('070_cs_department.sql')`);

    // Rollback 070 with no users assigned: the ...0009 row goes, DPM and 069 stay.
    await client.query(down070);
    assert.equal((await client.query(`SELECT 1 FROM departments WHERE name = 'Customer Service'`)).rowCount, 0);
    assert.deepEqual((await client.query(`SELECT id, name, permitted_features FROM departments WHERE id = $1`, [id8])).rows[0], { id: id8, name: 'DPM', permitted_features: [] });
    assert.equal((await client.query(`SELECT 1 FROM schema_migrations WHERE name = '070_cs_department.sql'`)).rowCount, 0);
    assert.equal((await client.query(`SELECT 1 FROM schema_migrations WHERE name = '069_cs_report.sql'`)).rowCount, 1);
    assert.equal((await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'cs_agents'`, [schema])).rowCount, 1);

    // Re-apply, assign a user: rollback keeps the row and only removes the feature.
    await client.query(up070);
    await client.query(`INSERT INTO schema_migrations (name) VALUES ('070_cs_department.sql')`);
    await client.query(`INSERT INTO users (id, username, name, password_hash, department_id) VALUES ('u-cs', 'cs', 'CS Agent', 'hash', $1)`, [id9]);
    await client.query(down070);
    const kept = await client.query(`SELECT id, name, permitted_features FROM departments WHERE name = 'Customer Service'`);
    assert.deepEqual(kept.rows[0], { id: id9, name: 'Customer Service', permitted_features: [] }, 'row kept when a user is assigned');
    assert.equal((await client.query(`SELECT department_id FROM users WHERE id = 'u-cs'`)).rows[0].department_id, id9);
    assert.deepEqual((await client.query(`SELECT name FROM departments WHERE id = $1`, [id8])).rows[0], { name: 'DPM' });
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});

test('migration 070 is a no-op when 069 already created Customer Service at ...0008, and its rollback leaves that row alone', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `csdept_fresh_${Date.now()}`;
  const id8 = '00000000-0000-0000-0000-000000000008';
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE departments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, permitted_features TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT departments_permitted_features_valid CHECK (permitted_features <@ ARRAY['social-post','google-ads']::TEXT[])
      );
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', department_id TEXT REFERENCES departments(id));
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
    `);
    await client.query(readFileSync('db/migrations/069_cs_report.sql', 'utf8'));
    assert.deepEqual((await client.query(`SELECT id, permitted_features FROM departments WHERE name = 'Customer Service'`)).rows[0], { id: id8, permitted_features: ['cs-report'] });
    await client.query(readFileSync('db/migrations/070_cs_department.sql', 'utf8'));
    await client.query(readFileSync('db/migrations/070_cs_department.sql', 'utf8'));
    const rows = await client.query(`SELECT id, name, permitted_features FROM departments ORDER BY name`);
    assert.equal(rows.rowCount, 1, '070 must not insert a second Customer Service row');
    assert.deepEqual(rows.rows[0], { id: id8, name: 'Customer Service', permitted_features: ['cs-report'] });
    assert.equal((await client.query(`SELECT 1 FROM departments WHERE id = '00000000-0000-0000-0000-000000000009'`)).rowCount, 0);
    await client.query(`INSERT INTO schema_migrations (name) VALUES ('070_cs_department.sql')`);
    await client.query(readFileSync('db/rollbacks/070_cs_department_down.sql', 'utf8'));
    assert.deepEqual((await client.query(`SELECT id, name, permitted_features FROM departments WHERE name = 'Customer Service'`)).rows[0], { id: id8, name: 'Customer Service', permitted_features: ['cs-report'] }, 'rollback of 070 must not strip a 069-created department');
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
