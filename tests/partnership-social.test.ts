import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleFromUrl, normalizeHandle, parseSocialHandles, socialProfileUrl, withInstagram } from '../src/lib/partnership/social';
import { alternateHost, discoverSocialAccounts, extractSocialCandidates, localePage, rankCandidates, redirectedHost, type DiscoveryDeps } from '../src/lib/partnership/social-discovery';
import { parseCompetitorInput } from '../src/lib/partnership/intel';

test('social links: profiles become handles; share/intent/post/generic links are ignored', () => {
  assert.deepEqual(handleFromUrl('https://www.instagram.com/mifx.indonesia/'), { platform: 'instagram', handle: 'mifx.indonesia' });
  assert.deepEqual(handleFromUrl('https://www.tiktok.com/@mifx.indonesia?lang=en'), { platform: 'tiktok', handle: 'mifx.indonesia' });
  assert.deepEqual(handleFromUrl('https://twitter.com/valbury_futures'), { platform: 'x', handle: 'valbury_futures' });
  assert.deepEqual(handleFromUrl('https://t.me/finexberjangka'), { platform: 'telegram', handle: 'finexberjangka' });
  assert.deepEqual(handleFromUrl('https://www.youtube.com/user/MifxChannel'), { platform: 'youtube', handle: 'user/MifxChannel' });
  assert.deepEqual(handleFromUrl('https://www.youtube.com/@XTBIndonesia'), { platform: 'youtube', handle: '@XTBIndonesia' });
  assert.deepEqual(handleFromUrl('https://id.linkedin.com/company/pt-mifx/'), { platform: 'linkedin', handle: 'company/pt-mifx' });
  assert.deepEqual(handleFromUrl('https://www.facebook.com/valburyfuturesofficial'), { platform: 'facebook', handle: 'valburyfuturesofficial' });
  for (const url of [
    'https://www.facebook.com/sharer/sharer.php?u=https://mifx.com', 'https://twitter.com/intent/tweet?text=x', 'https://x.com/share?url=a',
    'https://www.linkedin.com/shareArticle?url=a', 'https://t.me/share/url?url=a', 'https://www.instagram.com/p/ABC123/',
    'https://www.youtube.com/watch?v=abc', 'https://www.tiktok.com/tag/forex', 'https://www.instagram.com/', 'https://example.com/instagram',
  ]) assert.equal(handleFromUrl(url), null, url);
});

test('social handles: typed values normalize per platform; junk is rejected', () => {
  assert.equal(normalizeHandle('instagram', '@xtb_id'), 'xtb_id');
  assert.equal(normalizeHandle('instagram', 'https://instagram.com/xtb_id'), 'xtb_id');
  assert.equal(normalizeHandle('instagram', 'https://www.tiktok.com/@xtb_id'), null);
  assert.equal(normalizeHandle('youtube', 'UC-l61LxjsphAAjnoQwGTV6Q'), 'channel/UC-l61LxjsphAAjnoQwGTV6Q');
  assert.equal(normalizeHandle('youtube', 'MIFX'), '@MIFX');
  assert.equal(normalizeHandle('linkedin', 'pt-mifx'), 'company/pt-mifx');
  assert.equal(normalizeHandle('facebook', 'profile.php?id=100064563920348'), 'profile.php?id=100064563920348');
  assert.equal(normalizeHandle('x', 'this handle is too long'), null);
  assert.equal(normalizeHandle('telegram', ''), '');
  assert.equal(socialProfileUrl('youtube', 'user/MifxChannel'), 'https://www.youtube.com/user/MifxChannel');
  assert.deepEqual(withInstagram(parseSocialHandles({ tiktok: 'a', bogus: 'b', x: 7 }), 'ig_handle'), { tiktok: 'a', instagram: 'ig_handle' });
});

