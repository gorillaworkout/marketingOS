import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedNumbers, buildDraftPrompt, buildProposalDocument, computeTotals, draftProposalContent, formatRupiah, guardNumbers, parseDraftResponse,
  parsePartnerLogo, parseProposalContent, parseProposalInput, templateContent, type ProposalInput,
} from '../src/lib/partnership/proposal';
import { BAPPEBTI_LICENSE, VERIFIED_AWARDS, verifiedFacts } from '../src/lib/partnership/proposal-facts';
import { DEFAULT_PROPOSAL_SETTINGS, parseProposalSettings, settingsOrDefault } from '../src/lib/partnership/proposal-settings';

const S = DEFAULT_PROPOSAL_SETTINGS;
const NOW = new Date('2026-11-15T10:00:00Z');

function kopiInput(overrides: Record<string, unknown> = {}): ProposalInput {
  const parsed = parseProposalInput({
    partnerName: 'Kopi Kenangan',
    partnerDescription: 'Indonesian coffee chain',
    objective: 'User Acquisition',
    collaborationScheme: 'Kopi Kenangan customers who download and register get a discount.',
    userBenefit: 'Discount fee IDR 5k for every Kopi Kenangan Mantan purchase at offline store.',
    exposures: ['ig-feed-collab', 'ig-story', 'article', 'media-coverage', 'home-banner'].map(itemId => ({ itemId, units: 1 })),
    offline: [{ materialId: 'x-banner' }, { materialId: 'tent-card' }],
    language: 'en',
    template: 'document',
    ...overrides,
  }, S, NOW);
  assert.ok('value' in parsed, JSON.stringify(parsed));
  return parsed.value;
}

test('verified facts carry the license, regulators, memberships, and the confirmed awards', () => {
  assert.equal(BAPPEBTI_LICENSE, '423/BAPPEBTI/SI/VII/2004');
  for (const language of ['id', 'en'] as const) {
    const facts = verifiedFacts(language);
    assert.equal(facts.licenseNumber, '423/BAPPEBTI/SI/VII/2004');
    assert.deepEqual(facts.supervision, ['BAPPEBTI', 'OJK', 'BI']);
    assert.deepEqual(facts.memberships, ['JFX', 'KBI', 'ASPEBTINDO']);
    assert.match(facts.aboutParagraph, /BAPPEBTI, OJK, (dan|and) BI/);
    assert.deepEqual(facts.rating, { title: language === 'en' ? 'A+++ Rating' : 'Peringkat A+++', years: '2023–2025', by: 'Bappebti' });
  }
  assert.deepEqual(VERIFIED_AWARDS.map(award => `${award.title} ${award.year} (${award.by})`), [
    'Most Trusted Broker 2025 (CNN Indonesia)',
    'Highest Trading Volume Broker 2025 (CNBC)',
    'Top Futures Broker 2026 (Bloomberg Technoz)',
    'Best Growth Trading Platform 2024 (CNBC)',
  ]);
});

test('default rate card and figures are copied exactly from the example proposals', () => {
  assert.deepEqual(S.rateCard.map(item => [item.content, item.quantityLabel, item.value]), [
    ['Poster collaboration activity', '1x', 3_000_000],
    ['Promotion activity', '2x/week (3 slides story)', 12_000_000],
    ['Collaboration article', '1x', 7_000_000],
    ['Media coverage', '3x', 6_000_000],
    ['Clickable Home banner (Apps & website)', '1 each', 50_000_000],
  ]);
  assert.deepEqual(S.offlineMaterials.map(item => item.material), ['X-Banner (60x160cm)', 'Tent Card (A5)']);
  assert.deepEqual(S.snapshots.map(snapshot => snapshot.cells.map(cell => cell.value)), [['#1', '1,272,382', '4,113'], ['#1', '833.224,67', '5979']]);
  assert.deepEqual(S.activeUsers.map(row => row.value), ['695', '2K', '3K', '6K', '15K']);
  assert.deepEqual(S.ageDistribution.map(row => row.value), ['23.80%', '37.90%', '21.60%', '9.40%', '5.70%', '1.60%']);
  assert.deepEqual(S.occupation.map(row => row.value), ['42.30%', '23.50%', '14.70%', '10.80%', '4.60%', '4.10%']);
  const regionSum = S.marketRegions.reduce((sum, row) => sum + Number(row.value.replace('%', '')), 0);
  assert.equal(Math.round(regionSum * 10) / 10, 100);
  assert.equal(S.productCount, '70+');
});

