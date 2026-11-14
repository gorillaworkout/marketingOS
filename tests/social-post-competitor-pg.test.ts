import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';

test('migration 053 applies and rolls back on PostgreSQL', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `social_competitor_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member'
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft'
      );
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id, username, name, password_hash) VALUES ('user-1', 'rina', 'Rina', 'hash');
      INSERT INTO tasks (id, user_id, type, title) VALUES ('task-1', 'user-1', 'social-post', 'Gold');
    `);
    const up = readFileSync('db/migrations/053_social_post_competitor_analyzer.sql', 'utf8');
    await client.query(up);
    await client.query(up);
    await client.query(`
      INSERT INTO competitor_references (id, competitor_name, source_url, pasted_text, analysis, created_by, updated_by)
      VALUES ('ref-1', 'Example', 'https://news.example/gold', 'A public article', '{"hookPattern":"question"}'::jsonb, 'user-1', 'user-1')
    `);
    await client.query(`
      INSERT INTO caption_analyses (id, user_id, task_id, platform, caption, result, model)
      VALUES ('analysis-1', 'user-1', 'task-1', 'Instagram', 'Trade clearly.', '{"score":80}'::jsonb, 'ag/gemini-3-flash')
    `);
    const stored = await client.query(`SELECT analysis->>'hookPattern' AS hook FROM competitor_references WHERE id = 'ref-1'`);
    assert.equal(stored.rows[0].hook, 'question');

    await client.query(`INSERT INTO schema_migrations (name) VALUES ('053_social_post_competitor_analyzer.sql')`);
    await client.query(readFileSync('db/rollbacks/053_social_post_competitor_analyzer_down.sql', 'utf8'));
    const competitors = await client.query(`SELECT to_regclass('competitor_references') AS name`);
    const analyses = await client.query(`SELECT to_regclass('caption_analyses') AS name`);
    const migration = await client.query(`SELECT name FROM schema_migrations WHERE name = '053_social_post_competitor_analyzer.sql'`);
    assert.equal(competitors.rows[0].name, null);
    assert.equal(analyses.rows[0].name, null);
    assert.equal(migration.rowCount, 0);
    const task = await client.query(`SELECT title FROM tasks WHERE id = 'task-1'`);
    assert.equal(task.rows[0].title, 'Gold');
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
