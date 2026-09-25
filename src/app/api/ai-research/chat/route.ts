import { NextRequest } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { resolveFeatureModel } from '@/lib/model-routing';
import { rateLimit } from '@/lib/rate-limit';
import {
  AI_RESEARCH_MAX_OUTPUT_TOKENS,
  AI_RESEARCH_SYSTEM_PROMPT,
  buildStoredAssistantMessage,
  parseStoredMessages,
  type AiResearchChatMessage,
  type AiResearchMode,
  type GatewayMessage,
} from '@/lib/ai-research';
import { hydrateMessageFiles } from '@/lib/ai-research-files';
import { parseAiResearchChatBody as parseChatRequest } from '@/lib/ai-research-request';
import {
  AI_RESEARCH_DEEP_PLAN_MAX_TOKENS,
  AI_RESEARCH_DEEP_PLAN_PROMPT,
  AI_RESEARCH_DEEP_PLAN_TIMEOUT_MS,
  AI_RESEARCH_DEEP_SYSTEM_ADDENDUM,
  buildDeepStatusEvent,
  ensureDeepLimitationsSection,
  fallbackDeepResearchPlan,
  formatDeepResearchPlanNote,
  parseDeepResearchPlan,
  runDeepResearchGather,
  type DeepStopReason,
} from '@/lib/ai-research-deep';
import {
  buildAiResearchChatMessages,
  gatherAiResearchContext,
  prefersIndonesiaSources,
  resolveAiResearchTemperature,
  shouldResearchQuery,
  type ResearchContext,
} from '@/lib/ai-research-grounding';
import { parseGatewayCompletion } from '@/lib/gateway-response';
import { fetchAiResearchContextUrls } from '@/lib/ai-research-url-fetch';
import {
  buildCompareSearchQuery,
  buildCompareSystemAddendum,
  mergeCompareResearch,
} from '@/lib/ai-research-compare';
import {
  AI_RESEARCH_INBOX_PROJECT,
  appendProjectSummary,
  buildProjectMemoryBlock,
  selectProjectMemoryTurns,
} from '@/lib/ai-research-projects';
import {
  applyContextUrlsToIncoming,
  isUrlOnlyQuery,
  mergeContextUrlSources,
} from '@/lib/ai-research-urls';
import {
  applyPinnedResearchSources,
  buildResearchSsePayload,
  parsePinnedSourceUrls,
} from '@/lib/ai-research-inspector';
import { GORILLAWORKOUT_API_BASE, GORILLAWORKOUT_API_KEY } from '@/lib/gateway-config';
import { AVAILABLE_MODELS, fetchKnowledgeContext } from '@/lib/openai';
import {
  formatInternalDocsPrompt,
  mergeInternalDocSources,
  retrieveInternalDocHits,
  type InternalDocHit,
} from '@/lib/internal-docs';
import { persistCompletedResearchAnswer } from '@/lib/knowledge-persist';
import {
  isAbortError,
  linkAbortSignal,
  mergeAbortSignals,
  throwIfResearchAborted,
} from '@/lib/ai-research-abort';
import { logTokenUsage } from '@/lib/token-log';
import {
  consumeChatCompletionSseLines,
  gatewayMessagesText,
  mergeGatewayUsage,
  parseGatewayResponseUsage,
  resolveTokenUsage,
  type GatewayTokenUsage,
} from '@/lib/token-usage';
import { v4 as uuidv4 } from 'uuid';
import { execute, queryAll, queryOne } from '@/lib/database';

const MAX_HISTORY = 20;

export const maxDuration = 120;

