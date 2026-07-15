/**
 * K-Means Clustering for Knowledge Entries
 * Clusters embeddings into 3 style groups: Bold, Professional, Creative
 * Uses cosine similarity as the distance metric.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ClusterResult {
  assignments: number[];       // cluster index per entry (0..k-1)
  centroids: number[][];       // centroid vectors
  clusterSizes: number[];      // entries per cluster
}

export interface LabeledCluster {
  name: 'bold' | 'professional' | 'creative';
  description: string;
  centroidIndex: number;
  entryIndices: number[];
  exampleIds: string[];
}

// ─── Cosine Similarity (inline, no dep on embeddings.ts) ────────────────────

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// Cosine distance = 1 - cosine similarity
function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSim(a, b);
}

// ─── K-Means++ Initialization ───────────────────────────────────────────────

function initCentroidsPlusPlus(vectors: number[][], k: number, rng: () => number): number[][] {
  const n = vectors.length;
  const centroids: number[][] = [];

  // Pick first centroid randomly
  const firstIdx = Math.floor(rng() * n);
  centroids.push([...vectors[firstIdx]]);

  for (let c = 1; c < k; c++) {
    // Compute min distance from each point to nearest existing centroid
    const distances: number[] = [];
    let totalDist = 0;
    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      for (const centroid of centroids) {
        const d = cosineDistance(vectors[i], centroid);
        if (d < minDist) minDist = d;
      }
      distances.push(minDist * minDist); // squared distance for weighting
      totalDist += minDist * minDist;
    }

    // Weighted random selection
    let threshold = rng() * totalDist;
    let cumulative = 0;
    let chosen = 0;
    for (let i = 0; i < n; i++) {
      cumulative += distances[i];
      if (cumulative >= threshold) {
        chosen = i;
        break;
      }
    }
    centroids.push([...vectors[chosen]]);
  }

  return centroids;
}

// ─── K-Means Core ───────────────────────────────────────────────────────────

/**
 * Run K-Means clustering on embedding vectors.
 *
 * @param vectors - Array of embedding vectors (all same dimension)
 * @param k - Number of clusters (default 3)
 * @param maxIterations - Max iterations (default 50)
 * @param seed - Random seed for reproducibility (default 42)
 * @returns ClusterResult with assignments, centroids, sizes
 */
export function kMeans(
  vectors: number[][],
  k: number = 3,
  maxIterations: number = 50,
  seed: number = 42
): ClusterResult {
  const n = vectors.length;
  if (n === 0) {
    return { assignments: [], centroids: [], clusterSizes: [] };
  }
  if (n <= k) {
    // Fewer entries than clusters — each gets its own cluster
    const assignments = vectors.map((_, i) => i);
    const centroids = vectors.map(v => [...v]);
    const clusterSizes = vectors.map(() => 1);
    return { assignments, centroids, clusterSizes };
  }

  // Seeded PRNG (xorshift32)
  let state = seed;
  const rng = () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };

  // K-Means++ initialization
  let centroids = initCentroidsPlusPlus(vectors, k, rng);

  let assignments = new Array(n).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // Assignment step
    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      let bestCluster = 0;
      for (let c = 0; c < k; c++) {
        const d = cosineDistance(vectors[i], centroids[c]);
        if (d < minDist) {
          minDist = d;
          bestCluster = c;
        }
      }
      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        changed = true;
      }
    }

    if (!changed && iter > 0) break; // converged

    // Update centroids
    const newCentroids: number[][] = [];
    const dim = vectors[0].length;

    for (let c = 0; c < k; c++) {
      const members = vectors.filter((_, i) => assignments[i] === c);
      if (members.length === 0) {
        // Empty cluster — reinitialize randomly
        const randIdx = Math.floor(rng() * n);
        newCentroids.push([...vectors[randIdx]]);
        continue;
      }

      const centroid = new Array(dim).fill(0);
      for (const v of members) {
        for (let d = 0; d < dim; d++) {
          centroid[d] += v[d];
        }
      }
      for (let d = 0; d < dim; d++) {
        centroid[d] /= members.length;
      }

      // L2 normalize centroid for cosine space
      let norm = 0;
      for (const val of centroid) norm += val * val;
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let d = 0; d < dim; d++) centroid[d] /= norm;
      }

      newCentroids.push(centroid);
    }

    centroids = newCentroids;
  }

  // Compute cluster sizes
  const clusterSizes = new Array(k).fill(0);
  for (const a of assignments) clusterSizes[a]++;

  return { assignments, centroids, clusterSizes };
}

// ─── Cluster Labeling ───────────────────────────────────────────────────────

/**
 * Pre-defined style labels with their characteristics.
 * Used to seed the `style_clusters` table.
 */
