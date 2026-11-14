import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { aiProviderErrorBody, aiProviderStatus } from '@/lib/ai-http-status';
import { generateContent, getUserPreferredModel, runQC } from '@/lib/openai';
import { dedupeHashtags, hashtagRange, normalizeHashtag, platformOptimization } from '@/lib/social-post-brief';

export const dynamic = 'force-dynamic';

const BRAND_TAGS = ['#dupoin', '#dupoinfutures'];

function groupOf(value: unknown): string[] {
  return dedupeHashtags(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'social-post');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const platform = typeof body?.platform === 'string' && body.platform.trim() ? body.platform : 'Instagram';
  const topic = String(body?.topic || body?.caption || '').trim().slice(0, 2_000);
  if (!topic) return NextResponse.json({ error: 'A topic or caption is required.' }, { status: 400 });
  const range = hashtagRange(platform);
  const model = await getUserPreferredModel(auth.id, 'social-post');

  try {
    const result = await generateContent(
      `You write compliant Dupoin Futures hashtags. ${platformOptimization(platform)} Never invent trend volumes. Never use guaranteed-profit wording. Return JSON only.`,
      `Topic or caption:\n${topic}\nContent type: ${typeof body?.contentType === 'string' ? body.contentType : 'photo'}\nReturn between ${range.min} and ${range.max} hashtags in total, grouped as brand, campaign, niche, and broad. Brand should include Dupoin tags when they fit. JSON: { "groups": { "brand": [], "campaign": [], "niche": [], "broad": [] }, "avoid": [{ "tag": "", "reason": "" }], "notes": "" }`,
      auth.id,
      undefined,
      { model, responseFormat: { type: 'json_object' }, temperature: 0.4, taskType: 'social-post' },
    );
    const parsed = JSON.parse(result.content) as { groups?: Record<string, unknown>; avoid?: unknown; notes?: unknown };
    const groups = {
      brand: dedupeHashtags([...BRAND_TAGS, ...groupOf(parsed.groups?.brand)]),
      campaign: groupOf(parsed.groups?.campaign),
      niche: groupOf(parsed.groups?.niche),
      broad: groupOf(parsed.groups?.broad),
    };
    const recommended = dedupeHashtags([
      ...groups.brand,
      ...groups.campaign,
      ...groups.niche,
      ...groups.broad,
    ]).slice(0, range.max);
    const allowed = new Set(recommended);
    groups.brand = groups.brand.filter(tag => allowed.has(tag));
    groups.campaign = groups.campaign.filter(tag => allowed.has(tag));
    groups.niche = groups.niche.filter(tag => allowed.has(tag));
    groups.broad = groups.broad.filter(tag => allowed.has(tag));
    const avoid = Array.isArray(parsed.avoid)
      ? parsed.avoid.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const tag = normalizeHashtag(String((item as { tag?: unknown }).tag || ''));
        const reason = String((item as { reason?: unknown }).reason || '').slice(0, 160);
        return tag ? [{ tag, reason }] : [];
      })
      : [];
    const caption = typeof body?.caption === 'string' ? body.caption : '';
    const qc = caption
      ? runQC(caption, recommended, platform, {
        style: typeof body?.style === 'string' ? body.style : undefined,
        keyMessage: typeof body?.keyMessage === 'string' ? body.keyMessage : undefined,
        cta: typeof body?.cta === 'string' ? body.cta : undefined,
        ctaUrl: typeof body?.ctaUrl === 'string' ? body.ctaUrl : undefined,
      })
      : null;
    return NextResponse.json({
      platform,
      range,
      groups,
      recommended,
      avoid,
      notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 400) : '',
      qc,
    });
  } catch (error) {
    return NextResponse.json(aiProviderErrorBody(error), { status: aiProviderStatus(error) });
  }
}
