import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

/**
 * sql.js wrapper that exposes a better-sqlite3 compatible API so existing
 * routes don't need to change.
 */
class WrappedDb {
  private raw: any;

  constructor(raw: any) {
    this.raw = raw;
  }

  prepare(sql: string) {
    const rawStmt = this.raw.prepare(sql);
    const self = this;
    return {
      bind(params: unknown[] = []) {
        rawStmt.bind(params);
        return this;
      },
      step(): boolean {
        return rawStmt.step();
      },
      get(...params: unknown[]) {
        if (params.length) rawStmt.bind(params);
        if (rawStmt.step()) {
          const obj = rawStmt.getAsObject();
          rawStmt.free();
          return obj;
        }
        rawStmt.free();
        return undefined;
      },
      getAsObject() {
        return rawStmt.getAsObject();
      },
      all(...params: unknown[]) {
        if (params.length) rawStmt.bind(params);
        const rows: Record<string, unknown>[] = [];
        while (rawStmt.step()) {
          rows.push(rawStmt.getAsObject());
        }
        rawStmt.free();
        return rows;
      },
      run(...params: unknown[]) {
        if (params.length) rawStmt.bind(params);
        rawStmt.step();
        rawStmt.free();
        return { changes: self.raw.getRowsModified() };
      },
      free() {
        rawStmt.free();
      },
      getColumnNames() {
        return rawStmt.getColumnNames();
      },
    };
  }

  exec(sql: string) {
    return this.raw.exec(sql);
  }

  run(sql: string, params?: unknown[]) {
    if (params) {
      const stmt = this.raw.prepare(sql);
      stmt.bind(params);
      stmt.step();
      stmt.free();
    } else {
      this.raw.run(sql);
    }
    return { changes: this.raw.getRowsModified() };
  }

  pragma(pragma: string) {
    this.raw.run(`PRAGMA ${pragma}`);
  }

  export() {
    return this.raw.export();
  }
}

let db: WrappedDb | null = null;
let initPromise: Promise<WrappedDb> | null = null;

async function initializeDb(): Promise<WrappedDb> {
  const DB_PATH = path.join(process.cwd(), 'data', 'marketingos.db');
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const SQL = await initSqlJs({
    locateFile: (file: string) => path.join(process.cwd(), 'node_modules/sql.js/dist', file),
  });

  let rawDb;
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    rawDb = new SQL.Database(buffer);
  } else {
    rawDb = new SQL.Database();
  }

  db = new WrappedDb(rawDb);
  db.pragma('foreign_keys = ON');

  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, role TEXT DEFAULT 'member',
    last_active TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);

  // Migration: add last_active column if missing (existing databases)
  try {
    db.run("ALTER TABLE users ADD COLUMN last_active TEXT");
  } catch {
    // Column already exists — ignore
  }

  db.exec(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('social-post', 'video-script', 'event-plan')),
    title TEXT NOT NULL, brief TEXT,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'completed', 'archived')),
    output_data TEXT,
    rating INTEGER DEFAULT 0,
    feedback TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS token_logs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT,
    model TEXT NOT NULL, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
    cost REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (task_id) REFERENCES tasks(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY, task_id TEXT, user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('image', 'document', 'script', 'proposal')),
    file_path TEXT NOT NULL, original_name TEXT, mime_type TEXT, file_size INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id), FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS brand_guidelines (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    brand_name TEXT NOT NULL, tone_of_voice TEXT, target_market TEXT,
    key_messages TEXT, do_list TEXT DEFAULT '[]', dont_list TEXT DEFAULT '[]',
    examples TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS content_calendar (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT,
    platform TEXT, scheduled_date TEXT NOT NULL, scheduled_time TEXT,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'scheduled', 'published', 'cancelled')),
    notes TEXT, created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (task_id) REFERENCES tasks(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('social-post', 'video-script', 'event-plan')),
    platform TEXT, brief_template TEXT, output_template TEXT, tags TEXT,
    use_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS user_preferences (
    id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL,
    preferred_model TEXT DEFAULT 'deepseek/deepseek-v4-flash',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS task_model_preferences (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    task_type TEXT NOT NULL CHECK(task_type IN ('caption', 'image-prompt', 'video-script', 'event-plan')),
    model TEXT NOT NULL, provider TEXT DEFAULT 'openrouter',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, task_type),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // Knowledge Graph tables
  db.exec(`CREATE TABLE IF NOT EXISTS knowledge_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    task_type TEXT NOT NULL,
    brief TEXT NOT NULL,
    selected_output TEXT NOT NULL,
    rejected_outputs TEXT,
    style_cluster TEXT,
    platform TEXT,
    audience TEXT,
    embedding TEXT,
    quality_score REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS knowledge_edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relationship TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (source_id) REFERENCES knowledge_entries(id),
    FOREIGN KEY (target_id) REFERENCES knowledge_entries(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS style_clusters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    example_ids TEXT,
    centroid_embedding TEXT,
    entry_count INTEGER DEFAULT 0,
    last_analyzed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS user_style_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL,
    preferred_cluster TEXT,
    style_summary TEXT,
    tone_preferences TEXT,
    hook_preferences TEXT,
    platform_preferences TEXT,
    total_selections INTEGER DEFAULT 0,
    last_analyzed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS global_style_profile (
    id TEXT PRIMARY KEY,
    task_type TEXT UNIQUE NOT NULL,
    team_summary TEXT,
    top_examples TEXT,
    cluster_distribution TEXT,
    last_analyzed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  // Kanban tasks table
  db.exec(`CREATE TABLE IF NOT EXISTS kanban_tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    assignee TEXT,
    status TEXT DEFAULT 'ready' CHECK(status IN ('ready', 'running', 'blocked', 'completed', 'archived')),
    priority INTEGER DEFAULT 2,
    created_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    result TEXT
  )`);

  // Seed users
  const countResult = db.prepare('SELECT COUNT(*) as count FROM users').get() as Record<string, unknown>;
  const count = (countResult?.count as number) || 0;
  if (count === 0) {
    const defaultUsers = [
      { username: 'admin', name: 'Admin Marketing', role: 'admin' },
      { username: 'bayu', name: 'Bayu Darmawan', role: 'admin' },
      { username: 'rina', name: 'Rina Marketing', role: 'member' },
      { username: 'doni', name: 'Doni Creative', role: 'member' },
      { username: 'sari', name: 'Sari Content', role: 'member' },
    ];
    for (const user of defaultUsers) {
      const hash = bcrypt.hashSync('marketing123', 10);
      db.prepare('INSERT INTO users (id, username, name, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(
        uuidv4(), user.username, user.name, hash, user.role
      );
    }
    console.log('✅ 5 default users seeded (password: marketing123)');
  }

  saveDb();
  console.log('✅ Database ready');
  return db;
}

function saveDb() {
  if (!db) return;
  const DB_PATH = path.join(process.cwd(), 'data', 'marketingos.db');
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export async function getDb(): Promise<WrappedDb> {
  if (!initPromise) {
    initPromise = initializeDb();
  }
  return initPromise;
}

// Backward compat: some code uses getDbAsync
export { getDb as getDbAsync };

export function saveDbToDisk() {
  saveDb();
}
