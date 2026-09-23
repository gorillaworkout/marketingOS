import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { requireFeature } from '@/lib/auth';
import { execute, queryAll, queryOne } from '@/lib/database';
import {
  AI_RESEARCH_MAX_PROJECTS,
  normalizeProjectName,
  normalizeProjectNotes,
} from '@/lib/ai-research-projects';

type ProjectRow = {
  id: string;
  name: string;
  notes: string | null;
  updated_at: string | Date;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function present(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes || '',
    updatedAt: asIso(row.updated_at),
  };
}

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error('Invalid JSON body');
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return json({ error: auth.error }, auth.status);

  const projects = await queryAll<ProjectRow>(
    `SELECT id, name, notes, updated_at
      FROM ai_research_projects
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT ?`,
    [auth.id, AI_RESEARCH_MAX_PROJECTS],
  );
  return json({ projects: projects.map(present) });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return json({ error: auth.error }, auth.status);

  try {
    const body = await readJson(request) as { name?: unknown; notes?: unknown };
    const name = normalizeProjectName(body?.name);
    const notes = normalizeProjectNotes(body?.notes);
    const count = await queryOne<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM ai_research_projects WHERE user_id = ?',
      [auth.id],
    );
    if (Number(count?.count ?? 0) >= AI_RESEARCH_MAX_PROJECTS) {
      return json({ error: `Maksimal ${AI_RESEARCH_MAX_PROJECTS} proyek riset.` }, 400);
    }
    const id = uuidv4();
    await execute(
      `INSERT INTO ai_research_projects (id, user_id, name, notes, summary, created_at, updated_at)
        VALUES (?, ?, ?, ?, '', NOW(), NOW())`,
      [id, auth.id, name, notes],
    );
    const row = await queryOne<ProjectRow>(
      'SELECT id, name, notes, updated_at FROM ai_research_projects WHERE id = ? AND user_id = ?',
      [id, auth.id],
    );
    return json({ project: row ? present(row) : { id, name, notes, updatedAt: new Date().toISOString() } }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Gagal membuat proyek' }, 400);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return json({ error: auth.error }, auth.status);

  try {
    const body = await readJson(request) as { id?: unknown; name?: unknown; notes?: unknown };
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) return json({ error: 'Proyek tidak valid.' }, 400);
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM ai_research_projects WHERE id = ? AND user_id = ?',
      [id, auth.id],
    );
    if (!existing) return json({ error: 'Proyek tidak ditemukan' }, 404);

    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.name !== undefined) {
      sets.push('name = ?');
      params.push(normalizeProjectName(body.name));
    }
    if (body.notes !== undefined) {
      sets.push('notes = ?');
      params.push(normalizeProjectNotes(body.notes));
    }
    if (!sets.length) return json({ error: 'Tidak ada perubahan.' }, 400);
    sets.push('updated_at = NOW()');
    params.push(id, auth.id);
    await execute(
      `UPDATE ai_research_projects SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
      params,
    );
    const row = await queryOne<ProjectRow>(
      'SELECT id, name, notes, updated_at FROM ai_research_projects WHERE id = ? AND user_id = ?',
      [id, auth.id],
    );
    if (!row) return json({ error: 'Proyek tidak ditemukan' }, 404);
    return json({ project: present(row) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Gagal memperbarui proyek' }, 400);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return json({ error: auth.error }, auth.status);

  const id = new URL(request.url).searchParams.get('id')?.trim() || '';
  if (!id) return json({ error: 'Proyek tidak valid.' }, 400);
  const removed = await execute(
    'DELETE FROM ai_research_projects WHERE id = ? AND user_id = ?',
    [id, auth.id],
  );
  if (!removed) return json({ error: 'Proyek tidak ditemukan' }, 404);
  return json({ success: true });
}
