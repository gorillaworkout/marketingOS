import { v4 as uuidv4 } from 'uuid';
import {
  AI_RESEARCH_MEMORY_MODEL,
  isMemoryKind,
  isSensitiveMemory,
  validateMemoryContent,
  type MemoryKind,
} from './ai-research-memory';

export const IMPORT_FACT_LIMIT = 12;
export const IMPORT_QA_LIMIT = 8;
export const IMPORT_MODEL_CHAR_LIMIT = 24_000;
export const IMPORT_MODEL_EDGE = 12_000;
export const FACT_EXTRACTION_FAILED = 'Fact extraction failed.';

export const IMPORT_EXTRACT_SYSTEM = [
  'You extract durable memory from one imported chat.',
  'Return JSON: {"facts":[{"kind":"role","content":"string","confidence":0.8}],"qa":[{"question":"string","answerSummary":"string"}]}.',
  'kind is one of role, interest, preference, style, context.',
  'A fact is a durable statement about the user.',
  'Keep a Q&A pair only when the answer states a reusable fact, decision, preference, or procedure.',
  'Drop greetings and acknowledgements.',
].join('\n');

export interface ImportFactDraft {
  id: string;
  kind: MemoryKind;
  content: string;
  confidence: number;
  included: true;
}

export interface ImportQaDraft {
  id: string;
  question: string;
  answerSummary: string;
  included: true;
}

export interface ImportDraft {
  facts: ImportFactDraft[];
  qa: ImportQaDraft[];
}

export function emptyImportDraft(): ImportDraft {
  return { facts: [], qa: [] };
}

export function extractionInput(transcript: string): string {
  if (transcript.length <= IMPORT_MODEL_CHAR_LIMIT) return transcript;
  return `${transcript.slice(0, IMPORT_MODEL_EDGE)}\n...[middle omitted]...\n${transcript.slice(-IMPORT_MODEL_EDGE)}`;
}

function nextId(createId?: () => string): string {
  return createId ? createId() : uuidv4();
}

