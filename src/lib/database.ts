import { Pool, type QueryResultRow } from 'pg';

let pool: Pool | undefined;

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required to use the database. Run npm run db:migrate first.');
  return value;
}

/** Shared PostgreSQL pool. It is deliberately lazy so builds do not need a DB. */
export function getDb(): Pool {
  if (!pool) pool = new Pool({ connectionString: databaseUrl() });
  return pool;
}

/** Converts legacy positional ? placeholders to PostgreSQL $1, $2 placeholders. */
function postgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<T | undefined> {
  const result = await getDb().query<T>(postgresSql(sql), values);
  return result.rows[0];
}

export async function queryAll<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
  const result = await getDb().query<T>(postgresSql(sql), values);
  return result.rows;
}

export async function execute(sql: string, values: unknown[] = []): Promise<number> {
  const result = await getDb().query(postgresSql(sql), values);
  return result.rowCount ?? 0;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
