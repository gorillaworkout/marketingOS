import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryAll, execute } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

export const BUILT_IN_TEMPLATES = [
  {
    id: 'builtin-social-post-market-update',
    name: 'Market Update Harian',
    type: 'social-post',
    platform: 'Instagram',
    brief_template: 'Buat market update harian yang ringkas berdasarkan topik, data, dan sumber yang saya berikan. Gunakan tone profesional, jelaskan dampaknya bagi trader, dan tutup dengan CTA yang relevan.',
    output_template: null,
    tags: 'market update, daily content, trader education',
    use_count: 0,
    created_at: null,
    is_builtin: true,
  },
  {
    id: 'builtin-video-script-education',
    name: 'Video Edukasi Trading',
    type: 'video-script',
    platform: 'Instagram',
    brief_template: 'Buat video edukasi trading dengan hook yang kuat, penjelasan sederhana, contoh praktis, dan CTA. Hindari janji profit dan pastikan setiap klaim mudah diverifikasi.',
    output_template: null,
    tags: 'education, video, trading',
    use_count: 0,
    created_at: null,
    is_builtin: true,
  },
  {
    id: 'builtin-event-plan-seminar',
    name: 'Seminar & Client Gathering',
    type: 'event-plan',
    platform: null,
    brief_template: 'Rancang seminar atau client gathering dengan objective, target audience, konsep acara, rundown, kebutuhan venue, speaker, timeline, dan budget ceiling. Gunakan hanya vendor, harga, dan kontak dari sumber yang dapat diverifikasi.',
    output_template: null,
    tags: 'seminar, gathering, event',
    use_count: 0,
    created_at: null,
    is_builtin: true,
  },
];

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;
  const type = request.nextUrl.searchParams.get('type');
  const platform = request.nextUrl.searchParams.get('platform');

  let query = 'SELECT * FROM templates WHERE user_id = ?';
  const params: unknown[] = [userId];

  if (type) { query += ' AND type = ?'; params.push(type); }
  if (platform) { query += ' AND platform = ?'; params.push(platform); }
  query += ' ORDER BY use_count DESC, created_at DESC';

  const userTemplates = await queryAll(query, [...params]) as Record<string, unknown>[];
  const builtIns = BUILT_IN_TEMPLATES.filter(template =>
    (!type || template.type === type) && (!platform || template.platform === platform),
  );
  const templates = [
    ...builtIns,
    ...userTemplates.map(template => ({ ...template, is_builtin: false })),
  ];

  return NextResponse.json({ templates });
}

export async function POST(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;
  const { name, type, platform, brief_template, output_template, tags } = await request.json();
  if (!name || !type) return NextResponse.json({ error: 'name and type are required' }, { status: 400 });

  const id = uuidv4();
  await execute('INSERT INTO templates (id, user_id, name, type, platform, brief_template, output_template, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, userId, name, type, platform || null, brief_template || null, output_template ? JSON.stringify(output_template) : null, tags || null]);

  return NextResponse.json({ success: true, id });
}

export async function PUT(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;
  const { id, name, type, platform, brief_template, output_template, tags, increment_use } = await request.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  if (id.startsWith('builtin-')) {
    if (increment_use) return NextResponse.json({ success: true });
    return NextResponse.json({ error: 'Built-in templates cannot be edited' }, { status: 400 });
  }

  if (increment_use) {
    await execute('UPDATE templates SET use_count = use_count + 1 WHERE id = ? AND user_id = ?', [id, userId]);
        return NextResponse.json({ success: true });
  }

  const fields: string[] = [];
  const params: unknown[] = [];

  if (name !== undefined) { fields.push('name = ?'); params.push(name); }
  if (type !== undefined) { fields.push('type = ?'); params.push(type); }
  if (platform !== undefined) { fields.push('platform = ?'); params.push(platform); }
  if (brief_template !== undefined) { fields.push('brief_template = ?'); params.push(brief_template); }
  if (output_template !== undefined) { fields.push('output_template = ?'); params.push(typeof output_template === 'string' ? output_template : JSON.stringify(output_template)); }
  if (tags !== undefined) { fields.push('tags = ?'); params.push(tags); }

  if (fields.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

  params.push(id, userId);
  await execute(`UPDATE templates SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, [...params]);

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (id.startsWith('builtin-')) return NextResponse.json({ error: 'Built-in templates cannot be deleted' }, { status: 400 });

  await execute('DELETE FROM templates WHERE id = ? AND user_id = ?', [id, userId]);

  return NextResponse.json({ success: true });
}
