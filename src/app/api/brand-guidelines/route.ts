import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryAll, execute } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

// GET: List all brand guidelines for the authenticated user
export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;
  const guidelines = await queryAll('SELECT id, brand_name, tone_of_voice, target_market, key_messages, do_list, dont_list, examples, created_at, updated_at FROM brand_guidelines WHERE user_id = ? ORDER BY updated_at DESC', [userId]) as Record<string, unknown>[];

  return NextResponse.json({
    guidelines: guidelines.map((row) => ({
      id: row.id,
      brand_name: row.brand_name,
      tone_of_voice: row.tone_of_voice,
      target_market: row.target_market,
      key_messages: row.key_messages,
      do_list: JSON.parse((row.do_list as string) || '[]'),
      dont_list: JSON.parse((row.dont_list as string) || '[]'),
      examples: row.examples,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
  });
}

// POST: Create new brand guidelines
export async function POST(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const body = await request.json();
  const { brand_name, tone_of_voice, target_market, key_messages, do_list, dont_list, examples } = body;

  if (!brand_name) {
    return NextResponse.json({ error: 'Brand name is required' }, { status: 400 });
  }
  const id = uuidv4();
  await execute(`INSERT INTO brand_guidelines (id, user_id, brand_name, tone_of_voice, target_market, key_messages, do_list, dont_list, examples)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, userId, brand_name, tone_of_voice || null, target_market || null, key_messages || null, JSON.stringify(do_list || []), JSON.stringify(dont_list || []), examples || null]);

  return NextResponse.json({
    success: true,
    guideline: { id, brand_name, tone_of_voice, target_market, key_messages, do_list: do_list || [], dont_list: dont_list || [], examples },
  });
}

// PUT: Update existing brand guidelines
export async function PUT(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const body = await request.json();
  const { id, brand_name, tone_of_voice, target_market, key_messages, do_list, dont_list, examples } = body;

  if (!id) return NextResponse.json({ error: 'Guideline ID is required' }, { status: 400 });

  // Verify ownership
  const existing = await queryOne('SELECT id FROM brand_guidelines WHERE id = ? AND user_id = ?', [id, userId]);
  if (!existing) {
    return NextResponse.json({ error: 'Guideline not found' }, { status: 404 });
  }

  await execute(`UPDATE brand_guidelines SET
       brand_name = COALESCE(?, brand_name),
       tone_of_voice = ?,
       target_market = ?,
       key_messages = ?,
       do_list = COALESCE(?, do_list),
       dont_list = COALESCE(?, dont_list),
       examples = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`, [brand_name || null, tone_of_voice ?? null, target_market ?? null, key_messages ?? null, do_list ? JSON.stringify(do_list) : null, dont_list ? JSON.stringify(dont_list) : null, examples ?? null, id, userId]);

  return NextResponse.json({ success: true, id });
}

// DELETE: Remove brand guidelines
export async function DELETE(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Guideline ID is required' }, { status: 400 });
  await execute('DELETE FROM brand_guidelines WHERE id = ? AND user_id = ?', [id, userId]);

  return NextResponse.json({ success: true });
}
