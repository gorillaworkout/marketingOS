export const AI_RESEARCH_MAX_PROJECTS = 40;
export const AI_RESEARCH_PROJECT_NAME_MAX = 80;
export const AI_RESEARCH_PROJECT_NOTES_MAX = 2_000;
export const AI_RESEARCH_PROJECT_SUMMARY_MAX = 900;
/** Whole injected project block. Roughly 400 tokens, not the full thread history. */
export const AI_RESEARCH_PROJECT_MEMORY_MAX_CHARS = 1_600;
export const AI_RESEARCH_PROJECT_MEMORY_MAX_TURNS = 6;
export const AI_RESEARCH_PROJECT_MEMORY_TURN_CHARS = 220;
export const AI_RESEARCH_INBOX_PROJECT = 'inbox';

export interface ProjectMemoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProjectMemoryInput {
  name: string;
  notes?: string;
  summary?: string;
  recentTurns?: ProjectMemoryTurn[];
}

function clip(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function normalizeProjectName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Nama proyek wajib diisi.');
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('Nama proyek wajib diisi.');
  return name.slice(0, AI_RESEARCH_PROJECT_NAME_MAX);
}

export function normalizeProjectNotes(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error('Catatan proyek tidak valid.');
  return value.replace(/\r\n/g, '\n').trim().slice(0, AI_RESEARCH_PROJECT_NOTES_MAX);
}

export function normalizeProjectId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  if (!id || id === AI_RESEARCH_INBOX_PROJECT) return undefined;
  if (id.length > 80) throw new Error('Proyek tidak valid.');
  return id;
}

/** Inbox is every conversation with no project. A project only sees its own threads. */
export function conversationBelongsToProject(
  conversationProjectId: string | null | undefined,
  activeProjectId: string | null,
): boolean {
  if (!activeProjectId) return !conversationProjectId;
  return conversationProjectId === activeProjectId;
}

export function appendProjectSummary(previous: string, userText: string, assistantText: string): string {
  const user = clip(userText, 180);
  const assistant = clip(assistantText, 280);
  if (!user && !assistant) return previous.replace(/\r\n/g, '\n').trim().slice(-AI_RESEARCH_PROJECT_SUMMARY_MAX);
  const line = `User: ${user || '(tanpa teks)'}\nAsisten: ${assistant || '(tanpa jawaban)'}`;
  const prior = previous.replace(/\r\n/g, '\n').trim();
  const combined = [prior, line].filter(Boolean).join('\n');
  if (combined.length <= AI_RESEARCH_PROJECT_SUMMARY_MAX) return combined;
  const tail = combined.slice(combined.length - AI_RESEARCH_PROJECT_SUMMARY_MAX);
  return tail.replace(/^\S*\s/, '').trim();
}

/**
 * Threads are newest-first. Returns the latest turns, oldest-to-newest, under the char cap.
 */
export function selectProjectMemoryTurns(
  threads: Array<Array<{ role: 'user' | 'assistant'; content: string }>>,
  options: { maxTurns?: number; maxChars?: number } = {},
): ProjectMemoryTurn[] {
  const maxTurns = options.maxTurns ?? AI_RESEARCH_PROJECT_MEMORY_MAX_TURNS;
  const maxChars = options.maxChars ?? 900;
  const chronological = [...threads].reverse();
  const flat: ProjectMemoryTurn[] = [];
  for (const thread of chronological) {
    for (const message of thread) {
      if (message.role !== 'user' && message.role !== 'assistant') continue;
      const content = clip(message.content || '', AI_RESEARCH_PROJECT_MEMORY_TURN_CHARS);
      if (!content) continue;
      flat.push({ role: message.role, content });
    }
  }
  const tail = flat.slice(-maxTurns);
  while (tail.length > 1 && tail.reduce((sum, turn) => sum + turn.content.length, 0) > maxChars) {
    tail.shift();
  }
  if (tail.length === 1 && tail[0].content.length > maxChars) {
    tail[0] = { ...tail[0], content: clip(tail[0].content, maxChars) };
  }
  return tail;
}

export function buildProjectMemoryBlock(input: ProjectMemoryInput): string {
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (!name) return '';
  const lines = [
    'KONTEKS PROYEK RISET (ingatan di dalam proyek ini; bukan bukti web baru):',
    `Nama proyek: ${name}`,
    'Gunakan konteks ini hanya untuk menjaga kelanjutan percakapan di proyek yang sama. Jangan mengarang fakta, harga, atau angka yang tidak ada di konteks ini atau di sumber riset. Jika konteks tidak cukup, katakan belum tercatat di proyek.',
  ];
  const notes = clip(input.notes || '', 600);
  if (notes) {
    lines.push('Catatan sematan:');
    lines.push(notes);
  }
  const summary = clip(input.summary || '', 700);
  if (summary) {
    lines.push('Ringkasan percakapan proyek:');
    lines.push(summary);
  }
  const turns = input.recentTurns || [];
  if (turns.length) {
    lines.push('Giliran terbaru dari utas lain di proyek ini:');
    for (const turn of turns) {
      lines.push(`${turn.role === 'user' ? 'User' : 'Asisten'}: ${turn.content}`);
    }
  }
  const text = lines.join('\n');
  if (text.length <= AI_RESEARCH_PROJECT_MEMORY_MAX_CHARS) return text;
  return `${text.slice(0, AI_RESEARCH_PROJECT_MEMORY_MAX_CHARS - 1).trimEnd()}…`;
}
