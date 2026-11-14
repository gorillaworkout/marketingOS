import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { execute, queryAll, queryOne } from '@/lib/database';
import { getAuthorizedUser } from '@/lib/auth';
import { canEditBrandVoice, canWriteBrandVoice, VOICE_SAMPLE_MAX, VOICE_SAMPLES_STORED_MAX } from '@/lib/social-post-library';

type RouteContext = { params: Promise<{ id: string }> };

const CONTENT_TYPES = new Set(['photo', 'carousel', 'video']);

async function parentFor(request: NextRequest, id: string) {
  const user = await getAuthorizedUser(request);
  if ('error' in user) return user;
  if (!canWriteBrandVoice(user)) {
    return { error: 'Forbidden: Social Post, Video Script, or Event Plan access is required.', status: 403 as const };
  }
  const row = await queryOne<{ id: string; user_id: string; is_shared: boolean }>(
    'SELECT id, user_id, is_shared FROM brand_guidelines WHERE id = ? AND (user_id = ? OR is_shared = TRUE)',
    [id, user.id],
  );
  if (!row) return { error: 'Guideline not found', status: 404 as const };
  return { user, row };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const loaded = await parentFor(request, id);
  if ('error' in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const samples = await queryAll(
    `SELECT id, platform, content_type, caption, note, created_by, created_at
     FROM brand_voice_samples WHERE brand_guideline_id = ? ORDER BY created_at DESC LIMIT ?`,
    [id, VOICE_SAMPLES_STORED_MAX],
  );
  return NextResponse.json({
    samples,
    can_edit: canEditBrandVoice(loaded.user, { userId: loaded.row.user_id, isShared: Boolean(loaded.row.is_shared) }),
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const loaded = await parentFor(request, id);
  if ('error' in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  if (!canEditBrandVoice(loaded.user, { userId: loaded.row.user_id, isShared: Boolean(loaded.row.is_shared) })) {
    return NextResponse.json({ error: 'Only an admin can add a sample to a shared brand voice. Save it on your personal voice instead.' }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { caption?: unknown; platform?: unknown; contentType?: unknown; note?: unknown } | null;
  const caption = typeof body?.caption === 'string' ? body.caption.trim().slice(0, VOICE_SAMPLE_MAX) : '';
  if (!caption) return NextResponse.json({ error: 'A sample caption is required.' }, { status: 400 });
  const count = await queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM brand_voice_samples WHERE brand_guideline_id = ?', [id]);
  if (Number(count?.count || 0) >= VOICE_SAMPLES_STORED_MAX) {
    return NextResponse.json({ error: `A brand voice can keep ${VOICE_SAMPLES_STORED_MAX} samples.` }, { status: 400 });
  }
  const contentType = typeof body?.contentType === 'string' && CONTENT_TYPES.has(body.contentType) ? body.contentType : null;
  const platform = typeof body?.platform === 'string' ? body.platform.trim().slice(0, 40) : null;
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 300) : null;
  const sampleId = uuidv4();
  await execute(
    `INSERT INTO brand_voice_samples (id, brand_guideline_id, platform, content_type, caption, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sampleId, id, platform || null, contentType, caption, note || null, loaded.user.id],
  );
  return NextResponse.json({ success: true, id: sampleId });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const loaded = await parentFor(request, id);
  if ('error' in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  if (!canEditBrandVoice(loaded.user, { userId: loaded.row.user_id, isShared: Boolean(loaded.row.is_shared) })) {
    return NextResponse.json({ error: 'Only an admin can delete a sample from a shared brand voice.' }, { status: 403 });
  }
  const sampleId = new URL(request.url).searchParams.get('sampleId');
  if (!sampleId) return NextResponse.json({ error: 'Sample id is required.' }, { status: 400 });
  await execute('DELETE FROM brand_voice_samples WHERE id = ? AND brand_guideline_id = ?', [sampleId, id]);
  return NextResponse.json({ success: true });
}
