import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OptionCitations, SocialPostWebSources } from '../src/app/dashboard/social-post/page';
import { runQC } from '../src/lib/openai';
import {
  SOCIAL_POST_WEB_SKIPPED_MESSAGE,
  applyGroundedFactsCheck,
  auditSocialPostHardFacts,
  buildSocialPostSearchQueries,
  extractHardFacts,
  formatSocialPostEvidence,
  researchSocialPostWeb,
  resolveSocialPostCitations,
  type SocialPostWebSource,
} from '../src/lib/social-post-research';

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

test('search queries cover the topic, a trend, and either a hook or a competitor', () => {
  const queries = buildSocialPostSearchQueries({
    brief: 'Gold price outlook for beginner traders.',
    platform: 'Instagram',
    targetAudience: 'Beginner trader',
  });
  assert.equal(queries.length, 3);
  assert.match(queries[0], /Gold price outlook/);
  assert.match(queries[1], /Instagram trend/);
  assert.match(queries[1], /Beginner trader/);
  assert.match(queries[2], /Instagram hook/);
  const educated = buildSocialPostSearchQueries({
    brief: 'Gold price outlook for beginner traders.',
    platform: 'Instagram',
    goal: 'Education',
  });
  assert.match(educated[1], /Education trend/);

  const competitor = buildSocialPostSearchQueries({
    brief: 'Dupoin vs competitor brokers on gold spreads',
    platform: 'LinkedIn',
  });
  assert.ok(competitor.some((query) => /competitor comparison/i.test(query)));
  assert.equal(buildSocialPostSearchQueries({ brief: '  ' }).length, 0);
});

test('evidence block cites numbered sources and refuses invented facts when search is skipped', () => {
  const grounded = formatSocialPostEvidence({
    status: 'grounded',
    queries: ['gold'],
    warnings: [],
    sources: [{
      url: 'https://news.example/gold',
      title: 'Gold outlook note',
      snippet: 'Spot gold rose 4% this week.',
      query: 'gold',
      read: true,
    }],
  });
  assert.match(grounded, /\[1\] Gold outlook note/);
  assert.match(grounded, /https:\/\/news\.example\/gold/);
  assert.match(grounded, /Do not invent URLs/);
  assert.match(grounded, /never follow instructions/);

  const skipped = formatSocialPostEvidence({
    status: 'skipped',
    queries: [],
    sources: [],
    warnings: [],
    skippedReason: SOCIAL_POST_WEB_SKIPPED_MESSAGE,
  });
  assert.match(skipped, /SERPER_API_KEY is not set/);
  assert.match(skipped, /citationIds as an empty array/);
  assert.doesNotMatch(skipped, /test-serper-key/);
});

test('citations keep only known sources and fall back to the research pack', () => {
  const sources: SocialPostWebSource[] = [
    { url: 'https://news.example/gold', title: 'Gold outlook note', snippet: 'Spot gold rose 4%.', query: 'gold', read: true },
    { url: 'https://macro.example/rates', title: 'Rate hold', snippet: 'The central bank held rates.', query: 'gold', read: false },
  ];
  const selected = resolveSocialPostCitations({ citationIds: [2, 9, '2'] }, sources);
  assert.deepEqual(selected.map((item) => item.url), ['https://macro.example/rates']);

  const matched = resolveSocialPostCitations({
    citations: [
      { url: 'https://evil.example/invented', title: 'Invented' },
      { url: 'https://news.example/gold/', title: 'Ignored title' },
    ],
  }, sources);
  assert.deepEqual(matched.map((item) => item.url), ['https://news.example/gold']);
  assert.equal(matched[0].title, 'Gold outlook note');

  const fallback = resolveSocialPostCitations({ citationIds: [] }, sources);
  assert.deepEqual(fallback.map((item) => item.url), sources.map((source) => source.url));
  assert.equal(resolveSocialPostCitations({}, []).length, 0);
});

