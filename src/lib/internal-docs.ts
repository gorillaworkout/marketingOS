import { readFile } from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { execute, executeTransaction, queryAll, queryOne } from './database';
import { cosineSimilarity, getEmbedding } from './embeddings';
import {
  allowedAccessLevels,
  canManageInternalDocs,
  isInternalDocVisible,
  type InternalDocAccessLevel,
  type InternalDocsPrincipal,
} from './internal-docs-acl';
import {
  collectDocxImages,
  extractedTextIsUsable,
  extractInternalDocText,
  INTERNAL_DOC_NO_TEXT_ERROR,
} from './internal-docs-extract';
import { persistInternalDocKnowledge } from './internal-docs-knowledge';
import { internalDocImagePath } from './internal-docs-reader';
import { resolveStoredInternalDoc } from './internal-docs-storage';
import type { InspectorResearchSource, ResearchSsePayload } from './ai-research-inspector';

export const INTERNAL_DOCS_CHUNK_SIZE = 1200;
export const INTERNAL_DOCS_CHUNK_OVERLAP = 200;
export const INTERNAL_DOCS_ASK_LIMIT = 6;
export const INTERNAL_DOCS_NO_MATCH_ANSWER =
  'The FAQ & Guides you can access do not contain an answer to that question.';

export const INTERNAL_DOCS_ASK_SYSTEM = `You answer questions for Dupoin employees using only the FAQ & Guides excerpts provided in the user message.
Cite the document title for every claim you take from those excerpts.
If the excerpts do not contain the answer, say FAQ & Guides do not confirm it.
Do not use outside knowledge for company facts, and do not mention documents that are not in the excerpts.
Write in clear English.`;

const QUERY_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'when', 'where',
  'how', 'who', 'why', 'are', 'was', 'were', 'have', 'has', 'does', 'did',
  'about', 'into', 'your', 'our', 'can', 'not', 'but', 'you',
  // Indonesian question words. "cara menyalakan X" is "how to turn on X";
  // the object of the question should outrank the question frame.
  'ada', 'adalah', 'agar', 'akan', 'anda', 'apa', 'apakah', 'atau', 'bagi',
  'bagaimana', 'belum', 'bisa', 'cara', 'dan', 'dalam', 'dapat', 'dari',
  'dengan', 'dimana', 'gimana', 'hanya', 'ini', 'ingin', 'itu', 'jika', 'juga',
  'kalau', 'kami', 'kapan', 'karena', 'lebih', 'mana', 'masih', 'mohon', 'nya',
  'oleh', 'pada', 'perlu', 'saya', 'sangat', 'sebagai', 'sudah', 'supaya',
  'telah', 'tetapi', 'tidak', 'tolong', 'untuk', 'yang',
]);

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const TITLE_TF_BOOST = 3;
const COSINE_WEIGHT = 0.2;
const DISTINCTIVE_IDF_GAP = 0.45;
const DISTINCTIVE_IDF_RATIO = 0.8;

export interface InternalDocListRow {
  id: string;
  title: string;
  original_name: string;
  mime_type: string;
  file_ext: string;
  file_size: number;
  access_level: string;
  status: string;
  error_message: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  snippet?: string | null;
}

export interface InternalDocChunkRow {
  chunk_id: string;
  document_id: string;
  content: string;
  embedding: string | null;
  title: string;
  access_level: string;
}

export interface InternalDocHit {
  documentId: string;
  title: string;
  accessLevel: InternalDocAccessLevel;
  chunkId: string;
  excerpt: string;
  score: number;
}

export interface InternalDocCitation {
  documentId: string;
  title: string;
  url: string;
  excerpt: string;
  extension?: string;
  images?: string[];
}