test('competitor input: socialHandles per platform; old instagramHandle still accepted; invalid handle named', () => {
  const both = parseCompetitorInput({ name: 'MIFX', region: 'local', socialHandles: { instagram: '@mifx.indonesia', youtube: 'https://www.youtube.com/user/MifxChannel', linkedin: 'company/pt-mifx', x: '' } });
  assert.ok('value' in both);
  assert.deepEqual(both.value.socialHandles, { instagram: 'mifx.indonesia', youtube: 'user/MifxChannel', linkedin: 'company/pt-mifx' });
  assert.equal(both.value.instagramHandle, 'mifx.indonesia');
  const legacy = parseCompetitorInput({ name: 'XTB', region: 'international', instagramHandle: '@xtb_id' });
  assert.ok('value' in legacy && legacy.value.socialHandles.instagram === 'xtb_id');
  const bad = parseCompetitorInput({ name: 'X', region: 'local', socialHandles: { tiktok: 'not a handle!' } });
  assert.ok('error' in bad && /TikTok/.test(bad.error));
});

const html = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;
function site(pages: Record<string, { status?: number; body: string; url?: string }>): DiscoveryDeps['fetchPublic'] {
  return async url => {
    const page = pages[url];
    return page ? { url: page.url || url, status: page.status ?? 200, body: page.body } : { url, status: 404, body: '' };
  };
}

test('discovery: visible footer links beat stale schema sameAs; the legacy account stays an alternative', async () => {
  const body = html(`<script type="application/ld+json">{"@type":"Organization","sameAs":["https://www.instagram.com/foreximf/"]}</script>
    <footer><a href="https://www.instagram.com/quickpro_official/">IG</a><a href="https://x.com/myquickpro">X</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a></footer>`);
  const result = await discoverSocialAccounts({ name: 'Forex IMF', website: 'https://www.foreximf.com/' }, {
    fetchPublic: site({ 'https://www.foreximf.com/': { body, url: 'https://quickpro.co.id/' } }),
  });
  const ig = result.suggestions.find(item => item.platform === 'instagram');
  assert.equal(ig?.handle, 'quickpro_official');
  assert.deepEqual(ig?.alternatives.map(alt => alt.handle), ['foreximf']);
  assert.equal(ig?.sourceUrl, 'https://quickpro.co.id/');
  assert.equal(result.suggestions.find(item => item.platform === 'x')?.handle, 'myquickpro');
  assert.ok(!result.suggestions.some(item => item.platform === 'facebook'));
  assert.ok(result.notes.some(note => /redirects to quickpro\.co\.id/.test(note)));
});

test('discovery: Indonesian /id/ page accounts rank first (Valetax), global ones become alternatives', async () => {
  const result = await discoverSocialAccounts({ name: 'Valetax', website: 'https://valetax.com/' }, {
    fetchPublic: site({
      'https://valetax.com/': { body: html('<a href="https://www.instagram.com/valetax.official">ig</a><a href="https://facebook.com/valetaxtrading">fb</a>') },
      'https://valetax.com/id/': { body: html('<a href="https://www.instagram.com/valetax.indonesia">ig</a><a href="https://facebook.com/valetax.indonesian">fb</a>') },
    }),
  });
  const ig = result.suggestions.find(item => item.platform === 'instagram');
  assert.equal(ig?.handle, 'valetax.indonesia');
  assert.equal(ig?.sourceUrl, 'https://valetax.com/id/');
  assert.deepEqual(ig?.alternatives.map(alt => alt.handle), ['valetax.official']);
  assert.equal(result.suggestions.find(item => item.platform === 'facebook')?.handle, 'valetax.indonesian');
});

test('discovery: llms.txt is read even when the homepage refuses bots (Exness)', async () => {
  const result = await discoverSocialAccounts({ name: 'Exness', website: 'https://www.exness.com/' }, {
    fetchPublic: site({
      'https://www.exness.com/': { status: 403, body: '' },
      'https://exness.com/': { status: 403, body: '' },
      'https://www.exness.com/llms.txt': { body: '# Exness\n- Instagram: https://www.instagram.com/exness/\n- X: https://x.com/exness\n- LinkedIn: https://www.linkedin.com/company/exness/' },
    }),
  });
  assert.deepEqual(result.suggestions.map(item => [item.platform, item.handle]).sort(), [['instagram', 'exness'], ['linkedin', 'company/exness'], ['x', 'exness']]);
  assert.ok(result.suggestions.every(item => item.sourceUrl === 'https://www.exness.com/llms.txt'));
  assert.ok(result.notes.some(note => /HTTP 403/.test(note)));
});

