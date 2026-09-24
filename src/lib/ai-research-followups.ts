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
  const subject = topic || 'this topic';
  const sourceTitle = sources.map(source => usableSourceTitle(source.title)).find(Boolean) || null;
  const sourceChip = sourceTitle ? [`What is the main point of "${sourceTitle}"?`] : [];
  const shared = [
    'What does this mean for the Dupoin marketing team?',
    'What is still unclear in this answer?',
    'What practical step can be done this week?',
  ];

  if (intent === 'person') {
    return [
      `What role do the sources give ${subject}?`,
      `What other public traces mention ${subject}?`,
      ...sourceChip,
      `Which institution or company is named with ${subject}?`,
      `Which fact about ${subject} is still unconfirmed?`,
      ...shared,
    ];
  }
  if (intent === 'compare') {
    return [
      'What is the most important difference in this comparison?',
      'Which option is more relevant for the Dupoin marketing team?',
      ...sourceChip,
      'What risks does each option have?',
      'What data is still missing for the comparison?',
      ...shared,
    ];
  }
  if (intent === 'strategy') {
    return [
      'What are 5 steps that can be done this week?',
      'Which channel fits the first execution best?',
      ...sourceChip,
      'How should success of this approach be measured?',
      'What risks or constraints should be anticipated?',
      ...shared,
    ];
  }
  if (intent === 'data') {
    return [
      'Which figure matters most in these findings?',
      'How does the figure compare with the previous period?',
      ...sourceChip,
      'Which source states that figure?',
      'What does this figure mean for a marketing decision?',
      ...shared,
    ];
  }
  if (intent === 'url') {
    return [
      'What is the most important point on the attached page?',
      'What figures or data does that link mention?',
      ...sourceChip,
      'What does that page leave unexplained?',
      'How is this link relevant for the Dupoin marketing team?',
      ...shared,
    ];
  }
  return [
    `What is still unanswered about ${subject}?`,
    `Can you summarize ${subject} in 5 bullets?`,
    ...sourceChip,
    `Which source best supports the answer about ${subject}?`,
    ...shared,
  ];
}

function looksLikeErrorAnswer(answer: string): boolean {
  return /^(api error|unknown error|server error|an error occurred|failed to|source search failed|gagal mengambil|pencarian sumber gagal)\b/i.test(answer);
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
