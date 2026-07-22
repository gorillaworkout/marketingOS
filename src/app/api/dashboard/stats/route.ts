import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryAll, execute } from '@/lib/database';
import { getSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const totalTasks = (await queryOne('SELECT COUNT(*) as c FROM tasks WHERE user_id = ?', [userId]) as { c: number }).c;

  const tasksByType = await queryAll('SELECT type, COUNT(*) as c FROM tasks WHERE user_id = ? GROUP BY type', [userId]) as { type: string; c: number }[];

  const tokenRow = await queryOne('SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as t, COALESCE(SUM(cost), 0) as c FROM token_logs WHERE user_id = ?', [userId]) as { t: number; c: number };

  const recentTasks = await queryAll('SELECT id, title, type, status, created_at FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 5', [userId]) as Record<string, unknown>[];

  return NextResponse.json({
    totalTasks,
    tasksByType: tasksByType.map(r => ({ type: r.type, count: r.c })),
    totalTokens: tokenRow.t,
    totalCost: tokenRow.c,
    recentTasks
  });
}
