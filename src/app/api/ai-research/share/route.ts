import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { requireFeature } from '@/lib/auth';
import { execute, queryOne } from '@/lib/database';
import { parseStoredMessages } from '@/lib/ai-research';
import { rateLimit } from '@/lib/rate-limit';
import {
  matchShareSnapshot,
  researchSharePath,
  researchShareSecret,
  shareExpiryFromNow,
  signResearchShareToken,
} from '@/lib/ai-research-share';

export const runtime = 'nodejs';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(request);
  if (limited) return limited;

  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return json({ error: auth.error }, auth.status);

  let body: { conversationId?: unknown; answer?: unknown };
  try {
    body = await request.json() as { conversationId?: unknown; answer?: unknown };
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
  const answer = typeof body.answer === 'string' ? body.answer : '';
  if (!conversationId) return json({ error: 'Percakapan wajib ada sebelum dibagikan' }, 400);
  if (!answer.trim()) return json({ error: 'Jawaban kosong' }, 400);

  const row = await queryOne<{ messages: unknown }>(
    'SELECT messages FROM ai_research_conversations WHERE id = ? AND user_id = ?',
    [conversationId, auth.id],
  );
  if (!row) return json({ error: 'Percakapan tidak ditemukan' }, 404);

  const snapshot = matchShareSnapshot(parseStoredMessages(row.messages), answer);
  if (!snapshot) return json({ error: 'Jawaban tidak ada di percakapan ini' }, 400);

  let secret: string;
  try {
    secret = researchShareSecret();
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Share signing is not configured' }, 500);
  }

  const id = uuidv4();
  const now = Date.now();
  const exp = shareExpiryFromNow(now);
  const token = signResearchShareToken({ id, exp }, secret, now);
  await execute(
    `INSERT INTO ai_research_shares
      (id, user_id, conversation_id, query_text, answer, sources, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      id,
      auth.id,
      conversationId,
      snapshot.query,
      snapshot.answer,
      JSON.stringify(snapshot.sources),
      new Date(exp).toISOString(),
    ],
  );

  return json({
    path: researchSharePath(token),
    expiresAt: new Date(exp).toISOString(),
    ttlDays: 30,
  });
}