export function ilikeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, char => `\\${char}`)}%`;
}

export function buildInternalDocsListQuery(options: {
  accessLevels: readonly string[];
  includeUnindexed: boolean;
  search: string;
}): { sql: string; params: unknown[] } {
  const search = options.search.trim().slice(0, 200);
  const pattern = search ? ilikeContains(search) : '';
  const sql = `
    SELECT id, title, original_name, mime_type, file_ext, file_size, access_level, status,
           error_message, created_at, updated_at,
           CASE
             WHEN ? = '' THEN ''
             ELSE substring(extracted_text from GREATEST(POSITION(LOWER(?) IN LOWER(extracted_text)) - 60, 1) for 220)
           END AS snippet
    FROM internal_documents
    WHERE access_level = ANY(?::text[])
      AND (? OR status = 'indexed')
      AND (
        ? = ''
        OR title ILIKE ? ESCAPE '\\'
        OR extracted_text ILIKE ? ESCAPE '\\'
      )
    ORDER BY created_at DESC
    LIMIT 100`;
  return {
    sql,
    params: [search, search, [...options.accessLevels], options.includeUnindexed, search, pattern, pattern],
  };
}

export function buildInternalDocByIdQuery(): { sql: string } {
  return {
    sql: `
      SELECT id, title, original_name, mime_type, file_ext, file_size, storage_key, access_level,
             status, error_message, extracted_text, created_at, updated_at
      FROM internal_documents
      WHERE id = ? AND access_level = ANY(?::text[]) AND (? OR status = 'indexed')`,
  };
}

export function buildInternalDocChunkQuery(): { sql: string } {
  return {
    sql: `
      SELECT c.id AS chunk_id, c.document_id, c.content, c.embedding, d.title, d.access_level
      FROM internal_document_chunks c
      JOIN internal_documents d ON d.id = c.document_id
      WHERE d.status = 'indexed' AND d.access_level = ANY(?::text[])
      ORDER BY d.updated_at DESC, c.chunk_index ASC
      LIMIT 1500`,
  };
}

export function chunkDocumentText(
  text: string,
  size = INTERNAL_DOCS_CHUNK_SIZE,
  overlap = INTERNAL_DOCS_CHUNK_OVERLAP,
): string[] {
  const source = text.replace(/\r\n/g, '\n').trim();
  if (!source) return [];
  const paragraphs = source.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) chunks.push(trimmed);
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > size) {
      push(current);
      current = '';
      const step = Math.max(1, size - overlap);
      for (let index = 0; index < paragraph.length; index += step) {
        push(paragraph.slice(index, index + size));
        if (index + size >= paragraph.length) break;
      }
      continue;
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > size) {
      push(current);
      const tail = current.slice(Math.max(0, current.length - overlap));
      current = `${tail}\n\n${paragraph}`.trim();
    } else {
      current = next;
    }
  }
  push(current);
  return chunks;
}

function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2 && !QUERY_STOPWORDS.has(token));
}

function queryTokens(query: string): string[] {
  return [...new Set(tokensOf(query))].slice(0, 12);
}

function termIdf(df: number, total: number): number {
  return Math.log(1 + (total - df + 0.5) / (df + 0.5));
}

function bm25Weight(tf: number, docLen: number, avgdl: number, idf: number): number {
  const lengthNorm = 1 - BM25_B + BM25_B * (docLen / Math.max(avgdl, 1));
  return idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * lengthNorm));
}

function chunkCosine(embedding: string | null, queryEmbedding: number[]): number {
  if (!embedding) return 0;
  try {
    const vector = JSON.parse(embedding) as number[];
    if (!Array.isArray(vector)) return 0;
    return cosineSimilarity(queryEmbedding, vector);
  } catch {
    return 0;
  }
}

export function rankInternalDocChunks(
  query: string,
  queryEmbedding: number[],
  chunks: InternalDocChunkRow[],
  principal: InternalDocsPrincipal,
  limit = INTERNAL_DOCS_ASK_LIMIT,
): InternalDocHit[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  const visible = chunks.flatMap(chunk => {
    if (!isInternalDocVisible(chunk.access_level, principal)) return [];
    if (chunk.access_level !== 'company' && chunk.access_level !== 'it-only') return [];
    const titleTokens = tokensOf(chunk.title);
    const bodyTokens = tokensOf(chunk.content);
    const tf = new Map<string, number>();
    for (const token of bodyTokens) tf.set(token, (tf.get(token) || 0) + 1);
    for (const token of titleTokens) tf.set(token, (tf.get(token) || 0) + TITLE_TF_BOOST);
    return [{
      chunk,
      tf,
      docLen: bodyTokens.length + titleTokens.length * TITLE_TF_BOOST,
      cosine: chunkCosine(chunk.embedding, queryEmbedding),
    }];
  });
  if (!visible.length) return [];

  const total = visible.length;
  const df = new Map<string, number>();
  for (const token of tokens) {
    df.set(token, visible.reduce((count, row) => count + ((row.tf.get(token) || 0) > 0 ? 1 : 0), 0));
  }
  const avgdl = visible.reduce((sum, row) => sum + row.docLen, 0) / total;
  const idfOf = new Map(tokens.map(token => [token, termIdf(df.get(token) || 0, total)]));

  let scored = visible.flatMap(row => {
    const matched: string[] = [];
    let lexical = 0;
    for (const token of tokens) {
      const freq = row.tf.get(token) || 0;
      if (!freq) continue;
      matched.push(token);
      lexical += bm25Weight(freq, row.docLen, avgdl, idfOf.get(token) || 0);
    }
    // Hashed TF cosine only breaks ties. A chunk with no real query term is a
    // bucket collision, not a paraphrase, because these vectors are not semantic.
    if (!matched.length) return [];
    return [{
      chunk: row.chunk,
      matched,
      score: lexical + COSINE_WEIGHT * Math.max(0, row.cosine),
    }];
  });

  // A repeated common token such as "LED" used to outrank a rare term such as
  // "auditorium". When the query mixes both, keep chunks that contain the rare
  // terms so a how-to guide sharing only the common token cannot fill the answer.
  const present = tokens.filter(token => (df.get(token) || 0) > 0);
  if (present.length >= 2) {
    const weights = present.map(token => idfOf.get(token) || 0);
    const maxIdf = Math.max(...weights);
    const minIdf = Math.min(...weights);
    if (maxIdf >= minIdf + DISTINCTIVE_IDF_GAP) {
      const distinctive = new Set(present.filter(token => (idfOf.get(token) || 0) >= maxIdf * DISTINCTIVE_IDF_RATIO));
      const gated = scored.filter(row => row.matched.some(token => distinctive.has(token)));
      if (gated.length) scored = gated;
    }
  }

  scored.sort((left, right) => right.score - left.score || left.chunk.chunk_id.localeCompare(right.chunk.chunk_id));

  const hits: InternalDocHit[] = [];
  for (const row of scored) {
    const used = hits.filter(hit => hit.documentId === row.chunk.document_id).length;
    if (used >= 2) continue;
    hits.push({
      documentId: row.chunk.document_id,
      title: row.chunk.title,
      accessLevel: row.chunk.access_level === 'it-only' ? 'it-only' : 'company',
      chunkId: row.chunk.chunk_id,
      excerpt: row.chunk.content.replace(/\s+/g, ' ').trim().slice(0, 500),
      score: row.score,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

export function internalDocPagePath(documentId: string): string {
  return `/dashboard/internal-docs/${documentId}`;
}

export function internalDocAbsoluteUrl(documentId: string, origin: string): string {
  const page = internalDocPagePath(documentId);
  try {
    return new URL(page, origin).toString();
  } catch {
    return page;
  }
}

export function citationsFromHits(hits: InternalDocHit[], origin: string): InternalDocCitation[] {
  const citations: InternalDocCitation[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (seen.has(hit.documentId)) continue;
    seen.add(hit.documentId);
    citations.push({
      documentId: hit.documentId,
      title: hit.title,
      url: internalDocAbsoluteUrl(hit.documentId, origin),
      excerpt: hit.excerpt,
    });
  }
  return citations;
}

const CITATION_IMAGE_LIMIT = 4;

/** Attach the file type and, for Word guides, authenticated image URLs. Failures leave the citation text-only. */
export async function withCitationMedia(
  citations: InternalDocCitation[],
  principal: InternalDocsPrincipal,
): Promise<InternalDocCitation[]> {
  const enriched: InternalDocCitation[] = [];
  for (const citation of citations) {
    try {
      const row = await findVisibleDocument<{
        access_level: string;
        file_ext: string;
        storage_key: string;
        status: string;
      }>(principal, citation.documentId, false);
      if (!row) {
        enriched.push(citation);
        continue;
      }
      let images: string[] = [];
      if (row.file_ext === '.docx') {
        const stored = resolveStoredInternalDoc(row.storage_key);
        if (stored) {
          const found = await collectDocxImages(await readFile(stored));
          images = found.slice(0, CITATION_IMAGE_LIMIT).map((_, index) => internalDocImagePath(citation.documentId, index));
        }
      }
      enriched.push({ ...citation, extension: row.file_ext, images });
    } catch (error) {
      console.warn('FAQ citation media failed:', error);
      enriched.push(citation);
    }
  }
  return enriched;
}

export function formatInternalDocsPrompt(hits: InternalDocHit[], origin: string): string {
  const visible = hits.filter(hit => hit.accessLevel === 'company' || hit.accessLevel === 'it-only');
  if (!visible.length) return '';
  const lines = visible.map((hit, index) => {
    return `${index + 1}. Title: ${hit.title}\n   Document: ${internalDocAbsoluteUrl(hit.documentId, origin)}\n   Excerpt: ${hit.excerpt}`;
  });
  return [
    'FAQ & GUIDES — Company guidance this user is allowed to read.',
    'These are an additional grounded source. Keep using public web sources and the internal knowledge graph when they are present.',
    'Cite a guide by its title and document link. Do not treat it as a public web source.',
    'Do not mention, quote, or infer any guide that is not listed here.',
    lines.join('\n'),
  ].join('\n');
}

export function mergeInternalDocSources(
  payload: ResearchSsePayload,
  hits: InternalDocHit[],
  origin: string,
): ResearchSsePayload {
  const extra: InspectorResearchSource[] = [];
  const seen = new Set(payload.sources.map(source => source.url.replace(/\/$/, '')));
  for (const citation of citationsFromHits(hits, origin)) {
    const key = citation.url.replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push({
      title: `FAQ & Guides: ${citation.title}`,
      url: citation.url,
      origin: 'international',
      snippet: citation.excerpt.slice(0, 400),
      official: false,
      originChip: 'internal',
      traceKind: null,
    });
  }
  if (!extra.length) return payload;
  return {
    ...payload,
    sources: [...payload.sources, ...extra],
    sourceCount: payload.sources.length + extra.length,
    grounding: payload.grounding === 'empty' ? 'ok' : payload.grounding,
  };
}

export async function listInternalDocuments(
  principal: InternalDocsPrincipal,
  search: string,
): Promise<InternalDocListRow[]> {
  const { sql, params } = buildInternalDocsListQuery({
    accessLevels: allowedAccessLevels(principal),
    includeUnindexed: canManageInternalDocs(principal),
    search,
  });
  const rows = await queryAll<InternalDocListRow>(sql, params);
  return rows.filter(row => isInternalDocVisible(row.access_level, principal));
}

export async function retrieveInternalDocHits(
  principal: InternalDocsPrincipal,
  query: string,
  limit = INTERNAL_DOCS_ASK_LIMIT,
): Promise<InternalDocHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const { sql } = buildInternalDocChunkQuery();
  const rows = await queryAll<InternalDocChunkRow>(sql, [allowedAccessLevels(principal)]);
  const embedding = await getEmbedding(trimmed);
  return rankInternalDocChunks(trimmed, embedding, rows, principal, limit);
}

export function publicDocument(row: InternalDocListRow) {
  return {
    id: row.id,
    title: row.title,
    originalName: row.original_name,
    mimeType: row.mime_type,
    extension: row.file_ext,
    fileSize: Number(row.file_size) || 0,
    accessLevel: row.access_level,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    snippet: (row.snippet || '').replace(/\s+/g, ' ').trim(),
  };
}

async function replaceChunks(
  documentId: string,
  chunks: string[],
  embeddings: number[][],
): Promise<void> {
  await executeTransaction(async transaction => {
    await transaction.execute('DELETE FROM internal_document_chunks WHERE document_id = ?', [documentId]);
    for (let index = 0; index < chunks.length; index += 1) {
      await transaction.execute(
        `INSERT INTO internal_document_chunks (id, document_id, chunk_index, content, embedding)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), documentId, index, chunks[index], JSON.stringify(embeddings[index] || [])],
      );
    }
  });
}

