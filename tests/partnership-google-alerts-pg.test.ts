import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';
const FEED = readFileSync('tests/fixtures/google-alerts-feed.xml', 'utf8');
const OLD = 'https://www.google.com/alerts/feeds/06080713324255246800/8125963208260089004';
const NEW = 'https://www.google.com/alerts/feeds/06080713324255246800/42';

test('migration 064: feeds carried over, managed on the Google Alerts page, fetched free into Media Monitoring mentions, rolled back', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `galerts_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id, username, name, password_hash, role) VALUES ('admin-1', 'admin', 'Admin', 'hash', 'admin');
    `);
    await client.query(readFileSync('db/migrations/063_partnership_media_monitoring.sql', 'utf8'));
    // A feed pasted in Media Monitoring settings before this change.
    await client.query(`UPDATE partnership_media_settings SET alert_feeds = ARRAY[$1]::text[] WHERE brand_key = 'dupoin'`, [OLD]);
    const up = readFileSync('db/migrations/064_partnership_google_alerts.sql', 'utf8');
    await client.query(up);
    await client.query(up);
    const carried = await client.query(`SELECT url, label FROM partnership_google_alert_feeds`);
    assert.deepEqual(carried.rows, [{ url: OLD, label: '' }]);

    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    const alerts = await import('../src/lib/partnership/google-alerts-store');
    const { fetchGoogleAlertsNow } = await import('../src/lib/partnership/google-alerts');
    const mediaStore = await import('../src/lib/partnership/media-store');
    const { runMediaRefresh } = await import('../src/lib/partnership/media-run');
    const { closeDb } = await import('../src/lib/database');
    try {
      // Add, label, validate, duplicate.
      const added = await alerts.addAlertFeed({ url: `${NEW}/`, label: '  Scam watch ', userId: 'admin-1' });
      assert.equal(added.url, NEW);
      assert.equal(added.label, 'Scam watch');
      await assert.rejects(alerts.addAlertFeed({ url: NEW, userId: 'admin-1' }), (error: unknown) => error instanceof alerts.AlertFeedError && error.status === 409);
      await assert.rejects(alerts.addAlertFeed({ url: 'https://example.com/rss', userId: 'admin-1' }), alerts.AlertFeedError);
      const oldId = alerts.alertFeedId(OLD);
      assert.equal((await alerts.updateAlertFeedLabel(oldId, 'Dupoin brand'))?.label, 'Dupoin brand');
      assert.deepEqual((await mediaStore.getMediaSettings()).alertFeeds, [OLD, NEW], 'settings.alert_feeds mirrors the feeds');

      // Fetch now: free, one broken feed reported, articles saved as Media Monitoring mentions and linked.
      const fetched: string[] = [];
      const summary = await fetchGoogleAlertsNow({ fetchText: async target => { fetched.push(target); if (target === NEW) throw new Error('HTTP 404'); return FEED; } });
      assert.deepEqual(fetched.sort(), [OLD, NEW].sort());
      assert.equal(summary.feeds, 2);
      assert.equal(summary.failed, 1);
      assert.equal(summary.inserted, 2);
      const feeds = await alerts.listAlertFeeds();
      const brand = feeds.find(feed => feed.id === oldId)!;
      assert.equal(brand.lastItemCount, 2);
      assert.equal(brand.feedTitle, 'dupoin');
      assert.equal(brand.articleCount, 2);
      assert.equal(feeds.find(feed => feed.url === NEW)!.lastError, 'HTTP 404');
      const articles = await alerts.listAlertArticles();
      assert.equal(articles.length, 2);
      assert.ok(articles.every(article => article.feedIds.includes(oldId)));
      assert.equal((await alerts.listAlertArticles({ feedId: added.id })).length, 0);

      // Second fetch: same URLs, nothing new (deduped).
      const again = await fetchGoogleAlertsNow({ fetchText: async () => FEED });
      assert.equal(again.inserted, 0);
      assert.equal((await alerts.listAlertArticles({ feedId: added.id })).length, 2, 'the same article can belong to two alerts');

      // Media Monitoring sees the same rows, and its free refresh reads the feeds table too.
      const range = { from: '2026-11-01', to: '2026-11-18' };
      const before = (await mediaStore.listMentionsInRange(range)).length;
      const runId = await mediaStore.createMediaRun({ trigger: 'scheduled', mode: 'free', platforms: [], userId: 'admin-1' });
      await runMediaRefresh(runId, {
        freeDeps: () => ({ now: () => new Date('2026-11-18T00:00:00Z'), fetchText: async target => (target.includes('alerts/feeds') ? FEED : '<rss></rss>'), fetchJson: async () => ({ articles: [] }), youtubeKey: null, sleep: async () => undefined }),
        complete: async () => ({ model: 'stub', content: '{"items":[]}' }),
      });
      const run = await mediaStore.getMediaRun(runId);
      assert.equal(run?.status, 'succeeded', run?.error ?? '');
      assert.equal(run?.stats?.google_alerts, 4);
      assert.equal(run?.stats?.inserted, 0);
      assert.equal((await mediaStore.listMentionsInRange(range)).length, before);
      assert.ok(run?.notes.includes('Google Alerts "Dupoin brand": 2 item(s).'));

      // Remove: links go, articles stay in Media Monitoring, settings mirror updated.
      assert.ok(await alerts.deleteAlertFeed(added.id));
      assert.equal(await alerts.deleteAlertFeed(added.id), false);
      assert.equal((await mediaStore.listMentionsInRange(range)).length, before);
      assert.deepEqual((await mediaStore.getMediaSettings()).alertFeeds, [OLD]);
    } finally {
      await closeDb();
    }

    await client.query(readFileSync('db/rollbacks/064_partnership_google_alerts_down.sql', 'utf8'));
    const left = await client.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('partnership_google_alert_feeds', 'partnership_media_mention_alerts')`, [schema]);
    assert.equal(left.rows[0].n, 0);
    const kept = await client.query(`SELECT alert_feeds FROM partnership_media_settings WHERE brand_key = 'dupoin'`);
    assert.deepEqual(kept.rows[0].alert_feeds, [OLD], 'feed URLs survive the rollback');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM partnership_media_mentions')).rows[0].n, 2, 'articles survive the rollback');
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
