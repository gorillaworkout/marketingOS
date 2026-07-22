import bcrypt from 'bcryptjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { closeDb, execute, queryOne } from '../src/lib/database';

export async function migrate(seed = true) {
  await execute('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const name = '001_initial.sql';
  if (!await queryOne('SELECT name FROM schema_migrations WHERE name = ?', [name])) {
    const sql = await readFile(path.join(process.cwd(), 'db/migrations', name), 'utf8');
    await execute(sql);
    await execute('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
  }
  const count = await queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
  if (seed && Number(count?.count ?? 0) === 0) {
    for (const user of [
      ['admin', 'Admin Marketing', 'admin'], ['bayu', 'Bayu Darmawan', 'admin'],
      ['rina', 'Rina Marketing', 'member'], ['doni', 'Doni Creative', 'member'], ['sari', 'Sari Content', 'member'],
    ]) await execute('INSERT INTO users (id, username, name, password_hash, role) VALUES (?, ?, ?, ?, ?)', [uuidv4(), user[0], user[1], await bcrypt.hash('marketing123', 10), user[2]]);
    console.log('Seeded 5 default users (password: marketing123).');
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  migrate().then(closeDb).catch(async error => { console.error(error); await closeDb(); process.exitCode = 1; });
}
