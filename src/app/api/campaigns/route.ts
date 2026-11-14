import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { execute, queryAll, queryOne } from '@/lib/database';
import { requireFeature } from '@/lib/auth';
import { getEmbedding } from '@/lib/embeddings';
import {
  campaignEmbeddingText,
  canDeleteCampaign,
  parseCampaignInput,
  type CampaignCandidate,
  type CampaignInput,
} from '@/lib/social-post-library';
import { rankCampaignSuggestion } from '@/lib/social-post-campaign-match';

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  objective: string | null;
  key_facts: string;
  approved_claims: string;
  links: string;
  hashtags: string;
  notes: string | null;
  embedding: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
};

function jsonValue<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function present(row: CampaignRow, actor: { id: string; role: string }) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    objective: row.objective,
    keyFacts: jsonValue<string[]>(row.key_facts, []),
    approvedClaims: jsonValue<string[]>(row.approved_claims, []),
    links: jsonValue<{ label: string; url: string }[]>(row.links, []),
    hashtags: jsonValue<string[]>(row.hashtags, []),
    notes: row.notes,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    updatedBy: row.updated_by,
    updatedByName: row.updated_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canDelete: canDeleteCampaign(actor, { createdBy: row.created_by }),
  };
}

const CAMPAIGN_SELECT = `
  SELECT c.id, c.name, c.status, c.starts_on::text AS starts_on, c.ends_on::text AS ends_on,
         c.objective, c.key_facts, c.approved_claims, c.links, c.hashtags, c.notes, c.embedding,
         c.created_by, c.updated_by, c.created_at::text AS created_at, c.updated_at::text AS updated_at,
         creator.name AS created_by_name, editor.name AS updated_by_name
  FROM campaigns c
  LEFT JOIN users creator ON creator.id = c.created_by
  LEFT JOIN users editor ON editor.id = c.updated_by
`;

async function store(id: string, campaign: CampaignInput, actorId: string, creating: boolean) {
  const embedding = JSON.stringify(await getEmbedding(campaignEmbeddingText(campaign)));
  const values = [
    campaign.name, campaign.status, campaign.startsOn, campaign.endsOn, campaign.objective,
    JSON.stringify(campaign.keyFacts), JSON.stringify(campaign.approvedClaims), JSON.stringify(campaign.links),
    JSON.stringify(campaign.hashtags), campaign.notes, embedding, actorId,
  ];
  if (creating) {
    await execute(
      `INSERT INTO campaigns (
         id, name, status, starts_on, ends_on, objective, key_facts, approved_claims, links, hashtags, notes, embedding, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, ...values, actorId],
    );
    return;
  }
  await execute(
    `UPDATE campaigns SET
       name = ?, status = ?, starts_on = ?, ends_on = ?, objective = ?, key_facts = ?, approved_claims = ?,
       links = ?, hashtags = ?, notes = ?, embedding = ?, updated_by = ?, updated_at = NOW()
     WHERE id = ?`,
    [...values, id],
  );
}

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'social-post');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const suggest = new URL(request.url).searchParams.get('suggest')?.trim() || '';
  const rows = await queryAll<CampaignRow>(`${CAMPAIGN_SELECT} ORDER BY c.updated_at DESC LIMIT 100`);
  if (suggest) {
    const embedding = await getEmbedding(suggest.slice(0, 2_000));
    const candidates: CampaignCandidate[] = rows.map(row => ({ id: row.id, name: row.name, status: row.status, embedding: row.embedding }));
    const suggestion = rankCampaignSuggestion(embedding, candidates);
    return NextResponse.json({
      suggestion: suggestion ? { id: suggestion.id, name: suggestion.name, score: Number(suggestion.score.toFixed(3)) } : null,
    });
  }
  return NextResponse.json({ campaigns: rows.map(row => present(row, auth)) });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'social-post');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Campaign details are required.' }, { status: 400 });
  const parsed = parseCampaignInput(body as Record<string, unknown>);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const id = uuidv4();
  await store(id, parsed.campaign, auth.id, true);
  return NextResponse.json({ success: true, id });
}

export async function PUT(request: NextRequest) {
  const auth = await requireFeature(request, 'social-post');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'Campaign id is required.' }, { status: 400 });
  const existing = await queryOne('SELECT id FROM campaigns WHERE id = ?', [id]);
  if (!existing) return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
  const parsed = parseCampaignInput(body || {});
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  await store(id, parsed.campaign, auth.id, false);
  return NextResponse.json({ success: true, id });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireFeature(request, 'social-post');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Campaign id is required.' }, { status: 400 });
  const existing = await queryOne<{ created_by: string }>('SELECT created_by FROM campaigns WHERE id = ?', [id]);
  if (!existing) return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
  if (!canDeleteCampaign(auth, { createdBy: existing.created_by })) {
    return NextResponse.json({ error: 'Only the person who created this campaign, or an admin, can delete it.' }, { status: 403 });
  }
  await execute('DELETE FROM campaigns WHERE id = ?', [id]);
  return NextResponse.json({ success: true });
}
