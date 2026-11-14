import test from 'node:test';
import assert from 'node:assert/strict';
import { runQC } from '../src/lib/openai';
import { socialPostGenerateRequestBody } from '../src/lib/social-post-brand-guideline';
import {
  buildBriefPromptBlock,
  dedupeHashtags,
  emojiLimit,
  hashtagRange,
  keyMessagePresent,
  parseSocialPostBrief,
  platformKey,
  platformOptimization,
  readStoredSocialPostInput,
  REFERENCE_TEXT_MAX,
} from '../src/lib/social-post-brief';
import { htmlToText, readPublicReferenceUrl } from '../src/lib/social-post-reference';

test('Twitter/X uses the twitter platform rules', () => {
  assert.equal(platformKey('Twitter/X'), 'twitter');
  assert.match(platformOptimization('Twitter/X'), /1-3 hashtags/);
  assert.doesNotMatch(platformOptimization('Twitter/X'), /Optimize content format/);
});

test('QC hashtag and emoji limits follow the platform and Bold style', () => {
  assert.deepEqual(hashtagRange('Instagram'), { min: 15, max: 20 });
  assert.deepEqual(hashtagRange('Twitter/X'), { min: 1, max: 3 });
  assert.deepEqual(hashtagRange('LinkedIn'), { min: 3, max: 5 });
  assert.deepEqual(hashtagRange('TikTok'), { min: 3, max: 6 });
  assert.deepEqual(hashtagRange('Facebook'), { min: 1, max: 3 });
  const tags = Array.from({ length: 16 }, (_, index) => `#gold${index}`);
  const instagram = runQC('A'.repeat(80), tags, 'Instagram', { style: 'bold' });
  assert.equal(instagram.checks.find(check => check.name === 'hashtag_count')?.passed, true);
  assert.equal(emojiLimit('LinkedIn', 'bold'), 2);
  assert.equal(emojiLimit('Instagram', 'bold'), 8);
  const bold = runQC(`${'A'.repeat(80)} 😀😀😀😀`, tags, 'Instagram', { style: 'bold' });
  assert.equal(bold.checks.find(check => check.name === 'emoji_count')?.passed, true);
  const linkedin = runQC(`${'A'.repeat(80)} 😀😀😀`, ['#markets', '#fx', '#dupoin'], 'LinkedIn', { style: 'bold' });
  assert.equal(linkedin.checks.find(check => check.name === 'emoji_count')?.passed, false);
});

test('brief parser stores the generation fields and rejects a bad URL', () => {
  const parsed = parseSocialPostBrief({
    contentType: 'video',
    tone: 'educational',
    cta: 'register',
    ctaUrl: 'https://dupoin.com/register',
    keyMessage: 'Trade with a regulated broker',
    reference: { kind: 'text', text: '  Notes from the desk.  ' },
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.brief.contentType, 'video');
  assert.equal(parsed.brief.reference?.text, 'Notes from the desk.');
  assert.match(buildBriefPromptBlock(parsed.brief), /must appear in the caption/);
  assert.match(buildBriefPromptBlock(parsed.brief), /3 seconds/);
  const longReference = parseSocialPostBrief({ reference: { kind: 'text', text: 'A'.repeat(5_000) }, keyMessage: 'B'.repeat(400) });
  assert.equal(longReference.ok, true);
  if (longReference.ok) {
    assert.equal(longReference.brief.reference?.text.length, REFERENCE_TEXT_MAX);
    assert.equal(longReference.brief.keyMessage.length, 200);
    assert.ok(buildBriefPromptBlock(longReference.brief).length < 3_000);
  }
  const restored = readStoredSocialPostInput({ contentType: 'carousel', platform: 'Twitter/X', keyMessage: 'Open an account', cta: 'follow' });
  assert.equal(restored?.contentType, 'carousel');
  assert.equal(restored?.platform, 'Twitter/X');
  const bad = parseSocialPostBrief({ cta: 'visit-link', ctaUrl: 'javascript:alert(1)' });
  assert.equal(bad.ok, false);
  const social = parseSocialPostBrief({ reference: { kind: 'url', url: 'https://www.instagram.com/p/abc' } });
  assert.equal(social.ok, false);
});

test('key message check allows a close paraphrase and hashtags are normalised', () => {
  assert.equal(keyMessagePresent('Trade with a regulated broker today', 'regulated broker'), true);
  assert.equal(keyMessagePresent('Hello traders', 'guaranteed profit today'), false);
  assert.deepEqual(dedupeHashtags(['Dupoin', '#Dupoin', 'pasti untung', 'gold outlook']), ['#dupoin', '#goldoutlook']);
  const qc = runQC('Trade with a regulated broker. Visit https://dupoin.com/go', ['#dupoin'], 'Twitter/X', { keyMessage: 'regulated broker', cta: 'visit-link', ctaUrl: 'https://dupoin.com/go' });
  assert.equal(qc.checks.find(check => check.name === 'key_message_present')?.passed, true);
  assert.equal(qc.checks.find(check => check.name === 'cta_present')?.passed, true);
  assert.equal(qc.checks.find(check => check.name === 'no_invented_url')?.passed, true);
  const invented = runQC('Visit https://evil.example', ['#dupoin'], 'Twitter/X', { cta: 'visit-link', ctaUrl: 'https://dupoin.com/go' });
  assert.equal(invented.checks.find(check => check.name === 'no_invented_url')?.passed, false);
});

test('generate request keeps the old body and adds brief fields when set', () => {
  const base = { brief: 'Gold outlook', platform: 'Instagram', targetAudience: 'Traders', goal: 'Awareness' };
  assert.deepEqual(socialPostGenerateRequestBody(base), base);
  const body = socialPostGenerateRequestBody({
    ...base,
    contentType: 'video',
    tone: 'educational',
    cta: 'register',
    ctaUrl: 'https://dupoin.com/register',
    keyMessage: 'Regulated broker',
    reference: { kind: 'text', text: 'Desk notes' },
  });
  assert.equal(body.contentType, 'video');
  assert.equal(body.reference?.text, 'Desk notes');
  assert.equal('brandGuidelineId' in body, false);
});

test('public reference reader skips social hosts and clips HTML', async () => {
  assert.equal(htmlToText('<style>x</style><p>Gold &amp; silver</p>').includes('Gold & silver'), true);
  const blocked = await readPublicReferenceUrl('https://x.com/dupoin', async () => { throw new Error('should not fetch'); });
  assert.match('error' in blocked ? blocked.error : '', /not fetched/);
});
