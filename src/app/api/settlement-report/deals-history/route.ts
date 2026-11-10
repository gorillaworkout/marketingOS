import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { readUploadBody } from '@/lib/monthly-report/service';
import { MAX_CHUNK_BYTES, MAX_CHUNK_DEALS, parseDealsTitle, type ParsedDeal } from '@/lib/settlement/deals-parse';
import { withSessionLock } from '@/lib/settlement/deals-lock';
import { abortOwnedSession, commitOwnedSession, openOwnedSession, stageOwnedChunk } from '@/lib/settlement/deals-store';
import { requireSettlementReport } from '@/lib/settlement/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Chunked Deals History upload. Each request stays within the 25 MB body limit.
 * Actions: open, chunk, commit, abort. Only the session owner may write.
 */
export async function POST(request: NextRequest) {
  const user = await requireSettlementReport(request, { upload: true });
  if (user instanceof NextResponse) return user;
  const body = await readUploadBody(request);
  if (body instanceof NextResponse) return body;
  if (body.length > MAX_CHUNK_BYTES) return NextResponse.json({ error: 'The chunk is larger than 25 MB' }, { status: 413 });
  const payload = JSON.parse(body.toString('utf8')) as { action?: string; fileName?: string; title?: string; footerCommission?: number; footerSwap?: number; sessionId?: string; seq?: number; hash?: string; deals?: ParsedDeal[] };
  if (payload.action === 'open') {
    const title = parseDealsTitle(payload.title ?? '');
    const id = uuidv4();
    await openOwnedSession({
      id, ownerId: user.id, fileName: (payload.fileName || 'deals-history').slice(0, 200),
      titleFilter: title?.filter ?? null, from: title?.from ?? null, to: title?.to ?? null,
      footerCommission: Number(payload.footerCommission ?? 0), footerSwap: Number(payload.footerSwap ?? 0),
    });
    return NextResponse.json({ ok: true, sessionId: id, title });
  }
  if (!payload.sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  try {
    const result = await withSessionLock(payload.sessionId, async () => {
      if (payload.action === 'abort') {
        await abortOwnedSession(payload.sessionId as string, user.id);
        return { ok: true, aborted: true };
      }
      if (payload.action === 'commit') {
        return { ok: true, ...(await commitOwnedSession(payload.sessionId as string, user.id, { commission: Number(payload.footerCommission ?? 0), swap: Number(payload.footerSwap ?? 0) })) };
      }
      if (payload.action === 'chunk') {
        const deals = payload.deals ?? [];
        if (deals.length > MAX_CHUNK_DEALS) return { ok: false, error: `A chunk can contain at most ${MAX_CHUNK_DEALS} deals`, status: 400 };
        const staged = await stageOwnedChunk({ sessionId: payload.sessionId as string, actorId: user.id, seq: Number(payload.seq), hash: String(payload.hash ?? ''), deals });
        return { ok: true, ...staged };
      }
      return { ok: false, error: 'Unknown action', status: 400 };
    });
    const status = 'status' in result && typeof result.status === 'number' ? result.status : result.ok ? 200 : 400;
    return NextResponse.json(result, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    const status = /another user/.test(message) ? 403 : /Footer/.test(message) ? 409 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
