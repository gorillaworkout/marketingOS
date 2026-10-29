import { v4 as uuidv4 } from 'uuid';
import { execute, queryAll, queryOne } from '@/lib/database';
import type { SopCategory, SopInput } from './sops';

export interface SopSummary {
  id: string;
  title: string;
  category: SopCategory;
  updated_by_name: string | null;
  updated_at: string;
  created_at: string;
}
export interface SopRow extends SopSummary { body_md: string }

const FROM = 'FROM seo_sops s LEFT JOIN users u ON u.id = s.updated_by';

export async function listSops(): Promise<SopSummary[]> {
  return queryAll<SopSummary & Record<string, unknown>>(
    `SELECT s.id, s.title, s.category, u.name AS updated_by_name, s.updated_at, s.created_at ${FROM} ORDER BY s.category, lower(s.title), s.id`, []);
}

export async function getSop(id: string): Promise<SopRow | undefined> {
  return queryOne<SopRow & Record<string, unknown>>(
    `SELECT s.id, s.title, s.category, s.body_md, u.name AS updated_by_name, s.updated_at, s.created_at ${FROM} WHERE s.id = ?`, [id]);
}

export async function createSop(input: SopInput, userId: string): Promise<string> {
  const id = uuidv4();
  await execute(
    'INSERT INTO seo_sops (id, title, category, body_md, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?)',
    [id, input.title, input.category, input.bodyMd, userId, userId],
  );
  return id;
}

export async function updateSop(id: string, input: SopInput, userId: string): Promise<boolean> {
  return (await execute(
    'UPDATE seo_sops SET title = ?, category = ?, body_md = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [input.title, input.category, input.bodyMd, userId, id],
  )) > 0;
}

export async function deleteSop(id: string): Promise<boolean> {
  return (await execute('DELETE FROM seo_sops WHERE id = ?', [id])) > 0;
}
