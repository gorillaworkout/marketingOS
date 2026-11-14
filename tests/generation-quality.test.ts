import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { guardGeneratedText, BRAND_FACT_RULES, DUPOIN_VERIFIED_FACTS, mergeBrandFacts } from '../src/lib/brand-fact-guard.ts';
import { getSmartSystemPrompt, getSystemPrompt, runQC } from '../src/lib/openai.ts';
import { buildBriefPromptBlock, keyMessagePresent, type SocialPostBriefInput } from '../src/lib/social-post-brief.ts';
import { buildEventPricingQueries, buildEventPricingFollowUpQueries } from '../src/lib/event-plan-pricing.ts';
import { NOT_IN_QUOTATION_NOTE, alignBudgetWithQuotation } from '../src/lib/event-plan-quotation.ts';
import { explainImageFailure } from '../src/app/api/generate-image/route.ts';
import { imageQuotaNotice, nextImageFallback } from '../src/lib/image-generation-fallback.ts';
import { videoFormatInstruction, buildStoryboardImagePrompt } from '../src/lib/video-script-format.ts';
import { storedAuthExpired } from '../src/lib/llm-auth.ts';
import { IMAGE_PROMPT_SYSTEM } from '../src/lib/dupoin-image-prompt.ts';

const brief = (keyMessage: string): SocialPostBriefInput => ({
  contentType: 'photo',
  ctaUrl: '',
  reference: null,
  tone: 'educational',
  toneCustom: '',
  cta: 'none',
  keyMessage,
});

test('the real Dupoin license is kept and a wrong number or award is stripped', () => {
  const facts = mergeBrandFacts('fast execution');
  assert.match(facts, /423\/BAPPEBTI\/SI\/VII\/2004/);
  assert.match(facts, /SPAB-064\/BBJ\/04\/04/);
  assert.match(facts, /05\/AK-KBI\/PN\/V\/2024/);
  assert.match(facts, /0013\/ASPEBTINDO\/ANG-B\/05\/2024/);
  assert.match(facts, /824 153 24006/);
  assert.match(facts, /fast execution/);
  assert.doesNotMatch(DUPOIN_VERIFIED_FACTS, /\bOJK\b/);
  assert.doesNotMatch(DUPOIN_VERIFIED_FACTS, /\bBI\b/);

  // The CNN Indonesia award is real (dupoin.co.id/en/about-us/our-awards); a made-up award is not.
  const kept = guardGeneratedText('PT Dupoin Futures Indonesia is regulated by BAPPEBTI, license 423/BAPPEBTI/SI/VII/2004. MOST TRUSTED BROKER CNN 2025. Best Broker Forbes 2025. Trade with a plan.', facts);
  assert.match(kept.text, /423\/BAPPEBTI\/SI\/VII\/2004/);
  assert.match(kept.text, /MOST TRUSTED BROKER CNN 2025/);
  assert.doesNotMatch(kept.text, /Forbes/);
  assert.match(kept.text, /Trade with a plan/);
  assert.ok(kept.warnings.length > 0);

  const wrong = guardGeneratedText('Licensed 999/BAPPEBTI/SI/VII/2004. Trade with a plan.', facts);
  assert.doesNotMatch(wrong.text, /999\/BAPPEBTI/);
  assert.match(wrong.text, /Trade with a plan/);

  const ica = mergeBrandFacts('cheer facts', { name: 'ICA Cheerleading', siteUrl: 'https://indonesiancheer.org/' });
  assert.equal(ica, 'cheer facts');
  assert.doesNotMatch(guardGeneratedText('License 423/BAPPEBTI/SI/VII/2004.', ica).text, /423\/BAPPEBTI/);

  assert.match(BRAND_FACT_RULES, /VERIFIED_BRAND_FACTS/);
  assert.match(BRAND_FACT_RULES, /demo account|risk-management|webinar/i);
  assert.match(getSystemPrompt('social-post'), /423\/BAPPEBTI\/SI\/VII\/2004/);
  assert.match(getSystemPrompt('social-post'), /compliance footer/i);
  assert.match(getSystemPrompt('social-post'), /never as a slogan/i);
  assert.match(getSmartSystemPrompt('social-post'), /VERIFIED_BRAND_FACTS/);
  assert.match(getSystemPrompt('video-script'), /VERIFIED_BRAND_FACTS/);
  assert.match(getSystemPrompt('event-plan'), /VERIFIED_BRAND_FACTS/);
  assert.match(readFileSync('src/lib/seo/content-prompt.ts', 'utf8'), /BRAND_FACT_RULES/);
  assert.match(readFileSync('src/lib/article-market-news.ts', 'utf8'), /BRAND_FACT_RULES/);
  assert.match(IMAGE_PROMPT_SYSTEM, /VERIFIED_BRAND_FACTS/);
  assert.doesNotMatch(IMAGE_PROMPT_SYSTEM, /badge CNN 2025/);
  assert.match(videoFormatInstruction('event-recap'), /simulation|plan/i);
  assert.match(videoFormatInstruction('street-interview'), /simulation|plan/i);
  assert.match(buildStoryboardImagePrompt({ number: 1, shot: 'Desk', onScreenText: '', vo: '', duration: '5s' }, 'talking-head'), /license|award/i);
});

