import { NextRequest } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { resolveFeatureModel } from '@/lib/model-routing';
import { rateLimit } from '@/lib/rate-limit';
import {
  AI_RESEARCH_MAX_OUTPUT_TOKENS,
  AI_RESEARCH_SYSTEM_PROMPT,
  parseChatRequest,
  parseStoredMessages,
  type AiResearchChatMessage,
} from '@/lib/ai-research';
import { hydrateMessageFiles } from '@/lib/ai-research-files';
import {
  buildAiResearchChatMessages,
  gatherAiResearchContext,
  resolveAiResearchTemperature,
  type ResearchContext,
} from '@/lib/ai-research-grounding';
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
  resolveTokenUsage,
  type GatewayTokenUsage,
} from '@/lib/token-usage';
import { v4 as uuidv4 } from 'uuid';
import { execute, queryOne } from '@/lib/database';

const MAX_HISTORY = 20;

export const maxDuration = 60;

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

  let parsed: { messages: AiResearchChatMessage[]; conversationId?: string; pinnedSourceUrls: string[] };
  try {
    parsed = parseChatRequest(await request.json());
    parsed.messages = hydrateMessageFiles(parsed.messages);
  } catch (error) {
    return jsonError(
      error instanceof SyntaxError ? 'Invalid JSON body' : error instanceof Error ? error.message : 'Invalid request',
      400,
    );
  }

  const { messages, conversationId } = parsed;
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
    if (history) dbMessages = hydrateMessageFiles(parseStoredMessages(history.messages));
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
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'start', conversationId: convId, model })}\n\n`));

        let research: ResearchContext | null = null;
        let gatherFailed = false;
        const query = latestUser?.content || '';
        try {
          research = await gatherAiResearchContext(query);
        } catch (error) {
          console.error('[ai-research] gatherAiResearchContext failed:', error);
          gatherFailed = true;
          research = null;
        }
        const researchEvent = buildResearchSsePayload({ query, research, failed: gatherFailed });
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'research',
          sourceCount: researchEvent.sourceCount,
          grounding: researchEvent.grounding,
          sources: researchEvent.sources,
        })}\n\n`));

        const modelResearch = research && pinnedSourceUrls.length
          ? applyPinnedResearchSources(research, pinnedSourceUrls)
          : research;

        const apiMessages = buildAiResearchChatMessages({
          systemPrompt: AI_RESEARCH_SYSTEM_PROMPT,
          history: dbMessages,
          incoming: messages,
          maxHistory: MAX_HISTORY,
          research: modelResearch,
        });

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
            messages: apiMessages,
            stream: true,
            stream_options: { include_usage: true },
            temperature: resolveAiResearchTemperature(research),
            max_tokens: AI_RESEARCH_MAX_OUTPUT_TOKENS,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: `API error ${response.status}: ${errText}` })}\n\n`));
          controller.close();
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'No stream body' })}\n\n`));
          controller.close();
          return;
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
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', content: parsed.content })}\n\n`));
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
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', content: parsed.content })}\n\n`));
          }
          if (parsed.usage) reportedUsage = parsed.usage;
        }

        const allMessages = [...pendingMessages, { role: 'assistant' as const, content: fullContent }];
        await persistConversation(convId, auth.id, allMessages, model, true);
        await logAiResearchUsage({
          userId: auth.id,
          model,
          inputText: gatewayMessagesText(apiMessages),
          outputText: fullContent,
          reported: reportedUsage,
        });

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', conversationId: convId, model })}\n\n`));
        controller.close();
      } catch (error) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: error instanceof Error ? error.message : 'Unknown error' })}\n\n`));
        controller.close();
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
