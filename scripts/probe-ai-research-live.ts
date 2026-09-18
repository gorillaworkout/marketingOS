/**
 * Live end-to-end probe for AI Research grounding.
 * Runs the real gatherAiResearchContext against the live network (Serper +
 * fallbacks) and prints which queries were issued and which sources came back.
 *
 * Usage: npx tsx scripts/probe-ai-research-live.ts "your question"
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
  const question = process.argv[2] || 'cari informasi Bayu Darmawan AKA Gorillaworkout';
  const {
    buildSearchQueries,
    buildOpenWebSearchQueries,
    extractPersonNameCandidates,
    extractHandleCandidates,
    gatherAiResearchContext,
  } = await import('../src/lib/ai-research-grounding');

  console.log('question :', question);
  console.log('names    :', extractPersonNameCandidates(question));
  console.log('handles  :', extractHandleCandidates(question));
  console.log('queries  :', buildSearchQueries(question));
  console.log('openWeb  :', buildOpenWebSearchQueries(question));

  const result = await gatherAiResearchContext(question, { timeoutMs: 30_000 });
  console.log(`\nsources (${result.sources.length}):`);
  for (const source of result.sources) {
    console.log(`  - ${source.url}`);
    console.log(`      ${source.snippet.slice(0, 140).replace(/\s+/g, ' ')}`);
  }
}

main().catch(error => {
  console.error('probe failed:', error.message);
  process.exit(1);
});
