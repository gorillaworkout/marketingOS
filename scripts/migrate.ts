import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { closeDb, execute, queryOne } from '../src/lib/database';

export async function migrate(seed = true) {
  await execute('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const migrationsDir = path.join(process.cwd(), 'db/migrations');
  const names = (await readdir(migrationsDir)).filter(name => name.endsWith('.sql')).sort();
  for (const name of names) {
    if (await queryOne('SELECT name FROM schema_migrations WHERE name = ?', [name])) continue;
    const sql = await readFile(path.join(migrationsDir, name), 'utf8');
    await execute(sql);
    await execute('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
  }
  const count = await queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
  if (seed && Number(count?.count ?? 0) === 0) {
    const general = await queryOne<{ id: string }>('SELECT id FROM departments WHERE name = ?', ['General']);
    for (const user of [
      ['admin', 'Admin Marketing', 'admin'], ['bayu', 'Bayu Darmawan', 'admin'],
      ['rina', 'Rina Marketing', 'member'], ['doni', 'Doni Creative', 'member'], ['sari', 'Sari Content', 'member'],
    ]) await execute('INSERT INTO users (id, username, name, password_hash, role, department_id) VALUES (?, ?, ?, ?, ?, ?)', [uuidv4(), user[0], user[1], await bcrypt.hash('marketing123', 10), user[2], user[2] === 'admin' ? null : general?.id || null]);
    console.log('Seeded 5 default users (password: marketing123).');
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  migrate().then(closeDb).catch(async error => { console.error(error); await closeDb(); process.exitCode = 1; });
}