export const STYLE_LABELS = [
  {
    name: 'bold' as const,
    description: 'High energy, emojis, FOMO, urgency, exclamation marks, action-oriented language',
  },
  {
    name: 'professional' as const,
    description: 'Structured, data-driven, minimal emojis, authoritative tone, clear CTA',
  },
  {
    name: 'creative' as const,
    description: 'Storytelling, casual, emotional, trendy references, conversational, unique hooks',
  },
];

/**
 * Assign style labels to clusters by matching cluster content to known style descriptions.
 * Uses keyword heuristics on the entries' selected_output text.
 */
export function labelClusters(
  entries: Array<{ id: string; selected_output: string; brief: string }>,
  assignments: number[],
  k: number = 3
): LabeledCluster[] {
  // Score each cluster for each style
  const styleKeywords = {
    bold: /🔥|💪|⚡|🚀|!!!|jangan|sekarang|hari ini|mudah|cepat|gratis|rahasia|terbukti|limited|segera|wajib|harus/gi,
    professional: /data|riset|analisis|strategi|optimasi|efektif|efisien|pertumbuhan|metode|framework|solusi|terukur|ROI|konversi|benchmark/gi,
    creative: /cerita|bayangkan|pernah|gimana|sih|dong|lho|vibes|mood| aesthetic|plot twist|imagine|story|behind the scenes|nggak nyangka|ngakak/gi,
  };

  const clusterScores: Array<{ bold: number; professional: number; creative: number }> = [];

  for (let c = 0; c < k; c++) {
    const memberIndices = assignments
      .map((a, i) => (a === c ? i : -1))
      .filter(i => i >= 0);

    const memberTexts = memberIndices
      .map(i => `${entries[i].brief} ${entries[i].selected_output}`)
      .join(' ');

    const scores = {
      bold: (memberTexts.match(styleKeywords.bold) || []).length,
      professional: (memberTexts.match(styleKeywords.professional) || []).length,
      creative: (memberTexts.match(styleKeywords.creative) || []).length,
    };
    clusterScores.push(scores);
  }

  // Greedy assignment: assign highest-scoring cluster first
  const usedStyles = new Set<string>();
  const clusterLabels: Array<'bold' | 'professional' | 'creative'> = new Array(k).fill('professional');

  // Build all (cluster, style, score) tuples and sort by score desc
  const candidates: Array<{ cluster: number; style: 'bold' | 'professional' | 'creative'; score: number }> = [];
  for (let c = 0; c < k; c++) {
    candidates.push({ cluster: c, style: 'bold', score: clusterScores[c].bold });
    candidates.push({ cluster: c, style: 'professional', score: clusterScores[c].professional });
    candidates.push({ cluster: c, style: 'creative', score: clusterScores[c].creative });
  }
  candidates.sort((a, b) => b.score - a.score);

  for (const { cluster, style } of candidates) {
    if (!usedStyles.has(style) && clusterLabels[cluster] === 'professional' && usedStyles.has('professional') === false) {
      // Only assign if this cluster hasn't been labeled yet
    }
  }

  // Simpler greedy: iterate styles, pick best cluster for each
  const assignedClusters = new Set<number>();
  const styleOrder: Array<'bold' | 'professional' | 'creative'> = ['bold', 'professional', 'creative'];

  // Sort style order by which has the most distinctive signal
  styleOrder.sort((a, b) => {
    const maxA = Math.max(...clusterScores.map(s => s[a]));
    const maxB = Math.max(...clusterScores.map(s => s[b]));
    return maxB - maxA;
  });

  for (const style of styleOrder) {
    let bestCluster = -1;
    let bestScore = -1;
    for (let c = 0; c < k; c++) {
      if (assignedClusters.has(c)) continue;
      if (clusterScores[c][style] > bestScore) {
        bestScore = clusterScores[c][style];
        bestCluster = c;
      }
    }
    if (bestCluster >= 0) {
      clusterLabels[bestCluster] = style;
      assignedClusters.add(bestCluster);
    }
  }

  // Assign any remaining unassigned clusters
  const remainingStyles = styleOrder.filter(s => {
    return !clusterLabels.some((l, i) => assignedClusters.has(i) && l === s);
  });
  for (let c = 0; c < k; c++) {
    if (!assignedClusters.has(c)) {
      const fallbackStyle = remainingStyles.shift() || 'professional';
      clusterLabels[c] = fallbackStyle;
      assignedClusters.add(c);
    }
  }

  // Build result
  const results: LabeledCluster[] = [];
  for (let c = 0; c < k; c++) {
    const memberIndices = assignments
      .map((a, i) => (a === c ? i : -1))
      .filter(i => i >= 0);

    const styleDef = STYLE_LABELS.find(s => s.name === clusterLabels[c])!;

    results.push({
      name: clusterLabels[c],
      description: styleDef.description,
      centroidIndex: c,
      entryIndices: memberIndices,
      exampleIds: memberIndices.slice(0, 3).map(i => entries[i].id),
    });
  }

  return results;
}
