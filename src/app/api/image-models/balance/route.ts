import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedUser } from '@/lib/auth';
import { hasGenerationFeature } from '@/lib/authorization';
import { readOpenRouterCreditBalance } from '@/lib/llm-provider';

/**
 * Remaining OpenRouter credit, shown next to the cost estimate before a paid
 * image run. Only a number is returned, never the key.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthorizedUser(request);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!hasGenerationFeature(auth)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const balance = await readOpenRouterCreditBalance();
  return NextResponse.json(balance, { headers: { 'Cache-Control': 'no-store' } });
}
