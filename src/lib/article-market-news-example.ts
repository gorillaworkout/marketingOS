export interface ExampleCompetitorStructure {
  h1: string;
  h2: string;
  h3: string;
}

export const ARTICLE_MARKET_NEWS_EXAMPLE_KEYWORD = 'harga emas';

export const ARTICLE_MARKET_NEWS_EXAMPLE_ANGLE =
  'Membahas pergerakan harga emas hari ini, faktor pendorongnya, dan hal yang perlu diperhatikan trader pemula.';

export const ARTICLE_MARKET_NEWS_EXAMPLE_COMPETITORS: readonly ExampleCompetitorStructure[] = [
  {
    h1: 'Harga Emas Hari Ini',
    h2: 'Faktor Penggerak Harga Emas',
    h3: 'Risiko yang Perlu Diperhatikan',
  },
  {
    h1: 'Update Harga Emas Spot',
    h2: 'Pengaruh Dolar AS dan Suku Bunga',
    h3: 'Level yang Dipantau Trader',
  },
  {
    h1: 'Emas Menguat di Pasar Global',
    h2: 'Permintaan Bank Sentral',
    h3: 'Dampak ke XAUUSD',
  },
  {
    h1: 'Analisis Harga Emas Harian',
    h2: 'Data Ekonomi yang Menggerakkan Emas',
    h3: 'Skenario Naik dan Turun',
  },
  {
    h1: 'Panduan Membaca Pergerakan Emas',
    h2: 'Perbedaan Emas Fisik dan XAUUSD',
    h3: 'Kesalahan Umum Trader Pemula',
  },
];

export const ARTICLE_MARKET_NEWS_EXAMPLE_PAA = [
  'Apa yang memengaruhi harga emas hari ini?',
  'Mengapa harga emas dapat naik atau turun?',
  'Bagaimana hubungan dolar AS dengan harga emas?',
  'Apa perbedaan emas fisik dan XAUUSD?',
  'Apa risiko trading emas untuk pemula?',
] as const;

export function formatExampleCompetitorHeadings(
  competitors: readonly ExampleCompetitorStructure[] = ARTICLE_MARKET_NEWS_EXAMPLE_COMPETITORS,
): string {
  return competitors
    .map((block, index) => `Competitor ${index + 1}:\nH1: ${block.h1}\nH2: ${block.h2}\nH3: ${block.h3}`)
    .join('\n\n');
}

export function formatExamplePaaText(
  questions: readonly string[] = ARTICLE_MARKET_NEWS_EXAMPLE_PAA,
): string {
  return questions.join('\n');
}

export const exampleCompetitorHeadings = formatExampleCompetitorHeadings();
export const examplePaaText = formatExamplePaaText();