test('the key message is required in every option and a clear paraphrase passes QC', () => {
  const block = buildBriefPromptBlock(brief('Mulai trading dengan modal kecil'));
  assert.match(block, /every option/i);
  assert.match(block, /paraphrase/i);
  assert.equal(keyMessagePresent('Trading bisa dimulai dari modal yang kecil hari ini', 'Mulai trading dengan modal kecil'), true);
  assert.equal(keyMessagePresent('Ikuti berita emas minggu ini', 'Mulai trading dengan modal kecil'), false);
  const qc = runQC('Trading bisa dimulai dari modal yang kecil hari ini #dupoin', [], 'Instagram', { keyMessage: 'Mulai trading dengan modal kecil' });
  assert.equal(qc.checks.find(check => check.name === 'key_message_present')?.passed, true);
});

test('a confirmed quotation replaces missing prices and skips covered wedding-prone searches', () => {
  const budget = alignBudgetWithQuotation({
    items: [
      { category: 'Venue', estimatedCost: null, notes: 'No public price found — request a quotation from the vendor. Wedding ballroom Rp 80.000.000.' },
      { category: 'Catering', estimatedCost: null, notes: 'No public price found — request a quotation from the vendor.' },
    ],
  }, [{ vendor: 'Kempinski', item: 'Ballroom', category: 'Venue', qty: 1, unitPrice: 25_000_000, total: 25_000_000, currency: 'IDR', notes: '' }]);
  const items = budget.items as Array<Record<string, unknown>>;
  const venueEstimates = items.filter(item => item.category === 'Venue' && item.source !== 'quotation');
  assert.equal(venueEstimates.length, 0);
  const catering = items.find(item => item.category === 'Catering');
  assert.match(String(catering?.notes), new RegExp(NOT_IN_QUOTATION_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(JSON.stringify(items), /No public price found/i);

  const queries = buildEventPricingQueries({
    location: 'Jakarta',
    eventName: 'Market Outlook',
    theme: 'seminar',
    coveredCategories: ['Venue'],
  });
  assert.ok(queries.every(query => query.includes('-pernikahan') && query.includes('-wedding') && !/ballroom rental/i.test(query)));
  assert.ok(queries.some(query => /seminar|keuangan|korporat/i.test(query) && /Jakarta/.test(query)));
  assert.ok(queries.every(query => !/sewa venue/i.test(query)));
  const open = buildEventPricingQueries({ location: 'Jakarta', eventName: 'Seminar', theme: 'seminar' });
  assert.ok(open.every(query => /pernikahan|wedding|-wedding/i.test(query) || !/ballroom/i.test(query)));
  const follow = buildEventPricingFollowUpQueries({ location: 'Jakarta', eventName: 'Seminar', theme: 'seminar', existingQueries: open });
  assert.ok(follow.every(query => !/daftar harga sewa ballroom/i.test(query)));
  assert.ok(follow.some(query => /keuangan|korporat|seminar/i.test(query)));
});

test('image quota fails over only to another enabled free model, otherwise one notice and a retry', () => {
  assert.equal(nextImageFallback('ag/gemini-3.1-flash-image', ['ag/gemini-3.1-flash-image', 'google/gemini-3.1-flash-image']), null);
  assert.equal(nextImageFallback('ag/gemini-3.1-flash-image', ['ag/gemini-3.1-flash-image', 'cx/free-image']), 'cx/free-image');
  const notice = imageQuotaNotice('Gemini 3.1 Flash Image (Antigravity)', '8m 56s');
  assert.equal(notice, 'Image quota reached for Gemini 3.1 Flash Image (Antigravity), retry in 8m 56s; no other image model enabled — enable one in AI Models');
  assert.equal(explainImageFailure('Image API error 429: usage limit (reset after 8m 56s)', 'ag/gemini-3.1-flash-image'), imageQuotaNotice('Gemini 3.1 Flash Image (Antigravity)', '8m 56s'));
  const storyboard = readFileSync('src/components/video-storyboard.tsx', 'utf8');
  assert.match(storyboard, />Retry</);
});

test('an Auth expired badge is derived from a stored 401 or OAuth error', () => {
  assert.equal(storedAuthExpired({ status: 'error', message: 'HTTP 401: authentication_error oauth token expired' }), true);
  assert.equal(storedAuthExpired({ status: 'active', message: 'HTTP 200', lastError: 'HTTP 401: oauth token expired' }), false);
  assert.equal(storedAuthExpired({ status: 'error', message: 'HTTP 500', lastError: 'upstream authentication_error' }), true);
  const page = readFileSync('src/app/dashboard/models/page.tsx', 'utf8');
  assert.match(page, /lastError/);
  assert.match(page, /storedAuthExpired|Auth expired/);
});
