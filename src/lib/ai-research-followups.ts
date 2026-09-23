export const AI_RESEARCH_FOLLOW_UP_MIN = 3;
export const AI_RESEARCH_FOLLOW_UP_MAX = 5;

const MIN_ANSWER_CHARS = 20;

const LEADING_REQUEST = /^(tolong\s+)?(bisa\s+)?(jelaskan|rangkum|ringkas|analisis|analisa|bandingkan|banding|cari|carikan|buatkan|buat|tulis|tuliskan)\s+/i;
const LEADING_QUESTION = /^(siapa|siapakah|apa|apakah|bagaimana|mengapa|kenapa|kapan|di\s+mana|dimana|berapa|why|what|who|how|when|where)\s+/i;

type FollowUpIntent = 'person' | 'compare' | 'strategy' | 'data' | 'url' | 'general';

export interface FollowUpSource {
  title?: string;
  url?: string;
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function topicPhrase(query: string): string {
  let text = query.replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim();
  text = text.replace(/[?!.]+$/g, '').trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const next = text.replace(LEADING_REQUEST, '').replace(LEADING_QUESTION, '').trim();
    if (next === text) break;
    text = next;
  }
  text = text.replace(/\b(hari ini|menurut sumber)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > 72) {
    const cut = text.slice(0, 72);
    const space = cut.lastIndexOf(' ');
    text = (space > 24 ? cut.slice(0, space) : cut).trim();
  }
  return text.length >= 3 ? text : '';
}

function classifyIntent(query: string, topic: string): FollowUpIntent {
  const haystack = normalized(query);
  const urlOnly = /https?:\/\//i.test(query) && topic.length < 12;
  if (urlOnly) return 'url';
  if (/\b(siapa|siapakah|who is|who's)\b/.test(haystack)) return 'person';
  if (/\b(bandingkan|perbedaan|versus|\bvs\b|compare)\b/.test(haystack)) return 'compare';
  if (/\b(strategi|konten|kampanye|campaign|instagram|marketing|iklan)\b/.test(haystack)) return 'strategy';
  if (/\b(harga|angka|data|berapa|statistik|tren|trend|price)\b/.test(haystack)) return 'data';
  if (/https?:\/\//i.test(query)) return 'url';
  return 'general';
}

function usableSourceTitle(title?: string): string | null {
  const text = (title || '').replace(/\s+/g, ' ').trim();
  if (text.length < 6 || text.length > 80) return null;
  if (/^https?:\/\//i.test(text) || /^www\./i.test(text)) return null;
  return text.length > 60 ? `${text.slice(0, 57).trim()}…` : text;
}

function templatesFor(intent: FollowUpIntent, topic: string, sources: FollowUpSource[]): string[] {
  const subject = topic || 'topik ini';
  const sourceTitle = sources.map(source => usableSourceTitle(source.title)).find(Boolean) || null;
  const sourceChip = sourceTitle ? [`Apa isi utama dari "${sourceTitle}"?`] : [];
  const shared = [
    'Apa implikasinya untuk tim marketing Dupoin?',
    'Apa yang masih belum jelas dari jawaban ini?',
    'Langkah praktis apa yang bisa dikerjakan minggu ini?',
  ];

  if (intent === 'person') {
    return [
      `Apa peran ${subject} yang disebutkan sumber?`,
      `Jejak publik lain apa yang terkait ${subject}?`,
      ...sourceChip,
      `Lembaga atau perusahaan mana yang disebut bersama ${subject}?`,
      `Fakta mana tentang ${subject} yang belum terkonfirmasi?`,
      ...shared,
    ];
  }
  if (intent === 'compare') {
    return [
      'Apa perbedaan paling penting dari perbandingan ini?',
      'Opsi mana yang lebih relevan untuk tim marketing Dupoin?',
      ...sourceChip,
      'Risiko apa yang ada pada masing-masing opsi?',
      'Data apa yang masih kurang untuk membandingkannya?',
      ...shared,
    ];
  }
  if (intent === 'strategy') {
    return [
      'Apa 5 langkah yang bisa dikerjakan minggu ini?',
      'Kanal mana yang paling cocok untuk eksekusi pertama?',
      ...sourceChip,
      'Bagaimana cara mengukur keberhasilan pendekatan ini?',
      'Risiko atau kendala apa yang perlu diantisipasi?',
      ...shared,
    ];
  }
  if (intent === 'data') {
    return [
      'Angka mana yang paling penting dari temuan ini?',
      'Bagaimana angkanya dibanding periode sebelumnya?',
      ...sourceChip,
      'Sumber mana yang menyebut angka tersebut?',
      'Apa implikasi angka ini untuk keputusan marketing?',
      ...shared,
    ];
  }
  if (intent === 'url') {
    return [
      'Apa poin paling penting dari halaman yang dilampirkan?',
      'Angka atau data apa yang disebut di tautan itu?',
      ...sourceChip,
      'Apa yang tidak dijelaskan di halaman tersebut?',
      'Bagaimana isi tautan ini relevan untuk tim marketing Dupoin?',
      ...shared,
    ];
  }
  return [
    `Apa yang belum dijawab tentang ${subject}?`,
    `Bisakah kamu ringkas ${subject} dalam 5 butir?`,
    ...sourceChip,
    `Sumber mana yang paling mendukung jawaban tentang ${subject}?`,
    ...shared,
  ];
}

function looksLikeErrorAnswer(answer: string): boolean {
  return /^(api error|unknown error|server error|an error occurred|failed to|gagal mengambil|pencarian sumber gagal)\b/i.test(answer);
}

export function suggestAiResearchFollowUps(input: {
  query: string;
  answer: string;
  sources?: FollowUpSource[];
}): string[] {
  const answer = (input.answer || '').replace(/\s+/g, ' ').trim();
  const query = (input.query || '').replace(/\s+/g, ' ').trim();
  if (!query || answer.length < MIN_ANSWER_CHARS || looksLikeErrorAnswer(answer)) return [];

  const topic = topicPhrase(query);
  const intent = classifyIntent(query, topic);
  const seen = new Set<string>();
  const queryKey = normalized(query.replace(/[?!.]+$/g, ''));
  const suggestions: string[] = [];

  for (const candidate of templatesFor(intent, topic, input.sources || [])) {
    const text = candidate.replace(/\s+/g, ' ').trim();
    if (!text.endsWith('?') || text.length > 160) continue;
    const key = normalized(text);
    if (!key || key === queryKey || seen.has(key)) continue;
    seen.add(key);
    suggestions.push(text);
    if (suggestions.length >= AI_RESEARCH_FOLLOW_UP_MAX) break;
  }

  return suggestions.length >= AI_RESEARCH_FOLLOW_UP_MIN ? suggestions : [];
}
