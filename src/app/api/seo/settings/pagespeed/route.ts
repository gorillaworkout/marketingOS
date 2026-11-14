import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { pagespeedKeyStatus, savePagespeedKey } from '@/lib/seo/audit-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const envConfigured = Boolean(process.env.PAGESPEED_API_KEY?.trim());
  const stored = await pagespeedKeyStatus();
  return NextResponse.json({
    configured: envConfigured || stored.configured,
    hint: envConfigured ? 'Server environment' : stored.hint,
    source: envConfigured ? 'environment' : stored.configured ? 'settings' : 'none',
  });
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => null) as { pagespeedKey?: unknown; clear?: unknown } | null;
  if (body?.clear === true) {
    const status = await savePagespeedKey(null);
    return NextResponse.json(status);
  }
  const key = typeof body?.pagespeedKey === 'string' ? body.pagespeedKey.trim() : '';
  if (!key) return NextResponse.json({ error: 'Enter a PageSpeed Insights API key, or clear the saved key.' }, { status: 400 });
  if (key.length > 200) return NextResponse.json({ error: 'That key is too long.' }, { status: 400 });
  try {
    const status = await savePagespeedKey(key);
    return NextResponse.json(status);
  } catch {
    return NextResponse.json({ error: 'The key could not be stored. JWT_SECRET must be set on the server.' }, { status: 503 });
  }
}
