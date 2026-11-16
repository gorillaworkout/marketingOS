import { generateContent, getUserPreferredModel } from '@/lib/openai';
import { aiProviderErrorBody } from '@/lib/ai-http-status';
import { crawlSite } from './audit-crawl';
import { bucketCounts, buildGapKeywords, FREE_METHODOLOGY, normalizePhrase, type CompetitorKeyword, type GapKeyword, type OurKeyword } from './keyword-gap-bucket';
import { extractPageCandidates, parseClusteredKeywords, topCandidates } from './keyword-gap-extract';
import { countStoredGscRows, loadStoredGscQueries } from './keyword-gap-gsc';
import {
  dataForSeoError, dataForSeoIntersectionBody, dataForSeoRankedBody, DATAFORSEO_INTERSECTION, DATAFORSEO_RANKED,
  parseDataForSeoIntersection, parseDataForSeoRanked, parseSemrushIntersection, parseSemrushOrganic,
  scrubProviderSecret, semrushDatabase, semrushDomainVsDomainUrl, semrushOrganicUrl,
} from './keyword-gap-providers';
import { crawlTimeoutNote, GAP_COMPETITOR_CRAWL_MS, GAP_COMPETITOR_PAGE_CAP, SEO_LLM_TIMEOUT_MS, StepTimeoutError, withTimeout } from './time-budget';
import { collectTregKeywords } from './keyword-gap-treg';
import { TregError, tregConfig, tregFallbackNotice } from './treg-client';
import { settleTregRun } from './treg-cost-guard';
import { failGap, finishGap, getGap, readDataForSeo, readSemrushKey, updateGapProgress, type GapResult } from './keyword-gap-store';

const CLUSTER_SYSTEM = `You cluster competitor page phrases into search keywords. Reply with a JSON array only.
Each item is {"keyword":"phrase from the list","intent":"informational|navigational|commercial|transactional"}.
Use only phrases from the list. Do not invent keywords, search volume, or ranking positions. Return at most 150 items.`;
const SUMMARY_SYSTEM = `You are an SEO lead. Summarize the keyword gap in English in under 200 words.
Use only the rows given. Do not invent search volume, competitor positions, or Search Console numbers that are not in the rows.
In Free mode, say that competitor positions are a content-coverage gap, not measured rankings. Lead with Missing, then Weak, then Almost.`;

async function clusterPhrases(userId: string, phrases: string[]): Promise<{ keywords: Array<{ keyword: string; intent: GapKeyword['intent'] }>; model: string | null; error: string | null }> {
  const allowed = phrases.slice(0, 400);
  if (!allowed.length) return { keywords: [], model: null, error: null };
  try {
    const model = await getUserPreferredModel(userId, 'seo-content');
    const generated = await withTimeout(generateContent(CLUSTER_SYSTEM, allowed.join('\n'), userId, undefined, {
      model, temperature: 0.2, maxTokens: 4000, taskType: 'seo-keyword-gap',
    }), SEO_LLM_TIMEOUT_MS, 'Clustering');
    const parsed = parseClusteredKeywords(generated.content, allowed);
    if (parsed.length) return { keywords: parsed, model: generated.usage.model, error: null };
  } catch (error) {
    const message = error instanceof StepTimeoutError ? `${error.message} Using the most frequent phrases instead.` : aiProviderErrorBody(error).error;
    return { keywords: topCandidates([{ url: '', phrases: allowed }], 150).map(keyword => ({ keyword, intent: null })), model: null, error: message };
  }
  return { keywords: topCandidates([{ url: '', phrases: allowed }], 150).map(keyword => ({ keyword, intent: null })), model: null, error: null };
}

async function summarize(userId: string, result: GapResult): Promise<{ summary: string | null; error: string | null; model: string | null }> {
  const lines = result.keywords.slice(0, 40).map(keyword => `${keyword.bucket}: ${keyword.keyword} our=${keyword.ourPosition ?? '—'} competitor=${keyword.competitorPosition ?? '—'} volume=${keyword.volume ?? '—'}`);
  try {
    const model = await getUserPreferredModel(userId, 'seo-content');
    const generated = await withTimeout(generateContent(SUMMARY_SYSTEM, [`Provider: ${result.provider}`, result.methodology, '', ...lines].join('\n'), userId, undefined, {
      model, temperature: 0.2, maxTokens: 800, taskType: 'seo-keyword-gap',
    }), SEO_LLM_TIMEOUT_MS, 'The summary');
    return { summary: generated.content.slice(0, 8000), error: null, model: generated.usage.model };
  } catch (error) {
    return { summary: null, error: error instanceof StepTimeoutError ? error.message : aiProviderErrorBody(error).error, model: null };
  }
}

async function readText(url: string, secret: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  if (!response.ok || text.startsWith('ERROR')) throw new Error(scrubProviderSecret(text || `Request failed (${response.status})`, secret));
  return text;
}

