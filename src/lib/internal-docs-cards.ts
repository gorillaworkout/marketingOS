import { isInternalDocVisible, type InternalDocsPrincipal } from './internal-docs-acl';

export const GUIDE_CARD_SUMMARY_MAX = 200;

export interface GuideCardRow {
  id: string;
  title: string;
  access_level: string;
  status: string;
  card_summary?: string | null;
  file_ext?: string | null;
}

export interface GuideCard {
  id: string;
  title: string;
  summary: string;
  extension: string;
}

/** Short blurb stored at index time. Derived from the title and the opening of the guide. */
export function guideCardSummary(title: string, text: string, max = GUIDE_CARD_SUMMARY_MAX): string {
  const titleKey = title.replace(/\s+/g, ' ').trim().toLowerCase();
  const parts: string[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const plain = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*•]\s+/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!plain) continue;
    if (titleKey && plain.toLowerCase() === titleKey) continue;
    parts.push(plain);
  }
  const body = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!body) return '';
  const sentences = body.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [body];
  let summary = '';
  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    const next = summary ? `${summary} ${piece}` : piece;
    if (summary && next.length > max) break;
    summary = next;
    if (summary.length >= 90) break;
  }
  summary = summary.trim();
  if (!summary) return '';
  if (summary.length <= max) return summary;
  const cut = summary.slice(0, max);
  const space = cut.lastIndexOf(' ');
  const clipped = (space >= Math.floor(max * 0.6) ? cut.slice(0, space) : cut).trim();
  return `${clipped}...`;
}

/** Question sent through the existing Ask pipeline when someone chooses a guide card. */
export function guideOverviewQuestion(title: string): string {
  const name = title.replace(/\s+/g, ' ').trim();
  return name ? `What does ${name} cover?` : 'What does this guide cover?';
}

export function guideCardAsk(document: { id: string; title: string }): { question: string; documentId: string } {
  return {
    question: guideOverviewQuestion(document.title),
    documentId: document.id,
  };
}

export function parseGuideDocumentId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9-]{1,80}$/.test(trimmed)) return '';
  return trimmed;
}

export function faqAskRequestBody(input: {
  question: string;
  history: Array<{ role: string; content: string }>;
  documentId?: string;
}): { question: string; history: Array<{ role: string; content: string }>; documentId?: string } {
  const documentId = parseGuideDocumentId(input.documentId);
  const body: { question: string; history: Array<{ role: string; content: string }>; documentId?: string } = {
    question: input.question.trim(),
    history: input.history,
  };
  if (documentId) body.documentId = documentId;
  return body;
}

/** Indexed guides this person is allowed to read. IT-only rows stay hidden for everyone else. */
export function visibleGuideCards(rows: readonly GuideCardRow[], principal: InternalDocsPrincipal): GuideCard[] {
  const cards: GuideCard[] = [];
  for (const row of rows) {
    if (row.status !== 'indexed') continue;
    if (row.access_level !== 'company' && row.access_level !== 'it-only') continue;
    if (!isInternalDocVisible(row.access_level, principal)) continue;
    const title = row.title.replace(/\s+/g, ' ').trim();
    if (!row.id || !title) continue;
    cards.push({
      id: row.id,
      title,
      summary: (row.card_summary || '').replace(/\s+/g, ' ').trim(),
      extension: (row.file_ext || '').trim().toLowerCase(),
    });
  }
  return cards;
}
