import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { execute, queryAll, queryOne } from '@/lib/database';
import { requireFeature } from '@/lib/auth';
import { aiProviderErrorBody, aiProviderStatus } from '@/lib/ai-http-status';
import { generateContent, getUserPreferredModel, runQC } from '@/lib/openai';
import { normalizeCaptionAnalysis, type CaptionCheck } from '@/lib/social-post-competitor';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'social-post');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rows = await queryAll<{ id: string; platform: string | null; caption: string; result: unknown; model: string | null; created_at: string; task_id: string | null }>(
    `SELECT id, platform, caption, result, model, task_id, created_at::text AS created_at
     FROM caption_analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
    [auth.id],
  );
  return NextResponse.json({ analyses: rows });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireFeature(request, 'social-post');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Analysis id is required.' }, { status: 400 });
  const removed = await execute('DELETE FROM caption_analyses WHERE id = ? AND user_id = ?', [id, auth.id]);
  if (!removed) return NextResponse.json({ error: 'Analysis not found.' }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'social-post');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const caption = typeof body?.caption === 'string' ? body.caption.trim().slice(0, 2_200) : '';
  if (!caption) return NextResponse.json({ error: 'A caption is required.' }, { status: 400 });
  const platform = typeof body?.platform === 'string' && body.platform.trim() ? body.platform.trim().slice(0, 40) : 'Instagram';
  const goal = typeof body?.goal === 'string' ? body.goal.trim().slice(0, 80) : '';
  const cta = typeof body?.cta === 'string' ? body.cta.trim().slice(0, 40) : '';
  const keyMessage = typeof body?.keyMessage === 'string' ? body.keyMessage.trim().slice(0, 200) : '';
  const hashtags = Array.isArray(body?.hashtags) ? body.hashtags.filter((item): item is string => typeof item === 'string') : [];
  const checks = runQC(caption, hashtags, platform, { keyMessage, cta: cta || undefined, ctaUrl: typeof body?.ctaUrl === 'string' ? body.ctaUrl : undefined }).checks as CaptionCheck[];
  const model = await getUserPreferredModel(auth.id, 'social-post');
  try {
    const generated = await generateContent(
      'You review Dupoin Futures social captions. Score honestly. Compliance means BAPPEBTI: no guaranteed profit, no risk-free claims. Return JSON only.',
      `Platform: ${platform}\nGoal: ${goal || 'unspecified'}\nCTA: ${cta || 'none'}\nKey message: ${keyMessage || 'none'}\nDeterministic checks: ${JSON.stringify(checks)}\nCaption:\n${caption}\nJSON: { "score": 0, "summary": "", "dimensions": { "hook": { "score": 1, "note": "" }, "clarity": { "score": 1, "note": "" }, "brandVoice": { "score": 1, "note": "" }, "cta": { "score": 1, "note": "" }, "platformFit": { "score": 1, "note": "" }, "compliance": { "score": 1, "note": "" } }, "recommendations": [{ "priority": "high", "issue": "", "fix": "" }], "rewrittenHook": "", "improvedCaption": "", "suggestedHashtags": [] }`,
      auth.id,
      undefined,
      { model, responseFormat: { type: 'json_object' }, temperature: 0.3, taskType: 'social-post' },
    );
    const result = normalizeCaptionAnalysis(JSON.parse(generated.content), checks);
    let taskId: string | null = null;
    if (typeof body?.taskId === 'string' && body.taskId.trim()) {
      const task = await queryOne('SELECT id FROM tasks WHERE id = ? AND user_id = ?', [body.taskId.trim(), auth.id]);
      taskId = task ? body.taskId.trim() : null;
    }
    const id = uuidv4();
    await execute(
      `INSERT INTO caption_analyses (id, user_id, task_id, platform, caption, result, model) VALUES (?, ?, ?, ?, ?, ?::jsonb, ?)`,
      [id, auth.id, taskId, platform, caption, JSON.stringify(result), generated.usage.model || model],
    );
    return NextResponse.json({ id, result, model: generated.usage.model || model });
  } catch (error) {
    return NextResponse.json(aiProviderErrorBody(error), { status: aiProviderStatus(error) });
  }
}
