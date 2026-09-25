import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AIResearchPage from '../src/app/dashboard/ai-research/page';
import {
  AI_RESEARCH_STOPPED_STATUS,
  fetchWithAbortSignal,
  isAbortError,
  linkAbortSignal,
  mergeAbortSignals,
  researchAbortError,
  throwIfResearchAborted,
} from '../src/lib/ai-research-abort';
import { runDeepResearchGather } from '../src/lib/ai-research-deep';
import { gatherAiResearchContext } from '../src/lib/ai-research-grounding';
import { fetchAiResearchContextUrls } from '../src/lib/ai-research-url-fetch';

const read = (path: string) => readFileSync(path, 'utf8');

function abortError(): Error {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}

function hangingFetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(abortError());
    if (init?.signal?.aborted) {
      fail();
      return;
    }
    init?.signal?.addEventListener('abort', fail, { once: true });
    if (!init?.signal) reject(new Error(`missing abort signal for ${String(input)}`));
  });
}

test('abort helpers link and merge signals', () => {
  const parent = new AbortController();
  const linked = linkAbortSignal(parent.signal);
  assert.equal(linked.signal.aborted, false);
  parent.abort();
  assert.equal(linked.signal.aborted, true);
  assert.equal(linkAbortSignal(parent.signal).signal.aborted, true);

  const left = new AbortController();
  const right = new AbortController();
  const merged = mergeAbortSignals(left.signal, right.signal);
  right.abort();
  assert.equal(merged.aborted, true);
  assert.equal(mergeAbortSignals(left.signal), left.signal);

  const error = researchAbortError();
  assert.equal(isAbortError(error), true);
  assert.equal(isAbortError(new Error('network')), false);
  assert.throws(() => throwIfResearchAborted(parent.signal), (caught: unknown) => isAbortError(caught));
  assert.equal(AI_RESEARCH_STOPPED_STATUS, 'Stopped');
});

test('deep gather does not start another round after abort', async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  await assert.rejects(
    runDeepResearchGather({
      query: 'gold price outlook',
      plan: {
        outline: ['One', 'Two', 'Three'],
        queries: ['gold price', 'gold news', 'gold regulator'],
        source: 'fallback',
      },
      signal: controller.signal,
      gather: async query => {
        calls.push(query);
        controller.abort();
        return { query, sources: [], indonesiaPreferred: false };
      },
    }),
    (error: unknown) => isAbortError(error),
  );
  assert.deepEqual(calls, ['gold price']);
});

test('gather cancels in-flight source fetches when the signal aborts', async () => {
  const controller = new AbortController();
  let fetches = 0;
  const pending = gatherAiResearchContext('Dupoin gold price outlook this week', {
    fetchImpl: (input, init) => {
      fetches += 1;
      return hangingFetch(input, init);
    },
    signal: controller.signal,
    timeoutMs: 30_000,
    searchApiKeys: {},
    enableJinaFallback: false,
    logger: { warn() {} },
  });
  setTimeout(() => controller.abort(), 30);
  const outcome = await Promise.race([
    pending.then(() => 'resolved' as const, error => error),
    new Promise(resolve => setTimeout(() => resolve('timeout'), 1_500)),
  ]);
  assert.notEqual(outcome, 'timeout');
  assert.equal(isAbortError(outcome), true);
  assert.ok(fetches > 0);
});

test('context url fetch rejects when the signal aborts', async () => {
  const controller = new AbortController();
  const pending = fetchAiResearchContextUrls('See https://example.com/gold-report for the outlook', {
    signal: controller.signal,
    timeoutMs: 30_000,
    lookupImpl: async () => ['93.184.216.34'],
    fetchImpl: hangingFetch,
  });
  controller.abort();
  await assert.rejects(pending, (error: unknown) => isAbortError(error));
});

test('fetch wrapper forwards the parent abort signal', async () => {
  const controller = new AbortController();
  let seenAborted = false;
  const wrapped = fetchWithAbortSignal(((_input, init) => {
    seenAborted = Boolean(init?.signal?.aborted);
    return Promise.reject(abortError());
  }) as typeof fetch, controller.signal);
  controller.abort();
  await assert.rejects(wrapped('https://example.com/report'), (error: unknown) => isAbortError(error));
  assert.equal(seenAborted, true);
});

test('AI Research page shows Stop and the chat route aborts with the request', () => {
  const page = read('src/app/dashboard/ai-research/page.tsx');
  const route = read('src/app/api/ai-research/chat/route.ts');
  assert.match(page, /data-testid="ai-research-stop"/);
  assert.match(page, /aria-label="Stop research"/);
  assert.match(page, />\s*Stop\s*</);
  assert.match(page, /new AbortController\(\)/);
  assert.match(page, /signal: controller\.signal/);
  assert.match(page, /AI_RESEARCH_STOPPED_STATUS/);
  assert.match(page, /data-testid="ai-research-stopped"/);
  assert.match(page, /stopResearch/);
  assert.match(page, /isAbortError/);
  assert.match(route, /linkAbortSignal\(request\.signal\)/);
  assert.match(route, /cancel\(\) \{\s*clientAbort\.abort\(\);/);
  assert.match(route, /throwIfResearchAborted\(signal\)/);
  assert.match(route, /signal: options\.signal/);
  assert.match(route, /gatherAiResearchContext\(searchQuery, \{ timeoutMs, signal \}\)/);
  assert.match(route, /gatherResearchSide\(query, signal\)/);
  assert.match(route, /fetchAiResearchContextUrls\(query, \{ signal \}\)/);
  assert.doesNotMatch(page, /Internal Docs/);

  const idle = renderToStaticMarkup(createElement(AIResearchPage));
  assert.match(idle, /data-testid="ai-research-compare-toggle"/);
  assert.match(idle, /title="Send message"/);
  assert.doesNotMatch(idle, /data-testid="ai-research-stop"/);
  assert.doesNotMatch(idle, /data-testid="ai-research-stopped"/);
  assert.match(page, /loading \? \([\s\S]*data-testid="ai-research-stop"/);
});
