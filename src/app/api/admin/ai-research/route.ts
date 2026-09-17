import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { queryAll, queryOne } from '@/lib/database';
import { parseStoredMessages, type AiResearchChatMessage } from '@/lib/ai-research';

const TITLE_SQL = `COALESCE((
  SELECT LEFT(elem->>'content', 80)
  FROM jsonb_array_elements(c.messages) AS elem
  WHERE elem->>'role' = 'user'
  LIMIT 1
), 'New conversation')`;

type ListRow = {
  id: string;
  user_id: string;
  user_name: string | null;
  username: string | null;
  model: string;
  updated_at: string | Date;
  title: string | null;
  message_count: number | string;
};

type FilterUserRow = {
  id: string;
  name: string | null;
  username: string | null;
};

type DetailRow = {
  id: string;
  user_id: string;
  user_name: string | null;
  username: string | null;
  messages: unknown;
  model: string;
  created_at: string | Date;
  updated_at: string | Date;
};

function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function publicMessages(messages: AiResearchChatMessage[]): AiResearchChatMessage[] {
  return messages.map(message => {
    const next: AiResearchChatMessage = { role: message.role, content: message.content };
    if (message.images?.length) {
      next.images = message.images.map(image => ({
        mimeType: image.mimeType,
        dataUrl: image.dataUrl,
        ...(image.name ? { name: image.name } : {}),
      }));
    }
    return next;
  });
}

function titleQuery(value: string): string | null {
  const cleaned = value.replace(/[%_\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return cleaned || null;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get('id')?.trim();

  if (conversationId) {
    const row = await queryOne<DetailRow>(
      `SELECT c.id, c.user_id, u.name AS user_name, u.username, c.messages, c.model, c.created_at, c.updated_at
        FROM ai_research_conversations c
        JOIN users u ON u.id = c.user_id
        WHERE c.id = ?`,
      [conversationId],
    );
    if (!row) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    return NextResponse.json({
      id: row.id,
      user: {
        id: row.user_id,
        name: row.user_name || row.username || 'Unknown',
        username: row.username || '',
      },
      model: row.model,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
      messages: publicMessages(parseStoredMessages(row.messages)),
    });
  }

  const userId = searchParams.get('userId')?.trim() || '';
  const title = titleQuery(searchParams.get('title') || '');
  const rawLimit = Number(searchParams.get('limit') || 200);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 200, 1), 500);

  const where: string[] = [];
  const params: unknown[] = [];
  if (userId) {
    where.push('c.user_id = ?');
    params.push(userId);
  }
  if (title) {
    where.push(`${TITLE_SQL} ILIKE ?`);
    params.push(`%${title}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);

  const [rows, users] = await Promise.all([
    queryAll<ListRow>(
      `SELECT c.id, c.user_id, u.name AS user_name, u.username, c.model, c.updated_at,
          ${TITLE_SQL} AS title,
          COALESCE(jsonb_array_length(c.messages), 0) AS message_count
        FROM ai_research_conversations c
        JOIN users u ON u.id = c.user_id
        ${whereSql}
        ORDER BY c.updated_at DESC
        LIMIT ?`,
      params,
    ),
    queryAll<FilterUserRow>(
      `SELECT DISTINCT u.id, u.name, u.username
        FROM ai_research_conversations c
        JOIN users u ON u.id = c.user_id
        ORDER BY u.name ASC, u.username ASC`,
      [],
    ),
  ]);

  return NextResponse.json({
    conversations: rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name || row.username || 'Unknown',
      username: row.username || '',
      title: (row.title || 'New conversation').slice(0, 80),
      model: row.model,
      messageCount: Number(row.message_count) || 0,
      updatedAt: asIso(row.updated_at),
    })),
    users: users.map(user => ({
      id: user.id,
      name: user.name || user.username || 'Unknown',
      username: user.username || '',
    })),
  });
}
