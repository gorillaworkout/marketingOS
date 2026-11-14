import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { execute, queryAll, queryOne } from '@/lib/database';
import { requireFeature } from '@/lib/auth';
import { aiProviderErrorBody, aiProviderStatus } from '@/lib/ai-http-status';
import { postChat } from '@/lib/llm-provider';
import { getUserPreferredModel, generateContent } from '@/lib/openai';
import { REFERENCE_IMAGE_MAX_BYTES } from '@/lib/social-post-brief';
import { readPublicReferenceUrl } from '@/lib/social-post-reference';
import {
  COMPETITOR_NAME_MAX,
  COMPETITOR_TEXT_MAX,
  approachInsight,
  canDeleteCompetitor,
  competitorFetchDecision,
  parseCompetitorAnalysis,
} from '@/lib/social-post-competitor';

export const dynamic = 'force-dynamic';

const IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]);

type CompetitorRow = {
  id: string;
  competitor_name: string;
  platform: string | null;
  source_url: string | null;
  pasted_text: string | null;
  screenshot_key: string | null;
  analysis: unknown;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
};

const SELECT = `
  SELECT c.id, c.competitor_name, c.platform, c.source_url, c.pasted_text, c.screenshot_key, c.analysis,
         c.created_by, c.updated_by, c.created_at::text AS created_at, c.updated_at::text AS updated_at,
         creator.name AS created_by_name, editor.name AS updated_by_name
  FROM competitor_references c
  LEFT JOIN users creator ON creator.id = c.created_by
  LEFT JOIN users editor ON editor.id = c.updated_by
`;

function present(row: CompetitorRow, actor: { id: string; role: string }) {
  const analysis = parseCompetitorAnalysis(row.analysis);
  const hasAnalysis = Boolean(row.analysis);
  return {
    id: row.id,
    competitorName: row.competitor_name,
    platform: row.platform,
    sourceUrl: row.source_url,
    pastedText: row.pasted_text,
    hasScreenshot: Boolean(row.screenshot_key),
    analysis: hasAnalysis ? analysis : null,
    insight: hasAnalysis ? approachInsight(analysis, row.pasted_text || '') : '',
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    updatedBy: row.updated_by,
    updatedByName: row.updated_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canDelete: canDeleteCompetitor(actor, { createdBy: row.created_by }),
  };
}

function safeKey(value: string | null): string | null {
  if (!value || !/^[0-9a-f-]{36}\.(png|jpg|webp)$/i.test(value)) return null;
  return value;
}

async function loadRow(id: string): Promise<CompetitorRow | undefined> {
  return queryOne<CompetitorRow>(`${SELECT} WHERE c.id = ?`, [id]);
}

async function describeScreenshot(userId: string, imageKey: string, mime: string): Promise<string> {
  const file = path.join(process.cwd(), 'data', 'competitor-references', imageKey);
  const bytes = await readFile(file);
  const model = await getUserPreferredModel(userId, 'social-post');
  const exchange = await postChat({
    model,
    feature: 'social-post',
    referer: 'https://marketingos.local',
    title: 'MarketingOS',
    timeoutMs: 60_000,
    body: {
      model,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe the marketing approach in this screenshot. Do not copy headlines verbatim. JSON: { "hookPattern": "", "structure": "", "tone": "", "ctaStyle": "", "hashtagStyle": "", "visualNotes": "", "strengths": [], "weaknesses": [], "whatToAvoid": [], "differentiationIdeas": [] }' },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${bytes.toString('base64')}` } },
        ],
      }],
    },
  });
  if (!exchange.response.ok) {
    const detail = await exchange.response.text();
    throw new Error(detail.slice(0, 300));
  }
  const payload = await exchange.response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return payload.choices?.[0]?.message?.content || '';
}

