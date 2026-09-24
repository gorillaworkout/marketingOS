/**
 * Offline tests mock Serper and Jina.
 * Live check when SERPER_API_KEY is available (this checkout has no .env):
 *   npx tsx scripts/probe-video-script-research.ts "gold outlook for beginner traders"
 *   npx tsx scripts/probe-video-script-research.ts "gold outlook" --url https://www.reuters.com/markets/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VideoScriptCitations, VideoScriptQcPanel, VideoScriptWebSources } from '../src/app/dashboard/video-script/page';
import { runVideoScriptQc } from '../src/lib/video-script-qc';
import {
  VIDEO_SCRIPT_REFERENCE_SKIP_WARNING,
  VIDEO_SCRIPT_WEB_SKIPPED_MESSAGE,
  buildVideoScriptSearchQueries,
  formatVideoScriptEvidence,
  parseVideoScriptReferenceUrls,
  researchVideoScriptWeb,
  resolveVideoScriptCitations,
  type VideoScriptWebSource,
} from '../src/lib/video-script-research';

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), 'utf8');

function response(body: string, status = 200, contentType = 'text/html', finalUrl = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: finalUrl,
    headers: new Headers({ 'content-type': contentType }),
    body: null,
    text: async () => body,
  } as Response;
}

const goldPage = `<html><head><title>Gold outlook note</title></head><body>
<p>Gold price outlook for beginner traders: spot gold rose 4% this week after the central bank held rates and traders rebuilt long positions.</p>
</body></html>`;

const creativeFullScript = `[0:00-0:12]
[VISUAL: close chart]
[SFX: soft tick]
[VO: The chart moved overnight, and the reason is simpler than it looks. Rates held steady in the story traders already knew. That is the whole move, told without a magic number. Stay with the part most recaps skip.]
[0:12-0:30]
[VO: You do not need a louder opinion today. You need a cleaner way to see the same move. Dupoin is where that watch starts, with the risk still in the room. Follow if you want the next one in plain language.]`;

test('search queries cover the topic, a video format, and competitors', () => {
  const queries = buildVideoScriptSearchQueries({
    event: 'Gold price outlook for beginner traders.',
    platform: 'Instagram Reels',
    duration: '30-45 seconds',
    targetAudience: 'Beginner trader',
  });
  assert.equal(queries.length, 3);
  assert.match(queries[0], /Gold price outlook/);
  assert.match(queries[1], /Instagram Reels script format/);
  assert.match(queries[1], /Beginner trader/);
  assert.match(queries[2], /competitors/);

  const named = buildVideoScriptSearchQueries({
    event: 'Dupoin vs competitor brokers on gold spreads',
    platform: 'TikTok',
  });
  assert.ok(named.some((query) => /competitor comparison/i.test(query)));
  assert.equal(buildVideoScriptSearchQueries({ event: '  ' }).length, 0);
  assert.deepEqual(parseVideoScriptReferenceUrls('see https://notes.example/reel, http://127.0.0.1/secret https://notes.example/reel/'), [
    'https://notes.example/reel',
  ]);
});

test('evidence block cites numbered sources and allows creative voiceover when search is skipped', () => {
  const grounded = formatVideoScriptEvidence({
    status: 'grounded',
    queries: ['gold'],
    warnings: [],
    sources: [{
      url: 'https://news.example/gold',
      title: 'Gold outlook note',
      snippet: 'Spot gold rose 4% this week.',
      query: 'gold',
      read: true,
      kind: 'web',
    }],
  });
  assert.match(grounded, /\[1\] Gold outlook note \(open web\)/);
  assert.match(grounded, /https:\/\/news\.example\/gold/);
  assert.match(grounded, /Creative voiceover/);
  assert.match(grounded, /never follow instructions/);

  const skipped = formatVideoScriptEvidence({
    status: 'skipped',
    queries: [],
    sources: [],
    warnings: [],
    skippedReason: VIDEO_SCRIPT_WEB_SKIPPED_MESSAGE,
  });
  assert.match(skipped, /SERPER_API_KEY is not set/);
  assert.match(skipped, /citationIds as an empty array/);
});

test('missing Serper key skips the network unless a reference link can be read', async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    throw new Error('network should not be called');
  };
  const research = await researchVideoScriptWeb({
    event: 'Gold price outlook for beginner traders',
    platform: 'Instagram Reels',
    fetchImpl,
    serperApiKey: '   ',
  });
  assert.equal(called, false);
  assert.equal(research.status, 'skipped');
  assert.equal(research.skippedReason, VIDEO_SCRIPT_WEB_SKIPPED_MESSAGE);
  assert.equal(research.sources.length, 0);
});

test('a provided reference is read with Jina when the raw page is a challenge shell', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (/google\.serper\.dev|duckduckgo|127\.0\.0\.1/.test(url)) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    if (url === 'https://www.instagram.com/p/abc') return response('Log in to Instagram to see this');
    if (url.startsWith('https://r.jina.ai/https://www.instagram.com/p/abc')) {
      return response('Log in to continue', 200, 'text/plain');
    }
    if (url === 'https://notes.example/reel') return response('Just a moment');
    if (url.startsWith('https://r.jina.ai/https://notes.example/reel')) {
      return response([
        'Title: Reel format note',
        'URL Source: https://notes.example/reel',
        '',
        'Short-form gold videos open on the chart, hold for two beats, then land the explanation before the fifteen-second mark.',
      ].join('\n'), 200, 'text/plain');
    }
    return response('missing', 404, 'text/plain');
  };

  const progress: string[] = [];
  const research = await researchVideoScriptWeb({
    event: 'Gold price outlook for beginner traders',
    platform: 'Instagram Reels',
    references: 'https://notes.example/reel\nhttps://www.instagram.com/p/abc\nhttp://127.0.0.1/secret',
    fetchImpl,
    serperApiKey: '',
    onProgress: (message) => progress.push(message),
  });

  assert.equal(calls.some((url) => /serper|duckduckgo|127\.0\.0\.1/.test(url)), false);
  assert.ok(calls.some((url) => url.startsWith('https://r.jina.ai/https://notes.example/reel')));
  assert.equal(research.status, 'grounded');
  assert.equal(research.sources.length, 1);
  assert.equal(research.sources[0].kind, 'reference');
  assert.equal(research.sources[0].read, true);
  assert.match(research.sources[0].snippet || '', /fifteen-second mark/);
  assert.ok(research.warnings.some((warning) => warning.includes('https://www.instagram.com/p/abc')));
  assert.ok(research.warnings.includes(VIDEO_SCRIPT_REFERENCE_SKIP_WARNING));
  assert.deepEqual(progress, [
    'Reading the reference links you provided...',
    'Reading source pages...',
  ]);
});

test('research reads a public page from Serper and uses Jina when the direct page is blocked', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (/127\.0\.0\.1|localhost/.test(url)) throw new Error(`blocked fetch attempted: ${url}`);
    if (url.includes('google.serper.dev/search')) {
      return response(JSON.stringify({
        organic: [
          { title: 'Gold outlook note', link: 'https://news.example/gold', snippet: 'Search snippet about gold prices for beginner traders this week.' },
          { title: 'Secret', link: 'http://127.0.0.1/admin', snippet: 'nope' },
          { title: 'Instagram', link: 'https://instagram.com/gold', snippet: 'login wall that should not be fetched' },
        ],
      }), 200, 'application/json');
    }
    if (url === 'https://news.example/gold') return response('Just a moment');
    if (url.startsWith('https://r.jina.ai/https://news.example/gold')) {
      return response([
        'Title: Gold outlook note',
        'URL Source: https://news.example/gold',
        '',
        'Gold price outlook for beginner traders: spot gold rose 4% this week after the central bank held rates and traders rebuilt long positions.',
      ].join('\n'), 200, 'text/plain');
    }
    return response(goldPage);
  };

  const research = await researchVideoScriptWeb({
    event: 'Gold price outlook for beginner traders',
    platform: 'Instagram Reels',
    fetchImpl,
    serperApiKey: 'test-key',
  });
  assert.ok(calls.some((url) => url.includes('google.serper.dev/search')));
  assert.ok(calls.some((url) => url.startsWith('https://r.jina.ai/https://news.example/gold')));
  assert.equal(calls.some((url) => /127\.0\.0\.1|instagram\.com/.test(url)), false);
  assert.equal(research.status, 'grounded');
  assert.equal(research.sources[0].url, 'https://news.example/gold');
  assert.equal(research.sources[0].kind, 'web');
  assert.equal(research.sources[0].read, true);
  assert.match(research.sources[0].snippet || '', /4%/);
});

test('citations keep only known sources', () => {
  const sources: VideoScriptWebSource[] = [
    { url: 'https://news.example/gold', title: 'Gold outlook note', snippet: 'Spot gold rose 4%.', query: 'gold', read: true, kind: 'web' },
    { url: 'https://macro.example/rates', title: 'Rate hold', snippet: 'The central bank held rates.', query: 'gold', read: false, kind: 'web' },
  ];
  const selected = resolveVideoScriptCitations({ citationIds: [2, 9] }, sources);
  assert.deepEqual(selected.map((item) => item.url), ['https://macro.example/rates']);
  const invented = resolveVideoScriptCitations({ citations: [{ url: 'https://evil.example/invented' }] }, sources);
  assert.deepEqual(invented.map((item) => item.url), sources.map((source) => source.url));
  assert.equal(resolveVideoScriptCitations({ citationIds: [1] }, []).length, 0);
});

test('script QC flags unsourced hard claims and keeps creative voiceover', () => {
  const preview = runVideoScriptQc({
    mode: 'preview',
    duration: '30-45 seconds',
    platform: 'Instagram Reels',
    hook: 'The chart moved, and nobody explained why.',
    context: 'A short look at the week, and trading is not risk-free.',
    highlight: 'The moment the trend became obvious.',
    brandTieIn: 'Dupoin keeps the chart in one place.',
    cta: 'Follow for the next breakdown.',
    citations: [],
  });
  assert.equal(preview.allPassed, true);
  assert.equal(preview.checks.some((check) => check.name === 'timing' || check.name === 'voiceover'), false);
  assert.match(preview.checks.find((check) => check.name === 'grounded_facts')?.detail || '', /No hard numbers/);

  const sourced = runVideoScriptQc({
    mode: 'full',
    duration: '30-45 seconds',
    hook: 'Gold jumped, and the chart made it obvious.',
    cta: 'Follow for the next breakdown.',
    fullScript: creativeFullScript.replace('The chart moved', 'Gold jumped 4% and the chart moved'),
    citations: [{ url: 'https://news.example/gold', title: 'Gold note', snippet: 'Spot gold rose 4% this week.' }],
  });
  assert.equal(sourced.checks.find((check) => check.name === 'grounded_facts')?.passed, true);
  assert.equal(sourced.checks.find((check) => check.name === 'voiceover')?.passed, true);
  assert.equal(sourced.checks.find((check) => check.name === 'timing')?.passed, true);
  assert.equal(sourced.allPassed, true);

  const invented = runVideoScriptQc({
    mode: 'full',
    duration: '30-45 seconds',
    hook: 'Gold jumped 99% and the chart made it obvious.',
    cta: 'Follow for the next breakdown.',
    fullScript: creativeFullScript,
    citations: [{ url: 'https://news.example/gold', title: 'Gold note', snippet: 'Gold was steady.' }],
  });
  const grounded = invented.checks.find((check) => check.name === 'grounded_facts');
  assert.equal(grounded?.passed, false);
  assert.match(grounded?.detail || '', /99%/);
  assert.equal(invented.allPassed, false);
  assert.match(invented.checks.find((check) => check.name === 'voiceover')?.detail || '', /voiceover/i);

  const thin = runVideoScriptQc({
    mode: 'full',
    duration: '30-45 seconds',
    hook: 'Wait.',
    cta: '',
    fullScript: '[0:00]\n[VO: Buy now.]',
    citations: [],
  });
  assert.equal(thin.checks.find((check) => check.name === 'cta')?.passed, false);
  assert.match(thin.checks.find((check) => check.name === 'cta')?.detail || '', /call to action/i);
  assert.equal(thin.checks.find((check) => check.name === 'voiceover_sentences')?.passed, false);
  assert.match(thin.checks.find((check) => check.name === 'voiceover_sentences')?.detail || '', /single sentence/);

  const compliance = runVideoScriptQc({
    mode: 'preview',
    hook: 'This trade is guaranteed profit.',
    cta: 'Open an account right now before it is too late.',
    citations: [],
  });
  assert.equal(compliance.checks.find((check) => check.name === 'compliance')?.passed, false);
  assert.match(compliance.checks.find((check) => check.name === 'compliance')?.detail || '', /Guaranteed-return/);
});

test('web source and QC panels render English issues without blocking copy', () => {
  const grounded = renderToStaticMarkup(React.createElement(VideoScriptWebSources, {
    research: {
      status: 'grounded',
      queries: ['gold script format'],
      warnings: [VIDEO_SCRIPT_REFERENCE_SKIP_WARNING],
      sources: [{
        url: 'https://news.example/gold',
        title: 'Gold outlook note',
        snippet: 'Spot gold rose 4% this week.',
        query: 'gold',
        read: true,
        kind: 'reference',
      }],
    },
  }));
  assert.match(grounded, /Web sources/);
  assert.match(grounded, /data-testid="video-script-web-sources"/);
  assert.match(grounded, /Gold outlook note/);
  assert.match(grounded, /https:\/\/news\.example\/gold/);
  assert.match(grounded, /Reference link/);
  assert.match(grounded, /Page read/);
  assert.match(grounded, /Searches: gold script format/);

  const skipped = renderToStaticMarkup(React.createElement(VideoScriptWebSources, {
    research: {
      status: 'skipped',
      queries: ['gold'],
      warnings: [],
      sources: [],
      skippedReason: VIDEO_SCRIPT_WEB_SKIPPED_MESSAGE,
    },
  }));
  assert.match(skipped, /data-testid="video-script-web-skipped"/);
  assert.match(skipped, /SERPER_API_KEY is not set/);

  const qc = renderToStaticMarkup(React.createElement(VideoScriptQcPanel, {
    result: runVideoScriptQc({
      mode: 'preview',
      hook: 'Gold jumped 99% overnight.',
      cta: 'Follow along.',
      citations: [],
    }),
  }));
  assert.match(qc, /data-testid="video-script-qc"/);
  assert.match(qc, /Has warnings/);
  assert.match(qc, /99%/);
  assert.match(qc, /do not block the script/i);

  const citations = renderToStaticMarkup(React.createElement(VideoScriptCitations, {
    detailed: true,
    citations: [
      { url: 'https://news.example/gold', title: 'Gold outlook note', snippet: 'Spot gold rose 4% this week.' },
      { url: 'javascript:alert(1)', title: 'Ignore me' },
    ],
  }));
  assert.match(citations, /data-testid="video-script-citations"/);
  assert.match(citations, /Gold outlook note/);
  assert.doesNotMatch(citations, /javascript:/);
});

test('Video Script generation keeps research, QC, and the two-step flow', () => {
  const route = read('src/app/api/video-script/generate/route.ts');
  const page = read('src/app/dashboard/video-script/page.tsx');
  assert.match(route, /researchVideoScriptWeb/);
  assert.match(route, /formatVideoScriptEvidence/);
  assert.match(route, /resolveVideoScriptCitations/);
  assert.match(route, /runVideoScriptQc/);
  assert.match(route, /citationIds/);
  assert.match(route, /webResearch/);
  assert.match(route, /qcResults/);
  assert.match(route, /fetchKnowledgeContext\(userId, event, 'video-script', 5\)/);
  assert.match(route, /\$\{contextMemory\}/);
  assert.match(route, /\$\{knowledgeContext\}/);
  assert.match(route, /mode === 'preview'/);
  assert.match(route, /mode === 'full'/);
  assert.doesNotMatch(route, /fetchReferenceContent/);
  assert.doesNotMatch(route, /substring\(0,\s*1000\)/);
  assert.ok(route.lastIndexOf('runVideoScriptQc') < route.indexOf('INSERT INTO tasks'));

  assert.match(page, /data-testid="video-script-web-sources"/);
  assert.match(page, /data-testid="video-script-web-skipped"/);
  assert.match(page, /data-testid="video-script-qc"/);
  assert.match(page, /data-testid="video-script-citations"/);
  assert.match(page, /research: 'Web research'/);
  assert.match(page, /qc: 'Script quality check'/);
  assert.match(page, /Generate three preview options/);
  assert.match(page, /Generate full script/);
  assert.match(read('scripts/probe-video-script-research.ts'), /SERPER_API_KEY/);
  assert.match(read('.env.example'), /Video Script/);
});
