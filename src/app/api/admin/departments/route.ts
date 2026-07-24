import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { execute, queryAll, queryOne } from '@/lib/database';
import { requireAdmin } from '@/lib/auth';
import { GENERATION_FEATURES } from '@/lib/authorization';

function validFeatures(features: unknown): features is string[] {
  return Array.isArray(features) && features.every(feature => GENERATION_FEATURES.includes(feature));
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request); if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ departments: await queryAll('SELECT id, name, permitted_features, created_at, updated_at FROM departments ORDER BY name') });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request); if (auth instanceof NextResponse) return auth;
  const { name, features } = await request.json();
  if (!name?.trim() || !validFeatures(features)) return NextResponse.json({ error: 'A name and valid permitted features are required' }, { status: 400 });
  if (await queryOne('SELECT id FROM departments WHERE name = ?', [name.trim()])) return NextResponse.json({ error: 'Department name already exists' }, { status: 409 });
  const id = uuidv4(); await execute('INSERT INTO departments (id, name, permitted_features) VALUES (?, ?, ?)', [id, name.trim(), features]);
  return NextResponse.json({ department: await queryOne('SELECT id, name, permitted_features, created_at, updated_at FROM departments WHERE id = ?', [id]) }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request); if (auth instanceof NextResponse) return auth;
  const { id, name, features } = await request.json();
  if (!id || (name !== undefined && !name.trim()) || (features !== undefined && !validFeatures(features))) return NextResponse.json({ error: 'Invalid department update' }, { status: 400 });
  if (!await queryOne('SELECT id FROM departments WHERE id = ?', [id])) return NextResponse.json({ error: 'Department not found' }, { status: 404 });
  if (name !== undefined && await queryOne('SELECT id FROM departments WHERE name = ? AND id != ?', [name.trim(), id])) return NextResponse.json({ error: 'Department name already exists' }, { status: 409 });
  const fields: string[] = []; const values: unknown[] = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name.trim()); }
  if (features !== undefined) { fields.push('permitted_features = ?'); values.push(features); }
  if (fields.length) { fields.push('updated_at = CURRENT_TIMESTAMP'); values.push(id); await execute(`UPDATE departments SET ${fields.join(', ')} WHERE id = ?`, values); }
  return NextResponse.json({ department: await queryOne('SELECT id, name, permitted_features, created_at, updated_at FROM departments WHERE id = ?', [id]) });
}
