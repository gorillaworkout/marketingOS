import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireFeature } from '@/lib/auth';
import { execute } from '@/lib/database';
import { rateLimit } from '@/lib/rate-limit';
import { generateContent, getUserPreferredModel } from '@/lib/openai';
import { buildMarketResearchPrompts, normalizeMarketResearchInput, validateAndHydrateMarketResearchSelection } from '@/lib/market-research';
import { researchLatestMarketNews } from '@/lib/market-research-sources';

export const maxDuration = 300;

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function parseSelection(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid shape');
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('AI returned an invalid market research format.');
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'market-research');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const limited = rateLimit(request, `market-research:${auth.id}`);
  if (limited) return limited;

  let input;
  try {
    input = normalizeMarketResearchInput(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid market research request.' }, { status: 400 });
  }

  const model = await getUserPreferredModel(auth.id, 'market-research');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseEvent({ step: 'sources', progress: 12, message: 'Scanning same-day Forex, Gold, Oil, and US Indices publisher feeds…' })));
        const research = await researchLatestMarketNews(input.researchDate);
        const { systemPrompt, userPrompt } = buildMarketResearchPrompts(input, research.candidates);
        controller.enqueue(encoder.encode(sseEvent({ step: 'selection', progress: 38, message: `Comparing ${research.candidates.length} same-day candidates for factual impact and recency…` })));

        let generated: Awaited<ReturnType<typeof generateContent>> | undefined;
        let report: ReturnType<typeof validateAndHydrateMarketResearchSelection> | undefined;
        let attemptPrompt = userPrompt;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            generated = await generateContent(systemPrompt, attemptPrompt, auth.id, undefined, {
              model,
              responseFormat: { type: 'json_object' },
              temperature: 0.2,
              maxTokens: 4_000,
              taskType: 'market-research',
              jsonRepairAttempts: 0,
            });
            report = validateAndHydrateMarketResearchSelection(parseSelection(generated.content), research.candidates);
            break;
          } catch (attemptError) {
            if (attempt === 3) throw new Error(`Market research failed the evidence gate after 3 attempts: ${attemptError instanceof Error ? attemptError.message : 'invalid output'}`);
            const feedback = attemptError instanceof Error ? attemptError.message : 'The prior selection was invalid.';
            controller.enqueue(encoder.encode(sseEvent({ step: 'selection', progress: 38 + attempt * 18, message: `Repairing evidence-bound selection (attempt ${attempt + 1}/3)…` })));
            attemptPrompt = `${userPrompt}\n\nDETERMINISTIC EVIDENCE-GATE FEEDBACK:\n${feedback}\n\nPRIOR JSON TO REVISE:\n${generated?.content || '{}'}\n\nCorrect every issue using only exact candidate IDs and evidence. Return only the required JSON.`;
          }
        }
        if (!generated || !report) throw new Error('Market research ended without a valid report.');

        const selectedIds = new Set(report.items.map(item => item.candidateId));
        const evidenceSnapshot = research.candidates.filter(candidate => selectedIds.has(candidate.id));
        const historyId = randomUUID();
        await execute(
          'INSERT INTO tasks (id, user_id, type, title, brief, status, output_data) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [historyId, auth.id, 'market-research', `Market Research: ${input.researchDate}`, input.brief, 'completed', JSON.stringify({
            report,
            input,
            model,
            groupsSearched: research.groupsSearched,
            groupCandidateCounts: research.groupCandidateCounts,
            sourceStatus: research.sourceStatus,
            candidateCount: research.candidates.length,
            evidenceSnapshot,
          })],
        );

        controller.enqueue(encoder.encode(sseEvent({
          step: 'done', progress: 100,
          message: 'Market research complete. Open every source link and review the full article before external use.',
          result: { ...report, input, model, groupsSearched: research.groupsSearched, groupCandidateCounts: research.groupCandidateCounts, sourceStatus: research.sourceStatus, candidateCount: research.candidates.length, evidenceSnapshot, historyId, usage: generated.usage },
        })));
      } catch (error) {
        controller.enqueue(encoder.encode(sseEvent({ step: 'error', progress: 100, message: error instanceof Error ? error.message : 'Market research failed.' })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
