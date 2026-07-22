import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/database';
import { getSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const db = await getDb();

  const tokenRow = db.prepare('SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as t, COALESCE(SUM(cost), 0) as c FROM token_logs WHERE user_id = ?').get(userId) as { t: number; c: number };
  const totalTasks = (db.prepare('SELECT COUNT(*) as c FROM tasks WHERE user_id = ?').get(userId) as { c: number }).c;

  const logs = db.prepare('SELECT id, model, input_tokens, output_tokens, cost, created_at FROM token_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId) as Record<string, unknown>[];

  return NextResponse.json({
    totalTokens: tokenRow.t,
    totalCost: tokenRow.c,
    totalTasks,
    logs
  });
}