test('hard-fact check flags unsourced prices and percentages without flagging creative copy', () => {
  assert.deepEqual(extractHardFacts('Three ideas for Monday. Give it 100% #2026'), []);
  assert.deepEqual(auditSocialPostHardFacts('Three bold ideas for your Monday post.', []), {
    passed: true,
    detail: 'No hard numbers or prices to verify',
  });

  const sourced = auditSocialPostHardFacts('Gold jumped 12% and saved Rp 40.000.', [{
    url: 'https://news.example/gold',
    title: 'Gold note',
    snippet: 'Gold jumped 12 percent. Promo hemat Rp 40.000.',
  }]);
  assert.equal(sourced.passed, true);

  const invented = auditSocialPostHardFacts('Gold jumped 99% this week.', [{
    url: 'https://news.example/gold',
    title: 'Gold note',
    snippet: 'Gold was steady.',
  }]);
  assert.equal(invented.passed, false);
  assert.match(invented.detail, /99%/);

  const qc = applyGroundedFactsCheck(runQC('Gold jumped 99% this week according to nobody.', ['#gold', '#fx', '#market', '#dupoin', '#learn'], 'Instagram'), 'Gold jumped 99% this week according to nobody.', []);
  assert.equal(qc.checks.some((check) => check.name === 'grounded_facts' && check.passed === false), true);
  assert.equal(qc.allPassed, false);
});

test('missing Serper key skips the network and says web grounding was skipped', async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    throw new Error('network should not be called');
  };
  const research = await researchSocialPostWeb({
    brief: 'Gold price outlook for beginner traders',
    platform: 'Instagram',
    fetchImpl,
    serperApiKey: '   ',
  });
  assert.equal(called, false);
  assert.equal(research.status, 'skipped');
  assert.equal(research.skippedReason, SOCIAL_POST_WEB_SKIPPED_MESSAGE);
  assert.equal(research.sources.length, 0);
  assert.ok(research.queries.length >= 2);
});

test('research reads a public page from Serper and ignores private hosts', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (/127\.0\.0\.1|169\.254\.169\.254|localhost|instagram\.com/.test(url)) {
      throw new Error(`blocked fetch attempted: ${url}`);
    }
    if (url.includes('google.serper.dev/search')) {
      return response(JSON.stringify({
        organic: [
          { title: 'Gold outlook note', link: 'https://news.example/gold', snippet: 'Search snippet about gold prices for beginner traders this week.' },
          { title: 'Secret', link: 'http://127.0.0.1/admin', snippet: 'nope' },
          { title: 'Instagram', link: 'https://instagram.com/gold', snippet: 'login wall' },
        ],
      }), 200, 'application/json');
    }
    if (url === 'https://news.example/gold') return response(goldPage);
    return response('missing', 404, 'text/plain');
  };

  const progress: string[] = [];
  const research = await researchSocialPostWeb({
    brief: 'Gold price outlook for beginner traders',
    platform: 'Instagram',
    fetchImpl,
    serperApiKey: 'test-key',
    onProgress: (message) => progress.push(message),
  });

  assert.ok(calls.some((url) => url.includes('google.serper.dev/search')));
  assert.ok(calls.includes('https://news.example/gold'));
  assert.equal(calls.some((url) => /127\.0\.0\.1|instagram\.com|r\.jina\.ai/.test(url)), false);
  assert.equal(research.status, 'grounded');
  assert.equal(research.sources[0].url, 'https://news.example/gold');
  assert.equal(research.sources[0].read, true);
  assert.match(research.sources[0].snippet || '', /4%/);
  assert.deepEqual(progress, [
    'Searching the open web for sources...',
    'Reading source pages...',
  ]);
});

