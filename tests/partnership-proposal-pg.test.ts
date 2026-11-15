import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';

test('migration 058 applies twice, stores proposals with versions and settings, and rolls back on PostgreSQL', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `proposal_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id, username, name, password_hash) VALUES ('user-1', 'rina', 'Rina', 'hash');
      INSERT INTO schema_migrations (name) VALUES ('058_partnership_proposals.sql');
    `);
    const up = readFileSync('db/migrations/058_partnership_proposals.sql', 'utf8');
    await client.query(up);
    await client.query(up);

    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    const store = await import('../src/lib/partnership/proposal-store');
    const { closeDb } = await import('../src/lib/database');
    const { parseProposalInput, templateContent } = await import('../src/lib/partnership/proposal');
    const { DEFAULT_PROPOSAL_SETTINGS } = await import('../src/lib/partnership/proposal-settings');
    try {
      const parsed = parseProposalInput({ partnerName: 'Kopi Kenangan', exposures: [{ itemId: 'home-banner', units: 1 }], template: 'document' }, DEFAULT_PROPOSAL_SETTINGS);
      assert.ok('value' in parsed);
      const content = templateContent(parsed.value);
      const id = await store.createProposal({ input: parsed.value, content, partnerLogo: null, status: 'draft', model: 'stub', note: 'AI draft' }, 'user-1');
      const version = await store.updateProposal(id, { input: parsed.value, content: { ...content, projectOverview: 'Edited overview' }, partnerLogo: null, status: 'final', note: 'Marked final' }, 'user-1');
      assert.equal(version, 2);
      const saved = await store.getProposal(id);
      assert.equal(saved?.content.projectOverview, 'Edited overview');
      assert.equal(saved?.status, 'final');
      assert.equal(saved?.model, 'stub');
      assert.equal(saved?.packageTotal, 50_000_000);
      const list = await store.listProposals();
      assert.deepEqual(list.map(item => [item.partnerName, item.version, item.createdByName]), [['Kopi Kenangan', 2, 'Rina']]);
      const versions = await store.listVersions(id);
      assert.deepEqual(versions.map(item => [item.version, item.note]), [[2, 'Marked final'], [1, 'AI draft']]);
      const first = await store.getVersion(id, versions[1].id);
      assert.equal(first?.content.projectOverview, content.projectOverview);
      assert.equal(await store.updateProposal('missing', { input: parsed.value, content, partnerLogo: null, status: 'draft', note: '' }, 'user-1'), null);

      assert.deepEqual((await store.getProposalSettings()).settings, DEFAULT_PROPOSAL_SETTINGS);
      await store.saveProposalSettings({ ...DEFAULT_PROPOSAL_SETTINGS, productCount: '80+' }, 'user-1');
      const changed = await store.getProposalSettings();
      assert.equal(changed.settings.productCount, '80+');
      assert.equal(changed.updatedByName, 'Rina');
      await store.resetProposalSettings();
      assert.equal((await store.getProposalSettings()).settings.productCount, '70+');

      await store.deleteProposal(id);
      assert.equal((await store.listVersions(id)).length, 0);
    } finally {
      await closeDb();
    }

    await client.query(readFileSync('db/rollbacks/058_partnership_proposals_down.sql', 'utf8'));
    const left = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'partnership_%'`, [schema]);
    assert.equal(left.rowCount, 0);
    assert.equal((await client.query(`SELECT 1 FROM schema_migrations WHERE name = '058_partnership_proposals.sql'`)).rowCount, 0);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
