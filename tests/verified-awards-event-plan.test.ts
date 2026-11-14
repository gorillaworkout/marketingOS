import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_FACT_RULES, DUPOIN_VERIFIED_FACTS, guardGeneratedText, mergeBrandFacts, unverifiedClaims } from '../src/lib/brand-fact-guard.ts';
import {
  ESTIMATE_UNAVAILABLE_NOTE,
  NOT_IN_QUOTATION_NOTE,
  missingPriceNote,
  scrubMissingPriceNotes,
} from '../src/lib/event-plan-pricing.ts';
import { buildPreliminaryBudget, formatVenueLine } from '../src/lib/event-plan-budget.ts';
import { alignBudgetWithQuotation, applyConfirmedQuotationNarrative, parseQuotationLines } from '../src/lib/event-plan-quotation.ts';
import { buildEventPlanDownload } from '../src/lib/event-plan-download.ts';
import { createGenerationJobStore, streamGenerationJob } from '../src/lib/generation-job.ts';
import { SOCIAL_POST_STORY_RULE, buildBriefPromptBlock, type SocialPostBriefInput } from '../src/lib/social-post-brief.ts';
import { getSystemPrompt } from '../src/lib/openai.ts';

const OLD_NOTE = ['No', 'public', 'price', 'found'].join(' ');

// ── Task 1: real Dupoin awards ────────────────────────────────────────────────

test('the verified facts list the real Dupoin awards and the Bappebti A+++ rating', () => {
  for (const award of [
    'Most Trusted Broker 2025 by CNN Indonesia (CNN Indonesia Awards 2025)',
    'Highest Trading Volume Broker 2025 by CNBC Indonesia',
    'Top Futures Broker 2026 by Bloomberg Technoz',
    'Best Growth Trading Platform 2024 by CNBC Indonesia',
    'peringkat A+++ dari Bappebti 2023–2025',
  ]) {
    assert.ok(DUPOIN_VERIFIED_FACTS.includes(award), `missing ${award}`);
  }
});

test('the guard keeps real award variants in any case or punctuation', () => {
  const facts = mergeBrandFacts('');
  for (const text of [
    'MOST TRUSTED BROKER CNN 2025.',
    'Most Trusted Broker by CNN Indonesia.',
    'Dupoin — Most Trusted Broker 2025, CNN Indonesia Awards 2025.',
    'most-trusted broker (CNN Indonesia, 2025).',
    'Highest Trading Volume Broker 2025 by CNBC Indonesia.',
    'TOP FUTURES BROKER 2026 — BLOOMBERG TECHNOZ.',
    'Best Growth Trading Platform 2024 by CNBC Indonesia.',
    'Dupoin meraih peringkat A+++ dari Bappebti 2023–2025.',
  ]) {
    assert.deepEqual(unverifiedClaims(text, facts), [], text);
    const guarded = guardGeneratedText(`${text} Trade with a plan.`, facts);
    assert.equal(guarded.warnings.length, 0, text);
    assert.ok(guarded.text.startsWith(text.slice(0, 12)), text);
  }
});

test('the guard strips fake or altered awards', () => {
  const facts = mergeBrandFacts('');
  for (const fake of [
    'Best Broker Forbes 2025.',
    'Most Trusted Broker by Forbes 2025.',
    'Most Trusted Broker CNN 2019.',
    'Top Futures Broker 2026 by CNN Indonesia.',
    'Winner of the Global Finance award 2025 broker.',
  ]) {
    const guarded = guardGeneratedText(`${fake} Trade with a plan.`, facts);
    assert.ok(guarded.warnings.length > 0, fake);
    assert.equal(guarded.text, 'Trade with a plan.', fake);
  }
});

test('the ICA site never inherits Dupoin awards', () => {
  const ica = mergeBrandFacts('cheer facts', { name: 'ICA Cheerleading', siteUrl: 'https://indonesiancheer.org/' });
  const guarded = guardGeneratedText('MOST TRUSTED BROKER CNN 2025. Cheer on.', ica);
  assert.equal(guarded.text, 'Cheer on.');
});

