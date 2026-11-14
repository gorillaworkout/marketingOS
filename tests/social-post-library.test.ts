import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEmbedding } from '../src/lib/embeddings';
import { runQC } from '../src/lib/openai';
import {
  buildBrandVoiceBlock,
  buildCampaignBlock,
  campaignEmbeddingText,
  canDeleteCampaign,
  canEditBrandVoice,
  canWriteBrandVoice,
  inventedPromoTokens,
  parseCampaignInput,
  pickVoiceSamples,
  VOICE_BLOCK_MAX,
  VOICE_CHARACTER_MAX,
  CAMPAIGN_BLOCK_MAX,
} from '../src/lib/social-post-library';
import { rankCampaignSuggestion } from '../src/lib/social-post-campaign-match';

const campaign = {
  name: 'Gold Week',
  status: 'active' as const,
  startsOn: '2026-11-01',
  endsOn: '2026-11-30',
  objective: 'Explain the gold spread',
  keyFacts: ['Gold spread from 0.0 this week'],
  approvedClaims: ['Regulated by BAPPEBTI'],
  links: [{ label: 'Register', url: 'https://dupoin.com/gold' }],
  hashtags: ['#goldweek'],
  notes: null,
};

test('shared brand voice is admin-only and a personal voice stays with its owner', () => {
  const member = { id: 'member', role: 'member', features: ['social-post'] };
  const outsider = { id: 'other', role: 'member', features: ['seo'] };
  assert.equal(canWriteBrandVoice(member), true);
  assert.equal(canWriteBrandVoice(outsider), false);
  assert.equal(canWriteBrandVoice({ id: 'admin', role: 'admin', features: [] }), true);
  assert.equal(canEditBrandVoice(member, { userId: 'member', isShared: false }), true);
  assert.equal(canEditBrandVoice(member, { userId: 'other', isShared: false }), false);
  assert.equal(canEditBrandVoice(member, { userId: 'admin', isShared: true }), false);
  assert.equal(canEditBrandVoice({ id: 'admin', role: 'admin' }, { userId: 'member', isShared: true }), true);
  assert.equal(canDeleteCampaign(member, { createdBy: 'member' }), true);
  assert.equal(canDeleteCampaign(member, { createdBy: 'other' }), false);
  assert.equal(canDeleteCampaign({ id: 'admin', role: 'admin' }, { createdBy: 'other' }), true);
});

test('voice and campaign prompt blocks stay inside their caps', () => {
  const samples = pickVoiceSamples([
    { platform: 'Instagram', contentType: 'photo', caption: 'P'.repeat(900) },
    { platform: 'LinkedIn', contentType: 'photo', caption: 'Skip this platform' },
    { platform: 'Instagram', contentType: 'video', caption: 'Skip this type' },
    { platform: 'Instagram', contentType: 'photo', caption: 'Second photo sample' },
    { caption: 'General sample' },
  ], 'Instagram', 'photo');
  const voice = buildBrandVoiceBlock({
    character: 'C'.repeat(4_000),
    banned: ['dijamin untung'],
    samples,
  });
  assert.ok(voice.length <= VOICE_BLOCK_MAX);
  assert.ok(!voice.includes('C'.repeat(VOICE_CHARACTER_MAX + 1)));
  assert.match(voice, /Banned phrases: dijamin untung/);
  assert.equal((voice.match(/^- /gm) || []).length, 3);
  assert.match(voice, /Second photo sample/);
  assert.doesNotMatch(voice, /Skip this platform/);
  const block = buildCampaignBlock({ ...campaign, keyFacts: ['F'.repeat(4_000)] });
  assert.ok(block.length <= CAMPAIGN_BLOCK_MAX);
  assert.match(block, /only promo facts you may state/);
  assert.match(block, /Never invent a URL/);
  assert.match(block, /https:\/\/dupoin.com\/gold/);
  const picked = pickVoiceSamples([
    { platform: 'TikTok', contentType: 'video', caption: 'no' },
    { platform: 'Instagram', contentType: 'carousel', caption: 'yes' },
  ], 'Instagram', 'carousel');
  assert.deepEqual(picked.map(sample => sample.caption), ['yes']);
});

test('campaign input rejects a bad link and suggestion does not select a campaign by itself', async () => {
  const bad = parseCampaignInput({ name: 'Promo', links: [{ label: 'Go', url: 'javascript:alert(1)' }] });
  assert.equal(bad.ok, false);
  const good = parseCampaignInput({ name: 'Promo', keyFacts: ['Bonus 10%'], links: [{ label: 'Go', url: 'https://dupoin.com/go' }] });
  assert.equal(good.ok, true);
  if (!good.ok) return;
  const embedding = await getEmbedding(campaignEmbeddingText(good.campaign));
  const other = await getEmbedding('office chair catalog wholesale furniture');
  const suggestion = rankCampaignSuggestion(embedding, [
    { id: 'ended', name: 'Old promo', status: 'ended', embedding: JSON.stringify(embedding) },
    { id: 'match', name: 'Promo', status: 'active', embedding: JSON.stringify(embedding) },
    { id: 'other', name: 'Furniture', status: 'active', embedding: JSON.stringify(other) },
  ]);
  assert.equal(suggestion?.id, 'match');
  const none = rankCampaignSuggestion(other, [
    { id: 'match', name: 'Promo', status: 'active', embedding: JSON.stringify(embedding) },
  ]);
  assert.equal(none, null);
});

test('QC allows campaign links and rejects a price that is not in Campaign Memory', () => {
  assert.deepEqual(inventedPromoTokens('Spread from 0.0 and a 10% bonus', 'Gold spread from 0.0 this week'), ['10%']);
  const qc = runQC(
    'Gold spread from 0.0 this week. Register at https://dupoin.com/gold',
    ['#goldweek'],
    'Twitter/X',
    {
      cta: 'register',
      ctaUrl: 'https://dupoin.com/gold',
      allowedUrls: ['https://dupoin.com/gold'],
      restrictUrls: true,
      campaignFacts: 'Gold spread from 0.0 this week https://dupoin.com/gold',
    },
  );
  assert.equal(qc.checks.find(check => check.name === 'campaign_facts')?.passed, true);
  assert.equal(qc.checks.find(check => check.name === 'no_invented_url')?.passed, true);
  const invented = runQC('Get a 50% bonus at https://evil.example', ['#goldweek'], 'Twitter/X', {
    restrictUrls: true,
    allowedUrls: ['https://dupoin.com/gold'],
    campaignFacts: 'Gold spread from 0.0 this week',
  });
  assert.equal(invented.checks.find(check => check.name === 'campaign_facts')?.passed, false);
  assert.equal(invented.checks.find(check => check.name === 'no_invented_url')?.passed, false);
});

test('generation injects a selected campaign and only suggests a match otherwise', () => {
  const route = readFileSync('src/app/api/social-post/generate/route.ts', 'utf8');
  assert.match(route, /buildCampaignBlock\(campaign\)/);
  assert.match(route, /rankCampaignSuggestion/);
  assert.match(route, /selectedCampaignId/);
  assert.match(route, /campaignId: selectedCampaignId \|\| null/);
  const page = readFileSync('src/app/dashboard/social-post/page.tsx', 'utf8');
  assert.match(page, /SocialPostAdvanced/);
  assert.doesNotMatch(page, /Brand voice — coming soon/);
  assert.doesNotMatch(page, /Campaign — coming soon/);
});