async function analyzeRow(userId: string, row: CompetitorRow) {
  if (row.analysis) return { analysis: parseCompetitorAnalysis(row.analysis), cached: true, model: null as string | null };
  const model = await getUserPreferredModel(userId, 'social-post');
  let content = '';
  if (row.screenshot_key && safeKey(row.screenshot_key)) {
    const extension = row.screenshot_key.split('.').pop();
    const mime = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
    content = await describeScreenshot(userId, row.screenshot_key, mime);
  } else {
    const source = [row.pasted_text, row.source_url].filter(Boolean).join('\n').slice(0, COMPETITOR_TEXT_MAX);
    if (!source) throw new Error('Add pasted text, a screenshot, or a public article before analyzing.');
    const result = await generateContent(
      'You describe marketing approaches for Dupoin. Never copy the source wording. Never name or disparage the other brand. Return JSON only.',
      `Untrusted source:\n${source}\nJSON: { "hookPattern": "", "structure": "", "tone": "", "ctaStyle": "", "hashtagStyle": "", "visualNotes": "", "strengths": [], "weaknesses": [], "whatToAvoid": [], "differentiationIdeas": [] }`,
      userId,
      undefined,
      { model, responseFormat: { type: 'json_object' }, temperature: 0.2, taskType: 'social-post' },
    );
    content = result.content;
  }
  const analysis = parseCompetitorAnalysis(JSON.parse(content));
  await execute(
    'UPDATE competitor_references SET analysis = ?::jsonb, updated_by = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(analysis), userId, row.id],
  );
  return { analysis, cached: false, model };
}

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'social-post');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rows = await queryAll<CompetitorRow>(`${SELECT} ORDER BY c.updated_at DESC LIMIT 100`);
  return NextResponse.json({ competitors: rows.map(row => present(row, auth)) });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'social-post');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const analyze = new URL(request.url).searchParams.get('analyze') === '1';
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Choose one PNG, JPG, or WebP image.' }, { status: 400 });
    const extension = IMAGE_TYPES.get(file.type);
    if (!extension) return NextResponse.json({ error: 'Use a PNG, JPG, or WebP image.' }, { status: 400 });
    if (file.size > REFERENCE_IMAGE_MAX_BYTES) return NextResponse.json({ error: 'Image must be 5 MB or smaller.' }, { status: 400 });
    const name = String(form.get('competitorName') || '').trim().slice(0, COMPETITOR_NAME_MAX);
    if (!name) return NextResponse.json({ error: 'Competitor name is required.' }, { status: 400 });
    const imageKey = `${randomUUID()}.${extension}`;
    const directory = path.join(process.cwd(), 'data', 'competitor-references');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, imageKey), Buffer.from(await file.arrayBuffer()));
    const id = uuidv4();
    await execute(
      `INSERT INTO competitor_references (id, competitor_name, platform, source_url, pasted_text, screenshot_key, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, String(form.get('platform') || '').slice(0, 40) || null, null, String(form.get('pastedText') || '').trim().slice(0, COMPETITOR_TEXT_MAX) || null, imageKey, auth.id, auth.id],
    );
    if (!analyze) return NextResponse.json({ success: true, id });
    const row = await loadRow(id);
    if (!row) return NextResponse.json({ error: 'Competitor reference was not saved.' }, { status: 500 });
    try {
      const result = await analyzeRow(auth.id, row);
      return NextResponse.json({ success: true, id, ...result, insight: approachInsight(result.analysis, row.pasted_text || '') });
    } catch (error) {
      return NextResponse.json(aiProviderErrorBody(error), { status: aiProviderStatus(error) });
    }
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Competitor details are required.' }, { status: 400 });

  if (body.action === 'fetch-url') {
    const id = typeof body.id === 'string' ? body.id : '';
    const row = id ? await loadRow(id) : undefined;
    if (!row) return NextResponse.json({ error: 'Competitor reference not found.' }, { status: 404 });
    const decision = competitorFetchDecision(row.source_url || '', Boolean(row.pasted_text?.trim()));
    if ('error' in decision) return NextResponse.json({ error: decision.error }, { status: 400 });
    if (decision.action === 'skip') return NextResponse.json({ success: true, id, text: row.pasted_text, fetched: false });
    const read = await readPublicReferenceUrl(row.source_url || '');
    if ('error' in read) return NextResponse.json({ error: read.error }, { status: 400 });
    const text = read.text.slice(0, COMPETITOR_TEXT_MAX);
    await execute(
      'UPDATE competitor_references SET pasted_text = ?, analysis = NULL, updated_by = ?, updated_at = NOW() WHERE id = ?',
      [text, auth.id, id],
    );
    return NextResponse.json({ success: true, id, text, fetched: true });
  }

  if (typeof body.id === 'string' && analyze) {
    const row = await loadRow(body.id);
    if (!row) return NextResponse.json({ error: 'Competitor reference not found.' }, { status: 404 });
    try {
      const result = await analyzeRow(auth.id, row);
      return NextResponse.json({ success: true, id: row.id, cached: result.cached, analysis: result.analysis, insight: approachInsight(result.analysis, row.pasted_text || '') });
    } catch (error) {
      return NextResponse.json(aiProviderErrorBody(error), { status: aiProviderStatus(error) });
    }
  }

  const name = typeof body.competitorName === 'string' ? body.competitorName.trim().slice(0, COMPETITOR_NAME_MAX) : '';
  if (!name) return NextResponse.json({ error: 'Competitor name is required.' }, { status: 400 });
  const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : '';
  if (sourceUrl) {
    const decision = competitorFetchDecision(sourceUrl, true);
    if ('error' in decision && !decision.error.includes('never fetched')) {
      return NextResponse.json({ error: decision.error }, { status: 400 });
    }
  }
  const id = uuidv4();
  await execute(
    `INSERT INTO competitor_references (id, competitor_name, platform, source_url, pasted_text, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      name,
      typeof body.platform === 'string' ? body.platform.trim().slice(0, 40) || null : null,
      sourceUrl || null,
      typeof body.pastedText === 'string' ? body.pastedText.trim().slice(0, COMPETITOR_TEXT_MAX) || null : null,
      auth.id,
      auth.id,
    ],
  );
  return NextResponse.json({ success: true, id });
}

