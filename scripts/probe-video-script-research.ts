/**
 * Live Video Script grounding check.
 *
 *   npx tsx scripts/probe-video-script-research.ts "gold outlook for beginner traders"
 *   npx tsx scripts/probe-video-script-research.ts "gold outlook" --url https://www.reuters.com/markets/
 *
 * Open-web search needs SERPER_API_KEY in .env.local (or the process environment).
 * Reference URLs are still read with Jina when that key is missing.
 * Unit tests mock Serper and Jina, so this probe is the live check.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

async function main() {
  const args = process.argv.slice(2);
  const urls: string[] = [];
  const words: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--url' && args[index + 1]) {
      urls.push(args[index + 1]);
      index += 1;
      continue;
    }
    words.push(args[index]);
  }

  const event = words.join(' ').trim() || 'gold price outlook for beginner traders';
  if (!process.env.SERPER_API_KEY?.trim()) {
    console.log('SERPER_API_KEY is not set. Open-web search will be skipped. Reference links are still read with Jina when you pass --url.');
  }

  const { researchVideoScriptWeb } = await import('../src/lib/video-script-research');
  const research = await researchVideoScriptWeb({
    event,
    platform: 'Instagram Reels',
    duration: '30-45 seconds',
    targetAudience: 'Beginner trader',
    references: urls.join('\n'),
    timeoutMs: 12_000,
  });

  console.log('status   :', research.status);
  if (research.skippedReason) console.log('skipped  :', research.skippedReason);
  console.log('queries  :', research.queries.join(' | ') || '(none)');
  if (research.warnings.length) console.log('warnings :', research.warnings.join(' | '));
  console.log(`sources (${research.sources.length}):`);
  for (const source of research.sources) {
    console.log(`  - [${source.kind}${source.read ? ', read' : ', snippet'}] ${source.title}`);
    console.log(`    ${source.url}`);
    console.log(`    ${(source.snippet || '').slice(0, 180).replace(/\s+/g, ' ')}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('probe failed:', message);
  process.exit(1);
});
