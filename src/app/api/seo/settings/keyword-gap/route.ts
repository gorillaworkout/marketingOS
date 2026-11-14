import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { providerKeyStatus, saveDataForSeo, saveSemrushKey } from '@/lib/seo/keyword-gap-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  return NextResponse.json(await providerKeyStatus());
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => null) as { semrushKey?: unknown; clearSemrush?: unknown; dataforseoLogin?: unknown; dataforseoPassword?: unknown; clearDataforseo?: unknown } | null;
  try {
    if (body?.clearSemrush === true) await saveSemrushKey(null);
    else if (typeof body?.semrushKey === 'string' && body.semrushKey.trim()) {
      if (body.semrushKey.trim().length > 200) return NextResponse.json({ error: 'That key is too long.' }, { status: 400 });
      await saveSemrushKey(body.semrushKey.trim());
    }
    if (body?.clearDataforseo === true) await saveDataForSeo(null, null);
    else if (typeof body?.dataforseoLogin === 'string' && typeof body?.dataforseoPassword === 'string' && body.dataforseoLogin.trim() && body.dataforseoPassword.trim()) {
      await saveDataForSeo(body.dataforseoLogin.trim(), body.dataforseoPassword.trim());
    }
  } catch {
    return NextResponse.json({ error: 'The key could not be stored. JWT_SECRET must be set on the server.' }, { status: 503 });
  }
  return NextResponse.json(await providerKeyStatus());
}
