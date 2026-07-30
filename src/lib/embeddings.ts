/**
 * Local embedding system. Knowledge similarity stays inside MarketingOS and
 * does not open a second external model-provider path.
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

const TFIDF_DIM = 256;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function hashToken(token: string, dim: number): number {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % dim;
}

function getTFIDFEmbedding(text: string): number[] {
  const tokens = tokenize(text);
  const vector = new Array(TFIDF_DIM).fill(0);

  // Term frequency
  const tf: Record<string, number> = {};
  for (const token of tokens) {
    tf[token] = (tf[token] || 0) + 1;
  }

  // Build vector using hash projection with TF weighting
  for (const [token, freq] of Object.entries(tf)) {
    const idx = hashToken(token, TFIDF_DIM);
    // Log-scaled TF: 1 + log(count)
    const weight = 1 + Math.log(freq);
    vector[idx] += weight;
  }

  // L2 normalize
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  }

  return vector;
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
 * Returns 0 if vectors have different lengths or are zero-length.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Find knowledge entries most similar to the given text.
 * Searches all entries with embeddings, computes cosine similarity,
 * and returns the top `limit` results.
 */
export async function findSimilarEntries(
  text: string,
  limit: number = 5
): Promise<KnowledgeEntry[]> {
  const queryEmbedding = await getEmbedding(text);

  // Fetch all entries with embeddings
  const entries = await queryAll<KnowledgeEntry>('SELECT * FROM knowledge_entries WHERE embedding IS NOT NULL');

  if (entries.length === 0) return [];

  // Compute similarities
  const scored: Array<{ entry: KnowledgeEntry; score: number }> = [];
  for (const entry of entries) {
    if (!entry.embedding) continue;
    try {
      const entryEmb = JSON.parse(entry.embedding) as number[];
      const score = cosineSimilarity(queryEmbedding, entryEmb);
      scored.push({ entry, score });
    } catch {
      // Skip entries with invalid embeddings
    }
  }

  // Sort by similarity descending
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(s => s.entry);
}

/**
 * Build similarity connections for a knowledge entry.
 * Finds the most similar existing entries and creates edges.
 */
export async function buildConnections(entryId: string): Promise<void> {
  const entry = await queryOne<KnowledgeEntry>('SELECT * FROM knowledge_entries WHERE id = ?', [entryId]);
  if (!entry) return;

  if (!entry.embedding) return;

  // Find similar entries (excluding self)
  const similar = await findSimilarEntries(entry.brief + ' ' + entry.selected_output, 10);
  const SIMILARITY_THRESHOLD = 0.5;

  for (const similarEntry of similar) {
    if (similarEntry.id === entryId) continue;
    if (!similarEntry.embedding) continue;

    try {
      const embA = JSON.parse(entry.embedding) as number[];
      const embB = JSON.parse(similarEntry.embedding) as number[];
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
