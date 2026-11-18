import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';

test('migration 067 + insights on PostgreSQL: paid vs organic join, search term suggestions, alert upsert/snooze/resolve, rollback', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `gads_ins_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member');
      CREATE TABLE departments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, permitted_features TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT departments_permitted_features_valid CHECK (permitted_features <@ ARRAY['social-post','seo','partnership']::TEXT[])
      );
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      CREATE TABLE seo_sites (id TEXT PRIMARY KEY, name TEXT NOT NULL, site_url TEXT NOT NULL, gsc_property TEXT, active BOOLEAN NOT NULL DEFAULT TRUE, last_synced_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE seo_gsc_daily (site_id TEXT, date DATE, query TEXT, page TEXT, clicks INT, impressions INT, ctr DOUBLE PRECISION, position DOUBLE PRECISION);
      CREATE TABLE seo_gsc_site_daily (site_id TEXT, date DATE, clicks INT, impressions INT);
      CREATE TABLE seo_gsc_monthly (site_id TEXT, month DATE, query TEXT, page TEXT, clicks INT, impressions INT, position DOUBLE PRECISION);
      CREATE TABLE seo_gsc_rollup_months (site_id TEXT, month DATE, first_date DATE, last_date DATE);
      INSERT INTO users (id, username, name, password_hash, role) VALUES ('u1', 'paid', 'Paid Media', 'hash', 'member');
    `);
    await client.query(readFileSync('db/migrations/066_paid_media_google_ads.sql', 'utf8'));
    const up = readFileSync('db/migrations/067_google_ads_alerts.sql', 'utf8');
    await client.query(up);
    await client.query(up);

    // Google Ads data: campaign 10 is steady, then spends 3x in the last 7 days; campaign 11 stops.
    await client.query(`INSERT INTO google_ads_accounts (customer_id, descriptive_name, currency_code, time_zone, status) VALUES ('4445551145', 'Dupoin-ID1', 'IDR', 'Asia/Jakarta', 'ENABLED')`);
    const asOf = '2026-11-17';
    await client.query(`
      INSERT INTO google_ads_campaign_daily (customer_id, date, campaign_id, campaign_name, campaign_status, channel_type, impressions, clicks, cost_micros, conversions)
      SELECT '4445551145', d::DATE, '10', 'Brand', 'ENABLED', 'SEARCH', 4000, CASE WHEN d >= DATE '2026-11-11' THEN 600 ELSE 200 END,
        CASE WHEN d >= DATE '2026-11-11' THEN 3000000000000 ELSE 1000000000000 END, 5
      FROM generate_series(DATE '2026-10-14', DATE '${asOf}', INTERVAL '1 day') d;
      INSERT INTO google_ads_campaign_daily (customer_id, date, campaign_id, campaign_name, campaign_status, channel_type, impressions, clicks, cost_micros, conversions)
      SELECT '4445551145', d::DATE, '11', 'Generic', 'ENABLED', 'SEARCH', 1000, 50, 500000000000, 0
      FROM generate_series(DATE '2026-10-14', DATE '2026-11-15', INTERVAL '1 day') d;
      INSERT INTO google_ads_search_term_daily (customer_id, date, ad_group_id, search_term, match_type, campaign_id, term_status, impressions, clicks, cost_micros, conversions) VALUES
        ('4445551145', '2026-11-10', '20', 'Dupoin', 'EXACT', '10', 'NONE', 100, 30, 120000000000, 0),
        ('4445551145', '2026-11-12', '20', 'dupoin  ', 'PHRASE', '10', 'NONE', 50, 10, 30000000000, 0),
        ('4445551145', '2026-11-12', '20', 'cara trading emas', 'BROAD', '10', 'NONE', 80, 20, 80000000000, 3),
        ('4445551145', '2026-11-12', '21', 'slot gacor', 'BROAD', '11', 'NONE', 80, 25, 250000000000, 0);
      INSERT INTO google_ads_keyword_daily (customer_id, date, ad_group_id, criterion_id, campaign_id, keyword_text, match_type, criterion_status, clicks, cost_micros) VALUES
        ('4445551145', '2026-11-12', '20', '30', '10', 'dupoin', 'EXACT', 'ENABLED', 40, 150000000000);
    `);

    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    const paidOrganic = await import('../src/lib/google-ads/paid-organic');
    const insights = await import('../src/lib/google-ads/search-term-insights');
    const alerts = await import('../src/lib/google-ads/alerts');
    const { exportInsightCsv } = await import('../src/lib/google-ads/insights-export');
    const { closeDb } = await import('../src/lib/database');
    try {
      const range = { start: '2026-11-01', end: '2026-11-17', account: 'all', source: null };
      // No Dupoin site yet: clear message, no flags.
      const missing = await paidOrganic.getPaidOrganicReport(range);
      assert.equal(missing.gsc.available, false);
      assert.match(missing.gsc.message ?? '', /not set up in SEO OS/);
      assert.ok(missing.rows.every(row => !row.flags.length && !row.organic));

      await client.query(`
        INSERT INTO seo_sites (id, name, site_url, gsc_property) VALUES ('s1', 'Dupoin', 'https://dupoin.co.id/', 'sc-domain:dupoin.co.id');
        INSERT INTO seo_gsc_site_daily VALUES ('s1', '2026-11-01', 1, 1), ('s1', '2026-11-15', 1, 1);
        INSERT INTO seo_gsc_daily VALUES
          ('s1', '2026-11-03', 'dupoin', '/', 400, 1000, 0.4, 1.2),
          ('s1', '2026-11-04', 'DUPOIN', '/login', 100, 1000, 0.1, 1.8),
          ('s1', '2026-11-04', 'cara trading emas', '/blog', 1, 100, 0.01, 24),
          ('s1', '2026-10-01', 'slot gacor', '/', 999, 1000, 0.9, 1);
      `);
      const report = await paidOrganic.getPaidOrganicReport(range);
      assert.equal(report.gsc.available, true);
      assert.deepEqual([report.gsc.dataFrom, report.gsc.dataThrough], ['2026-11-01', '2026-11-15']);
      const dupoin = report.rows.find(row => row.term === 'dupoin')!;
      assert.deepEqual(dupoin.organic, { clicks: 500, impressions: 2000, ctr: 0.25, position: 1.5 }, 'impression-weighted position across pages and casing');
      assert.deepEqual(dupoin.flags, ['organic-top3-paying']);
      assert.equal(dupoin.paid.cost, 150_000);
      assert.deepEqual(report.rows.find(row => row.term === 'cara trading emas')!.flags, ['seo-opportunity']);
      assert.equal(report.rows.find(row => row.term === 'slot gacor')!.organic, null, 'GSC rows outside the range do not count');
      assert.equal(report.summary.potentialSavings, 150_000);
      const keywordSide = await paidOrganic.getPaidOrganicReport({ ...range, source: 'keywords' });
      assert.deepEqual(keywordSide.rows.map(row => row.term), ['dupoin']);

      const terms = await insights.getSearchTermInsights({ ...range, minCost: '100000', minConversions: null });
      assert.deepEqual(terms.negatives.map(row => [row.campaignName, row.term, row.cost]), [['Generic', 'slot gacor', 250_000], ['Brand', 'dupoin', 150_000]]);
      assert.equal(terms.wastedSpend, 400_000);
      assert.deepEqual(terms.candidates.map(row => row.term), ['cara trading emas'], '"dupoin" is already a keyword');
      const csv = await exportInsightCsv('negatives', new URLSearchParams({ start: range.start, end: range.end, account: 'all', minCost: '100000' }));
      assert.match(csv.csv, /^Account,Customer ID,Campaign,Search term/);
      assert.match(csv.csv, /Dupoin-ID1,4445551145,Generic,slot gacor,BROAD,1,250000,25,80,0/);

      // Alerts: spend spike + CPC rise on Brand and the account, spend stopped on Generic.
      const first = await alerts.evaluateGoogleAdsAlerts(asOf);
      const open = await alerts.listAlerts({ status: 'open', customerId: null });
      const keyOf = (row: { campaignId: string; kind: string }) => `${row.campaignId || 'account'}:${row.kind}`;
      assert.deepEqual(open.map(keyOf).sort(), ['10:cpa_rise', '10:spend_spike', '11:spend_stopped', 'account:cpa_rise', 'account:spend_spike']);
      assert.deepEqual(first, { asOf, detected: 5, opened: 5, refreshed: 0, snoozed: 0, resolved: 0 });
      assert.deepEqual(await alerts.openAlertCounts(), { open: 5, critical: 5 });
      assert.equal(open[0].severity, 'critical');
      assert.equal(open.find(row => row.kind === 'spend_stopped')!.campaignName, 'Generic');

      // Same day again: refreshed, not duplicated.
      assert.deepEqual(await alerts.evaluateGoogleAdsAlerts(asOf), { asOf, detected: 5, opened: 0, refreshed: 5, snoozed: 0, resolved: 0 });
      // Acknowledge one, dismiss one: they stay quiet (snoozed) while the condition repeats.
      const spike = open.find(row => row.campaignId === '10' && row.kind === 'spend_spike')!;
      const stopped = open.find(row => row.kind === 'spend_stopped')!;
      assert.equal(await alerts.setAlertStatus(spike.id, 'acknowledge', 'u1'), 'acknowledged');
      assert.equal(await alerts.setAlertStatus(stopped.id, 'dismiss', 'u1'), 'dismissed');
      await assert.rejects(alerts.setAlertStatus(spike.id, 'delete', 'u1'), /acknowledge, dismiss, or reopen/);
      await assert.rejects(alerts.setAlertStatus('missing', 'dismiss', 'u1'), /not found/);
      assert.deepEqual(await alerts.evaluateGoogleAdsAlerts(asOf), { asOf, detected: 5, opened: 0, refreshed: 3, snoozed: 2, resolved: 0 });
      assert.equal((await alerts.openAlertCounts()).open, 3);
      const history = await alerts.listAlerts({ status: 'all', customerId: '4445551145' });
      assert.equal(history.find(row => row.id === spike.id)!.statusBy, 'Paid Media');

      // Spend back to normal for Brand: its open CPA alert and the account alerts resolve.
      await client.query(`UPDATE google_ads_campaign_daily SET cost_micros = 1000000000000, clicks = 200 WHERE campaign_id = '10'`);
      const calm = await alerts.evaluateGoogleAdsAlerts(asOf);
      assert.equal(calm.resolved, 3);
      assert.equal((await alerts.openAlertCounts()).open, 0);
      // After the snooze window a repeating dismissed condition opens a new alert.
      await client.query(`UPDATE google_ads_alerts SET last_seen_date = '2026-11-01' WHERE id = $1`, [stopped.id]);
      const reopened = await alerts.evaluateGoogleAdsAlerts(asOf);
      assert.equal(reopened.opened, 1, 'stale dismissal does not hide the alert forever');
      // Reopen conflicts when a newer open alert exists for the same scope and kind.
      await assert.rejects(alerts.setAlertStatus(stopped.id, 'reopen', 'u1'), /newer open alert/);
      await assert.rejects(client.query(`INSERT INTO google_ads_alerts (id, customer_id, campaign_id, kind, severity, first_seen_date, last_seen_date, message) VALUES ('dup', '4445551145', '11', 'spend_stopped', 'warning', '${asOf}', '${asOf}', 'x')`), 'one open alert per scope and kind');
    } finally {
      await closeDb();
    }

    await client.query(`INSERT INTO schema_migrations (name) VALUES ('067_google_ads_alerts.sql')`);
    await client.query(readFileSync('db/rollbacks/067_google_ads_alerts_down.sql', 'utf8'));
    assert.equal((await client.query(`SELECT to_regclass('google_ads_alerts') AS t`)).rows[0].t, null);
    assert.notEqual((await client.query(`SELECT to_regclass('google_ads_campaign_daily') AS t`)).rows[0].t, null, '066 tables stay');
    assert.equal((await client.query(`SELECT 1 FROM schema_migrations WHERE name = '067_google_ads_alerts.sql'`)).rowCount, 0);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await client.end();
  }
});
