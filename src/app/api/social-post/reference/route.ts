import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { aiProviderErrorBody, aiProviderStatus } from '@/lib/ai-http-status';
import { postChat } from '@/lib/llm-provider';
import { getUserPreferredModel } from '@/lib/openai';
import { clipDescription, readPublicReferenceUrl } from '@/lib/social-post-reference';
import { REFERENCE_IMAGE_MAX_BYTES, REFERENCE_TEXT_MAX } from '@/lib/social-post-brief';

export const dynamic = 'force-dynamic';

const IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]);

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'social-post');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Choose one PNG, JPG, or WebP image.' }, { status: 400 });
    const extension = IMAGE_TYPES.get(file.type);
    if (!extension) return NextResponse.json({ error: 'Use a PNG, JPG, or WebP image.' }, { status: 400 });
    if (file.size > REFERENCE_IMAGE_MAX_BYTES) return NextResponse.json({ error: 'Image must be 5 MB or smaller.' }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const imageKey = `${randomUUID()}.${extension}`;
    const directory = path.join(process.cwd(), 'data', 'social-post-references');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, imageKey), bytes);
    try {
      const model = await getUserPreferredModel(auth.id, 'social-post');
      const exchange = await postChat({
        model,
        feature: 'social-post',
        referer: 'https://marketingos.local',
        title: 'MarketingOS',
        timeoutMs: 60_000,
        body: {
          model,
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this screenshot for a social caption writer in 800 characters or fewer. Mention the subject, layout, and any readable headline. Do not invent offers or numbers.' },
              { type: 'image_url', image_url: { url: `data:${file.type};base64,${bytes.toString('base64')}` } },
            ],
          }],
        },
      });
      if (!exchange.response.ok) {
        const detail = await exchange.response.text();
        return NextResponse.json({ error: `The image could not be described. Paste the text instead. ${detail.slice(0, 180)}` }, { status: aiProviderStatus(new Error(detail)) });
      }
      const payload = await exchange.response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = clipDescription(payload.choices?.[0]?.message?.content || '');
      if (!text) return NextResponse.json({ error: 'The image had no usable description. Paste the text instead.' }, { status: 424 });
      return NextResponse.json({ kind: 'image', text, imageKey });
    } catch (error) {
      return NextResponse.json(aiProviderErrorBody(error), { status: aiProviderStatus(error) });
    }
  }

  const body = await request.json().catch(() => null) as { kind?: string; text?: string; url?: string } | null;
  if (body?.kind === 'text') {
    const text = String(body.text || '').trim().slice(0, REFERENCE_TEXT_MAX);
    if (!text) return NextResponse.json({ error: 'Paste some reference text.' }, { status: 400 });
    return NextResponse.json({ kind: 'text', text });
  }
  if (body?.kind === 'url') {
    const url = String(body.url || '').trim();
    const read = await readPublicReferenceUrl(url);
    if ('error' in read) return NextResponse.json({ error: read.error, kind: 'url', url }, { status: 400 });
    return NextResponse.json({ kind: 'url', url, text: read.text });
  }
  return NextResponse.json({ error: 'Choose pasted text, a public URL, or one image.' }, { status: 400 });
}
