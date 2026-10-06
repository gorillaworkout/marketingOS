import { createHash } from 'node:crypto';

export const CHAT_IMPORT_SOURCES = ['codex', 'claude', 'text'] as const;
export type ChatImportSource = (typeof CHAT_IMPORT_SOURCES)[number];
export type ImportParser = 'codex' | 'claude' | 'text';
export type ImportMessage = { role: 'user' | 'assistant'; content: string };

export const IMPORT_CHAT_CHAR_LIMIT = 200_000;
export const IMPORT_FILE_BYTE_LIMIT = 5 * 1024 * 1024;

export class MultiChatImportError extends Error {
  constructor() {
    super('Import one chat at a time.');
    this.name = 'MultiChatImportError';
  }
}

export type ParsedChat = {
  title: string;
  messages: ImportMessage[];
  parser: ImportParser;
  parserFallback: boolean;
  transcript: string;
  contentHash: string;
};

const USER_LABELS = new Set(['you', 'user', 'human']);
const SPEAKER = /^(you|user|human|assistant|claude|chatgpt|codex):\s*(.*)$/i;

export function isChatImportSource(value: unknown): value is ChatImportSource {
  return typeof value === 'string' && (CHAT_IMPORT_SOURCES as readonly string[]).includes(value);
}

export function normalizeMessageContent(content: string): string {
  const normalized = content.normalize('NFKC').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
  const lines = normalized.split('\n');
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start += 1;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(start, end).join('\n');
}

export function canonicalTranscript(messages: ImportMessage[]): string {
  return messages.map(message => `${message.role}\n${normalizeMessageContent(message.content)}`).join('\n---\n');
}

export function chatContentHash(messages: ImportMessage[]): string {
  return createHash('sha256').update(canonicalTranscript(messages)).digest('hex');
}

function clipTitle(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  return trimmed.length > 80 ? trimmed.slice(0, 80).trimEnd() : trimmed;
}

function fallbackTitle(messages: ImportMessage[], exportTitle?: string): string {
  const fromExport = exportTitle ? clipTitle(exportTitle) : '';
  if (fromExport) return fromExport;
  const firstUser = messages.find(message => message.role === 'user');
  if (firstUser) {
    const clipped = clipTitle(firstUser.content);
    if (clipped) return clipped;
  }
  return 'Imported chat';
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return '';
  const record = content as { parts?: unknown; text?: unknown };
  if (Array.isArray(record.parts)) return record.parts.filter((part): part is string => typeof part === 'string').join('\n');
  if (typeof record.text === 'string') return record.text;
  return '';
}

