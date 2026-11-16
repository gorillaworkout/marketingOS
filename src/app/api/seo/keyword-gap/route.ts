import { after } from 'next/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { sameHost } from '@/lib/seo/audit-url';
import { gscKeywordSource, countStoredGscRows } from '@/lib/seo/keyword-gap-gsc';
import { parseCompetitors, parseDomain } from '@/lib/seo/keyword-gap-input';
import { parseGscQueryFile } from '@/lib/seo/keyword-gap-parse';
import { GapInProgressError, createGap, listGaps, providerFlags, type GapInput, type GapProvider } from '@/lib/seo/keyword-gap-store';
import { runKeywordGap } from '@/lib/seo/keyword-gap-run';
import { listSeoSites } from '@/lib/seo/sites';
import { tregConfig } from '@/lib/seo/treg-client';
import { parseKeywordLimit, planTregRun } from '@/lib/seo/treg-plan';
import { attachSpendRef, expireStaleReservations, settleTregSpend } from '@/lib/seo/treg-spend';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PROVIDERS = new Set(['free', 'semrush', 'dataforseo', 'treg']);

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const domain = request.nextUrl.searchParams.get('domain') || '';
  const parsed = domain ? parseDomain(domain) : null;
  const sites = await listSeoSites();
  const site = parsed && !('error' in parsed) ? sites.find(item => sameHost(item.site_url, parsed.url)) ?? null : null;
  const storedRows = site ? await countStoredGscRows(site.id) : 0;
  const gscSites = await Promise.all(sites.map(async item => ({
    name: item.name,
    siteUrl: item.site_url,
    gscProperty: item.gsc_property,
    storedRows: await countStoredGscRows(item.id),
  })));
  const gaps = await listGaps();
  const providers = await providerFlags();
  return NextResponse.json({
    gaps,
    providers,
    gscSites,
    source: parsed && !('error' in parsed) ? {
      domain: parsed.url,
      siteId: site?.id ?? null,
      gscProperty: site?.gsc_property ?? null,
      active: site?.active ?? false,
      storedRows,
      using: gscKeywordSource({ gscProperty: site?.gsc_property ?? null, active: site?.active ?? false, storedRows }),
    } : null,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Send the keyword gap form.' }, { status: 400 });
  const our = parseDomain(String(form.get('ourDomain') || ''));
  if ('error' in our) return NextResponse.json({ error: our.error }, { status: 400 });
  const competitors = parseCompetitors(String(form.get('competitors') || ''), our.host);
  if (competitors.error) return NextResponse.json({ error: competitors.error }, { status: 400 });
  const language = form.get('language') === 'en' ? 'en' : 'id';
  const market = String(form.get('market') || '').trim().slice(0, 80);
  if (!market) return NextResponse.json({ error: 'Enter a market, for example Indonesia.' }, { status: 400 });
  const provider = String(form.get('provider') || 'free');
  if (!PROVIDERS.has(provider)) return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });
  const flags = await providerFlags();
  if (provider === 'semrush' && !flags.semrush) return NextResponse.json({ error: 'Semrush is not configured.' }, { status: 400 });
  if (provider === 'dataforseo' && !flags.dataforseo) return NextResponse.json({ error: 'DataForSEO is not configured.' }, { status: 400 });

  let uploadedKeywords: GapInput['uploadedKeywords'] = null;
  const file = form.get('queries');
  if (file instanceof File && file.size > 0) {
    if (file.size > 5_000_000) return NextResponse.json({ error: 'The Queries export is larger than 5 MB.' }, { status: 400 });
    const parsedFile = parseGscQueryFile(Buffer.from(await file.arrayBuffer()));
    if (parsedFile.error) return NextResponse.json({ error: parsedFile.error }, { status: 400 });
    uploadedKeywords = parsedFile.keywords;
  }
  const sites = await listSeoSites();
  const site = sites.find(item => sameHost(item.site_url, our.url)) ?? null;
  const payload: GapInput = { uploadedKeywords, competitors: competitors.domains.map(domain => domain.url), language, market };
  let spendId: string | null = null;
  if (provider === 'treg') {
    await expireStaleReservations().catch(() => undefined);
    const confirmed = Number(form.get('confirmEstimateMicro'));
    const plan = await planTregRun({
      config: tregConfig(),
      role: auth.role,
      userId: auth.id,
      competitors: payload.competitors.length,
      keywordLimit: parseKeywordLimit(form.get('keywordLimit')),
      confirmedEstimateMicro: Number.isFinite(confirmed) && confirmed > 0 ? confirmed : null,
    });
    if (plan.kind === 'refuse') return NextResponse.json(plan.body, { status: plan.status });
    if (plan.kind === 'paid') {
      spendId = plan.spendId;
      payload.treg = { spendId: plan.spendId, keywordLimit: plan.keywordLimit, estimateMicro: plan.estimateMicro, balanceBeforeMicro: plan.balanceBeforeMicro };
    } else {
      payload.tregSkipped = plan.reason;
    }
  }
  try {
    const id = await createGap({ siteId: site?.id ?? null, ourDomain: our.url, provider: provider as GapProvider, payload, userId: auth.id });
    if (spendId) await attachSpendRef(spendId, id);
    after(() => runKeywordGap(id));
    return NextResponse.json({ id }, { status: 202 });
  } catch (error) {
    // Nothing was called on treg: release the reservation.
    if (spendId) await settleTregSpend(spendId, { status: 'failed', actualMicro: 0, costSource: 'reported', calls: 0, callIds: [], note: 'The run did not start.' }).catch(() => undefined);
    if (error instanceof GapInProgressError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