export async function indexDocumentText(documentId: string, text: string): Promise<{ status: 'indexed' | 'failed'; errorMessage: string | null; chunkCount: number }> {
  if (!extractedTextIsUsable(text)) {
    await execute(
      `UPDATE internal_documents
       SET extracted_text = '', status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [INTERNAL_DOC_NO_TEXT_ERROR, documentId],
    );
    await execute('DELETE FROM internal_document_chunks WHERE document_id = ?', [documentId]);
    return { status: 'failed', errorMessage: INTERNAL_DOC_NO_TEXT_ERROR, chunkCount: 0 };
  }
  const chunks = chunkDocumentText(text);
  const embeddings = await Promise.all(chunks.map(chunk => getEmbedding(chunk)));
  await replaceChunks(documentId, chunks, embeddings);
  await execute(
    `UPDATE internal_documents
     SET extracted_text = ?, status = 'indexed', error_message = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [text, documentId],
  );
  return { status: 'indexed', errorMessage: null, chunkCount: chunks.length };
}

export async function createIndexedDocument(input: {
  id: string;
  title: string;
  originalName: string;
  mimeType: string;
  fileExt: string;
  fileSize: number;
  storageKey: string;
  accessLevel: InternalDocAccessLevel;
  uploadedBy: string;
  bytes: Uint8Array;
}): Promise<{ status: 'indexed' | 'failed'; errorMessage: string | null }> {
  let extracted = '';
  let extractError: string | null = null;
  try {
    extracted = await extractInternalDocText(input.bytes, input.fileExt);
  } catch (error) {
    extractError = error instanceof Error ? error.message : 'Could not read this file.';
  }
  await execute(
    `INSERT INTO internal_documents (
       id, title, original_name, mime_type, file_ext, file_size, storage_key, access_level,
       status, error_message, extracted_text, uploaded_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, '', ?)`,
    [
      input.id,
      input.title,
      input.originalName,
      input.mimeType,
      input.fileExt,
      input.fileSize,
      input.storageKey,
      input.accessLevel,
      input.uploadedBy,
    ],
  );
  if (extractError || !extractedTextIsUsable(extracted)) {
    const message = extractError || INTERNAL_DOC_NO_TEXT_ERROR;
    await execute(
      `UPDATE internal_documents SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [message.slice(0, 500), input.id],
    );
    return { status: 'failed', errorMessage: message };
  }
  const indexed = await indexDocumentText(input.id, extracted);
  if (indexed.status === 'indexed') {
    await persistInternalDocKnowledge({
      userId: input.uploadedBy,
      documentId: input.id,
      title: input.title,
      accessLevel: input.accessLevel,
      text: extracted,
    });
  }
  return { status: indexed.status, errorMessage: indexed.errorMessage };
}

export async function reindexStoredDocument(documentId: string, bytes: Uint8Array, fileExt: string): Promise<{ status: 'indexed' | 'failed'; errorMessage: string | null }> {
  try {
    const extracted = await extractInternalDocText(bytes, fileExt);
    return indexDocumentText(documentId, extracted);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read this file.';
    await execute(
      `UPDATE internal_documents SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [message.slice(0, 500), documentId],
    );
    return { status: 'failed', errorMessage: message };
  }
}

export async function findVisibleDocument<T extends { access_level: string }>(
  principal: InternalDocsPrincipal,
  id: string,
  includeUnindexed: boolean,
): Promise<T | undefined> {
  const { sql } = buildInternalDocByIdQuery();
  const row = await queryOne<T>(sql, [id, allowedAccessLevels(principal), includeUnindexed]);
  if (!row || !isInternalDocVisible(row.access_level, principal)) return undefined;
  return row;
}
