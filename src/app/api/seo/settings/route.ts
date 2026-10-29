import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { execute, queryAll, queryOne } from '@/lib/database';
import { normalizeGscProperty } from '@/lib/seo/property';
import { listSeoSites } from '@/lib/seo/sites';
import { serviceAccountStatus } from '@/lib/seo/sync-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const [sites, serviceAccount, runs] = await Promise.all([
    listSeoSites(),
    serviceAccountStatus(),
    queryAll(
      `SELECT r.id, r.site_id, s.name AS site_name, r.mode, r.status, to_char(r.range_start, 'YYYY-MM-DD') AS range_start, to_char(r.range_end, 'YYYY-MM-DD') AS range_end, r.days_synced, r.rows_upserted, r.error, r.started_at, r.finished_at
       FROM seo_sync_runs r JOIN seo_sites s ON s.id = r.site_id ORDER BY r.started_at DESC LIMIT 20`,
      [],
    ),
  ]);
  return NextResponse.json({ sites, serviceAccount, runs });
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const body = await request.json().catch(() => ({})) as { id?: unknown; name?: unknown; gscProperty?: unknown; active?: unknown };
  if (typeof body.id !== 'string' || !body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const existing = await queryOne<{ id: string }>('SELECT id FROM seo_sites WHERE id = ?', [body.id]);
  if (!existing) return NextResponse.json({ error: 'SEO site not found' }, { status: 404 });

  const sets: string[] = [];
  const values: unknown[] = [];
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120) return NextResponse.json({ error: 'Name must be 1-120 characters' }, { status: 400 });
    sets.push('name = ?');
    values.push(name);
  }
  if (body.gscProperty !== undefined) {
    const property = normalizeGscProperty(body.gscProperty);
    if (property === undefined) {
      return NextResponse.json({ error: 'GSC property must be sc-domain:example.com or a URL prefix ending in / such as https://example.com/' }, { status: 400 });
    }
    sets.push('gsc_property = ?');
    values.push(property);
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return NextResponse.json({ error: 'active must be true or false' }, { status: 400 });
    sets.push('active = ?');
    values.push(body.active);
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  await execute(`UPDATE seo_sites SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...values, body.id]);
  const site = await queryOne('SELECT id, name, site_url, gsc_property, active, last_synced_at FROM seo_sites WHERE id = ?', [body.id]);
  return NextResponse.json({ site });
}