async function postJson(url: string, login: string, password: string, body: unknown): Promise<unknown> {
  const token = Buffer.from(`${login}:${password}`).toString('base64');
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Basic ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(scrubProviderSecret(text || `DataForSEO returned ${response.status}`, password));
  const parsed = JSON.parse(text) as unknown;
  const failure = dataForSeoError(parsed);
  if (failure) throw new Error(scrubProviderSecret(failure, password));
  return parsed;
}

type FreeCollection = {
  ours: OurKeyword[];
  competitorKeywords: CompetitorKeyword[];
  source: GapResult['source'];
  intents: Record<string, GapKeyword['intent']>;
  clusterModel: string | null;
};

type LoadedGap = NonNullable<Awaited<ReturnType<typeof getGap>>>;

/** Free mode: stored Search Console queries (or the upload) vs crawled competitor topics. Null when the gap was failed. */
async function collectFree(id: string, gap: LoadedGap, userId: string, notes: string[], failPrefix = ''): Promise<FreeCollection | null> {
  if (!gap.input) return null;
  let ours: OurKeyword[] = [];
  let competitorKeywords: CompetitorKeyword[] = [];
  let source: GapResult['source'] = 'upload';
  const intents: Record<string, GapKeyword['intent']> = {};
  let clusterModel: string | null = null;
  await updateGapProgress(id, 8, 'Reading stored Search Console queries.');
  const storedCount = gap.site_id ? await countStoredGscRows(gap.site_id) : 0;
  if (storedCount > 0 && gap.site_id) {
    ours = await loadStoredGscQueries(gap.site_id);
    source = 'gsc-stored';
  } else if (gap.input.uploadedKeywords?.length) {
    ours = gap.input.uploadedKeywords;
    source = 'upload';
    notes.push('No stored Search Console queries for this domain. The uploaded Queries export is the fallback.');
  } else {
    await failGap(id, `${failPrefix}No stored Search Console queries for this domain. Upload a Queries export (query, clicks, impressions, CTR, position).`);
    return null;
  }
  const domains = gap.input.competitors;
  for (let index = 0; index < domains.length; index += 1) {
    const domain = domains[index];
    const base = 15 + Math.round((index / domains.length) * 50);
    const span = Math.round(50 / domains.length);
    await updateGapProgress(id, base, `Crawling ${domain} (${index + 1} of ${domains.length}).`);
    const pages: Array<{ url: string; phrases: string[] }> = [];
    const crawl = await crawlSite({
      startUrl: domain.startsWith('http') ? domain : `https://${domain}/`,
      maxPages: GAP_COMPETITOR_PAGE_CAP,
      seedFromSitemap: true,
      delayMs: 200,
      deadlineAt: Date.now() + GAP_COMPETITOR_CRAWL_MS,
      onHtml: page => pages.push({ url: page.url, phrases: extractPageCandidates(page.url, page.html) }),
      onProgress: (crawled, maxPages) => {
        if (crawled % 5 !== 0) return;
        void updateGapProgress(id, base + Math.round((crawled / Math.max(maxPages, 1)) * span), `Crawling ${domain}: ${crawled} of up to ${maxPages} pages.`);
      },
    });
    if (crawl.timedOut) notes.push(crawlTimeoutNote(domain, crawl.pages.length, GAP_COMPETITOR_CRAWL_MS));
    const phrases = topCandidates(pages, 80);
    for (const phrase of phrases) competitorKeywords.push({ keyword: phrase, domain, position: null, volume: null });
  }
  await updateGapProgress(id, 72, 'Clustering competitor phrases.');
  const clustered = await clusterPhrases(userId, [...new Set(competitorKeywords.map(keyword => normalizePhrase(keyword.keyword)))]);
  clusterModel = clustered.model;
  if (clustered.error) notes.push(clustered.error);
  if (clustered.keywords.length) {
    const kept = new Set(clustered.keywords.map(keyword => keyword.keyword));
    for (const keyword of clustered.keywords) intents[keyword.keyword] = keyword.intent;
    competitorKeywords = competitorKeywords.filter(keyword => kept.has(normalizePhrase(keyword.keyword)));
  }
  return { ours, competitorKeywords, source, intents, clusterModel };
}