export async function PUT(request: NextRequest) {
  const auth = await requireFeature(request, 'social-post');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = typeof body?.id === 'string' ? body.id : '';
  const row = id ? await loadRow(id) : undefined;
  if (!row) return NextResponse.json({ error: 'Competitor reference not found.' }, { status: 404 });
  const name = typeof body?.competitorName === 'string' ? body.competitorName.trim().slice(0, COMPETITOR_NAME_MAX) : row.competitor_name;
  if (!name) return NextResponse.json({ error: 'Competitor name is required.' }, { status: 400 });
  const sourceUrl = typeof body?.sourceUrl === 'string' ? body.sourceUrl.trim() : row.source_url || '';
  if (sourceUrl) {
    const decision = competitorFetchDecision(sourceUrl, true);
    if ('error' in decision && !decision.error.includes('never fetched')) return NextResponse.json({ error: decision.error }, { status: 400 });
  }
  const pastedText = typeof body?.pastedText === 'string' ? body.pastedText.trim().slice(0, COMPETITOR_TEXT_MAX) : row.pasted_text || '';
  const sourceChanged = pastedText !== (row.pasted_text || '') || sourceUrl !== (row.source_url || '');
  await execute(
    `UPDATE competitor_references
     SET competitor_name = ?, platform = ?, source_url = ?, pasted_text = ?, analysis = CASE WHEN ? THEN NULL ELSE analysis END,
         updated_by = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      name,
      typeof body?.platform === 'string' ? body.platform.trim().slice(0, 40) || null : row.platform,
      sourceUrl || null,
      pastedText || null,
      sourceChanged,
      auth.id,
      id,
    ],
  );
  return NextResponse.json({ success: true, id });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireFeature(request, 'social-post');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Competitor id is required.' }, { status: 400 });
  const row = await queryOne<{ created_by: string }>('SELECT created_by FROM competitor_references WHERE id = ?', [id]);
  if (!row) return NextResponse.json({ error: 'Competitor reference not found.' }, { status: 404 });
  if (!canDeleteCompetitor(auth, { createdBy: row.created_by })) {
    return NextResponse.json({ error: 'Only the person who created this reference, or an admin, can delete it.' }, { status: 403 });
  }
  await execute('DELETE FROM competitor_references WHERE id = ?', [id]);
  return NextResponse.json({ success: true });
}
