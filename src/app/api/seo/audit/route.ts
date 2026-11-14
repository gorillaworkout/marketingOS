import { after } from 'next/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { auditUrlError, clampMaxPages, normalizeAuditUrl, sameHost } from '@/lib/seo/audit-url';
import { AuditInProgressError, createAudit, listAudits } from '@/lib/seo/audit-store';
import { runSeoAudit } from '@/lib/seo/audit-run';
import { listSeoSites } from '@/lib/seo/sites';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const audits = await listAudits();
  return NextResponse.json({ audits });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null) as { url?: unknown; maxPages?: unknown } | null;
  const raw = typeof body?.url === 'string' ? body.url.trim() : '';
  const invalid = auditUrlError(raw);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const startUrl = normalizeAuditUrl(raw);
  const sites = await listSeoSites();
  const site = sites.find(item => sameHost(item.site_url, startUrl)) ?? null;
  try {
    const id = await createAudit({ startUrl, siteId: site?.id ?? null, maxPages: clampMaxPages(body?.maxPages), userId: auth.id });
    after(() => runSeoAudit(id));
    return NextResponse.json({ id }, { status: 202 });
  } catch (error) {
    if (error instanceof AuditInProgressError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