export async function runKeywordGap(id: string): Promise<void> {
  const gap = await getGap(id);
  if (!gap || gap.status === 'succeeded' || gap.status === 'failed' || !gap.input) return;
  const userId = gap.created_by;
  if (!userId) {
    await failGap(id, 'The keyword gap has no owner.');
    return;
  }
  try {
    const notes: string[] = [];
    let ours: OurKeyword[] = [];
    let competitorKeywords: CompetitorKeyword[] = [];
    let source: GapResult['source'] = 'upload';
    let ranked = false;
    const intents: Record<string, GapKeyword['intent']> = {};
    let clusterModel: string | null = null;
    let cost: GapResult['cost'] = null;
    let fallback: string | null = null;

    if (gap.provider === 'free') {
      const free = await collectFree(id, gap, userId, notes);
      if (!free) return;
      ({ ours, competitorKeywords, source, clusterModel } = free);
      Object.assign(intents, free.intents);
    } else if (gap.provider === 'treg') {
      const config = tregConfig();
      const plan = gap.input.treg;
      const outcome = config.apiKey && plan
        ? await collectTregKeywords({
          gapId: id, userId, ourDomain: gap.our_domain, competitors: gap.input.competitors, market: gap.market,
          language: gap.input.language, keywordLimit: plan.keywordLimit,
          onProgress: (progress, text) => updateGapProgress(id, progress, text),
        }, config)
        : { ok: false as const, error: new TregError(config.apiKey ? gap.input.tregSkipped ?? 'not-configured' : 'not-configured'), actualMicro: 0, costSource: 'reported' as const, calls: 0, callIds: [] };
      cost = await settleTregRun({
        config, spendId: plan?.spendId ?? null, estimateMicro: plan?.estimateMicro ?? 0, balanceBeforeMicro: plan?.balanceBeforeMicro ?? null,
        ok: outcome.ok, actualMicro: outcome.actualMicro, costSource: outcome.costSource, calls: outcome.calls, callIds: outcome.callIds,
        note: outcome.ok ? null : tregFallbackNotice(outcome.error), refusalBalanceMicro: outcome.ok ? null : outcome.error.balanceMicro,
      });
      if (outcome.ok) {
        ranked = true;
        source = 'provider';
        ours = outcome.ours;
        competitorKeywords = outcome.competitorKeywords;
      } else {
        fallback = tregFallbackNotice(outcome.error);
        notes.push(fallback);
        const free = await collectFree(id, gap, userId, notes, `${fallback}. `);
        if (!free) return;
        ({ ours, competitorKeywords, source, clusterModel } = free);
        Object.assign(intents, free.intents);
      }
    } else if (gap.provider === 'semrush') {
      ranked = true;
      source = 'provider';
      const key = await readSemrushKey();
      if (!key) {
        await failGap(id, 'Semrush is not configured. An admin can save an API key in SEO settings.');
        return;
      }
      const database = semrushDatabase(gap.market, gap.input.language);
      await updateGapProgress(id, 20, 'Reading Semrush domain organic keywords.');
      const ourHost = new URL(gap.our_domain).hostname.replace(/^www\./, '');
      const own = parseSemrushOrganic(await readText(semrushOrganicUrl(ourHost, database, key), key), ourHost);
      ours = own.ours;
      for (const domain of gap.input.competitors) {
        const host = new URL(domain).hostname.replace(/^www\./, '');
        const rows = parseSemrushOrganic(await readText(semrushOrganicUrl(host, database, key), key), host);
        competitorKeywords.push(...rows.competitor);
        const intersection = parseSemrushIntersection(await readText(semrushDomainVsDomainUrl(ourHost, host, database, key), key), ourHost, host);
        ours.push(...intersection.ours);
        competitorKeywords.push(...intersection.competitor);
      }
    } else {
      ranked = true;
      source = 'provider';
      const auth = await readDataForSeo();
      if (!auth) {
        await failGap(id, 'DataForSEO is not configured. An admin can save the API login and password in SEO settings.');
        return;
      }
      await updateGapProgress(id, 20, 'Reading DataForSEO ranked keywords.');
      const ourHost = new URL(gap.our_domain).hostname.replace(/^www\./, '');
      const ownBody = await postJson(DATAFORSEO_RANKED, auth.login, auth.password, dataForSeoRankedBody(ourHost, gap.market, gap.input.language));
      ours = parseDataForSeoRanked(ownBody, ourHost).ours;
      for (const domain of gap.input.competitors) {
        const host = new URL(domain).hostname.replace(/^www\./, '');
        const rankedBody = await postJson(DATAFORSEO_RANKED, auth.login, auth.password, dataForSeoRankedBody(host, gap.market, gap.input.language));
        competitorKeywords.push(...parseDataForSeoRanked(rankedBody, host).competitor);
        const intersection = await postJson(DATAFORSEO_INTERSECTION, auth.login, auth.password, dataForSeoIntersectionBody(ourHost, host, gap.market, gap.input.language));
        const parsed = parseDataForSeoIntersection(intersection, host);
        ours.push(...parsed.ours);
        competitorKeywords.push(...parsed.competitor);
      }
    }

    await updateGapProgress(id, 88, 'Assigning buckets.');
    const keywords = buildGapKeywords({ ours, competitorKeywords, intents, ranked });
    const result: GapResult = {
      provider: gap.provider,
      source,
      methodology: !ranked ? FREE_METHODOLOGY : gap.provider === 'treg'
        ? 'Competitor positions, volume, keyword difficulty, CPC and intent come from DataForSEO Labs ranked keywords via treg.'
        : 'Competitor positions and volume come from the selected ranking provider.',
      ranked,
      keywords,
      counts: bucketCounts(keywords),
      storedQueries: source === 'gsc-stored' ? ours.length : 0,
      notes,
      cost,
      fallback,
    };
    await updateGapProgress(id, 94, 'Writing the summary.');
    const summary = await summarize(userId, result);
    await finishGap(id, { summary: summary.summary, summaryError: summary.error, model: summary.model || clusterModel, result });
  } catch (error) {
    await failGap(id, error instanceof Error ? error.message : 'The keyword gap failed.');
  }
}