test('the shared brand rules ask for sparing use of awards as credibility proof', () => {
  assert.match(BRAND_FACT_RULES, /award/i);
  assert.match(BRAND_FACT_RULES, /sparingly/i);
  assert.match(BRAND_FACT_RULES, /credibility proof/i);
});

// ── Task 2: Event Plan missing-price wording ─────────────────────────────────

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

test('the old no-public-price wording is gone from every source file', () => {
  const offenders = walk('src').filter(file => /\.(ts|tsx|js|mjs)$/.test(file) && readFileSync(file, 'utf8').includes(OLD_NOTE));
  assert.deepEqual(offenders, []);
});

test('missing-price notes depend on whether a quotation table exists', () => {
  assert.equal(NOT_IN_QUOTATION_NOTE, 'Not in quotation — to confirm with vendor');
  assert.equal(ESTIMATE_UNAVAILABLE_NOTE, 'Estimate unavailable — request a vendor quotation');
  assert.equal(missingPriceNote(true), NOT_IN_QUOTATION_NOTE);
  assert.equal(missingPriceNote(false), ESTIMATE_UNAVAILABLE_NOTE);
});

test('generated plan output never carries the old wording', () => {
  const legacy = {
    concept: `${OLD_NOTE} — request a quotation from the vendor. Great venue.`,
    budget: { items: [{ category: 'Catering', notes: `${OLD_NOTE} — request a quotation from the vendor.` }] },
    research: { sources: [{ claim: `${OLD_NOTE} on this page — request a quotation from the vendor` }] },
  };
  const withQuote = scrubMissingPriceNotes(legacy, true);
  assert.doesNotMatch(JSON.stringify(withQuote), new RegExp(OLD_NOTE, 'i'));
  assert.match(JSON.stringify(withQuote), /Not in quotation — to confirm with vendor/);
  assert.doesNotMatch(JSON.stringify(withQuote), /Estimate unavailable/);
  const withoutQuote = scrubMissingPriceNotes(legacy, false);
  assert.doesNotMatch(JSON.stringify(withoutQuote), new RegExp(OLD_NOTE, 'i'));
  assert.match(JSON.stringify(withoutQuote), /Estimate unavailable — request a vendor quotation/);

  const lines = parseQuotationLines([{ vendor: 'Kempinski', item: 'Ballroom', category: 'Venue', qty: 1, unitPrice: 1000, total: 1000 }]);
  const aligned = alignBudgetWithQuotation(buildPreliminaryBudget(100_000_000, 'Jakarta'), lines);
  assert.doesNotMatch(JSON.stringify(aligned), /Estimate unavailable/);
  assert.match(JSON.stringify(aligned), /Not in quotation — to confirm with vendor/);
  const narrative = applyConfirmedQuotationNarrative(`Professional option. ${ESTIMATE_UNAVAILABLE_NOTE}.`, lines, 10);
  assert.doesNotMatch(narrative, /Estimate unavailable/);
  assert.match(narrative, /Confirmed quotation subtotal/);
});

test('the download uses the quotation-aware note', () => {
  const quoted = buildEventPlanDownload({
    eventName: 'Q4 Seminar',
    location: 'Jakarta',
    option: {
      styleLabel: 'Professional',
      venue: formatVenueLine('Jakarta'),
      budget: { currency: 'IDR', total: 1000, items: [{ category: 'Venue', estimatedCost: 1000, source: 'quotation', notes: 'Confirmed quotation.' }] },
      research: { status: 'unverified', sources: [], contacts: [] },
    },
  }, 'doc');
  assert.match(quoted.content, /Not in quotation — to confirm with vendor/);
  assert.doesNotMatch(quoted.content, new RegExp(OLD_NOTE));
  const plain = buildEventPlanDownload({
    eventName: 'Q4 Seminar',
    location: 'Jakarta',
    option: { styleLabel: 'Professional', venue: formatVenueLine('Jakarta'), budget: buildPreliminaryBudget(100_000_000, 'Jakarta'), research: { status: 'unverified', sources: [], contacts: [] } },
  }, 'doc');
  assert.match(plain.content, /Estimate unavailable — request a vendor quotation/);
});

