import { cosineSimilarity, parseStoredEmbedding } from '@/lib/embeddings';
import { CAMPAIGN_MATCH_MIN, type CampaignCandidate } from '@/lib/social-post-library';

/** Suggest the closest active campaign. Callers must not inject it unless the user selects it. */
export function rankCampaignSuggestion(
  briefEmbedding: number[],
  campaigns: CampaignCandidate[],
): { id: string; name: string; score: number } | null {
  let best: { id: string; name: string; score: number } | null = null;
  for (const campaign of campaigns) {
    if (campaign.status !== 'active') continue;
    const vector = parseStoredEmbedding(campaign.embedding);
    if (!vector) continue;
    const score = cosineSimilarity(briefEmbedding, vector);
    if (score < CAMPAIGN_MATCH_MIN) continue;
    if (!best || score > best.score) best = { id: campaign.id, name: campaign.name, score };
  }
  return best;
}