function sseFrame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function streamChatCompletion(options: {
  emit: (data: unknown) => void;
  model: string;
  apiMessages: GatewayMessage[];
  temperature: number;
  maxTokens?: number;
  signal: AbortSignal;
}): Promise<{ ok: true; content: string; usage: GatewayTokenUsage | null } | { ok: false; aborted?: boolean }> {
  if (options.signal.aborted) return { ok: false, aborted: true };
  let response: Response;
  try {
    response = await fetch(`${GORILLAWORKOUT_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GORILLAWORKOUT_API_KEY}`,
        'HTTP-Referer': 'https://marketing-aws.gorillaworkout.id',
        'X-Title': 'Dupoin AI Research',
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.apiMessages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: options.temperature,
        max_tokens: options.maxTokens ?? AI_RESEARCH_MAX_OUTPUT_TOKENS,
      }),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal.aborted || isAbortError(error)) return { ok: false, aborted: true };
    options.emit({ type: 'error', error: error instanceof Error ? error.message : 'Stream request failed' });
    return { ok: false };
  }

  if (options.signal.aborted) return { ok: false, aborted: true };

  if (!response.ok) {
    const errText = await response.text();
    options.emit({ type: 'error', error: `API error ${response.status}: ${errText}` });
    return { ok: false };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    options.emit({ type: 'error', error: 'No stream body' });
    return { ok: false };
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let reportedUsage: GatewayTokenUsage | null = null;
  let done = false;
  let aborted = false;

  while (!done) {
    if (options.signal.aborted) {
      aborted = true;
      break;
    }
    try {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      const parsed = consumeChatCompletionSseLines(lines);
      if (parsed.content) {
        fullContent += parsed.content;
        options.emit({ type: 'token', content: parsed.content });
      }
      if (parsed.usage) reportedUsage = parsed.usage;
      if (parsed.reachedDone) done = true;
    } catch (error) {
      if (options.signal.aborted || isAbortError(error)) aborted = true;
      done = true;
    }
  }

  if (aborted || options.signal.aborted) {
    await reader.cancel().catch(() => {});
    return { ok: false, aborted: true };
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const parsed = consumeChatCompletionSseLines([buffer]);
    if (parsed.content) {
      fullContent += parsed.content;
      options.emit({ type: 'token', content: parsed.content });
    }
    if (parsed.usage) reportedUsage = parsed.usage;
  }

  return { ok: true, content: fullContent, usage: reportedUsage };
}

