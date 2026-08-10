import { NextRequest } from 'next/server';
import { getAuthorizedUser } from '@/lib/auth';
import { resolveFeatureModel } from '@/lib/model-routing';
import { v4 as uuidv4 } from 'uuid';
import { execute, queryOne } from '@/lib/database';

const GORILLAWORKOUT_API_BASE = process.env.GORILLAWORKOUT_API_BASE || 'https://llm.gorillaworkout.id/v1';
const GORILLAWORKOUT_API_KEY = process.env.GORILLAWORKOUT_API_KEY || '';
const MAX_HISTORY = 20;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(request: NextRequest) {
  const auth = await getAuthorizedUser(request);
  if ('error' in auth) {
    return new Response(JSON.stringify({ error: auth.error }), { status: auth.status });
  }

  const { messages, conversationId } = await request.json() as {
    messages: ChatMessage[];
    conversationId?: string;
  };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'Messages are required' }), { status: 400 });
  }

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== 'user' || !lastMessage.content?.trim()) {
    return new Response(JSON.stringify({ error: 'Last message must be from user with content' }), { status: 400 });
  }

  // Resolve model preference
  const model = await resolveFeatureModel(auth.id, 'ai-research').catch(() => 'ag/gemini-3-flash-agent');

  // Load chat history from DB, limit to last N messages
  let dbMessages: { role: string; content: string }[] = [];
  if (conversationId) {
    const history = await queryOne<{ messages: string }>(
      'SELECT messages FROM ai_research_conversations WHERE id = ? AND user_id = ?',
      [conversationId, auth.id],
    );
    if (history) {
      try {
        dbMessages = JSON.parse(history.messages);
      } catch {
        dbMessages = [];
      }
    }
  }

  // Prepare API messages (truncate to avoid context overflow)
  const systemPrompt = {
    role: 'system',
    content: `Kamu adalah GorillaWorkout AI Assistant, asisten riset dan analisis untuk tim marketing Dupoin Futures. Kamu membantu dengan riset, analisis data, penulisan konten, strategi marketing, dan pertanyaan umum seputar trading forex, komoditas, dan indeks. Jawab dalam Bahasa Indonesia yang profesional namun mudah dipahami. Hindari jawaban seperti AI — tulis seperti kolega yang kompeten dan helpful.`,
  };

  const recentHistory = [...dbMessages, ...messages].slice(-MAX_HISTORY);
  const apiMessages = [systemPrompt, ...recentHistory.map(m => ({ role: m.role, content: m.content }))];

  // SSE stream
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
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  fullContent += delta;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', content: delta })}\n\n`));
                }
              } catch {
                // Skip unparseable chunks
              }
            }
          } catch {
            // Stream error — deliver what we have
            done = true;
          }
        }

        // Save conversation to DB
        const allMessages = [...dbMessages, ...messages, { role: 'assistant', content: fullContent }];
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

// GET: load conversation history
export async function GET(request: NextRequest) {
  const auth = await getAuthorizedUser(request);
  if ('error' in auth) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status });

  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get('id');

  if (!conversationId) {
    // List conversations
    const conversations = await import('@/lib/database').then(m =>
      m.queryAll<{ id: string; model: string; updated_at: string; messages: string }>(
        'SELECT id, model, updated_at, messages FROM ai_research_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50',
        [auth.id],
      ),
    );
    return new Response(JSON.stringify({
      conversations: conversations.map(c => {
        let msgs: ChatMessage[] = [];
        try { msgs = JSON.parse(c.messages); } catch {}
        const firstUser = msgs.find(m => m.role === 'user');
        return {
          id: c.id,
          title: firstUser ? firstUser.content.slice(0, 80) : 'New conversation',
          model: c.model,
          updatedAt: c.updated_at,
          messageCount: msgs.length,
        };
      }),
    }));
  }

  // Load single conversation
  const row = await queryOne<{ id: string; messages: string; model: string }>(
    'SELECT id, messages, model FROM ai_research_conversations WHERE id = ? AND user_id = ?',
    [conversationId, auth.id],
  );

  if (!row) {
    return new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 });
  }

  let messages: ChatMessage[] = [];
  try { messages = JSON.parse(row.messages); } catch {}

  return new Response(JSON.stringify({ id: row.id, messages, model: row.model }));
}

// DELETE: delete a conversation
export async function DELETE(request: NextRequest) {
  const auth = await getAuthorizedUser(request);
  if ('error' in auth) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status });

  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get('id');

  if (!conversationId) {
    return new Response(JSON.stringify({ error: 'Conversation ID is required' }), { status: 400 });
  }

  await execute(
    'DELETE FROM ai_research_conversations WHERE id = ? AND user_id = ?',
    [conversationId, auth.id],
  );

  return new Response(JSON.stringify({ success: true }));
}
