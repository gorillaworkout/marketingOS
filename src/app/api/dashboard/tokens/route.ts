import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryAll } from '@/lib/database';
import { getSession } from '@/lib/auth';

type TokenSummaryRow = { t: number | string; c: number | string };
type CountRow = { c: number | string };
type TokenLogRow = {
  id: string;
  username: string | null;
  user_name: string | null;
  model: string;
  provider: string | null;
  account_source: string | null;
  task_type: string | null;
  input_tokens: number | string;
  output_tokens: number | string;
  cost: number | string;
  created_at: string;
};
type AccountBreakdownRow = {
  username: string | null;
  user_name: string | null;
  account_source: string | null;
  provider: string | null;
  total_tokens: number | string;
  total_cost: number | string;
  request_count: number | string;
};

function inferProvider(model: string): string {
  if (model.startsWith('codex/')) return 'codex';
  if (model.startsWith('claude-code/')) return 'claude-code';
  return 'openrouter';
}

function accountSource(provider: string, source: string | null): string {
  return source || (provider === 'openrouter' ? 'personal' : 'office');
}

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const tokenRow = await queryOne<TokenSummaryRow>(
    'SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as t, COALESCE(SUM(cost), 0) as c FROM token_logs WHERE user_id = ?',
    [userId]
  );
  const totalTasks = await queryOne<CountRow>('SELECT COUNT(*) as c FROM tasks WHERE user_id = ?', [userId]);

  const logs = await queryAll<TokenLogRow>(`
    SELECT l.id, u.username, u.name AS user_name, l.model, l.provider, l.account_source, l.task_type,
      l.input_tokens, l.output_tokens, l.cost, l.created_at
    FROM token_logs l
    LEFT JOIN users u ON u.id = l.user_id
    WHERE l.user_id = ?
    ORDER BY l.created_at DESC
    LIMIT 50
  `, [userId]);

  const accountBreakdownRows = await queryAll<AccountBreakdownRow>(`
    SELECT u.username, u.name AS user_name, l.account_source, l.provider,
      COALESCE(SUM(l.input_tokens + l.output_tokens), 0) AS total_tokens,
      COALESCE(SUM(l.cost), 0) AS total_cost,
      COUNT(*) AS request_count
    FROM token_logs l
    LEFT JOIN users u ON u.id = l.user_id
    WHERE l.user_id = ?
    GROUP BY u.username, u.name, l.account_source, l.provider
    ORDER BY total_tokens DESC
  `, [userId]);

  const normalizedLogs = logs.map((log) => {
    const provider = log.provider || inferProvider(log.model);
    return {
      ...log,
      username: log.username || 'Unknown user',
      user_name: log.user_name || log.username || 'Unknown user',
      provider,
      account_source: accountSource(provider, log.account_source),
      input_tokens: Number(log.input_tokens) || 0,
      output_tokens: Number(log.output_tokens) || 0,
      cost: Number(log.cost) || 0,
    };
  });

  const accountBreakdown = accountBreakdownRows.map((row) => {
    const provider = row.provider || 'openrouter';
    return {
      username: row.username || 'Unknown user',
      user_name: row.user_name || row.username || 'Unknown user',
      account_source: accountSource(provider, row.account_source),
      provider,
      total_tokens: Number(row.total_tokens) || 0,
      total_cost: Number(row.total_cost) || 0,
      request_count: Number(row.request_count) || 0,
    };
  });

  return NextResponse.json({
    totalTokens: Number(tokenRow?.t) || 0,
    totalCost: Number(tokenRow?.c) || 0,
    totalTasks: Number(totalTasks?.c) || 0,
    accountBreakdown,
    logs: normalizedLogs,
  });
}
