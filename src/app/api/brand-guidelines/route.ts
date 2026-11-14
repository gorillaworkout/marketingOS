import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryAll, execute } from '@/lib/database';
import { getAuthorizedUser, getSession } from '@/lib/auth';
import { ensureDefaultBrandGuideline } from '@/lib/dupoin-default-brand-guideline';
import { canEditBrandVoice, canWriteBrandVoice, parseStringList, VOICE_CHARACTER_MAX } from '@/lib/social-post-library';
import { v4 as uuidv4 } from 'uuid';

type GuidelineRow = {
  id: string;
  user_id: string;
  brand_name: string;
  tone_of_voice: string | null;
  target_market: string | null;
  key_messages: string | null;
  do_list: string | null;
  dont_list: string | null;
  examples: string | null;
  is_shared: boolean;
  voice_character: string | null;
  banned_phrases: string | null;
  created_at: string;
  updated_at: string;
};

function jsonList(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function present(row: GuidelineRow, actor: { id: string; role: string }) {
  return {
    id: row.id,
    user_id: row.user_id,
    brand_name: row.brand_name,
    tone_of_voice: row.tone_of_voice,
    target_market: row.target_market,
    key_messages: row.key_messages,
    do_list: jsonList(row.do_list),
    dont_list: jsonList(row.dont_list),
    examples: row.examples,
    is_shared: Boolean(row.is_shared),
    voice_character: row.voice_character,
    banned_phrases: jsonList(row.banned_phrases),
    can_edit: canEditBrandVoice(actor, { userId: row.user_id, isShared: Boolean(row.is_shared) }),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function writer(request: NextRequest) {
  const user = await getAuthorizedUser(request);
  if ('error' in user) return user;
  if (!canWriteBrandVoice(user)) {
    return { error: 'Forbidden: Social Post, Video Script, or Event Plan access is required to edit a brand voice.', status: 403 as const };
  }
  return user;
}

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const actor = await getAuthorizedUser(request);
  if ('error' in actor) return NextResponse.json({ error: actor.error }, { status: actor.status });
  await ensureDefaultBrandGuideline(userId);
  const guidelines = await queryAll<GuidelineRow>(
    `SELECT id, brand_name, user_id, tone_of_voice, target_market, key_messages, do_list, dont_list, examples,
            is_shared, voice_character, banned_phrases, created_at, updated_at
     FROM brand_guidelines
     WHERE user_id = ? OR is_shared = TRUE
     ORDER BY is_shared ASC, updated_at DESC`,
    [userId],
  );
  return NextResponse.json({ guidelines: guidelines.map(row => present(row, actor)) });
}

export async function POST(request: NextRequest) {
  const user = await writer(request);
  if ('error' in user) return NextResponse.json({ error: user.error }, { status: user.status });

  const body = await request.json();
  const { brand_name, tone_of_voice, target_market, key_messages, do_list, dont_list, examples } = body;
  if (!brand_name || typeof brand_name !== 'string' || !brand_name.trim()) {
    return NextResponse.json({ error: 'Brand name is required' }, { status: 400 });
  }
  if (body.is_shared && user.role !== 'admin') {
    return NextResponse.json({ error: 'Only an admin can share a brand voice.' }, { status: 403 });
  }
  const id = uuidv4();
  const banned = parseStringList(body.banned_phrases, 80, 30);
  const character = typeof body.voice_character === 'string' ? body.voice_character.trim().slice(0, VOICE_CHARACTER_MAX) : null;
  await execute(
    `INSERT INTO brand_guidelines (
       id, user_id, brand_name, tone_of_voice, target_market, key_messages, do_list, dont_list, examples,
       is_shared, voice_character, banned_phrases
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, user.id, brand_name.trim().slice(0, 120), tone_of_voice || null, target_market || null, key_messages || null,
      JSON.stringify(do_list || []), JSON.stringify(dont_list || []), examples || null,
      Boolean(body.is_shared) && user.role === 'admin', character || null, JSON.stringify(banned),
    ],
  );
  return NextResponse.json({
    success: true,
    guideline: { id, brand_name, tone_of_voice, target_market, key_messages, do_list: do_list || [], dont_list: dont_list || [], examples, is_shared: Boolean(body.is_shared) && user.role === 'admin' },
  });
}

export async function PUT(request: NextRequest) {
  const user = await writer(request);
  if ('error' in user) return NextResponse.json({ error: user.error }, { status: user.status });

  const body = await request.json();
  const { id, brand_name } = body;
  if (!id) return NextResponse.json({ error: 'Guideline ID is required' }, { status: 400 });
  const existing = await queryOne<GuidelineRow>('SELECT * FROM brand_guidelines WHERE id = ?', [id]);
  if (!existing) return NextResponse.json({ error: 'Guideline not found' }, { status: 404 });
  if (!canEditBrandVoice(user, { userId: existing.user_id, isShared: Boolean(existing.is_shared) })) {
    return NextResponse.json({ error: 'Only an admin can edit a shared brand voice.' }, { status: 403 });
  }
  if ('is_shared' in body && Boolean(body.is_shared) !== Boolean(existing.is_shared) && user.role !== 'admin') {
    return NextResponse.json({ error: 'Only an admin can share a brand voice.' }, { status: 403 });
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => { sets.push(`${column} = ?`); values.push(value); };
  if (typeof brand_name === 'string' && brand_name.trim()) set('brand_name', brand_name.trim().slice(0, 120));
  if ('tone_of_voice' in body) set('tone_of_voice', body.tone_of_voice || null);
  if ('target_market' in body) set('target_market', body.target_market || null);
  if ('key_messages' in body) set('key_messages', body.key_messages || null);
  if ('do_list' in body) set('do_list', JSON.stringify(body.do_list || []));
  if ('dont_list' in body) set('dont_list', JSON.stringify(body.dont_list || []));
  if ('examples' in body) set('examples', body.examples || null);
  if ('voice_character' in body) set('voice_character', typeof body.voice_character === 'string' ? body.voice_character.trim().slice(0, VOICE_CHARACTER_MAX) : null);
  if ('banned_phrases' in body) set('banned_phrases', JSON.stringify(parseStringList(body.banned_phrases, 80, 30)));
  if ('is_shared' in body && user.role === 'admin') set('is_shared', Boolean(body.is_shared));
  if (sets.length === 0) return NextResponse.json({ success: true, id });
  sets.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  await execute(`UPDATE brand_guidelines SET ${sets.join(', ')} WHERE id = ?`, values);
  return NextResponse.json({ success: true, id });
}

export async function DELETE(request: NextRequest) {
  const user = await writer(request);
  if ('error' in user) return NextResponse.json({ error: user.error }, { status: user.status });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Guideline ID is required' }, { status: 400 });
  const existing = await queryOne<GuidelineRow>('SELECT * FROM brand_guidelines WHERE id = ?', [id]);
  if (!existing) return NextResponse.json({ error: 'Guideline not found' }, { status: 404 });
  if (!canEditBrandVoice(user, { userId: existing.user_id, isShared: Boolean(existing.is_shared) })) {
    return NextResponse.json({ error: 'Only an admin can delete a shared brand voice.' }, { status: 403 });
  }
  await execute('DELETE FROM brand_guidelines WHERE id = ?', [id]);
  return NextResponse.json({ success: true });
}
