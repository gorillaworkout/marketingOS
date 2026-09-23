import { NextRequest } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { resolveFeatureModel } from '@/lib/model-routing';
import { rateLimit } from '@/lib/rate-limit';
import {
  AI_RESEARCH_MAX_OUTPUT_TOKENS,
  AI_RESEARCH_SYSTEM_PROMPT,
  buildStoredAssistantMessage,
  parseChatRequest,
  parseStoredMessages,
  type AiResearchChatMessage,
  type AiResearchMode,
  type GatewayMessage,
} from '@/lib/ai-research';
import { hydrateMessageFiles } from '@/lib/ai-research-files';
import {
  AI_RESEARCH_DEEP_PLAN_MAX_TOKENS,
  AI_RESEARCH_DEEP_PLAN_PROMPT,
  AI_RESEARCH_DEEP_PLAN_TIMEOUT_MS,
  AI_RESEARCH_DEEP_STATUS,
  AI_RESEARCH_DEEP_SYSTEM_ADDENDUM,
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
import { AVAILABLE_MODELS } from '@/lib/openai';
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
import { execute, queryOne } from '@/lib/database';

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
}): Promise<{ ok: true; content: string; usage: GatewayTokenUsage | null } | { ok: false }> {
  const response = await fetch(`${GORILLAWORKOUT_API_BASE}/chat/completions`, {
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
  });

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

  while (!done) {
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
    } catch {
      done = true;
    }
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
    signal: AbortSignal.timeout(AI_RESEARCH_DEEP_PLAN_TIMEOUT_MS),
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
    'INSERT INTO ai_research_conversations (id, user_id, messages, model, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
    [id, userId, payload, model],
  );
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

  let parsed: { messages: AiResearchChatMessage[]; conversationId?: string; pinnedSourceUrls: string[]; mode: AiResearchMode };
  try {
    parsed = parseChatRequest(await request.json());
    parsed.messages = await hydrateMessageFiles(parsed.messages);
  } catch (error) {
    return jsonError(
      error instanceof SyntaxError ? 'Invalid JSON body' : error instanceof Error ? error.message : 'Invalid request',
      400,
    );
  }

  const { messages, conversationId, mode } = parsed;
  const pinnedSourceUrls = parsePinnedSourceUrls(parsed.pinnedSourceUrls);
  let model: string;
  try {
    model = await resolveFeatureModel(auth.id, 'ai-research');
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to resolve AI Research model', 500);
  }

  let dbMessages: AiResearchChatMessage[] = [];
  let history: { messages: unknown } | undefined;
  if (conversationId) {
    history = await queryOne<{ messages: unknown }>(
      'SELECT messages FROM ai_research_conversations WHERE id = ? AND user_id = ?',
      [conversationId, auth.id],
    );
    if (history) dbMessages = await hydrateMessageFiles(parseStoredMessages(history.messages));
  }

  const convId = conversationId || uuidv4();
  const pendingMessages = [...dbMessages, ...messages];
  const latestUser = messages[messages.length - 1];

  try {
    await persistConversation(convId, auth.id, pendingMessages, model, Boolean(history));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to save conversation', 500);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sseFrame(data)));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      try {
        emit({ type: 'start', conversationId: convId, model, mode });
        const query = latestUser?.content || '';
        const urlOnly = isUrlOnlyQuery(query);

        if (mode === 'deep') {
          emit({ type: 'status', phase: 'plan', message: AI_RESEARCH_DEEP_STATUS.plan });
          const skipped = urlOnly ? 'url-only' : !shouldResearchQuery(query) ? 'not-needed' : null;
          let plan = fallbackDeepResearchPlan(query);
          let planUsage: GatewayTokenUsage | null = null;
          if (!skipped) {
            try {
              const planned = await requestDeepResearchPlan(model, query);
              planUsage = planned.usage;
              const parsedPlan = parseDeepResearchPlan(planned.text, query);
              if (parsedPlan) plan = parsedPlan;
            } catch (error) {
              console.error('[ai-research] deep plan failed:', error);
            }
          }

          const urlContextPromise = fetchAiResearchContextUrls(query);
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
              gather: (searchQuery, timeoutMs) => gatherAiResearchContext(searchQuery, { timeoutMs }),
              onProgress: event => {
                emit({
                  type: 'status',
                  phase: event.phase,
                  message: event.message,
                  round: event.round,
                  query: event.query,
                });
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

          const urlContext = await urlContextPromise;
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
          emit({
            type: 'research',
            sourceCount: researchEvent.sourceCount,
            grounding: researchEvent.grounding,
            sources: researchEvent.sources,
          });

          const pinnedResearch = pinnedSourceUrls.length
            ? applyPinnedResearchSources(gatherResult.research, pinnedSourceUrls)
            : gatherResult.research;
          const modelResearch = mergeContextUrlSources(pinnedResearch, urlContext.sources, query);
          emit({ type: 'status', phase: 'synthesize', message: AI_RESEARCH_DEEP_STATUS.synthesize });

          const apiMessages = buildAiResearchChatMessages({
            systemPrompt: `${AI_RESEARCH_SYSTEM_PROMPT}\n\n${AI_RESEARCH_DEEP_SYSTEM_ADDENDUM}\n\n${formatDeepResearchPlanNote(plan, gatherResult)}`,
            history: dbMessages,
            incoming: applyContextUrlsToIncoming(messages, urlContext.failures),
            maxHistory: MAX_HISTORY,
            research: modelResearch,
          });
          const streamed = await streamChatCompletion({
            emit,
            model,
            apiMessages,
            temperature: resolveAiResearchTemperature(modelResearch),
          });
          if (!streamed.ok) {
            close();
            return;
          }

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

          const allMessages = [...pendingMessages, buildStoredAssistantMessage({
            content: fullContent,
            mode: 'deep',
            sources: researchEvent.sources,
          })];
          await persistConversation(convId, auth.id, allMessages, model, true);
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
          if (urlOnly) return { research: null, failed: false };
          try {
            return { research: await gatherAiResearchContext(query), failed: false };
          } catch (error) {
            console.error('[ai-research] gatherAiResearchContext failed:', error);
            return { research: null, failed: true };
          }
        })();
        const [gatherOutcome, urlContext] = await Promise.all([
          gatherTask,
          fetchAiResearchContextUrls(query),
        ]);
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
        emit({
          type: 'research',
          sourceCount: researchEvent.sourceCount,
          grounding: researchEvent.grounding,
          sources: researchEvent.sources,
        });

        const pinnedResearch = gatherOutcome.research && pinnedSourceUrls.length
          ? applyPinnedResearchSources(gatherOutcome.research, pinnedSourceUrls)
          : gatherOutcome.research;
        const modelResearch = mergeContextUrlSources(pinnedResearch, urlContext.sources, query);

        const apiMessages = buildAiResearchChatMessages({
          systemPrompt: AI_RESEARCH_SYSTEM_PROMPT,
          history: dbMessages,
          incoming: applyContextUrlsToIncoming(messages, urlContext.failures),
          maxHistory: MAX_HISTORY,
          research: modelResearch,
        });

        const streamed = await streamChatCompletion({
          emit,
          model,
          apiMessages,
          temperature: resolveAiResearchTemperature(modelResearch),
        });
        if (!streamed.ok) {
          close();
          return;
        }

        const allMessages = [...pendingMessages, buildStoredAssistantMessage({
          content: streamed.content,
          mode: 'fast',
          sources: researchEvent.sources,
        })];
        await persistConversation(convId, auth.id, allMessages, model, true);
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
        emit({ type: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
        close();
      }
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
    const conversations = await import('@/lib/database').then(m =>
      m.queryAll<{ id: string; model: string; updated_at: string; title: string | null; message_count: number }>(
        `SELECT id, model, updated_at,
            COALESCE((
              SELECT elem->>'content'
              FROM jsonb_array_elements(messages) AS elem
              WHERE elem->>'role' = 'user'
              LIMIT 1
            ), 'New conversation') AS title,
            COALESCE(jsonb_array_length(messages), 0) AS message_count
          FROM ai_research_conversations
          WHERE user_id = ?
          ORDER BY updated_at DESC
          LIMIT 50`,
        [auth.id],
      ),
    );
    return new Response(JSON.stringify({
      conversations: conversations.map(c => ({
        id: c.id,
        title: (c.title || 'New conversation').slice(0, 80),
        model: c.model,
        updatedAt: c.updated_at,
        messageCount: Number(c.message_count) || 0,
      })),
    }));
  }

  const row = await queryOne<{ id: string; messages: unknown; model: string }>(
    'SELECT id, messages, model FROM ai_research_conversations WHERE id = ? AND user_id = ?',
    [conversationId, auth.id],
  );

  if (!row) {
    return jsonError('Conversation not found', 404);
  }

  return new Response(JSON.stringify({
    id: row.id,
    messages: parseStoredMessages(row.messages),
    model: row.model,
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
