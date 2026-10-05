/**
 * Local embedding system. Knowledge similarity stays inside MarketingOS and
 * does not open a second external model-provider path.
 *
 * Vectors are a hashed bag of words (1024 buckets) with stopwords, light IDF,
 * and L2 normalisation. Older 256-dimension rows stay readable: cosine
 * similarity returns 0 when lengths differ, and retrieval re-embeds a few
 * stale rows lazily. `scripts/reembed-knowledge.ts` refreshes the rest.
 */

import { queryOne, queryAll, execute } from './database';
import { v4 as uuidv4 } from 'uuid';

// ─── Types ───────────────────────────────────────────────────────────────────

interface KnowledgeEntry {
  id: string;
  user_id: string;
  task_type: string;
  brief: string;
  selected_output: string;
  rejected_outputs: string | null;
  style_cluster: string | null;
  platform: string | null;
  audience: string | null;
  embedding: string | null;
  quality_score: number;
  created_at: string;
}

// ─── TF-IDF Embedding ───────────────────────────────────────────────────────

export const EMBEDDING_DIM = 1024;
/** Previous on-disk width. Ranking must not throw when it still appears. */
export const LEGACY_EMBEDDING_DIM = 256;
const IDF_CORPUS = 10_000;
const LAZY_REEMBED_LIMIT = 8;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'while', 'of', 'to', 'in', 'on',
  'for', 'with', 'as', 'by', 'at', 'from', 'into', 'about', 'after', 'before', 'between', 'through',
  'during', 'without', 'within', 'over', 'under', 'again', 'further', 'once', 'here', 'there', 'all',
  'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just', 'don', 'dont', 'should', 'now',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'this',
  'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us',
  'them', 'my', 'your', 'his', 'its', 'our', 'their', 'what', 'which', 'who', 'whom', 'how', 'why',
  'where', 'please', 'also', 'using', 'use', 'used', 'via', 'per', 'etc', 'im', 'ive', 'youre',
  'theyre', 'whats', 'thats', 'theres', 'heres', 'doesnt', 'didnt', 'cant', 'wont', 'isnt', 'arent',
  'wasnt', 'werent', 'havent', 'hasnt', 'hadnt', 'would', 'could', 'may', 'might', 'shall', 'must',
  'into', 'onto', 'upon', 'out', 'up', 'down', 'off', 'than', 'then', 'because', 'while', 'although',
  'though', 'whether', 'until', 'unless', 'since', 'like', 'just', 'really', 'please', 'thanks',
  'thank', 'hello', 'hi', 'hey',
  'yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'pada', 'adalah', 'ini', 'itu', 'atau', 'juga',
  'tidak', 'ada', 'akan', 'sudah', 'belum', 'saya', 'aku', 'kamu', 'anda', 'kita', 'kami', 'mereka',
  'dia', 'nya', 'dalam', 'oleh', 'sebagai', 'karena', 'jika', 'kalau', 'agar', 'supaya', 'lebih',
  'sangat', 'bisa', 'dapat', 'harus', 'hanya', 'masih', 'lagi', 'saja', 'pun', 'serta', 'maupun',
  'tentang', 'antara', 'setelah', 'sebelum', 'saat', 'ketika', 'bagaimana', 'apa', 'siapa', 'mengapa',
  'kenapa', 'dimana', 'apakah', 'tolong', 'silakan', 'mohon', 'bukan', 'jangan', 'telah', 'sedang',
  'bagi', 'kepada', 'terhadap', 'hingga', 'sampai', 'sejak', 'selama', 'tanpa', 'menurut', 'seperti',
  'yaitu', 'yakni', 'dll', 'dsb', 'yg', 'dgn', 'utk', 'dr', 'biar', 'jadi', 'lah', 'kah', 'para',
  'ya', 'iya', 'dong', 'sih', 'deh', 'nih', 'tuh', 'kok', 'kan',
]);

