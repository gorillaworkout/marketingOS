/** One-way, read-only SQLite importer. It never writes data/marketingos.db. */
import initSqlJs from 'sql.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { closeDb, execute } from '../src/lib/database';
import { migrate } from './migrate';

const tables = [
  'users', 'tasks', 'token_logs', 'assets', 'sessions', 'brand_guidelines', 'content_calendar', 'templates',
  'user_preferences', 'task_model_preferences', 'knowledge_entries', 'style_clusters', 'user_style_preferences',
  'global_style_profile', 'knowledge_edges', 'kanban_tasks',
];
const userScopedTables = ['tasks', 'token_logs', 'assets', 'sessions', 'brand_guidelines', 'content_calendar', 'templates', 'user_preferences', 'task_model_preferences', 'knowledge_entries', 'user_style_preferences', 'kanban_tasks'];
const taskScopedTables = ['token_logs', 'assets', 'content_calendar'];

type SQLiteTable = { columns: string[]; values: unknown[][] };

async function main() {
  const source = path.join(process.cwd(), 'data', 'marketingos.db');
  if (!existsSync(source)) throw new Error(`SQLite source does not exist: ${source}`);
  // Create the canonical schema without seeding users that would conflict with source IDs.
  await migrate(false);
  const SQL = await initSqlJs({ locateFile: file => path.join(process.cwd(), 'node_modules/sql.js/dist', file) });
  const sqlite = new SQL.Database(readFileSync(source));
  try {
    // Read the source once. No SQLite write APIs are called anywhere in this importer.
    const sourceTables = new Map<string, SQLiteTable>();
    for (const table of tables) {
      const result = sqlite.exec(`SELECT * FROM "${table}"`);
      if (result.length) sourceTables.set(table, result[0] as SQLiteTable);
    }

    // Some historical sql.js databases can contain rows whose owning user was later
    // removed while foreign keys were not enforced. Preserve those user_id values by
    // creating disabled placeholder accounts before importing dependent rows.
    const sourceUserIds = new Set((sourceTables.get('users')?.values ?? []).map(row => String(row[0])));
    const referencedUserIds = new Set<string>();
    for (const table of userScopedTables) {
      const data = sourceTables.get(table);
      const userIdIndex = data?.columns.indexOf('user_id') ?? -1;
      if (data && userIdIndex >= 0) for (const row of data.values) {
        if (row[userIdIndex] !== null && row[userIdIndex] !== undefined) referencedUserIds.add(String(row[userIdIndex]));
      }
    }

    const referencedTaskOwners = new Map<string, string>();
    for (const table of taskScopedTables) {
      const data = sourceTables.get(table);
      const taskIdIndex = data?.columns.indexOf('task_id') ?? -1;
      const userIdIndex = data?.columns.indexOf('user_id') ?? -1;
      if (data && taskIdIndex >= 0 && userIdIndex >= 0) for (const row of data.values) {
        if (row[taskIdIndex] !== null && row[taskIdIndex] !== undefined && row[userIdIndex] !== null && row[userIdIndex] !== undefined) {
          referencedTaskOwners.set(String(row[taskIdIndex]), String(row[userIdIndex]));
        }
      }
    }
    const sourceTaskData = sourceTables.get('tasks');
    const sourceTaskIdIndex = sourceTaskData?.columns.indexOf('id') ?? -1;
    const sourceTaskIds = new Set(sourceTaskData && sourceTaskIdIndex >= 0 ? sourceTaskData.values.map(row => String(row[sourceTaskIdIndex])) : []);

    for (const table of tables) {
      const data = sourceTables.get(table);
      if (!data) continue;
      const { columns, values } = data;
      const quoted = columns.map(column => `"${column}"`).join(', ');
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
      for (const row of values) {
        // SQLite stores timestamps as text; PostgreSQL accepts their ISO/SQLite representation.
        await execute(`INSERT INTO "${table}" (${quoted}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, row);
      }
      console.log(`Imported ${values.length} ${table} rows (existing rows skipped).`);

      if (table === 'users') {
        for (const userId of referencedUserIds) {
          if (sourceUserIds.has(userId)) continue;
          await execute(
            'INSERT INTO users (id, username, name, password_hash, role) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
            [userId, `legacy-${userId}`, 'Legacy migrated user', await bcrypt.hash(randomUUID(), 10), 'member'],
          );
        }
      }

      if (table === 'tasks') {
        for (const [taskId, userId] of referencedTaskOwners) {
          if (sourceTaskIds.has(taskId)) continue;
          await execute(
            'INSERT INTO tasks (id, user_id, type, title, status) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
            [taskId, userId, 'social-post', 'Legacy migrated task', 'archived'],
          );
        }
      }
    }
  } finally {
    sqlite.close();
    await closeDb();
  }
}
main().catch(async error => { console.error(error); await closeDb(); process.exitCode = 1; });