function collapse(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function collectFacts(value: unknown, createId?: () => string, keepId = false): ImportFactDraft[] {
  if (!Array.isArray(value)) return [];
  const facts: ImportFactDraft[] = [];
  for (const item of value) {
    if (facts.length >= IMPORT_FACT_LIMIT) break;
    if (!item || typeof item !== 'object') continue;
    const row = item as { id?: unknown; kind?: unknown; content?: unknown; confidence?: unknown };
    if (!isMemoryKind(row.kind)) continue;
    const content = collapse(row.content, 280);
    if (content.length < 3 || isSensitiveMemory(content)) continue;
    const id = keepId && typeof row.id === 'string' && row.id ? row.id : nextId(createId);
    facts.push({
      id,
      kind: row.kind,
      content,
      confidence: clampConfidence(row.confidence),
      included: true,
    });
  }
  return facts;
}

function collectQa(value: unknown, createId?: () => string, keepId = false): ImportQaDraft[] {
  if (!Array.isArray(value)) return [];
  const qa: ImportQaDraft[] = [];
  for (const item of value) {
    if (qa.length >= IMPORT_QA_LIMIT) break;
    if (!item || typeof item !== 'object') continue;
    const row = item as { id?: unknown; question?: unknown; answerSummary?: unknown };
    const question = collapse(row.question, 2_000);
    const answerSummary = collapse(row.answerSummary, 500);
    if (question.length < 3 || answerSummary.length < 1) continue;
    if (isSensitiveMemory(question) || isSensitiveMemory(answerSummary)) continue;
    const id = keepId && typeof row.id === 'string' && row.id ? row.id : nextId(createId);
    qa.push({ id, question, answerSummary, included: true });
  }
  return qa;
}

export function parseImportExtraction(raw: string, createId?: () => string): ImportDraft | null {
  const text = stripFence(typeof raw === 'string' ? raw : '');
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as { facts?: unknown; qa?: unknown };
  return {
    facts: collectFacts(record.facts, createId),
    qa: collectQa(record.qa, createId),
  };
}

export function readStoredDraft(value: unknown): ImportDraft {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return emptyImportDraft();
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyImportDraft();
  const record = parsed as { facts?: unknown; qa?: unknown };
  return {
    facts: collectFacts(record.facts, undefined, true),
    qa: collectQa(record.qa, undefined, true),
  };
}

export function validateImportQuestion(value: unknown): { ok: true; question: string } | { ok: false; error: string } {
  const question = collapse(value, 2_000);
  if (question.length < 3) return { ok: false, error: 'Enter the question.' };
  if (isSensitiveMemory(question)) return { ok: false, error: 'That memory can\'t be saved.' };
  return { ok: true, question };
}

export function validateImportAnswer(value: unknown): { ok: true; answerSummary: string } | { ok: false; error: string } {
  const answerSummary = collapse(value, 500);
  if (answerSummary.length < 1) return { ok: false, error: 'Enter the answer summary.' };
  if (isSensitiveMemory(answerSummary)) return { ok: false, error: 'That memory can\'t be saved.' };
  return { ok: true, answerSummary };
}

export async function requestImportDraft(input: {
  transcript: string;
  complete: (prompt: string) => Promise<string>;
  createId?: () => string;
}): Promise<{ ok: true; draft: ImportDraft } | { ok: false; error: typeof FACT_EXTRACTION_FAILED }> {
  let raw = '';
  try {
    raw = await input.complete(extractionInput(input.transcript));
  } catch {
    return { ok: false, error: FACT_EXTRACTION_FAILED };
  }
  if (!raw.trim()) return { ok: false, error: FACT_EXTRACTION_FAILED };
  const draft = parseImportExtraction(raw, input.createId);
  if (!draft) return { ok: false, error: FACT_EXTRACTION_FAILED };
  return { ok: true, draft };
}

export interface ApprovalFact {
  id: string;
  kind: MemoryKind;
  content: string;
  confidence: number;
}

export interface ApprovalQa {
  id: string;
  question: string;
  answerSummary: string;
}

export function applyApproval(
  draft: ImportDraft,
  body: { facts?: unknown; qa?: unknown },
): { ok: true; facts: ApprovalFact[]; qa: ApprovalQa[] } | { ok: false; error: string } {
  const factItems = body.facts === undefined ? [] : body.facts;
  const qaItems = body.qa === undefined ? [] : body.qa;
  if (!Array.isArray(factItems) || !Array.isArray(qaItems)) {
    return { ok: false, error: 'That row is not in this draft.' };
  }
  const factById = new Map(draft.facts.map(fact => [fact.id, fact]));
  const qaById = new Map(draft.qa.map(row => [row.id, row]));
  const facts: ApprovalFact[] = [];
  const qa: ApprovalQa[] = [];
  for (const item of factItems) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'That row is not in this draft.' };
    const row = item as { id?: unknown; kind?: unknown; content?: unknown; included?: unknown };
    if (typeof row.id !== 'string' || !factById.has(row.id)) return { ok: false, error: 'That row is not in this draft.' };
    if (!isMemoryKind(row.kind)) return { ok: false, error: 'Choose a memory kind.' };
    if (row.included !== true) continue;
    const validated = validateMemoryContent(row.content);
    if (!validated.ok) return { ok: false, error: validated.error };
    facts.push({
      id: row.id,
      kind: row.kind,
      content: validated.content,
      confidence: factById.get(row.id)!.confidence,
    });
  }
  for (const item of qaItems) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'That row is not in this draft.' };
    const row = item as { id?: unknown; question?: unknown; answerSummary?: unknown; included?: unknown };
    if (typeof row.id !== 'string' || !qaById.has(row.id)) return { ok: false, error: 'That row is not in this draft.' };
    if (row.included !== true) continue;
    const question = validateImportQuestion(row.question);
    if (!question.ok) return { ok: false, error: question.error };
    const answer = validateImportAnswer(row.answerSummary);
    if (!answer.ok) return { ok: false, error: answer.error };
    qa.push({ id: row.id, question: question.question, answerSummary: answer.answerSummary });
  }
  return { ok: true, facts, qa };
}

export async function completeImportExtraction(userId: string, prompt: string): Promise<string> {
  const { generateContent } = await import('./openai');
  const result = await generateContent(IMPORT_EXTRACT_SYSTEM, prompt, userId, undefined, {
    model: AI_RESEARCH_MEMORY_MODEL,
    temperature: 0.1,
    maxTokens: 2000,
    responseFormat: { type: 'json_object' },
    jsonRepairAttempts: 0,
    taskType: 'ai-research',
  });
  return result.content;
}
