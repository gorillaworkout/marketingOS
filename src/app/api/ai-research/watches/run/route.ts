import { NextRequest, NextResponse } from 'next/server';
import { runDueResearchWatches } from '@/lib/ai-research-watch-run';
import { watchCronAuthorization } from '@/lib/ai-research-watches';

export async function POST(request: NextRequest) {
  const provided = request.headers.get('x-research-watch-secret');
  const auth = watchCronAuthorization(provided);
  if (auth === 'missing') {
    return NextResponse.json({
      error: 'AI_RESEARCH_WATCH_CRON_SECRET belum diatur. Jalankan npm run research:watches di VPS.',
    }, { status: 503 });
  }
  if (auth === 'rejected') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await runDueResearchWatches();
  return NextResponse.json(result);
}
