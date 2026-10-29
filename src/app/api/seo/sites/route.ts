import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { connectionStatus, defaultSiteId, listSeoSites } from '@/lib/seo/sites';
import { serviceAccountStatus } from '@/lib/seo/sync-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const [sites, account] = await Promise.all([listSeoSites(), serviceAccountStatus()]);
  return NextResponse.json({
    sites: sites.map(site => ({ ...site, status: connectionStatus(site, account.configured) })),
    defaultSiteId: defaultSiteId(sites),
    isAdmin: auth.role === 'admin',
    // Admins see why Search Console is not connected; members only see the state.
    serviceAccount: auth.role === 'admin' ? account : { configured: account.configured },
  });
}
