import type { FaqAskMessage } from './FaqAskPanel';

/** Only the current Ask stays on screen. The previous exchange moves to History Search as soon as a new question is submitted. */
export const FAQ_ASK_RECENT_TURNS = 1;

export interface FaqAskTurn {
  index: number;
  question: string;
  answer: string;
  messages: FaqAskMessage[];
}

export function groupFaqAskTurns(messages: readonly FaqAskMessage[]): FaqAskTurn[] {
  const turns: FaqAskTurn[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === 'assistant') {
      turns.push({
        index,
        question: '',
        answer: message.content,
        messages: [message],
      });
      continue;
    }
    const next = messages[index + 1];
    const answered = next?.role === 'assistant' ? next : undefined;
    turns.push({
      index,
      question: message.content,
      answer: answered?.content || '',
      messages: answered ? [message, answered] : [message],
    });
    if (answered) index += 1;
  }
  return turns;
}

export function earlierAskTurns(messages: readonly FaqAskMessage[], recent = FAQ_ASK_RECENT_TURNS): FaqAskTurn[] {
  const turns = groupFaqAskTurns(messages);
  return turns.slice(0, Math.max(0, turns.length - recent));
}

export function askHistorySnippet(text: string, max = 140): string {
  const plain = text.replace(/\s+/g, ' ').trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1).trim()}…`;
}

export function searchAskHistory(turns: readonly FaqAskTurn[], query: string): FaqAskTurn[] {
  const needle = query.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!needle) return [...turns];
  return turns.filter(turn => `${turn.question}\n${turn.answer}`.toLowerCase().includes(needle));
}

/** History list. An empty query is older turns only; a query searches every saved question. */
export function faqAskHistoryEntries(
  messages: readonly FaqAskMessage[],
  query: string,
  recent = FAQ_ASK_RECENT_TURNS,
): FaqAskTurn[] {
  const turns = groupFaqAskTurns(messages);
  const needle = query.replace(/\s+/g, ' ').trim();
  if (!needle) return turns.slice(0, Math.max(0, turns.length - recent));
  return searchAskHistory(turns, needle);
}

export function visibleAskMessages(
  messages: readonly FaqAskMessage[],
  focusedIndex: number | null,
  recent = FAQ_ASK_RECENT_TURNS,
): FaqAskMessage[] {
  const turns = groupFaqAskTurns(messages);
  if (focusedIndex != null) {
    const focused = turns.find(turn => turn.index === focusedIndex);
    if (focused) return focused.messages;
  }
  return turns.slice(-recent).flatMap(turn => turn.messages);
}
