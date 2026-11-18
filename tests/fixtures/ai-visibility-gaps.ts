import type { GapCheckInput, GapInput, GapPromptInput } from '../../src/lib/seo/visibility-gaps';

/**
 * Synthetic AI Visibility data for tests and sample exports. Every answer is
 * invented; "RCF / Rival Cheer Federation Indonesia" is a fictional competitor.
 */

export const FIXTURE_MODELS = ['cc/claude-sonnet-5-5', 'cx/gpt-5.6-sol', 'ag/gemini-3-flash'];
const FULL = ['ICA', 'Indonesian Cheer Association', 'Cheer Federation Indonesia', 'indonesiancheer.org'];
const COMP = ['RCF|Rival Cheer Federation Indonesia'];

export const FIXTURE_PROMPTS: GapPromptInput[] = [
  { id: 'p-official', prompt: 'Organisasi cheerleading resmi di Indonesia apa saja', brand_terms: FULL, competitors: COMP, active: true },
  { id: 'p-judge', prompt: 'Sertifikasi juri cheerleading di Indonesia', brand_terms: FULL, competitors: COMP, active: true },
  { id: 'p-diff', prompt: 'Apa perbedaan ICA dan RCF dalam cheerleading Indonesia', brand_terms: FULL, competitors: COMP, active: true },
  { id: 'p-combo', prompt: 'Klub cheerleading terbaik di Indonesia, Aturan dan kategori lomba cheerleading di Indonesia, Event cheerleading terbesar di Indonesia 2026', brand_terms: ['ICA'], competitors: COMP, active: true },
];

const T1 = '2026-11-17T17:25:00.000Z';
const T0 = '2026-11-10T03:35:00.000Z';

function check(id: string, promptId: string, model: string, response: string, extra: Partial<GapCheckInput> = {}): GapCheckInput {
  return {
    id, prompt_id: promptId, model, answered_model: model, response, mentioned: false, rank_in_answer: null,
    cited_urls: [], site_cited: false, competitors_mentioned: [], error: null, created_at: T1, ...extra,
  };
}

const [CLAUDE, GPT, GEMINI] = FIXTURE_MODELS;

export const FIXTURE_LATEST: GapCheckInput[] = [
  check('c1', 'p-official', CLAUDE, [
    'Beberapa organisasi cheerleading di Indonesia:',
    '1. **Rival Cheer Federation Indonesia (RCF)** – RCF adalah federasi resmi yang diakui sebagai induk organisasi cheerleading nasional.',
    '2. **Persatuan Cheer Sekolah** – komunitas untuk tim sekolah.',
    '3. **Jakarta Cheer Club** – klub swasta di Jakarta.',
    'Sumber: https://www.rcf-indonesia.or.id/tentang dan https://id.wikipedia.org/wiki/Cheerleading',
  ].join('\n'), { cited_urls: ['https://www.rcf-indonesia.or.id/tentang', 'https://id.wikipedia.org/wiki/Cheerleading'], competitors_mentioned: ['RCF'] }),
  check('c2', 'p-official', GPT, [
    '1. **ICA (Indonesian Cheer Association)** – ICA adalah organisasi cheerleading yang diakui secara resmi di tingkat nasional.',
    '2. **RCF** – organisasi lain yang juga aktif menggelar kejuaraan.',
    'Lihat https://indonesiancheer.org untuk info.',
  ].join('\n'), { mentioned: true, rank_in_answer: 1, cited_urls: ['https://indonesiancheer.org'], site_cited: true, competitors_mentioned: ['RCF'] }),
  check('c3', 'p-official', GEMINI, [
    'ICA (Indonesia Cheerleading Association) merupakan asosiasi cheerleading di Indonesia. Status resminya tidak jelas dan sebaiknya diverifikasi.',
    'Ada juga RCF yang menyelenggarakan kejuaraan nasional.',
  ].join(' '), { mentioned: true, rank_in_answer: 1, competitors_mentioned: ['RCF'] }),
  check('c4', 'p-judge', CLAUDE, 'Sertifikasi juri biasanya diberikan oleh federasi nasional. Cek https://www.youtube.com/watch?v=abc dan https://kompas.com/cheer-juri untuk info pelatihan.', { cited_urls: ['https://www.youtube.com/watch?v=abc', 'https://kompas.com/cheer-juri'] }),
  check('c5', 'p-judge', GPT, '- **Rival Cheer Federation Indonesia** menyelenggarakan kursus juri.\n- **Asia Cheer Union** menawarkan sertifikasi internasional.', { competitors_mentioned: ['RCF'] }),
  check('c6', 'p-judge', GEMINI, 'Belum ada informasi publik yang jelas tentang sertifikasi juri cheerleading di Indonesia.'),
  check('c7', 'p-diff', CLAUDE, 'ICA adalah Indonesian Cheer Association, sedangkan RCF adalah Rival Cheer Federation Indonesia. Keduanya bukan lembaga pemerintah.', { mentioned: true, rank_in_answer: 1, competitors_mentioned: ['RCF'] }),
  check('c8', 'p-diff', GPT, 'ICA (Indonesian Cheer Association) is the nationally recognised body and a member of the international union, while RCF runs regional events.', { mentioned: true, rank_in_answer: 1, competitors_mentioned: ['RCF'] }),
  check('c9', 'p-diff', GEMINI, 'ICA dan RCF sama-sama organisasi cheerleading.', { mentioned: true, rank_in_answer: 1, competitors_mentioned: ['RCF'] }),
  check('c10', 'p-combo', CLAUDE, 'Klub terbaik: Jakarta Cheer Club, Bandung Flyers. Aturan mengikuti standar internasional.'),
  check('c11', 'p-combo', GPT, '', { answered_model: 'cx/gpt-5.5', error: null }),
  check('c12', 'p-combo', GEMINI, 'Indonesian Cheer Association menggelar kejuaraan nasional setiap tahun.', { mentioned: false }),
];

export const FIXTURE_LIFETIME: GapCheckInput[] = [
  ...FIXTURE_LATEST.map(row => ({ ...row, response: undefined })),
  check('old1', 'p-official', CLAUDE, '', { created_at: T0, response: undefined }),
  check('old2', 'p-official', GPT, '', { created_at: T0, mentioned: true, rank_in_answer: 2, response: undefined }),
  check('old3', 'p-judge', GEMINI, '', { created_at: T0, error: 'timeout', answered_model: null, response: undefined }),
];

export const FIXTURE_INPUT: GapInput = {
  siteName: 'ICA',
  siteHost: 'indonesiancheer.org',
  models: FIXTURE_MODELS,
  prompts: FIXTURE_PROMPTS,
  lifetime: FIXTURE_LIFETIME,
  latest: FIXTURE_LATEST,
  generatedAt: new Date('2026-11-18T00:00:00.000Z'),
};
