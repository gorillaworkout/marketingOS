import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { COUNT_FIELDS } from '../src/lib/cs-report/fields';
import { buildSyntheticWorkbook } from './fixtures/cs-report-workbook';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';

test('migration 069 + CS Report store on PostgreSQL: upsert, complaints, bulk upload dedupe, name linking, dashboard, rollback', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
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