export function tokenizeForEmbedding(text: string): string[] {
  const safe = typeof text === 'string' ? text : String(text ?? '');
  return safe
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(token => token.length > 1 && !STOPWORDS.has(token));
}

function hashToken(token: string, dim: number): number {
  let hash = 2166136261;
  for (const char of token) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % dim;
}

/** Light static IDF: short generic tokens weigh less than specific ones. */
function idfWeight(token: string): number {
  const documentFrequency = token.length <= 3 ? 500 : token.length <= 5 ? 120 : 20;
  return Math.log((IDF_CORPUS + 1) / (documentFrequency + 1)) + 1;
}

function getTFIDFEmbedding(text: string): number[] {
  const tokens = tokenizeForEmbedding(text);
  const vector = new Array(EMBEDDING_DIM).fill(0);
  const tf: Record<string, number> = {};
  for (const token of tokens) tf[token] = (tf[token] || 0) + 1;

  for (const [token, freq] of Object.entries(tf)) {
    const idx = hashToken(token, EMBEDDING_DIM);
    vector[idx] += (1 + Math.log(freq)) * idfWeight(token);
  }

  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  }
  return vector;
}

/**
 * Text that should be embedded for a knowledge row.
 * AI Research stores the question with the claim. Other features keep the
 * approved output only, so their retrieval contract stays the same.
 */
export function knowledgeEmbeddingInput(taskType: string | null | undefined, brief: string, selectedOutput: string): string {
  const answer = (selectedOutput || '').trim();
  if (taskType === 'ai-research' || taskType === 'ai-research-qa' || taskType === 'user-memory') {
    const question = (brief || '').trim();
    if (question && answer) return `${question}\n${answer}`;
    return question || answer;
  }
  return answer;
}

