/**
 * Probe the GorillaWorkout OpenAI-compatible gateway for live chat models.
 *
 * Default host is llmdupoin (override with GORILLAWORKOUT_API_BASE).
 * Requires GORILLAWORKOUT_API_KEY — do not commit secrets.
 *
 * VPS / production verify:
 *   GORILLAWORKOUT_API_BASE=https://llmdupoin.gorillaworkout.id/v1 \
 *   GORILLAWORKOUT_API_KEY=... \
 *     npx tsx scripts/probe-gateway-models.ts
 *
 * Optional extra ids: pass them as argv (probed even if /models omitted them).
 */
import { config } from 'dotenv';
import { parseGatewayCompletion } from '../src/lib/gateway-response';
import { resolveGorillaWorkoutApiBase, resolveGorillaWorkoutApiKey } from '../src/lib/gateway-config';
import { GATEWAY_BROWSER_USER_AGENT } from '../src/lib/model-health';

config({ path: '.env.local' });
config();

async function probe(base: string, key: string, model: string): Promise<{ model: string; ok: boolean; note: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'User-Agent': GATEWAY_BROWSER_USER_AGENT,
        'HTTP-Referer': 'https://marketing-aws.gorillaworkout.id',
        'X-Title': 'MarketingOS gateway probe',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        temperature: 0,
        max_tokens: 1500,
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      return { model, ok: false, note: `HTTP ${response.status} ${body.slice(0, 140).replace(/\s+/g, ' ')}` };
    }
    let content = '';
    try {
      content = parseGatewayCompletion(body, response.headers.get('content-type'));
    } catch (error) {
      return { model, ok: false, note: `unparseable: ${(error as Error).message}` };
    }
    // A 200 can still carry a retirement notice as the completion text.
    if (/no longer available|deprecated|has been retired|switch to/i.test(content)) {
      return { model, ok: false, note: `RETIRED: ${content.slice(0, 120).replace(/\s+/g, ' ')}` };
    }
    if (!content.trim()) return { model, ok: false, note: 'empty completion' };
    return { model, ok: true, note: content.slice(0, 60).replace(/\s+/g, ' ') };
  } catch (error) {
    return { model, ok: false, note: `error: ${(error as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const BASE = resolveGorillaWorkoutApiBase();
  const KEY = resolveGorillaWorkoutApiKey();
  if (!KEY) {
    console.error('GORILLAWORKOUT_API_KEY is not set. Load .env.local or export it, then re-run.');
    console.error(`Would probe: ${BASE}`);
    process.exit(2);
  }

  const listed = await fetch(`${BASE}/models`, {
    headers: {
      Authorization: `Bearer ${KEY}`,
      'User-Agent': GATEWAY_BROWSER_USER_AGENT,
    },
  })
    .then(r => r.json())
    .then(d => (d.data || []).map((m: { id: string }) => m.id) as string[])
    .catch(() => [] as string[]);

  const extra = process.argv.slice(2);
  const models = [...new Set([...listed, ...extra])];
  console.log(`probing ${models.length} models against ${BASE}`);
  console.log(`listed by gateway /models: ${listed.length}\n`);

  const results: { model: string; ok: boolean; note: string }[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < models.length; i += CONCURRENCY) {
    const batch = await Promise.all(models.slice(i, i + CONCURRENCY).map(model => probe(BASE, KEY, model)));
    for (const entry of batch) {
      console.log(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.model.padEnd(38)} ${entry.note}`);
      results.push(entry);
    }
  }

  // A 401/429 can be a transient auth or rate-limit blip, not a retirement.
  // Retry failures once, slowly, before calling anything dead.
  const retryable = results.filter(r => !r.ok && !r.note.startsWith('RETIRED'));
  if (retryable.length) {
    console.log(`\n--- retrying ${retryable.length} failures once ---`);
    for (const entry of retryable) {
      await new Promise(resolve => setTimeout(resolve, 3_000));
      const second = await probe(BASE, KEY, entry.model);
      console.log(`${second.ok ? 'PASS' : 'FAIL'}  ${second.model.padEnd(38)} ${second.note}`);
      const index = results.findIndex(r => r.model === entry.model);
      results[index] = second;
    }
  }

  const alive = results.filter(r => r.ok).map(r => r.model);
  const dead = results.filter(r => !r.ok);
  console.log(`\n=== ALIVE (${alive.length}/${results.length}) ===`);
  console.log(JSON.stringify(alive, null, 2));
  console.log(`\n=== DEAD (${dead.length}) ===`);
  for (const entry of dead) console.log(`${entry.model.padEnd(38)} ${entry.note}`);
  console.log(`\nNOT LISTED BY GATEWAY: ${extra.filter(m => !listed.includes(m)).join(', ') || '(none)'}`);
}

main();
