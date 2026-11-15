/** Server wiring for the proposal AI draft: model routing and read-only Competitor Intelligence insights. */
import { generateContent, getUserPreferredModel } from '@/lib/openai';
import { buildCombinedOpportunities } from './intel';
import { latestReports, listCompetitors } from './store';
import type { DraftDeps } from './proposal';

export const MAX_INSIGHTS = 5;

/** Short "Competitor: opportunity" lines from the latest successful competitor reports. Read-only. */
export async function competitorInsights(): Promise<string[]> {
  const [competitors, { succeeded }] = await Promise.all([listCompetitors(), latestReports()]);
  const opportunities = buildCombinedOpportunities(competitors.flatMap(competitor => {
    const report = succeeded.get(competitor.id);
    return report?.result ? [{ competitorName: competitor.name, opportunities: report.result.opportunities }] : [];
  }));
  return opportunities.slice(0, MAX_INSIGHTS).map(item => `${item.competitorName}: ${item.title}${item.detail ? ` — ${item.detail}` : ''}`.slice(0, 240));
}

/** generateContent routes through the gateway with model failover, including the auth-expired cooldown (src/lib/llm-auth.ts). */
export function proposalDraftDeps(userId: string): DraftDeps {
  return {
    complete: async (system, user) => {
      const model = await getUserPreferredModel(userId, 'market-research');
      const generated = await generateContent(system, user, userId, undefined, {
        model,
        responseFormat: { type: 'json_object' },
        temperature: 0.4,
        maxTokens: 2_500,
        taskType: 'partnership-proposal',
      });
      return { content: generated.content, model: generated.usage.model };
    },
  };
}