async function requestDeepResearchPlan(
  model: string,
  query: string,
  signal: AbortSignal,
): Promise<{ text: string; usage: GatewayTokenUsage | null }> {
  const response = await fetch(`${GORILLAWORKOUT_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GORILLAWORKOUT_API_KEY}`,
      'HTTP-Referer': 'https://marketing-aws.gorillaworkout.id',
      'X-Title': 'Dupoin AI Research',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: AI_RESEARCH_DEEP_PLAN_PROMPT },
        { role: 'user', content: query.slice(0, 2_000) },
      ],
      stream: false,
      temperature: 0.2,
      max_tokens: AI_RESEARCH_DEEP_PLAN_MAX_TOKENS,
    }),
    signal: mergeAbortSignals(AbortSignal.timeout(AI_RESEARCH_DEEP_PLAN_TIMEOUT_MS), signal),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Deep plan failed (${response.status})`);
  return {
    text: parseGatewayCompletion(body, response.headers.get('content-type')),
    usage: parseGatewayResponseUsage(body, response.headers.get('content-type')),
  };
}

function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ error }), { status });
}

async function persistConversation(
  id: string,
  userId: string,
  messages: AiResearchChatMessage[],
  model: string,
  exists: boolean,
  projectId: string | null,
) {
  const payload = JSON.stringify(messages);
  if (exists) {
    const updated = await execute(
      'UPDATE ai_research_conversations SET messages = ?, model = ?, updated_at = NOW() WHERE id = ? AND user_id = ?',
      [payload, model, id, userId],
    );
    if (updated > 0) return;
  }
  await execute(
    'INSERT INTO ai_research_conversations (id, user_id, messages, model, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
    [id, userId, payload, model, projectId],
  );
}

async function loadProjectMemory(userId: string, projectId: string, excludeConversationId: string): Promise<string> {
  const project = await queryOne<{ name: string; notes: string | null; summary: string | null }>(
    'SELECT name, notes, summary FROM ai_research_projects WHERE id = ? AND user_id = ?',
    [projectId, userId],
  );
  if (!project) return '';
  const others = await queryAll<{ messages: unknown }>(
    `SELECT messages FROM ai_research_conversations
      WHERE user_id = ? AND project_id = ? AND id <> ?
      ORDER BY updated_at DESC
      LIMIT 4`,
    [userId, projectId, excludeConversationId],
  );
  return buildProjectMemoryBlock({
    name: project.name,
    notes: project.notes || '',
    summary: project.summary || '',
    recentTurns: selectProjectMemoryTurns(others.map(row => parseStoredMessages(row.messages))),
  });
}

async function rememberProjectTurn(
  userId: string,
  projectId: string | null,
  userText: string,
  assistantText: string,
) {
  if (!projectId) return;
  const row = await queryOne<{ summary: string | null }>(
    'SELECT summary FROM ai_research_projects WHERE id = ? AND user_id = ?',
    [projectId, userId],
  );
  if (!row) return;
  const summary = appendProjectSummary(row.summary || '', userText, assistantText);
  await execute(
    'UPDATE ai_research_projects SET summary = ?, updated_at = NOW() WHERE id = ? AND user_id = ?',
    [summary, projectId, userId],
  );
}

async function gatherResearchSide(
  query: string,
  signal: AbortSignal,
): Promise<{ research: ResearchContext | null; failed: boolean }> {
  try {
    throwIfResearchAborted(signal);
    return { research: await gatherAiResearchContext(query, { signal }), failed: false };
  } catch (error) {
    if (signal.aborted) throw error;
    console.error('[ai-research] gatherAiResearchContext failed:', error);
    return { research: null, failed: true };
  }
}

function usageCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = AVAILABLE_MODELS.find(candidate => candidate.id === model);
  return inputTokens * (pricing?.input ?? 0) + outputTokens * (pricing?.output ?? 0);
}

async function logAiResearchUsage(options: {
  userId: string;
  model: string;
  inputText: string;
  outputText: string;
  reported: GatewayTokenUsage | null;
}) {
  if (!options.outputText.trim()) return;
  const usage = resolveTokenUsage({
    reported: options.reported,
    inputText: options.inputText,
    outputText: options.outputText,
  });
  await logTokenUsage({
    userId: options.userId,
    taskId: null,
    model: options.model,
    provider: 'gorillaworkout',
    accountSource: 'office',
    taskType: 'ai-research',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cost: usageCost(options.model, usage.inputTokens, usage.outputTokens),
  });
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(request);
  if (limited) return limited;

  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) {
    return jsonError(auth.error, auth.status);
  }

  let parsed: {
    messages: AiResearchChatMessage[];
    conversationId?: string;
    projectId?: string;
    pinnedSourceUrls: string[];
    mode: AiResearchMode;
    compare?: { a: string; b: string };
  };
  try {
    parsed = parseChatRequest(await request.json());
    parsed.messages = await hydrateMessageFiles(parsed.messages);
  } catch (error) {
    return jsonError(
      error instanceof SyntaxError ? 'Invalid JSON body' : error instanceof Error ? error.message : 'Invalid request',
      400,
    );
  }

  const { messages, conversationId, mode, compare } = parsed;
  const pinnedSourceUrls = parsePinnedSourceUrls(parsed.pinnedSourceUrls);
  let model: string;
  try {
    model = await resolveFeatureModel(auth.id, 'ai-research');
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to resolve AI Research model', 500);
  }

  let dbMessages: AiResearchChatMessage[] = [];
  let history: { messages: unknown; project_id: string | null } | undefined;
  if (conversationId) {
    history = await queryOne<{ messages: unknown; project_id: string | null }>(
      'SELECT messages, project_id FROM ai_research_conversations WHERE id = ? AND user_id = ?',
      [conversationId, auth.id],
    );
    if (history) dbMessages = await hydrateMessageFiles(parseStoredMessages(history.messages));
  }

  const convId = conversationId || uuidv4();
  let activeProjectId: string | null = history?.project_id ?? null;
  if (!history && parsed.projectId) {
    const owned = await queryOne<{ id: string }>(
      'SELECT id FROM ai_research_projects WHERE id = ? AND user_id = ?',
      [parsed.projectId, auth.id],
    );
    if (!owned) return jsonError('Proyek tidak ditemukan', 404);
    activeProjectId = owned.id;
  }

  let projectMemoryBlock = '';
  if (activeProjectId) {
    try {
      projectMemoryBlock = await loadProjectMemory(auth.id, activeProjectId, convId);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : 'Failed to load project memory', 500);
    }
  }

  const pendingMessages = [...dbMessages, ...messages];
  const latestUser = messages[messages.length - 1];

  try {
    await persistConversation(convId, auth.id, pendingMessages, model, Boolean(history), activeProjectId);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to save conversation', 500);
  }

  const clientAbort = linkAbortSignal(request.signal);
  const signal = clientAbort.signal;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (data: unknown) => {
        if (closed || signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(data)));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* client already cancelled the stream */ }
      };
      try {
        throwIfResearchAborted(signal);
        const effectiveMode = compare ? 'fast' : mode;
        emit({ type: 'start', conversationId: convId, model, mode: effectiveMode });
        const query = latestUser?.content || '';
        const knowledgeContext = await fetchKnowledgeContext(auth.id, query, undefined, 5, 'internal');
        throwIfResearchAborted(signal);
        const internalDocsPrincipal = { role: auth.role, departmentName: auth.departmentName };
        let internalDocHits: InternalDocHit[] = [];
        try {
          internalDocHits = await retrieveInternalDocHits(internalDocsPrincipal, query);
        } catch (error) {
          console.error('[ai-research] internal docs retrieval failed:', error);
        }
        const internalDocsContext = formatInternalDocsPrompt(internalDocHits, request.nextUrl.origin);
        throwIfResearchAborted(signal);
        const urlOnly = isUrlOnlyQuery(query);

        if (mode === 'deep' && !compare) {
          emit(buildDeepStatusEvent({ phase: 'plan' }));
          const skipped = urlOnly ? 'url-only' : !shouldResearchQuery(query) ? 'not-needed' : null;
          let plan = fallbackDeepResearchPlan(query);
          let planUsage: GatewayTokenUsage | null = null;
          if (!skipped) {
            try {
              const planned = await requestDeepResearchPlan(model, query, signal);
              planUsage = planned.usage;
              const parsedPlan = parseDeepResearchPlan(planned.text, query);
              if (parsedPlan) plan = parsedPlan;
            } catch (error) {
              if (signal.aborted) throw error;
              console.error('[ai-research] deep plan failed:', error);
            }
          }
          throwIfResearchAborted(signal);

          const urlContextPromise = fetchAiResearchContextUrls(query, { signal }).catch(error => {
            if (signal.aborted || isAbortError(error)) return { sources: [], failures: [] };
            throw error;
          });
          let gatherResult: {
            research: ResearchContext;
            roundsRun: number;
            failedRounds: number;
            stoppedReason: DeepStopReason;
          } = {
            research: { query, sources: [], indonesiaPreferred: prefersIndonesiaSources(query) },
            roundsRun: 0,
            failedRounds: 0,
            stoppedReason: 'complete',
          };
          if (!skipped) {
            gatherResult = await runDeepResearchGather({
              query,
              plan,
              signal,
              gather: (searchQuery, timeoutMs) => gatherAiResearchContext(searchQuery, { timeoutMs, signal }),
              onProgress: event => {
                emit(buildDeepStatusEvent({
                  phase: event.phase,
                  message: event.message,
                  round: event.round,
                  maxRounds: event.maxRounds,
                  sourceCount: event.sourceCount,
                  query: event.query,
                }));
                if (event.phase === 'read' && event.research) {
                  const progressEvent = buildResearchSsePayload({
                    query,
                    research: event.research,
                    failed: false,
                  });
                  emit({
                    type: 'research',
                    sourceCount: progressEvent.sourceCount,
                    grounding: progressEvent.grounding,
                    sources: progressEvent.sources,
                  });
                }
              },
            });
          }
          throwIfResearchAborted(signal);

          const urlContext = await urlContextPromise;
          throwIfResearchAborted(signal);
          if (urlContext.sources.length || urlContext.failures.length) {
            emit({
              type: 'context-urls',
              attached: urlContext.sources.map(source => ({ url: source.url, title: source.title })),
              failures: urlContext.failures,
            });
          }

          const displayResearch = mergeContextUrlSources(gatherResult.research, urlContext.sources, query);
          const gatherFailed = !skipped
            && gatherResult.roundsRun > 0
            && gatherResult.failedRounds === gatherResult.roundsRun
            && gatherResult.research.sources.length === 0;
          const researchEvent = buildResearchSsePayload({
            query,
            research: displayResearch,
            failed: gatherFailed && urlContext.sources.length === 0,
          });
          const citedResearchEvent = mergeInternalDocSources(researchEvent, internalDocHits, request.nextUrl.origin);
          emit({
            type: 'research',
            sourceCount: citedResearchEvent.sourceCount,
            grounding: citedResearchEvent.grounding,
            sources: citedResearchEvent.sources,
          });

          const pinnedResearch = pinnedSourceUrls.length
            ? applyPinnedResearchSources(gatherResult.research, pinnedSourceUrls)
            : gatherResult.research;
          const modelResearch = mergeContextUrlSources(pinnedResearch, urlContext.sources, query);
          emit(buildDeepStatusEvent({
            phase: 'synthesize',
            skippedSearch: Boolean(skipped),
          }));

          const apiMessages = buildAiResearchChatMessages({
            systemPrompt: [
              AI_RESEARCH_SYSTEM_PROMPT,
              knowledgeContext,
              internalDocsContext,
              AI_RESEARCH_DEEP_SYSTEM_ADDENDUM,
              formatDeepResearchPlanNote(plan, gatherResult),
              projectMemoryBlock,
            ].filter(Boolean).join('\n\n'),
            history: dbMessages,
            incoming: applyContextUrlsToIncoming(messages, urlContext.failures),
            maxHistory: MAX_HISTORY,
            research: modelResearch,
          });
          throwIfResearchAborted(signal);
          const streamed = await streamChatCompletion({
            emit,
            model,
            apiMessages,
            temperature: resolveAiResearchTemperature(modelResearch),
            signal,
          });
          if (!streamed.ok || signal.aborted) {
            close();
            return;
          }

          emit(buildDeepStatusEvent({ phase: 'gaps' }));
          let fullContent = streamed.content;
          const withLimits = ensureDeepLimitationsSection(fullContent, {
            roundsRun: gatherResult.roundsRun,
            sourceCount: researchEvent.sourceCount,
            stoppedReason: gatherResult.stoppedReason,
            plannedQueries: plan.queries.length,
            skipped,
          });
          if (withLimits !== fullContent) {
            emit({ type: 'token', content: withLimits.slice(fullContent.length) });
            fullContent = withLimits;
          }

          throwIfResearchAborted(signal);
          const allMessages = [...pendingMessages, buildStoredAssistantMessage({
            content: fullContent,
            mode: 'deep',
            sources: citedResearchEvent.sources,
          })];
          await persistConversation(convId, auth.id, allMessages, model, true, activeProjectId);
          throwIfResearchAborted(signal);
          await persistCompletedResearchAnswer({
            userId: auth.id,
            conversationId: convId,
            projectId: activeProjectId,
            query,
            answer: fullContent,
            sources: researchEvent.sources,
            aborted: signal.aborted || request.signal.aborted,
          });
          try {
            await rememberProjectTurn(auth.id, activeProjectId, query, fullContent);
          } catch (error) {
            console.error('[ai-research] project summary update failed:', error);
          }
          await logAiResearchUsage({
            userId: auth.id,
            model,
            inputText: gatewayMessagesText(apiMessages),
            outputText: fullContent,
            reported: mergeGatewayUsage(planUsage, streamed.usage),
          });
          emit({ type: 'done', conversationId: convId, model, mode: 'deep' });
          close();
          return;
        }

        const gatherTask = (async (): Promise<{ research: ResearchContext | null; failed: boolean }> => {
          if (compare) {
            const [sideA, sideB] = await Promise.all([
              gatherResearchSide(buildCompareSearchQuery(compare.a), signal),
              gatherResearchSide(buildCompareSearchQuery(compare.b), signal),
            ]);
            const research = mergeCompareResearch({
              aLabel: compare.a,
              bLabel: compare.b,
              aResearch: sideA.research,
              bResearch: sideB.research,
            });
            const failed = sideA.failed && sideB.failed && research.sources.length === 0;
            return { research, failed };
          }
          if (urlOnly) return { research: null, failed: false };
          return gatherResearchSide(query, signal);
        })();
        const [gatherOutcome, urlContext] = await Promise.all([
          gatherTask,
          fetchAiResearchContextUrls(query, { signal }),
        ]);
        throwIfResearchAborted(signal);
        if (urlContext.sources.length || urlContext.failures.length) {
          emit({
            type: 'context-urls',
            attached: urlContext.sources.map(source => ({ url: source.url, title: source.title })),
            failures: urlContext.failures,
          });
        }

        const displayResearch = mergeContextUrlSources(gatherOutcome.research, urlContext.sources, query);
        const researchEvent = buildResearchSsePayload({
          query,
          research: displayResearch,
          failed: gatherOutcome.failed && urlContext.sources.length === 0,
        });
        const citedResearchEvent = mergeInternalDocSources(researchEvent, internalDocHits, request.nextUrl.origin);
        emit({
          type: 'research',
          sourceCount: citedResearchEvent.sourceCount,
          grounding: citedResearchEvent.grounding,
          sources: citedResearchEvent.sources,
        });

        const pinnedResearch = gatherOutcome.research && pinnedSourceUrls.length
          ? applyPinnedResearchSources(gatherOutcome.research, pinnedSourceUrls)
          : gatherOutcome.research;
        const modelResearch = mergeContextUrlSources(pinnedResearch, urlContext.sources, query);

        const apiMessages = buildAiResearchChatMessages({
          systemPrompt: [
            AI_RESEARCH_SYSTEM_PROMPT,
            knowledgeContext,
            internalDocsContext,
            projectMemoryBlock,
            compare ? buildCompareSystemAddendum(compare) : '',
          ].filter(Boolean).join('\n\n'),
          history: dbMessages,
          incoming: applyContextUrlsToIncoming(messages, urlContext.failures),
          maxHistory: MAX_HISTORY,
          research: modelResearch,
        });

        throwIfResearchAborted(signal);
        const streamed = await streamChatCompletion({
          emit,
          model,
          apiMessages,
          temperature: resolveAiResearchTemperature(modelResearch),
          signal,
        });
        if (!streamed.ok || signal.aborted) {
          close();
          return;
        }

        throwIfResearchAborted(signal);
        const allMessages = [...pendingMessages, buildStoredAssistantMessage({
          content: streamed.content,
          mode: 'fast',
          sources: citedResearchEvent.sources,
        })];
        await persistConversation(convId, auth.id, allMessages, model, true, activeProjectId);
        throwIfResearchAborted(signal);
        await persistCompletedResearchAnswer({
          userId: auth.id,
          conversationId: convId,
          projectId: activeProjectId,
          query,
          answer: streamed.content,
          sources: researchEvent.sources,
          aborted: signal.aborted || request.signal.aborted,
        });
        try {
          await rememberProjectTurn(auth.id, activeProjectId, query, streamed.content);
        } catch (error) {
          console.error('[ai-research] project summary update failed:', error);
        }
        await logAiResearchUsage({
          userId: auth.id,
          model,
          inputText: gatewayMessagesText(apiMessages),
          outputText: streamed.content,
          reported: streamed.usage,
        });

        emit({ type: 'done', conversationId: convId, model });
        close();
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          close();
          return;
        }
        emit({ type: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
        close();
      }
    },
    cancel() {
      clientAbort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return jsonError(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get('id');

  if (!conversationId) {
    const projectParam = (searchParams.get('project') || AI_RESEARCH_INBOX_PROJECT).trim();
    const params: unknown[] = [auth.id];
    let projectClause = 'AND project_id IS NULL';
    if (projectParam !== AI_RESEARCH_INBOX_PROJECT) {
      const owned = await queryOne<{ id: string }>(
        'SELECT id FROM ai_research_projects WHERE id = ? AND user_id = ?',
        [projectParam, auth.id],
      );
      if (!owned) return jsonError('Proyek tidak ditemukan', 404);
      projectClause = 'AND project_id = ?';
      params.push(owned.id);
    }
    const conversations = await queryAll<{
      id: string;
      model: string;
      updated_at: string;
      project_id: string | null;
      title: string | null;
      message_count: number;
    }>(
      `SELECT id, model, updated_at, project_id,
          COALESCE((
            SELECT elem->>'content'
            FROM jsonb_array_elements(messages) AS elem
            WHERE elem->>'role' = 'user'
            LIMIT 1
          ), 'New conversation') AS title,
          COALESCE(jsonb_array_length(messages), 0) AS message_count
        FROM ai_research_conversations
        WHERE user_id = ?
        ${projectClause}
        ORDER BY updated_at DESC
        LIMIT 50`,
      params,
    );
    return new Response(JSON.stringify({
      conversations: conversations.map(c => ({
        id: c.id,
        title: (c.title || 'New conversation').slice(0, 80),
        model: c.model,
        projectId: c.project_id,
        updatedAt: c.updated_at,
        messageCount: Number(c.message_count) || 0,
      })),
    }));
  }

  const row = await queryOne<{ id: string; messages: unknown; model: string; project_id: string | null }>(
    'SELECT id, messages, model, project_id FROM ai_research_conversations WHERE id = ? AND user_id = ?',
    [conversationId, auth.id],
  );

  if (!row) {
    return jsonError('Conversation not found', 404);
  }

  return new Response(JSON.stringify({
    id: row.id,
    messages: parseStoredMessages(row.messages),
    model: row.model,
    projectId: row.project_id,
  }));
}

export async function DELETE(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return jsonError(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get('id');

  if (!conversationId) {
    return jsonError('Conversation ID is required', 400);
  }

  await execute(
    'DELETE FROM ai_research_conversations WHERE id = ? AND user_id = ?',
    [conversationId, auth.id],
  );

  return new Response(JSON.stringify({ success: true }));
}
