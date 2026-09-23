import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMPLIANCE_BANNER_TEXT,
  scanResearchCompliance,
} from '../src/lib/ai-research-compliance';
import { DUPOIN_ACCOUNT_CTA_SENTENCE } from '../src/lib/article-market-news';

const read = (path: string) => readFileSync(path, 'utf8');

test('compliance banner flags guaranteed returns and pressure, not the normal Dupoin CTA', () => {
  assert.equal(COMPLIANCE_BANNER_TEXT, 'Perhatian compliance — review sebelum dipakai ke konten publik.');

  const calm = scanResearchCompliance(
    `Harga emas bergerak mengikuti dolar.\n\n${DUPOIN_ACCOUNT_CTA_SENTENCE}`,
  );
  assert.equal(calm.flagged, false);

  const market = scanResearchCompliance('The dollar return after the Fed decision was mixed. Tidak ada imbal hasil yang dijamin.');
  assert.equal(market.flagged, false);

  const guaranteed = scanResearchCompliance('Strategi ini pasti untung dan risk-free untuk semua trader.');
  assert.equal(guaranteed.flagged, true);
  assert.equal(guaranteed.flags[0]?.kind, 'guaranteed-return');
  assert.match(guaranteed.flags[0]?.excerpt || '', /pasti untung/);

  const english = scanResearchCompliance('This setup offers a guaranteed return with no chance of loss.');
  assert.ok(english.flags.some(flag => flag.kind === 'guaranteed-return'));

  const pressure = scanResearchCompliance(
    `${DUPOIN_ACCOUNT_CTA_SENTENCE} Segera buka akun sekarang juga sebelum terlambat.`,
  );
  assert.equal(pressure.flags.some(flag => flag.kind === 'aggressive-solicitation'), true);
  assert.equal(pressure.flags.some(flag => flag.kind === 'guaranteed-return'), false);

  const hardSell = scanResearchCompliance('Buruan deposit sekarang juga. Segera hubungi kami sekarang juga.');
  assert.equal(hardSell.flags[0]?.kind, 'aggressive-solicitation');

  assert.equal(scanResearchCompliance('').flagged, false);
});

test('the research answer shows the compliance banner without blocking the reply', () => {
  const tools = read('src/components/AiResearchAnswerTools.tsx');
  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(tools, /COMPLIANCE_BANNER_TEXT/);
  assert.match(tools, /data-testid="ai-research-compliance"/);
  assert.match(tools, /border-amber-400/);
  assert.doesNotMatch(tools, /legal|dilarang|melanggar hukum/i);
  assert.match(page, /AiResearchAnswerTools/);
});
