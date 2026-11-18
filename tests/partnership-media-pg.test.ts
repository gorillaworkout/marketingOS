import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';
const FEED = readFileSync('tests/fixtures/google-alerts-feed.xml', 'utf8');

test('migration 063 applies twice, a scheduled refresh stores deduped mentions free-only, and rolls back on PostgreSQL', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `media_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id, username, name, password_hash, role) VALUES ('admin-1', 'admin', 'Admin', 'hash', 'admin');
    `);
    const up = readFileSync('db/migrations/063_partnership_media_monitoring.sql', 'utf8');
    await client.query(up);
    await client.query(up);
    const seeded = await client.query(`SELECT brand_name, keywords, alert_feeds, official_handles FROM partnership_media_settings`);
    assert.equal(seeded.rows.length, 1);
    assert.deepEqual(seeded.rows[0].keywords, ['Dupoin', 'Dupoin Futures']);
    assert.deepEqual(seeded.rows[0].alert_feeds, []);
    assert.deepEqual(seeded.rows[0].official_handles, {});

    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    const store = await import('../src/lib/partnership/media-store');
    const { runMediaRefresh } = await import('../src/lib/partnership/media-run');
    const { normalizeMediaSettings } = await import('../src/lib/partnership/media');
    const { closeDb } = await import('../src/lib/database');
    try {
      const current = await store.getMediaSettings();
      await store.saveMediaSettings(normalizeMediaSettings({ alertFeeds: ['https://www.google.com/alerts/feeds/1/2'], officialHandles: { website: 'https://news.example.co.id' } }, current).settings, 'admin-1');
      // Migration 064 (Google Alerts page) carries the feed above into partnership_google_alert_feeds.
      const up064 = readFileSync('db/migrations/064_partnership_google_alerts.sql', 'utf8');
      await client.query(up064);
      await client.query(up064);

      const id = await store.createMediaRun({ trigger: 'scheduled', mode: 'free', platforms: [], userId: 'admin-1' });
      await assert.rejects(store.createMediaRun({ trigger: 'manual', mode: 'free', platforms: [], userId: 'admin-1' }), store.MediaRunInProgressError);
      let extraCalled = false;
      const freeDeps = () => ({
        now: () => new Date('2026-11-18T00:00:00Z'),
        fetchText: async (target: string) => (target.includes('alerts/feeds') ? FEED : `<rss><item><title>Dupoin edukasi - News</title><link>https://www.news.example.co.id/ekonomi/dupoin-edukasi/</link><pubDate>Mon, 16 Nov 2026 03:00:00 GMT</pubDate><source url="x">News</source></item></rss>`),
        fetchJson: async () => ({ articles: [] }),
        youtubeKey: null,
        sleep: async () => undefined,
      });
      await runMediaRefresh(id, {
        freeDeps,
        // A scheduled run must ignore an extra (paid) collector even if one were passed.
        extraCollector: async () => { extraCalled = true; return { mentions: [], notes: [] }; },
        complete: async (_system, user) => ({ model: 'stub', content: JSON.stringify({ items: user.split('\n').map(line => ({ id: line.split(' | ')[0], sentiment: 'positive', reason: 'education' })) }) }),
      });
      assert.equal(extraCalled, false);
      const run = await store.getMediaRun(id);
      assert.equal(run?.status, 'succeeded', run?.error ?? '');
      assert.ok(run?.notes.includes('Paid sources ignored: scheduled refreshes are free-only.'));
      const mentions = await store.listMentionsInRange({ from: '2026-11-01', to: '2026-11-18' });
      // Alert item + Google News item for the same article collapse into one (www, utm, trailing slash).
      assert.equal(mentions.length, 2);
      const edukasi = mentions.find(mention => mention.url.includes('dupoin-edukasi'))!;
      assert.equal(edukasi.isOfficial, true);
      assert.equal(edukasi.sentiment, 'positive');

      // Second refresh: same URLs update, nothing new.
      const id2 = await store.createMediaRun({ trigger: 'manual', mode: 'free', platforms: [], userId: 'admin-1' });
      await runMediaRefresh(id2, { freeDeps, complete: async () => ({ model: 'stub', content: '{"items":[]}' }) });
      assert.equal((await store.getMediaRun(id2))?.stats?.inserted, 0);
      assert.equal((await store.listMentionsInRange({ from: '2026-11-01', to: '2026-11-18' })).length, 2);
      assert.ok(await store.setMentionSentiment(edukasi.id, 'neutral'));

      await store.saveMediaInsights({ from: '2026-11-01', to: '2026-11-18' }, { executiveSummary: 'S' } as never, 'stub', 'admin-1');
      assert.equal((await store.latestMediaInsights({ from: '2026-11-01', to: '2026-11-18' }))?.result.executiveSummary, 'S');
    } finally {
      await closeDb();
    }

    await client.query(readFileSync('db/rollbacks/064_partnership_google_alerts_down.sql', 'utf8'));
    await client.query(readFileSync('db/rollbacks/063_partnership_media_monitoring_down.sql', 'utf8'));
    const left = await client.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'partnership_media_%'`, [schema]);
    assert.equal(left.rows[0].n, 0);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
