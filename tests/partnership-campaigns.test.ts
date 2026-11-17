import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CAMPAIGN_DEFINITION, canonicalInstagramPostUrl, dateFromExtractedText, extractHashtags, findBrandHubs, instagramEmbedUrl, instagramPostText, isInstagramPostUrl,
  parseCampaignSections, parseInstagramEmbed, parseInstagramPostPage, parseTregInstagramPosts, parseZendeskArticles, registrableDomain, zendeskArticlesUrl,
} from '../src/lib/partnership/campaigns';
import { activityWindow, buildIntelPrompt, buildSourceCatalog, type IntelSource } from '../src/lib/partnership/intel';

const WINDOW = activityWindow(new Date('2026-11-17T03:00:00Z'));
const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, 'utf8');

test('hashtags: unique, in order, unicode-safe, no pure numbers or URL fragments', () => {
  assert.deepEqual(extractHashtags('Bersama, #PastiAdaJalan 💚 #pastiadajalan #2026 #GoJek https://x.y/#anchor'), ['#PastiAdaJalan', '#GoJek']);
  assert.deepEqual(extractHashtags(null), []);
});

test('Instagram post URLs: /p/, /reel/, and /<user>/reel/ canonicalize to /p/<code>/', () => {
  assert.equal(isInstagramPostUrl('https://www.instagram.com/p/DfMeFXkyIcy/?hl=en'), true);
  assert.equal(isInstagramPostUrl('https://www.instagram.com/gojekindonesia/'), false);
  assert.equal(canonicalInstagramPostUrl('https://www.instagram.com/gojekindonesia/reel/DfMeFXkyIcy/'), 'https://www.instagram.com/p/DfMeFXkyIcy/');
  assert.equal(instagramEmbedUrl('https://instagram.com/reel/DfMeFXkyIcy'), 'https://www.instagram.com/p/DfMeFXkyIcy/embed/captioned/');
});

test('public post page preview tags give caption, account, date and #PastiAdaJalan (Gojek example)', () => {
  const post = parseInstagramPostPage('https://www.instagram.com/p/DfMeFXkyIcy/?hl=en', fixture('partnership-ig-gojek-post.html'));
  assert.ok(post);
  assert.equal(post.account, 'gojekindonesia');
  assert.equal(post.date, '2026-11-01');
  assert.match(post.caption, /^Batik adalah warisan budaya/);
  assert.deepEqual(post.hashtags, ['#PastiAdaJalan']);
  assert.deepEqual(post.mentions, ['@harimerdeka', '@telusurkultur']);
  const textOut = instagramPostText(post);
  assert.match(textOut, /^Instagram post by @gojekindonesia on 2026-11-01/);
  assert.equal(dateFromExtractedText(textOut), '2026-11-01');
  assert.equal(parseInstagramPostPage('https://www.instagram.com/p/X/', '<html><head><title>Instagram</title></head></html>'), null, 'login wall -> null');
});

test('embed fallback reads the caption block', () => {
  const html = '<div class="Caption"><a class="CaptionUsername">mifx.indonesia</a> Satu Ruang untuk Segala Keistimewaan Anda.<br>#mifx<div class="CaptionComments">View all 1 comments</div></div>';
  const post = parseInstagramEmbed('https://www.instagram.com/p/DdjHlscH-Ac/', html);
  assert.equal(post?.account, 'mifx.indonesia');
  assert.equal(post?.caption, 'Satu Ruang untuk Segala Keistimewaan Anda.\n#mifx');
});

test('brand hubs: sibling subdomains linked from the site; client, careers and login hosts skipped', () => {
  assert.equal(registrableDomain('www.mifx.com'), 'mifx.com');
  assert.equal(registrableDomain('promo.broker.co.id'), 'broker.co.id');
  const html = ['https://client.mifx.com/open-live-account', 'https://support.mifx.com/hc/id', 'https://careers.mifx.com', 'https://get.mifx.com/mifx-priority', 'https://mifx.com/about', 'https://other.com/x']
    .map(url => `<a href="${url}">x</a>`).join('');
  assert.deepEqual(findBrandHubs([{ url: 'https://mifx.com/', html }], 'https://mifx.com/'), [
    { kind: 'help-center', url: 'https://support.mifx.com/hc/id' },
    { kind: 'landing', url: 'https://get.mifx.com/mifx-priority' },
  ]);
  assert.equal(zendeskArticlesUrl('https://support.mifx.com/hc/id'), 'https://support.mifx.com/api/v2/help_center/id/articles.json?sort_by=created_at&sort_order=desc&per_page=50');
});

test('help-center articles: new ones in the window and program-like ones updated in the window; old FAQs dropped', () => {
  const articles = parseZendeskArticles(JSON.stringify({ articles: [
    { title: 'MIFX Priority Hub', html_url: 'https://support.mifx.com/hc/id/articles/1-MIFX-Priority-Hub', created_at: '2026-09-11T03:00:00Z', updated_at: '2026-11-16T01:00:00Z', body: '<p>Fitur khusus untuk <b>Priority Client</b>.</p>' },
    { title: 'MIFX Priority', html_url: 'https://support.mifx.com/hc/id/articles/2-MIFX-Priority', created_at: '2025-10-27T03:00:00Z', updated_at: '2026-11-16T01:00:00Z', body: '' },
    { title: 'Bagaimana Cara Log in?', html_url: 'https://support.mifx.com/hc/id/articles/3', created_at: '2021-05-11T03:00:00Z', updated_at: '2026-11-16T01:00:00Z', body: '' },
  ] }), WINDOW);
  assert.deepEqual(articles.map(item => item.title), ['MIFX Priority Hub', 'MIFX Priority']);
  assert.equal(articles[0].excerpt, 'Fitur khusus untuk Priority Client.');
});