export function parseStoredEmbedding(raw: string | null | undefined): number[] | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    if (parsed.some(value => typeof value !== 'number' || !Number.isFinite(value))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function embeddingNeedsRefresh(vector: number[] | null | undefined): boolean {
  return !vector || vector.length !== EMBEDDING_DIM;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get a deterministic local embedding without an external provider call.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  return getTFIDFEmbedding(text);
}

/**
 * Compute cosine similarity between two vectors.
 * Returns 0 if vectors have different lengths or are zero-length, so a legacy
 * 256-dimension vector cannot crash ranking against a 1024-dimension query.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (typeof left !== 'number' || typeof right !== 'number') return 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export interface SimilarEntriesScope {
  userId: string;
  taskType?: string;
  taskTypes?: readonly string[];
  limit?: number;
  minScore?: number;
}

export function buildSimilarEntriesQuery(scope: { userId: string; taskType?: string; taskTypes?: readonly string[] }): { sql: string; params: unknown[] } {
  let sql = 'SELECT * FROM knowledge_entries WHERE user_id = ? AND embedding IS NOT NULL';
  const params: unknown[] = [scope.userId];
  const taskTypes = (scope.taskTypes || []).map(type => type.trim()).filter(Boolean);
  if (taskTypes.length > 0) {
    sql += ` AND task_type IN (${taskTypes.map(() => '?').join(', ')})`;
    params.push(...taskTypes);
  } else if (scope.taskType) {
    sql += ' AND task_type = ?';
    params.push(scope.taskType);
  }
  return { sql, params };
}

export function rankSimilarEntries<T extends { embedding: string | null }>(
  queryEmbedding: number[],
  entries: T[],
  limit: number,
  options?: { minScore?: number },
): T[] {
  const minScore = options?.minScore;
  const scored: Array<{ entry: T; score: number }> = [];
  for (const entry of entries) {
    const entryEmb = parseStoredEmbedding(entry.embedding);
    if (!entryEmb) continue;
    const score = cosineSimilarity(queryEmbedding, entryEmb);
    if (typeof minScore === 'number' && !(score >= minScore)) continue;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(item => item.entry);
}

async function refreshStaleEntry(entry: KnowledgeEntry): Promise<KnowledgeEntry> {
  const text = knowledgeEmbeddingInput(entry.task_type, entry.brief || '', entry.selected_output || '');
  if (!text.trim()) return entry;
  try {
    const fresh = await getEmbedding(text);
    try {
      await execute(
        'UPDATE knowledge_entries SET embedding = ? WHERE id = ? AND user_id = ?',
        [JSON.stringify(fresh), entry.id, entry.user_id],
      );
    } catch (error) {
      console.warn('Lazy knowledge re-embed failed:', error);
    }
    return { ...entry, embedding: JSON.stringify(fresh) };
  } catch (error) {
    console.warn('Lazy knowledge re-embed failed:', error);
    return entry;
  }
}

/**
 * Find this user's knowledge entries most similar to the given text.
 * Always scoped to `userId` so RAG never retrieves another user's selections.
 * `taskTypes` limits which workflows are eligible. `minScore` drops weak hits.
 */
export async function findSimilarEntries(
  text: string,
  scope: SimilarEntriesScope,
): Promise<KnowledgeEntry[]> {
  if (!scope.userId) return [];
  const limit = scope.limit ?? 5;
  const { sql, params } = buildSimilarEntriesQuery(scope);
  const queryEmbedding = await getEmbedding(text);
  const entries = await queryAll<KnowledgeEntry>(sql, params);
  if (entries.length === 0) return [];

  let refreshed = 0;
  const prepared: KnowledgeEntry[] = [];
  for (const entry of entries) {
    const parsed = parseStoredEmbedding(entry.embedding);
    if (!embeddingNeedsRefresh(parsed) || refreshed >= LAZY_REEMBED_LIMIT) {
      prepared.push(entry);
      continue;
    }
    refreshed += 1;
    prepared.push(await refreshStaleEntry(entry));
  }
  return rankSimilarEntries(queryEmbedding, prepared, limit, { minScore: scope.minScore });
}

/**
 * Build similarity connections for a knowledge entry.
 * Finds the most similar existing entries and creates edges.
 */
export async function buildConnections(entryId: string): Promise<void> {
  const entry = await queryOne<KnowledgeEntry>('SELECT * FROM knowledge_entries WHERE id = ?', [entryId]);
  if (!entry) return;

  if (!entry.embedding) return;

  // Find similar entries for the same user (excluding self)
  const similar = await findSimilarEntries(entry.brief + ' ' + entry.selected_output, {
    userId: entry.user_id,
    limit: 10,
  });
  const SIMILARITY_THRESHOLD = 0.5;

  for (const similarEntry of similar) {
    if (similarEntry.id === entryId) continue;
    if (!similarEntry.embedding) continue;

    try {
      const embA = parseStoredEmbedding(entry.embedding);
      const embB = parseStoredEmbedding(similarEntry.embedding);
      if (!embA || !embB) continue;
      const score = cosineSimilarity(embA, embB);

      if (score < SIMILARITY_THRESHOLD) continue;

      // Check if edge already exists (either direction)
      const exists = await queryOne(`SELECT id FROM knowledge_edges WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)`, [entryId, similarEntry.id, similarEntry.id, entryId]);

      if (exists) continue;

      // Create bidirectional edges
      const relationship = entry.task_type === similarEntry.task_type
        ? 'similar_content'
        : 'cross_task_similarity';

      // Edge: entry → similar
      await execute('INSERT INTO knowledge_edges (id, source_id, target_id, relationship, weight, metadata) VALUES (?, ?, ?, ?, ?, ?)', [uuidv4(), entryId, similarEntry.id, relationship, score, JSON.stringify({ auto_generated: true })]);

      // Edge: similar → entry
      await execute('INSERT INTO knowledge_edges (id, source_id, target_id, relationship, weight, metadata) VALUES (?, ?, ?, ?, ?, ?)', [uuidv4(), similarEntry.id, entryId, relationship, score, JSON.stringify({ auto_generated: true })]);
    } catch {
      // Skip entries with invalid embeddings
    }
  }
}
