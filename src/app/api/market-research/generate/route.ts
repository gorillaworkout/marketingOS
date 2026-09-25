import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireFeature } from '@/lib/auth';
import { execute } from '@/lib/database';
import { rateLimit } from '@/lib/rate-limit';
import { fetchKnowledgeContext, generateContent, getUserPreferredModel } from '@/lib/openai';
import { persistKnowledgeQuietly, summarizeMarketResearchKnowledge } from '@/lib/knowledge-persist';
import {
  buildMarketResearchPrompts,
  marketResearchNeedsShortlist,
  normalizeMarketResearchInput,
  validateAndHydrateMarketResearchSelection,
} from '@/lib/market-research';
import { EmptyMarketResearchPoolError } from '@/lib/market-research-status';
import { gatherMarketResearch, marketResearchGroupCounts, type MarketResearchGatherPhase, type MarketResearchGatherResult } from '@/lib/market-research-web';
import {
  candidatesForShortlist,
  MARKET_RESEARCH_SHORTLIST_TTL_MS,
  marketResearchGatherSecret,
  signMarketResearchGatherToken,
  toMarketResearchShortlistCandidate,
  verifyMarketResearchGatherToken,
} from '@/lib/market-research-shortlist';

export const maxDuration = 300;

const GATHER_PROGRESS: Record<MarketResearchGatherPhase, { progress: number; message: string }> = {
  feeds: { progress: 12, message: 'Scanning same-day publisher feeds…' },
  search: { progress: 28, message: 'Searching the open web for this brief…' },
  read: { progress: 46, message: 'Reading source pages…' },
  skip: { progress: 28, message: 'Open-web search skipped because SERPER_API_KEY is not set. Continuing with publisher feeds.' },
};

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
  const userId = String(auth.id);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => controller.enqueue(encoder.encode(sseEvent(data)));
      try {
        const research = input.gatherToken
          ? confirmedResearch(input.gatherToken, input.candidateIds || [], input.brief, input.researchDate, userId)
          : await gatherForShortlist(input.brief, input.researchDate, userId, send);
        if (!research) return;
        await runSelection(research, { brief: input.brief, researchDate: input.researchDate }, model, userId, send);
      } catch (error) {
        const payload: Record<string, unknown> = {
          step: 'error',
          progress: 100,
          message: error instanceof Error ? error.message : 'Market research failed.',
        };
        if (error instanceof EmptyMarketResearchPoolError) payload.sourceStatus = error.sourceStatus;
        send(payload);
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

async function gatherForShortlist(
  brief: string,
  researchDate: string,
  userId: string,
  send: (data: Record<string, unknown>) => void,
): Promise<MarketResearchGatherResult | null> {
  const research = await gatherMarketResearch(brief, researchDate, {
    onProgress: phase => send({ step: 'sources', ...GATHER_PROGRESS[phase] }),
  });
  if (!marketResearchNeedsShortlist(research.candidates.length)) return research;
  const gatherToken = signMarketResearchGatherToken({
    userId,
    brief,
    researchDate,
    exp: Date.now() + MARKET_RESEARCH_SHORTLIST_TTL_MS,
    candidates: research.candidates,
    groupsSearched: research.groupsSearched,
    groupCandidateCounts: research.groupCandidateCounts,
    sourceStatus: research.sourceStatus,
    themeCandidateCount: research.themeCandidateCount,
  }, marketResearchGatherSecret());
  send({
    step: 'shortlist',
    progress: 62,
    message: 'Multiple candidates found. Confirm the shortlist, then continue the briefing.',
    shortlist: {
      gatherToken,
      candidates: research.candidates.map(toMarketResearchShortlistCandidate),
      groupsSearched: research.groupsSearched,
      groupCandidateCounts: research.groupCandidateCounts,
      sourceStatus: research.sourceStatus,
      themeCandidateCount: research.themeCandidateCount,
    },
  });
  return null;
}

function confirmedResearch(
  gatherToken: string,
  candidateIds: string[],
  brief: string,
  researchDate: string,
  userId: string,
): MarketResearchGatherResult {
  const verified = verifyMarketResearchGatherToken(gatherToken, marketResearchGatherSecret());
  if (!verified.ok) {
    throw new Error(verified.reason === 'expired'
      ? 'This shortlist expired. Run the search again.'
      : 'This shortlist is invalid. Run the search again.');
  }
  const claims = verified.claims;
  if (claims.userId !== userId || claims.brief !== brief || claims.researchDate !== researchDate) {
    throw new Error('This shortlist does not match the current brief. Run the search again.');
  }
  const candidates = candidatesForShortlist(claims, candidateIds);
  const counts = marketResearchGroupCounts(candidates);
  return {
    candidates,
    groupsSearched: claims.groupsSearched,
    groupCandidateCounts: counts.groupCandidateCounts,
    sourceStatus: claims.sourceStatus,
    themeCandidateCount: counts.themeCandidateCount,
  };
}

async function runSelection(
  research: MarketResearchGatherResult,
  input: { brief: string; researchDate: string },
  model: string,
  userId: string,
  send: (data: Record<string, unknown>) => void,
) {
  const knowledgeContext = await fetchKnowledgeContext(userId, `${input.brief} ${input.researchDate}`, undefined, 5, 'internal');
  const built = buildMarketResearchPrompts(input, research.candidates);
  const systemPrompt = `${built.systemPrompt}${knowledgeContext}\n\nIf internal knowledge conflicts with CANDIDATES, follow the candidate evidence contract.`;
  const userPrompt = built.userPrompt;
  send({
    step: 'selection',
    progress: 72,
    message: `Comparing ${research.candidates.length} candidate${research.candidates.length === 1 ? '' : 's'} for factual impact and recency…`,
  });

  let generated: Awaited<ReturnType<typeof generateContent>> | undefined;
  let report: ReturnType<typeof validateAndHydrateMarketResearchSelection> | undefined;
  let attemptPrompt = userPrompt;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      generated = await generateContent(systemPrompt, attemptPrompt, userId, undefined, {
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
      send({ step: 'selection', progress: 72 + attempt * 8, message: `Repairing evidence-bound selection (attempt ${attempt + 1}/3)…` });
      attemptPrompt = `${userPrompt}\n\nDETERMINISTIC EVIDENCE-GATE FEEDBACK:\n${feedback}\n\nPRIOR JSON TO REVISE:\n${generated?.content || '{}'}\n\nCorrect every issue using only exact candidate IDs and numbers present in that candidate's evidence, title, or publication/update timestamps. Return only the required JSON.`;
    }
  }
  if (!generated || !report) throw new Error('Market research ended without a valid report.');

  const meta = {
    input,
    model,
    groupsSearched: research.groupsSearched,
    groupCandidateCounts: research.groupCandidateCounts,
    sourceStatus: research.sourceStatus,
    candidateCount: research.candidates.length,
    themeCandidateCount: research.themeCandidateCount,
  };

  if (report.items.length === 0) {
    send({
      step: 'done',
      progress: 100,
      message: 'No High Importance developments passed the evidence gate. Nothing was saved — try again later or broaden the brief.',
      result: { items: [], ...meta, evidenceSnapshot: [], historyId: null, usage: generated.usage },
    });
    return;
  }

  const selectedIds = new Set(report.items.map(item => item.candidateId));
  const evidenceSnapshot = research.candidates.filter(candidate => selectedIds.has(candidate.id));
  const historyId = randomUUID();
  await execute(
    'INSERT INTO tasks (id, user_id, type, title, brief, status, output_data) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [historyId, userId, 'market-research', `Market Research: ${input.researchDate}`, input.brief, 'completed', JSON.stringify({
      report,
      ...meta,
      evidenceSnapshot,
    })],
  );

  const researchKnowledge = summarizeMarketResearchKnowledge({
    brief: input.brief,
    researchDate: input.researchDate,
    items: report.items,
  });
  if (researchKnowledge) {
    await persistKnowledgeQuietly({
      userId,
      taskType: 'market-research',
      taskId: historyId,
      brief: researchKnowledge.brief,
      selectedOutput: researchKnowledge.selectedOutput,
      sourceUrls: researchKnowledge.sourceUrls,
      action: 'complete',
    });
  }

  send({
    step: 'done',
    progress: 100,
    message: 'Market research complete. Open every source link and review the full article before external use.',
    result: { ...report, ...meta, evidenceSnapshot, historyId, usage: generated.usage },
  });
}
