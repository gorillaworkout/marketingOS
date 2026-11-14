import { normalizeArticleMarketNewsInput, type ArticleMarketNewsInput, type ArticleSourceInput } from '../../src/lib/article-market-news';

/** Fixtures from the 2026-11-14 production final retest: the DOCX download stayed locked in 3 of 4 runs. */
const DATE = '2026-11-14';
const filler = (topic: string, n: number) => Array.from({ length: n }, (_, i) => (i % 12 === 11 ? `${topic}.` : 'pasar')).join(' ');

export const CTA = 'Buka akun Dupoin untuk memantau pergerakan pasar dengan pengelolaan risiko.';

function paa(keyword: string): string[] {
  return [
    `Apa yang memengaruhi ${keyword} hari ini?`,
    `Mengapa ${keyword} bergerak tajam?`,
    `Bagaimana suku bunga memengaruhi ${keyword}?`,
    `Apakah ${keyword} akan naik minggu ini?`,
    `Apa risiko trading ${keyword}?`,
  ];
}

function makeInput(keyword: string, sources: ArticleSourceInput[]): ArticleMarketNewsInput {
  return normalizeArticleMarketNewsInput({
    keyword,
    researchDate: DATE,
    angle: `Pergerakan ${keyword} dan respons trader.`,
    competitorHeadings: Array.from({ length: 5 }, (_, i) => `Competitor ${i + 1}:\nH1: ${keyword}\nH2: Faktor\nH3: Risiko`).join('\n\n'),
    paaQuestions: paa(keyword),
    noCompetitorBroker: true,
    factsVerified: true,
    sources,
  }, DATE);
}

function source(outlet: string, url: string, verifiedFacts: string, title = `${outlet} market report`): ArticleSourceInput {
  return { outlet, title, url, publishedAt: `${DATE}T09:30`, verifiedFacts };
}

/** A draft that passes the gate, with `extra` inserted as its own paragraph after the lead. */
export function draft(title: string, input: ArticleMarketNewsInput, lead: string, extra: string[] = [], sourcesExtra: string[] = []): string {
  const questions = input.paaQuestions.map(q => `## ${q}\n${q.replace(/\?$/, '')} bergantung pada data yang dirangkum sumber di atas dan sentimen pasar yang berubah cepat.`);
  return [
    `# ${title}`,
    '',
    lead,
    '',
    ...extra.flatMap(paragraph => [paragraph, '']),
    '## Analisis',
    filler(input.keyword, 760),
    '',
    ...questions.flatMap(block => [block, '']),
    CTA,
    '',
    '## Sources',
    ...input.sources.map(s => `- ${s.outlet} — ${s.publishedAt.slice(0, 10)} — ${s.url}`),
    ...sourcesExtra,
  ].join('\n');
}

// 1. Silver: "Unsupported numeric claims detected: 2.73%".
export const silverInput = makeInput('Silver', [
  source('Reuters', 'https://www.reuters.com/markets/commodities/silver-2026-11-14/', 'Open-web full-page excerpt: Silver rose 1,9% to $31.42 an ounce as the dollar weakened.'),
  source('Kitco', 'https://www.kitco.com/news/silver-2026-11-14/', 'Spot silver gained 2,1 percent in Asian trade on safe-haven demand.'),
]);
export const SILVER_TITLE = 'Silver Menguat karena Dolar Melemah';
export const silverLead = 'Harga Silver naik 1,9% ke $31.42 per ons (Reuters, 14 Nov 2026), dan sempat menguat 2,1% di sesi Asia (Kitco, 14 Nov 2026).';
export const silverInvented = 'Secara mingguan, Silver diperkirakan sudah melonjak 2.73% sejak awal pekan.';

// 2. S&P 500: a FRED reference with no attribution to the research list.
export const spxInput = makeInput('S&P 500', [
  source('Reuters', 'https://www.reuters.com/markets/us/sp500-2026-11-14/', 'Open-web full-page excerpt: The S&P 500 fell 0,8% to 6.512,4 points as technology shares weighed on the index.'),
  source('Kontan', 'https://investasi.kontan.co.id/news/wall-street-melemah', 'Wall Street ditutup melemah karena investor menunggu data inflasi dan sinyal suku bunga dari The Fed.'),
]);
export const SPX_TITLE = 'S&P 500 Melemah karena Saham Teknologi';
export const spxLead = 'Indeks S&P 500 turun 0,8% ke 6.512,4 poin (Reuters, 14 Nov 2026), sementara investor menunggu data inflasi (Kontan, 14 Nov 2026).';
export const spxFred = 'Menurut data FRED, imbal hasil obligasi 10 tahun ikut menekan valuasi saham teknologi.';
export const spxFredSourceLine = '- FRED — https://fred.stlouisfed.org/series/DGS10';

// 3. Silver + Apple: conflicting EPS figures for the same metric.
export const silverAppleInput = makeInput('Silver Apple', [
  source('Reuters', 'https://www.reuters.com/technology/apple-2026-11-14/', 'Open-web full-page excerpt: Apple reported EPS of $1.64 for the quarter, while silver rose 1,9%.'),
  source('CNBC', 'https://www.cnbc.com/2026/11/14/apple-silver.html', 'Apple shares rose 2% after earnings; silver held near $31.42 an ounce.'),
]);
export const SILVER_APPLE_TITLE = 'Silver Apple: Emas Putih dan Saham Teknologi';
export const silverAppleLead = 'Silver Apple menjadi sorotan: Apple membukukan EPS US$1,64 (Reuters, 14 Nov 2026), dan saham Apple naik 2% (CNBC, 14 Nov 2026).';
export const appleEpsConflict = 'Di bagian lain, EPS Apple disebut mencapai US$1,58 pada kuartal yang sama.';