// ── Task 3: Event Plan stream starts at once ─────────────────────────────────

test('a generation job stream sends its first chunk at once, before any event', async () => {
  const store = createGenerationJobStore('test-immediate');
  const job = store.create('user-1');
  const response = streamGenerationJob(store, job.id, 'user-1', { keepaliveMs: 10_000, pollMs: 5 });
  assert.equal(response.headers.get('X-Accel-Buffering'), 'no');
  assert.equal(response.headers.get('Content-Type'), 'text/event-stream');
  const reader = response.body!.getReader();
  const started = Date.now();
  const first = await reader.read();
  assert.ok(Date.now() - started < 200, 'first chunk must not wait for research');
  const text = new TextDecoder().decode(first.value);
  assert.match(text, /^: /);
  assert.match(text, new RegExp(`"jobId":"${job.id}"`));
  store.push(job.id, 'user-1', { step: 'done', progress: 100, result: { success: true } });
  store.finish(job.id, 'user-1', { success: true });
  let rest = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += new TextDecoder().decode(value);
  }
  assert.match(rest, /"step":"done"/);
});

test('a generation job stream pings while the job is silent', async () => {
  const store = createGenerationJobStore('test-ping');
  const job = store.create('user-1');
  const response = streamGenerationJob(store, job.id, 'user-1', { keepaliveMs: 20, pollMs: 5 });
  const reader = response.body!.getReader();
  await reader.read();
  const second = await reader.read();
  assert.match(new TextDecoder().decode(second.value), /^: keepalive/);
  store.fail(job.id, 'user-1', 'stop');
  while (!(await reader.read()).done) { /* drain */ }
});

test('the Event Plan route streams immediately, keeps alive, and can be reattached', () => {
  const route = readFileSync('src/app/api/event-plan/generate/route.ts', 'utf8');
  assert.match(route, /streamGenerationJob/);
  assert.match(route, /export async function GET/);
  assert.match(route, /void runEventPlanJob/);
  const page = readFileSync('src/app/dashboard/event-plan/page.tsx', 'utf8');
  assert.match(page, /generate\?jobId=/);
  const helper = readFileSync('src/lib/generation-job.ts', 'utf8');
  assert.match(helper, /X-Accel-Buffering': 'no'/);
  assert.match(helper, /10_000/);
});

// ── Task 4: no named-person anecdotes in Social Post ─────────────────────────

const brief: SocialPostBriefInput = { contentType: 'photo', ctaUrl: '', reference: null, tone: 'humorous', toneCustom: '', cta: 'none', keyMessage: '' };

test('Social Post prompts forbid named-person anecdotes presented as real', () => {
  assert.match(SOCIAL_POST_STORY_RULE, /named/i);
  assert.match(SOCIAL_POST_STORY_RULE, /misalnya/);
  assert.match(SOCIAL_POST_STORY_RULE, /hypothetical/i);
  assert.ok(buildBriefPromptBlock(brief).includes(SOCIAL_POST_STORY_RULE));
  assert.ok(buildBriefPromptBlock({ ...brief, tone: 'educational' }).includes(SOCIAL_POST_STORY_RULE));
  assert.ok(getSystemPrompt('social-post').includes(SOCIAL_POST_STORY_RULE));
  const route = readFileSync('src/app/api/social-post/generate/route.ts', 'utf8');
  assert.match(route, /STYLE: CREATIVE & TRENDY[\s\S]*SOCIAL_POST_STORY_RULE/);
});