test('discovery: www refused, apex works (MIFX); contact page is read; YouTube c/ and @ forms merge', async () => {
  const home = html(`<a href="/contact-us">Contact</a><a href="https://www.instagram.com/mifx.indonesia/">ig</a>
    <a href="https://www.youtube.com/c/MIFX">yt</a><a href="https://www.youtube.com/@MIFX">yt</a>`);
  const result = await discoverSocialAccounts({ name: 'MIFX', website: 'https://www.mifx.com/' }, {
    fetchPublic: site({
      'https://www.mifx.com/': { status: 403, body: '' },
      'https://mifx.com/': { body: home },
      'https://mifx.com/contact-us': { body: html('<a href="https://www.tiktok.com/@mifx.indonesia">tt</a><a href="https://www.linkedin.com/company/pt-mifx">in</a>') },
    }),
  });
  const map = Object.fromEntries(result.suggestions.map(item => [item.platform, item.handle]));
  assert.deepEqual(map, { instagram: 'mifx.indonesia', youtube: '@MIFX', tiktok: 'mifx.indonesia', linkedin: 'company/pt-mifx' });
  assert.equal(result.suggestions.find(item => item.platform === 'youtube')?.alternatives.length, 0);
  assert.ok(result.pagesRead.includes('https://mifx.com/contact-us'));
  assert.ok(result.notes.some(note => /SERPER_API_KEY is not configured/.test(note)));
});

test('discovery: web-search fallback only for missing platforms and only when the result names the competitor', async () => {
  const queries: string[] = [];
  const result = await discoverSocialAccounts({ name: 'Elve', website: null }, {
    fetchPublic: site({}),
    searchWeb: async query => {
      queries.push(query);
      if (query.includes('instagram.com')) return [{ title: 'Elve Futures (@elve.id) • Instagram', url: 'https://www.instagram.com/elve.id/', snippet: '' }];
      if (query.includes('tiktok.com')) return [{ title: 'Some other broker', url: 'https://www.tiktok.com/@other', snippet: 'forex' }];
      return [];
    },
  });
  assert.equal(queries.length, 5);
  assert.deepEqual(result.suggestions.map(item => [item.platform, item.handle, item.via]), [['instagram', 'elve.id', 'web-search']]);
  assert.ok(result.notes.some(note => /No website on file/.test(note)));
});

test('discovery helpers: alternate host, redirect, locale page, extraction weights, ranking', () => {
  assert.equal(alternateHost('https://www.mifx.com/'), 'https://mifx.com/');
  assert.equal(alternateHost('https://mifx.com/'), 'https://www.mifx.com/');
  assert.equal(redirectedHost('https://www.foreximf.com/', 'https://www.foreximf.com/home'), null);
  assert.equal(redirectedHost('https://www.foreximf.com/', 'https://quickpro.co.id/'), 'quickpro.co.id');
  assert.equal(localePage('https://valetax.com/'), 'https://valetax.com/id/');
  assert.equal(localePage('https://www.xtb.com/id'), null);
  const found = extractSocialCandidates(html('<a href="https://instagram.com/a_b">x</a><script>var u="https://instagram.com/c_d"</script>'), 'https://s.example/');
  assert.deepEqual(found.map(item => [item.handle, item.weight]), [['a_b', 2], ['c_d', 1]]);
  assert.equal(rankCandidates(found)[0].handle, 'a_b');
});

test('migration 062: per-platform social handles, backfilled from instagram_handle, with a rollback', () => {
  const up = readFileSync('db/migrations/062_partnership_competitor_social_handles.sql', 'utf8');
  assert.match(up, /ADD COLUMN IF NOT EXISTS social_handles JSONB NOT NULL DEFAULT '\{\}'/i);
  assert.match(up, /instagram_handle/);
  // scripts/migrate.ts runs files through execute(), which turns every ? into a $n placeholder.
  assert.doesNotMatch(up.replace(/--.*$/gm, ''), /\?/);
  const down = readFileSync('db/rollbacks/062_partnership_competitor_social_handles_down.sql', 'utf8');
  assert.match(down, /DROP COLUMN IF EXISTS social_handles/i);
});
