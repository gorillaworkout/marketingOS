import { NextRequest } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { resolveFeatureModel } from '@/lib/model-routing';
import { rateLimit } from '@/lib/rate-limit';
import {
  buildGatewayMessages,
  conversationTitleFromMessages,
  parseChatRequest,
  parseStoredMessages,
  type AiResearchChatMessage,
} from '@/lib/ai-research';
import { v4 as uuidv4 } from 'uuid';
import { execute, queryOne } from '@/lib/database';

const GORILLAWORKOUT_API_BASE = process.env.GORILLAWORKOUT_API_BASE || 'https://llm.gorillaworkout.id/v1';
const GORILLAWORKOUT_API_KEY = process.env.GORILLAWORKOUT_API_KEY || '';
const MAX_HISTORY = 20;
const SYSTEM_PROMPT = `Kamu adalah GorillaWorkout AI Assistant, asisten riset dan analisis untuk tim marketing Dupoin Futures. Kamu membantu dengan riset, analisis data, penulisan konten, strategi marketing, dan pertanyaan umum seputar trading forex, komoditas, dan indeks. Jawab dalam Bahasa Indonesia yang profesional namun mudah dipahami. Hindari jawaban seperti AI — tulis seperti kolega yang kompeten dan helpful. Jika pengguna melampirkan gambar, baca teks, angka, grafik, dan detail visual di gambar tersebut lalu gunakan informasinya dalam jawaban.`;

function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ error }), { status });
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(request);
  if (limited) return limited;

  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) {
    return jsonError(auth.error, auth.status);
  }

  let parsed: { messages: AiResearchChatMessage[]; conversationId?: string };
  try {
    parsed = parseChatRequest(await request.json());
  } catch (error) {
    return jsonError(
      error instanceof SyntaxError ? 'Invalid JSON body' : error instanceof Error ? error.message : 'Invalid request',
      400,
    );
  }

  const { messages, conversationId } = parsed;
  let model: string;
  try {
    model = await resolveFeatureModel(auth.id, 'ai-research');
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to resolve AI Research model', 500);
  }

  let dbMessages: AiResearchChatMessage[] = [];
  if (conversationId) {
    const history = await queryOne<{ messages: string }>(
      'SELECT messages FROM ai_research_conversations WHERE id = ? AND user_id = ?',
      [conversationId, auth.id],
    );
    if (history) dbMessages = parseStoredMessages(history.messages);
  }

  const apiMessages = buildGatewayMessages(SYSTEM_PROMPT, dbMessages, messages, MAX_HISTORY);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await fetch(`${GORILLAWORKOUT_API_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GORILLAWORKOUT_API_KEY}`,
            'HTTP-Referer': 'https://marketing-aws.gorillaworkout.id',
            'X-Title': 'MarketingOS AI Research',
          },
          body: JSON.stringify({
            model,
            messages: apiMessages,
            stream: true,
            temperature: 0.7,
            max_tokens: 2000,
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
        let done = false;

        while (!done) {
          try {
            const { value, done: streamDone } = await reader.read();
            if (streamDone) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;
              const data = trimmed.slice(6);
              if (data === '[DONE]') { done = true; break; }

              try {
                const parsedChunk = JSON.parse(data);
                const delta = parsedChunk.choices?.[0]?.delta?.content;
                if (delta) {
                  fullContent += delta;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', content: delta })}\n\n`));
                }
              } catch {
                // Skip unparseable chunks
              }
            }
          } catch {
            done = true;
          }
        }

        const allMessages = [...dbMessages, ...messages, { role: 'assistant' as const, content: fullContent }];
        const convId = conversationId || uuidv4();

        if (conversationId) {
          await execute(
            'UPDATE ai_research_conversations SET messages = ?, model = ?, updated_at = NOW() WHERE id = ? AND user_id = ?',
            [JSON.stringify(allMessages), model, conversationId, auth.id],
          );
        } else {
          await execute(
            'INSERT INTO ai_research_conversations (id, user_id, messages, model, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
            [convId, auth.id, JSON.stringify(allMessages), model],
          );
        }

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
      m.queryAll<{ id: string; model: string; updated_at: string; messages: string }>(
        'SELECT id, model, updated_at, messages FROM ai_research_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50',
        [auth.id],
      ),
    );
    return new Response(JSON.stringify({
      conversations: conversations.map(c => {
        const msgs = parseStoredMessages(c.messages);
        return {
          id: c.id,
          title: conversationTitleFromMessages(msgs),
          model: c.model,
          updatedAt: c.updated_at,
          messageCount: msgs.length,
        };
      }),
    }));
  }

  const row = await queryOne<{ id: string; messages: string; model: string }>(
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