function pushMessage(messages: ImportMessage[], role: unknown, content: unknown) {
  if (role !== 'user' && role !== 'assistant') return;
  const text = normalizeMessageContent(messageText(content));
  if (!text) return;
  messages.push({ role, content: text });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function oneConversation(value: unknown): Record<string, unknown> | 'multi' | null {
  if (Array.isArray(value)) {
    if (value.length !== 1) return 'multi';
    return asRecord(value[0]);
  }
  const record = asRecord(value);
  if (!record) return null;
  if (Array.isArray(record.conversations)) {
    if (record.conversations.length !== 1) return 'multi';
    return asRecord(record.conversations[0]);
  }
  return record;
}

function walkMapping(mapping: Record<string, unknown>): ImportMessage[] {
  const messages: ImportMessage[] = [];
  const visited = new Set<string>();
  const roots = Object.keys(mapping).filter(key => {
    const node = asRecord(mapping[key]);
    return Boolean(node && node.parent == null);
  });
  const visit = (key: string) => {
    if (visited.has(key)) return;
    visited.add(key);
    const node = asRecord(mapping[key]);
    if (!node) return;
    const message = asRecord(node.message);
    if (message) {
      const author = asRecord(message.author);
      const role = typeof message.role === 'string' ? message.role : author?.role;
      pushMessage(messages, role, message.content);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      if (typeof child === 'string') visit(child);
    }
  };
  for (const root of roots) visit(root);
  return messages;
}

function parseCodexConversation(record: Record<string, unknown>): { messages: ImportMessage[]; title?: string } {
  const title = typeof record.title === 'string' ? record.title : undefined;
  if (Array.isArray(record.messages)) {
    const messages: ImportMessage[] = [];
    for (const item of record.messages) {
      const message = asRecord(item);
      if (!message || typeof message.content !== 'string') continue;
      pushMessage(messages, message.role, message.content);
    }
    if (messages.length) return { messages, title };
  }
  const mapping = asRecord(record.mapping);
  if (mapping) return { messages: walkMapping(mapping), title };
  return { messages: [], title };
}

function parseClaudeConversation(record: Record<string, unknown>): { messages: ImportMessage[]; title?: string } {
  const named = typeof record.name === 'string' ? record.name : '';
  const titled = typeof record.title === 'string' ? record.title : '';
  const title = named || titled || undefined;
  const messages: ImportMessage[] = [];
  const rows = Array.isArray(record.chat_messages) ? record.chat_messages : [];
  for (const item of rows) {
    const message = asRecord(item);
    if (!message) continue;
    const sender = message.sender === 'human' ? 'user' : message.sender === 'assistant' ? 'assistant' : null;
    if (!sender) continue;
    if (typeof message.text === 'string' && message.text.trim()) {
      pushMessage(messages, sender, message.text);
      continue;
    }
    if (Array.isArray(message.content)) {
      const text = message.content.map(block => {
        const row = asRecord(block);
        if (!row || row.type !== 'text' || typeof row.text !== 'string') return '';
        return row.text;
      }).filter(Boolean).join('\n');
      pushMessage(messages, sender, text);
    }
  }
  return { messages, title };
}

function parsePlainText(raw: string): ImportMessage[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const messages: ImportMessage[] = [];
  let role: 'user' | 'assistant' | null = null;
  let buffer: string[] = [];
  let labeled = false;
  const flush = () => {
    if (!role) return;
    pushMessage(messages, role, buffer.join('\n'));
    buffer = [];
  };
  for (const line of lines) {
    const match = line.match(SPEAKER);
    if (match) {
      labeled = true;
      flush();
      role = USER_LABELS.has(match[1].toLowerCase()) ? 'user' : 'assistant';
      buffer = [match[2] ?? ''];
      continue;
    }
    if (role) buffer.push(line);
  }
  flush();
  if (!labeled || messages.length === 0) {
    const whole = normalizeMessageContent(raw);
    return whole ? [{ role: 'user', content: whole }] : [];
  }
  return messages;
}

function finish(parser: ImportParser, parserFallback: boolean, messages: ImportMessage[], exportTitle?: string): ParsedChat {
  return {
    title: fallbackTitle(messages, exportTitle),
    messages,
    parser,
    parserFallback,
    transcript: canonicalTranscript(messages),
    contentHash: chatContentHash(messages),
  };
}

export function parseImportedChat(source: ChatImportSource, raw: string): ParsedChat {
  if (source === 'text') return finish('text', false, parsePlainText(raw));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return finish('text', true, parsePlainText(raw));
  }
  const conversation = oneConversation(parsed);
  if (conversation === 'multi') throw new MultiChatImportError();
  if (!conversation) return finish('text', true, parsePlainText(raw));
  const extracted = source === 'codex' ? parseCodexConversation(conversation) : parseClaudeConversation(conversation);
  if (!extracted.messages.length) return finish('text', true, parsePlainText(raw));
  return finish(source, false, extracted.messages, extracted.title);
}

export function importPasteError(text: string): { status: 400 | 413; error: string } | null {
  if (text.length > IMPORT_CHAT_CHAR_LIMIT) return { status: 413, error: 'Paste is limited to 200,000 characters.' };
  if (!text.trim()) return { status: 400, error: 'Add a chat to import.' };
  return null;
}

export function importFileError(input: { filename: string; bytes: number; text: string | null }): { status: 400 | 413; error: string } | null {
  const name = input.filename.toLowerCase();
  if (!name.endsWith('.md') && !name.endsWith('.txt') && !name.endsWith('.json')) {
    return { status: 400, error: 'Use a .md, .txt, or .json file.' };
  }
  if (input.bytes > IMPORT_FILE_BYTE_LIMIT) return { status: 413, error: 'File is limited to 5 MB.' };
  if (input.text == null) return { status: 400, error: 'That file is not valid UTF-8 text.' };
  if (input.text.length > IMPORT_CHAT_CHAR_LIMIT) return { status: 413, error: 'Chat is limited to 200,000 characters.' };
  if (!input.text.trim()) return { status: 400, error: 'Add a chat to import.' };
  return null;
}

export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