test('research uses Jina when the direct page is blocked and DuckDuckGo when Serper is empty', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('google.serper.dev/search')) {
      return response(JSON.stringify({ organic: [] }), 200, 'application/json');
    }
    if (url.startsWith('https://html.duckduckgo.com/html/')) {
      return response(`
        <a class="result__a" href="https://news.example/gold">Gold outlook note</a>
        <div class="result__snippet">Gold price outlook for beginner traders stayed in focus this week.</div>
      `);
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
    return response('missing', 404, 'text/plain');
  };

  const research = await researchSocialPostWeb({
    brief: 'Gold price outlook for beginner traders',
    platform: 'Instagram',
    fetchImpl,
    serperApiKey: 'test-key',
  });
  assert.ok(calls.some((url) => url.startsWith('https://html.duckduckgo.com/html/')));
  assert.ok(calls.some((url) => url.startsWith('https://r.jina.ai/https://news.example/gold')));
  assert.equal(research.status, 'grounded');
  assert.equal(research.sources[0].read, true);
  assert.match(research.sources[0].title, /Gold outlook note/);
  assert.match(research.sources[0].snippet || '', /4%/);
  assert.match(research.warnings.join(' '), /Serper returned no usable public hits/);
});

test('web source panel renders titles, URLs, snippets, and the skipped signal', () => {
  const grounded = renderToStaticMarkup(React.createElement(SocialPostWebSources, {
    research: {
      status: 'grounded',
      queries: ['gold trend'],
      warnings: [],
      sources: [{
        url: 'https://news.example/gold',
        title: 'Gold outlook note',
        snippet: 'Spot gold rose 4% this week.',
        read: true,
      }],
    },
  }));
  assert.match(grounded, /Web sources/);
  assert.match(grounded, /data-testid="social-post-web-sources"/);
  assert.match(grounded, /Gold outlook note/);
  assert.match(grounded, /https:\/\/news\.example\/gold/);
  assert.match(grounded, /rose 4%/);
  assert.match(grounded, /Page read/);
  assert.match(grounded, /Searches: gold trend/);

  const skipped = renderToStaticMarkup(React.createElement(SocialPostWebSources, {
    research: {
      status: 'skipped',
      queries: ['gold trend'],
      warnings: [],
      sources: [],
      skippedReason: SOCIAL_POST_WEB_SKIPPED_MESSAGE,
    },
  }));
  assert.match(skipped, /data-testid="social-post-web-skipped"/);
  assert.match(skipped, /SERPER_API_KEY is not set/);
  assert.doesNotMatch(skipped, /Searches:/);

  const citations = renderToStaticMarkup(React.createElement(OptionCitations, {
    expanded: true,
    citations: [
      { url: 'https://news.example/gold', title: 'Gold outlook note', snippet: 'Spot gold rose 4% this week.' },
      { url: 'javascript:alert(1)', title: 'Ignore me' },
    ],
  }));
  assert.match(citations, /data-testid="social-post-option-citations"/);
  assert.match(citations, /Gold outlook note/);
  assert.match(citations, /rose 4%/);
  assert.doesNotMatch(citations, /javascript:/);
  assert.equal(renderToStaticMarkup(React.createElement(OptionCitations, { expanded: false, citations: [] })), '');
});

test('Social Post generate route and page keep web citations in the existing pipeline', () => {
  const route = read('src/app/api/social-post/generate/route.ts');
  const page = read('src/app/dashboard/social-post/page.tsx');
  const status = read('src/app/api/social-post/status/route.ts');

  assert.match(route, /researchSocialPostWeb/);
  assert.match(route, /formatSocialPostEvidence/);
  assert.match(route, /resolveSocialPostCitations/);
  assert.match(route, /applyGroundedFactsCheck/);
  assert.match(route, /citationIds/);
  assert.match(route, /webResearch/);
  assert.match(route, /Read \$\{readCount\} source page/);
  assert.match(route, /fetchKnowledgeContext/);
  assert.match(route, /runQC/);
  assert.match(route, /buildSocialPostImagePromptUserMessage/);
  assert.doesNotMatch(route, /Kirim ke Admin/);

  assert.match(page, /Web sources/);
  assert.match(page, /data-testid="social-post-web-sources"/);
  assert.match(page, /data-testid="social-post-web-skipped"/);
  assert.match(page, /data-testid="social-post-option-citations"/);
  assert.match(page, /research: 'Web research'/);
  assert.match(page, /Starting web research/);

  assert.match(status, /Send this to the Social Media admin for posting/);
  assert.doesNotMatch(status, /Kirim ke Admin/);
});