test('treg Instagram feed (real MIFX response, sanitized) surfaces the MIFX Priority Hub posts', () => {
  const posts = parseTregInstagramPosts(fixture('partnership-treg-ig-mifx.json'));
  assert.equal(posts.length, 12);
  assert.equal(posts[0].account, 'mifx.indonesia');
  assert.equal(posts[0].date, '2026-11-15');
  const priority = posts.filter(post => /MIFX Priority Hub/.test(post.caption));
  assert.equal(priority.length, 3);
  assert.deepEqual(priority.map(post => post.date), ['2026-09-23', '2026-09-22', '2026-09-21']);
  assert.equal(priority[2].kind, 'carousel');
  // Other provider shapes
  const other = parseTregInstagramPosts({ output: { posts: [{ caption: { text: 'Hi #a1' }, shortcode: 'ABCDEF', taken_at: 1_793_000_000, user: {} }, { edge_media_to_caption: { edges: [{ node: { text: 'Edge cap' } }] }, permalink: 'https://www.instagram.com/reel/GHIJKL/', timestamp: '2026-10-01T00:00:00Z', owner: { username: 'x' } }] } });
  assert.deepEqual(other.map(post => [post.caption, post.url, post.date, post.account]), [
    ['Hi #a1', 'https://www.instagram.com/p/ABCDEF/', '2026-10-26', null],
    ['Edge cap', 'https://www.instagram.com/p/GHIJKL/', '2026-10-01', 'x'],
  ]);
});

function catalog(): IntelSource[] {
  return buildSourceCatalog({
    pages: [], news: [], web: [{ title: 'Giveaway', url: 'https://web.example/g', snippet: 'GIVEAWAY tebak harga emas, 3 pemenang' }],
    evidence: [{ id: 'ev-1', kind: 'link', sourceUrl: 'https://www.instagram.com/p/DfMeFXkyIcy/', pastedText: null, extractedText: 'Instagram post by @gojekindonesia on 2026-11-01\nCaption: ... sebagai pengingat Bersama, #PastiAdaJalan\nHashtags: #PastiAdaJalan', observedOn: null }],
  }, WINDOW);
}

test('team IG link evidence gets its date from the fetched caption and is titled as an Instagram post', () => {
  const sources = catalog();
  const evidence = sources.find(source => source.id === 'E1');
  assert.equal(evidence?.date, '2026-11-01');
  assert.equal(evidence?.title, 'Team-pasted Instagram post');
});

test('campaign guard: Gojek #PastiAdaJalan is a campaign; a giveaway "campaign" is moved to regular content; invented hashtags dropped', () => {
  const sources = catalog();
  const { campaigns, regularContent } = parseCampaignSections({
    campaigns: [
      { name: 'Bersama Pasti Ada Jalan', brandComm: 'Bersama Pasti Ada Jalan', hashtags: ['#PastiAdaJalan', '#Invented'], format: 'Short inspiring-story Reels', period: 'Nov 2026', channels: ['Instagram'], summary: 'Kindness stories.', sourceIds: ['E1'] },
      { name: 'Tebak Harga Emas Giveaway', brandComm: '', hashtags: [], format: 'Giveaway post', summary: 'Guess the gold price.', sourceIds: ['S1'] },
      { name: 'Uncited idea', brandComm: 'x', sourceIds: [] },
    ],
    regularContent: [{ pattern: 'quiz', summary: 'Weekly quiz.', examples: ['Quiz'], sourceIds: ['S1'] }],
  }, sources, WINDOW);
  assert.equal(campaigns.length, 1);
  assert.deepEqual(campaigns[0].hashtags, ['#PastiAdaJalan']);
  assert.equal(campaigns[0].date, '2026-11-01');
  assert.equal(campaigns[0].month, '2026-11');
  assert.equal(campaigns[0].sources[0].evidenceId, 'ev-1');
  assert.deepEqual(regularContent.map(item => item.pattern), ['giveaway', 'quiz']);
  assert.deepEqual(regularContent[0].examples, ['Tebak Harga Emas Giveaway']);
});

test('prompt carries the campaign definition and both few-shot examples', () => {
  const prompt = buildIntelPrompt({ name: 'MIFX', region: 'local', instagramHandle: 'mifx.indonesia' }, catalog(), WINDOW);
  assert.ok(prompt.system.includes(CAMPAIGN_DEFINITION));
  assert.match(prompt.system, /#PastiAdaJalan/);
  assert.match(prompt.system, /NOT a campaign/);
  assert.match(prompt.system, /"campaigns":\[/);
  assert.match(prompt.user, /Instagram @mifx\.indonesia/);
});
