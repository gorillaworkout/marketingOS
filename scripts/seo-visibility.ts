import 'dotenv/config';
import { closeDb, queryAll } from '../src/lib/database';
import { NothingToCheckError, startVisibilityRun } from '../src/lib/seo/visibility-run';
import { HARD_MAX_CHECKS } from '../src/lib/seo/visibility';
import { RunBusyError, resolveRunUserId } from '../src/lib/seo/visibility-store';

// SEO OS AI Visibility: ask each active prompt on each configured model through
// the llmdupoin gateway and store mention / rank / citations.
//
//   npm run seo:visibility                      every active site that has active prompts
//   npm run seo:visibility -- --site=<site id>   one site (active or not)
//   npm run seo:visibility -- --max-checks=120   override the per-run cap (1-300; default = site setting, 60)
//   npm run seo:visibility -- --user=<id|username>  user the token_logs rows are attributed to (default: oldest admin)
//
// Weekly VPS cron, Monday 07:00 WIB (00:00 UTC). Not installed automatically; see docs/seo-os/setup.md:
// 0 0 * * 1 cd /home/ubuntu/apps/marketingos && npm run seo:visibility >> /home/ubuntu/logs/seo-visibility.log 2>&1
//
// Requires DATABASE_URL and GORILLAWORKOUT_API_KEY (already set for the app). Keys are never printed.

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<number> {
  const maxArg = argValue('max-checks');
  const maxChecks = maxArg === undefined ? undefined : Number(maxArg);
  if (maxChecks !== undefined && (!Number.isInteger(maxChecks) || maxChecks < 1 || maxChecks > HARD_MAX_CHECKS)) {
    console.error(`--max-checks must be an integer between 1 and ${HARD_MAX_CHECKS}`);
    return 1;
  }
  const userArg = argValue('user');
  const userId = await resolveRunUserId(userArg);
  if (!userId) {
    console.error(userArg ? `User not found: ${userArg}` : 'No admin user found to attribute token usage to. Pass --user=<id|username>.');
    return 1;
  }
  const site = argValue('site');
  const siteIds = site ? [site] : (await queryAll<{ id: string }>(
    `SELECT s.id FROM seo_sites s WHERE s.active AND EXISTS (SELECT 1 FROM seo_ai_prompts p WHERE p.site_id = s.id AND p.active) ORDER BY s.created_at, s.id`,
    [],
  )).map(row => row.id);
  if (!siteIds.length) {
    console.log('AI Visibility: no active site has active prompts yet. Add prompts in SEO OS > AI Visibility.');
    return 0;
  }
  let failed = 0;
  for (const siteId of siteIds) {
    try {
      const started = await startVisibilityRun({ siteId, trigger: 'cron', triggeredBy: null, tokenUserId: userId, maxChecks });
      console.log(`AI Visibility ${siteId}: run ${started.runId}, ${started.planned} checks planned, ${started.skippedPrompts} prompts wait for the next run.`);
      const result = await started.done;
      console.log(`AI Visibility ${siteId}: ${result.done} answered, ${result.failed} failed, cost $${result.cost.toFixed(4)}.`);
      if (result.done === 0 && started.planned > 0) failed += 1;
    } catch (error) {
      if (error instanceof RunBusyError || error instanceof NothingToCheckError) {
        console.log(`AI Visibility ${siteId}: skipped. ${error.message}`);
        continue;
      }
      failed += 1;
      console.error(`AI Visibility ${siteId} failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  return failed ? 1 : 0;
}

main()
  .then(async code => { await closeDb(); process.exitCode = code; })
  .catch(async error => { console.error(error instanceof Error ? error.message : error); await closeDb(); process.exitCode = 1; });