test('settings parser validates rate card prices and keeps defaults for missing parts', () => {
  const parsed = parseProposalSettings({ rateCard: [{ content: 'Podcast mention', platform: 'YouTube', quantityLabel: '1x', value: 'Rp 4.500.000' }] });
  assert.ok('value' in parsed);
  assert.deepEqual(parsed.value.rateCard, [{ id: 'podcast-mention', content: 'Podcast mention', platform: 'YouTube', quantityLabel: '1x', value: 4_500_000 }]);
  assert.deepEqual(parsed.value.occupation, S.occupation);
  assert.deepEqual(parseProposalSettings({ rateCard: [{ content: 'Bad', value: 'abc' }] }), { error: 'Rate card "Bad" needs a valid Rupiah value.' });
  assert.equal(parseProposalSettings({ instagramUrl: 'javascript:alert(1)' }).hasOwnProperty('value'), true);
  assert.equal((parseProposalSettings({ instagramUrl: 'javascript:alert(1)' }) as { value: typeof S }).value.instagramUrl, S.instagramUrl);
  assert.deepEqual(settingsOrDefault('not json'), S);
});

test('formatRupiah matches the proposals', () => {
  assert.equal(formatRupiah(3_000_000), 'Rp 3.000.000,-');
  assert.equal(formatRupiah(78_000_000), 'Rp 78.000.000,-');
  assert.equal(formatRupiah(0), 'Rp 0,-');
});

test('Kopi Kenangan package totals Rp 78.000.000 and Tadakado Rp 58.000.000, computed in code', () => {
  const kopi = computeTotals(kopiInput());
  assert.equal(kopi.exposureTotal, 78_000_000);
  assert.equal(kopi.packageTotal, 78_000_000);
  assert.equal(kopi.baseFee, null);
  assert.equal(kopi.exposureLines[1].platform, 'Instagram story (Dupoin & Kopi Kenangan)');

  const tadakado = computeTotals(kopiInput({
    partnerName: 'Tadakado Indonesia',
    exposures: ['ig-feed-collab', 'ig-story', 'article', 'media-coverage'].map(itemId => ({ itemId, units: 1 })),
    needs: [{ description: 'Vouchers', quantity: 1000, unitValue: 30_000 }, { description: 'Offline promotion material at some official merchants' }],
  }));
  assert.equal(tadakado.exposureTotal, 28_000_000);
  assert.equal(tadakado.needTotal, 30_000_000);
  assert.equal(tadakado.packageTotal, 58_000_000);

  const doubled = computeTotals(kopiInput({ exposures: [{ itemId: 'ig-story', units: 2 }], baseFee: 5_000_000 }));
  assert.equal(doubled.exposureLines[0].quantity, '2 × 2x/week (3 slides story)');
  assert.equal(doubled.exposureTotal, 24_000_000);
  assert.equal(doubled.packageTotal, 29_000_000);
});

test('input prices come from the rate card, not from the request', () => {
  const input = kopiInput({ exposures: [{ itemId: 'home-banner', units: 1, unitValue: 1 }] });
  assert.equal(input.exposures[0].unitValue, 50_000_000);
  assert.deepEqual(parseProposalInput({ partnerName: '  ' }, S), { error: 'Partner name is required.' });
  const id = parseProposalInput({ partnerName: 'X' }, S, NOW);
  assert.ok('value' in id);
  assert.equal(id.value.language, 'id');
  assert.equal(id.value.template, 'slide');
  assert.equal(id.value.year, '2026');
});

test('number guard drops AI sentences with numbers the user never gave', () => {
  const input = kopiInput();
  const allowed = allowedNumbers(input);
  assert.ok(allowed.has('5000'), '5k expands to 5000');
  assert.equal(guardNumbers('Users get IDR 5.000 off. Dupoin has 2 million users. Promo runs for 3 months.', allowed), 'Users get IDR 5.000 off. Promo runs for 3 months.');
});

