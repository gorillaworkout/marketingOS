import type { FaqAskMessage, FaqCitation } from './FaqAskPanel';

export const FAQ_ASK_SESSION_KEY = 'mos.faq-ask.messages';

/** Newest questions kept across a refresh. Older than this drop off the front of the store. */
export const FAQ_ASK_STORED_MESSAGE_LIMIT = 100;
const MAX_CONTENT = 8000;
const MAX_CITATIONS = 8;

export function capFaqAskMessages<T extends { role: 'user' | 'assistant' }>(
  messages: T[],
  limit = FAQ_ASK_STORED_MESSAGE_LIMIT,
): T[] {
  if (messages.length <= limit) return messages;
  const sliced = messages.slice(-limit);
  if (sliced[0]?.role === 'assistant') return sliced.slice(1);
  return sliced;
}

export interface FaqAskStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storedCitation(value: unknown): FaqCitation | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.documentId !== 'string' || !row.documentId.trim()) return null;
  if (typeof row.title !== 'string' || !row.title.trim()) return null;
  if (typeof row.url !== 'string') return null;
  if (typeof row.excerpt !== 'string') return null;
  const citation: FaqCitation = {
    documentId: row.documentId.slice(0, 80),
    title: row.title.slice(0, 300),
    url: row.url.slice(0, 500),
    excerpt: row.excerpt.slice(0, 2000),
  };
  if (typeof row.extension === 'string' && row.extension.trim() && row.extension.length <= 12) {
    citation.extension = row.extension.trim();
  }
  return citation;
}

export function parseFaqAskMessages(raw: string | null): FaqAskMessage[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const messages: FaqAskMessage[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.content !== 'string') continue;
    const message: FaqAskMessage = {
      role: row.role,
      content: row.content.slice(0, MAX_CONTENT),
    };
    if (row.confidence === 'high' || row.confidence === 'low' || row.confidence === 'none') {
      message.confidence = row.confidence;
    }
    if (Array.isArray(row.citations)) {
      const citations = row.citations
        .map(storedCitation)
        .filter((entry): entry is FaqCitation => entry !== null)
        .slice(0, MAX_CITATIONS);
      if (citations.length) message.citations = citations;
    }
    messages.push(message);
  }
  return capFaqAskMessages(messages);
}

export function readFaqAskMessages(storage: FaqAskStorage | null): FaqAskMessage[] {
  if (!storage) return [];
  try {
    return parseFaqAskMessages(storage.getItem(FAQ_ASK_SESSION_KEY));
  } catch {
    return [];
  }
}

export function writeFaqAskMessages(storage: FaqAskStorage | null, messages: FaqAskMessage[]): void {
  if (!storage) return;
  try {
    if (!messages.length) {
      storage.removeItem(FAQ_ASK_SESSION_KEY);
      return;
    }
    storage.setItem(FAQ_ASK_SESSION_KEY, JSON.stringify(parseFaqAskMessages(JSON.stringify(messages))));
  } catch {
    // A full or blocked session store should not discard the conversation on screen.
  }
}

const EMPTY_MESSAGES: FaqAskMessage[] = [];
const FAQ_ASK_EVENT = 'faq-ask-messages';
let memory: FaqAskMessage[] | null = null;

export function subscribeFaqAskMessages(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(FAQ_ASK_EVENT, onStoreChange);
  return () => window.removeEventListener(FAQ_ASK_EVENT, onStoreChange);
}

export function getFaqAskServerSnapshot(): FaqAskMessage[] {
  return EMPTY_MESSAGES;
}

export function getFaqAskSnapshot(): FaqAskMessage[] {
  if (memory !== null) return memory;
  if (typeof window === 'undefined') return EMPTY_MESSAGES;
  const loaded = readFaqAskMessages(window.sessionStorage);
  memory = loaded.length ? loaded : EMPTY_MESSAGES;
  return memory;
}

export function saveFaqAskMessages(messages: FaqAskMessage[]): void {
  memory = messages.length ? messages : EMPTY_MESSAGES;
  if (typeof window === 'undefined') return;
  writeFaqAskMessages(window.sessionStorage, memory);
  window.dispatchEvent(new Event(FAQ_ASK_EVENT));
}