test('AI draft fills narrative only; facts and totals stay out of the AI', async () => {
  const input = kopiInput();
  const prompt = buildDraftPrompt(input, ['MIFX runs cashback promos']);
  assert.match(prompt.system, /Do NOT write company facts, licenses/);
  assert.match(prompt.user, /Partner: Kopi Kenangan/);
  assert.match(prompt.user, /MIFX runs cashback promos/);
  let calls = 0;
  const result = await draftProposalContent(input, {
    complete: async () => {
      calls += 1;
      return {
        model: 'stub-model',
        content: JSON.stringify({
          projectOverview: 'Dupoin wants to meet coffee lovers. We serve 9,999,999 traders.',
          schemeGoal: 'Main Goals: User Acquisition',
          schemeBullets: ['Customers who register get IDR 5k off.', 'Valid for 90 days.'],
          userJourney: ['See banner', 'Download app', 'Get voucher'],
          marketInsight: 'Competitors push cashback; a lifestyle perk stands out.',
          notes: ['Tax, if any, to be borne by Dupoin Futures Indonesia.'],
        }),
      };
    },
  }, ['MIFX runs cashback promos']);
  assert.equal(calls, 1);
  assert.equal(result.model, 'stub-model');
  assert.equal(result.content.projectOverview, 'Dupoin wants to meet coffee lovers.');
  assert.deepEqual(result.content.schemeBullets, ['Customers who register get IDR 5k off.']);
  assert.equal(result.droppedSentences, 2);
  assert.equal(result.content.marketInsight, 'Competitors push cashback; a lifestyle perk stands out.');
  assert.equal(result.content.notes[0], templateContent(input).notes[0]);
  assert.ok(result.content.notes.includes('Tax, if any, to be borne by Dupoin Futures Indonesia.'));
  assert.deepEqual(parseDraftResponse('not json', input), { error: 'The AI response was not valid JSON.' });
});

test('edited content is sanitized and section toggles kept', () => {
  const input = kopiInput();
  const content = parseProposalContent({ projectOverview: '  Edited  ', include: { awards: false, nope: true }, schemeBullets: ['a', '', 'b'], extra: 'x' }, input);
  assert.equal(content.projectOverview, 'Edited');
  assert.equal(content.include.awards, false);
  assert.equal(content.include.numbers, true);
  assert.deepEqual(content.schemeBullets, ['a', 'b']);
  assert.equal('extra' in content, false);
});

test('document model resolves {partner} and carries verified facts, not AI text', () => {
  const input = kopiInput({ language: 'id' });
  const doc = buildProposalDocument(input, templateContent(input), S, null);
  assert.equal(doc.labels.toc, 'Daftar isi');
  assert.equal(doc.facts.licenseNumber, BAPPEBTI_LICENSE);
  assert.equal(doc.offline[0].placement, 'Kopi Kenangan offline store');
  assert.equal(doc.totals.exposureTotal, 78_000_000);
});

test('partner logo accepts small PNG/JPEG data URLs only', () => {
  assert.deepEqual(parsePartnerLogo(''), { value: null });
  assert.deepEqual(parsePartnerLogo('data:image/png;base64,iVBORw0KGgo='), { value: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.deepEqual(parsePartnerLogo('data:image/svg+xml;base64,PHN2Zz4='), { error: 'Partner logo must be a PNG or JPEG image.' });
  assert.deepEqual(parsePartnerLogo(`data:image/png;base64,${'A'.repeat(960_000)}`), { error: 'Partner logo must be 700 KB or smaller.' });
});

test('proposal awards match the shared verified award register and AI award claims are guarded', async () => {
  const { DUPOIN_VERIFIED_AWARDS } = await import('../src/lib/brand-fact-guard');
  for (const award of VERIFIED_AWARDS) {
    const entry = DUPOIN_VERIFIED_AWARDS.find(item => item.keys.some(key => award.title.toLowerCase().includes(key)));
    assert.ok(entry, award.title);
    assert.ok((entry.years as readonly string[]).includes(award.year), award.title);
  }
  const input = kopiInput();
  const parsed = parseDraftResponse(JSON.stringify({ projectOverview: 'Dupoin is a lifestyle partner. Dupoin won Best Broker Platform 2023 by Forbes Awards.' }), input);
  assert.ok('content' in parsed);
  assert.equal(parsed.content.projectOverview, 'Dupoin is a lifestyle partner.');
});
