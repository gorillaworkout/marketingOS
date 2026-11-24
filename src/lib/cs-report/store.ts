/** PostgreSQL access for CS Report. SQL uses ? placeholders (converted by database.ts). */
import { v4 as uuidv4 } from 'uuid';
import { executeTransaction, queryAll, queryOne, execute, type DatabaseTransaction } from '@/lib/database';
import { COUNT_FIELDS } from './fields';
import { complaintDedupeKey, normalizeText } from './dedupe';
import type { Complaint, ComplaintInput, CsAgent, DailyEntry, DailyEntryInput, WeeklyNote } from './types';
import type { ParsedComplaint, ParsedEntry } from './parse';
import type { MappingUser } from './mapping';

type AgentRow = { id: string; display_name: string; user_id: string | null; aliases: string[] | null };
const toAgent = (row: AgentRow): CsAgent => ({ id: row.id, displayName: row.display_name, userId: row.user_id, aliases: row.aliases ?? [] });

const COUNT_COLUMNS = COUNT_FIELDS.map(field => field.column);

type EntryRow = Record<string, unknown> & {
  id: string; agent_id: string; agent_name: string; entry_date: string; status: DailyEntry['status']; unsolved_uids: string;
  follow_up_minutes: number; frequent_question: string; difficult_question: string; source: 'web' | 'upload'; updated_at: string | null;
};

function toEntry(row: EntryRow): DailyEntry {
  const entry = {
    id: row.id, agentId: row.agent_id, agentName: row.agent_name, date: row.entry_date, status: row.status,
    unsolvedUids: row.unsolved_uids, followUpMinutes: row.follow_up_minutes, frequentQuestion: row.frequent_question,
    difficultQuestion: row.difficult_question, source: row.source, updatedAt: row.updated_at,
  } as DailyEntry;
  for (const field of COUNT_FIELDS) {
    const v = row[field.column];
    entry[field.key] = v === null || v === undefined ? null : Number(v);
  }
  return entry;
}

type ComplaintRow = {
  id: string; agent_id: string | null; agent_name: string | null; complaint_date: string; client_name: string; uid: string; account: string;
  platform: string; description: string; cause: string; resolution: string; completion_date: string | null; status: string; sla_met: boolean | null;
  urgency: string; category: string; source: 'web' | 'upload'; created_by: string | null;
};

function toComplaint(row: ComplaintRow): Complaint {
  return {
    id: row.id, agentId: row.agent_id, agentName: row.agent_name, date: row.complaint_date, clientName: row.client_name, uid: row.uid,
    account: row.account, platform: row.platform, description: row.description, cause: row.cause, resolution: row.resolution,
    completionDate: row.completion_date, status: row.status, slaMet: row.sla_met, urgency: row.urgency, category: row.category,
    source: row.source, createdBy: row.created_by,
  };
}

const ENTRY_SELECT = `
  SELECT e.id, e.agent_id, a.display_name AS agent_name, to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date, e.status,
    ${COUNT_COLUMNS.map(c => `e.${c}`).join(', ')}, e.unsolved_uids, e.follow_up_minutes, e.frequent_question, e.difficult_question,
    e.source, e.updated_at::text AS updated_at
  FROM cs_daily_entries e JOIN cs_agents a ON a.id = e.agent_id`;

const COMPLAINT_SELECT = `
  SELECT c.id, c.agent_id, a.display_name AS agent_name, to_char(c.complaint_date, 'YYYY-MM-DD') AS complaint_date, c.client_name, c.uid,
    c.account, c.platform, c.description, c.cause, c.resolution, to_char(c.completion_date, 'YYYY-MM-DD') AS completion_date, c.status,
    c.sla_met, c.urgency, c.category, c.source, c.created_by
  FROM cs_complaints c LEFT JOIN cs_agents a ON a.id = c.agent_id`;

export async function listAgents(): Promise<CsAgent[]> {
  return (await queryAll<AgentRow>('SELECT id, display_name, user_id, aliases FROM cs_agents ORDER BY display_name')).map(toAgent);
}

export async function getAgent(id: string): Promise<CsAgent | null> {
  const row = await queryOne<AgentRow>('SELECT id, display_name, user_id, aliases FROM cs_agents WHERE id = ?', [id]);
  return row ? toAgent(row) : null;
}

export async function agentForUser(userId: string): Promise<CsAgent | null> {
  const row = await queryOne<AgentRow>('SELECT id, display_name, user_id, aliases FROM cs_agents WHERE user_id = ?', [userId]);
  return row ? toAgent(row) : null;
}

/** The agent row for a user, created on first use (display name = the user's name). */
export async function ensureAgentForUser(userId: string, tx?: DatabaseTransaction): Promise<CsAgent> {
  const db = tx ?? { queryOne, execute };
  const existing = await db.queryOne<AgentRow>('SELECT id, display_name, user_id, aliases FROM cs_agents WHERE user_id = ?', [userId]);
  if (existing) return toAgent(existing);
  const user = await db.queryOne<{ name: string }>('SELECT name FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error('User not found');
  const id = uuidv4();
  await db.execute('INSERT INTO cs_agents (id, display_name, user_id, aliases) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO NOTHING', [id, user.name, userId, [normalizeText(user.name)]]);
  const row = await db.queryOne<AgentRow>('SELECT id, display_name, user_id, aliases FROM cs_agents WHERE user_id = ?', [userId]);
  return toAgent(row!);
}

/** Users who can use CS Report through their department (for the agent pickers). Admins are not listed. */
export async function listCsUsers(): Promise<MappingUser[]> {
  return queryAll<MappingUser>(`
    SELECT u.id, u.name, u.username FROM users u JOIN departments d ON d.id = u.department_id
    WHERE 'cs-report' = ANY(d.permitted_features) ORDER BY u.name`);
}

export async function getUserBrief(userId: string): Promise<MappingUser | null> {
  return (await queryOne<MappingUser>('SELECT id, name, username FROM users WHERE id = ?', [userId])) ?? null;
}

export async function getEntry(agentId: string, date: string): Promise<DailyEntry | null> {
  const row = await queryOne<EntryRow>(`${ENTRY_SELECT} WHERE e.agent_id = ? AND e.entry_date = ?::date`, [agentId, date]);
  return row ? toEntry(row) : null;
}

export async function listEntries(from: string, to: string, agentId: string | null): Promise<DailyEntry[]> {
  const params: unknown[] = [from, to];
  let sql = `${ENTRY_SELECT} WHERE e.entry_date BETWEEN ?::date AND ?::date`;
  if (agentId) { sql += ' AND e.agent_id = ?'; params.push(agentId); }
  return (await queryAll<EntryRow>(`${sql} ORDER BY e.entry_date, a.display_name`, params)).map(toEntry);
}

/** Upsert one agent-day from the web form (one row per agent per date). */
export async function upsertEntry(agentId: string, input: DailyEntryInput, userId: string): Promise<DailyEntry> {
  const values = COUNT_FIELDS.map(field => input[field.key]);
  const columns = ['id', 'agent_id', 'entry_date', 'status', ...COUNT_COLUMNS, 'unsolved_uids', 'follow_up_minutes', 'frequent_question', 'difficult_question', 'source', 'created_by', 'updated_by'];
  const params = [uuidv4(), agentId, input.date, input.status, ...values, input.unsolvedUids, input.followUpMinutes, input.frequentQuestion, input.difficultQuestion, 'web', userId, userId];
  const updates = ['status', ...COUNT_COLUMNS, 'unsolved_uids', 'follow_up_minutes', 'frequent_question', 'difficult_question', 'updated_by']
    .map(c => `${c} = EXCLUDED.${c}`).join(', ');
  await execute(`INSERT INTO cs_daily_entries (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
    ON CONFLICT (agent_id, entry_date) DO UPDATE SET ${updates}, updated_at = CURRENT_TIMESTAMP`, params);
  return (await getEntry(agentId, input.date))!;
}

export async function listComplaints(from: string, to: string, agentId: string | null): Promise<Complaint[]> {
  const params: unknown[] = [from, to];
  let sql = `${COMPLAINT_SELECT} WHERE c.complaint_date BETWEEN ?::date AND ?::date`;
  if (agentId) { sql += ' AND c.agent_id = ?'; params.push(agentId); }
  return (await queryAll<ComplaintRow>(`${sql} ORDER BY c.complaint_date DESC, c.created_at DESC`, params)).map(toComplaint);
}

export async function getComplaint(id: string): Promise<Complaint | null> {
  const row = await queryOne<ComplaintRow>(`${COMPLAINT_SELECT} WHERE c.id = ?`, [id]);
  return row ? toComplaint(row) : null;
}

export class DuplicateComplaintError extends Error {
  constructor() { super('This complaint is already recorded (same date, UID, account and description).'); }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === '23505');
}

const COMPLAINT_COLUMNS = ['complaint_date', 'client_name', 'uid', 'account', 'platform', 'description', 'cause', 'resolution', 'completion_date', 'status', 'sla_met', 'urgency', 'category'];
const complaintValues = (c: ComplaintInput) => [c.date, c.clientName, c.uid, c.account, c.platform, c.description, c.cause, c.resolution, c.completionDate, c.status, c.slaMet, c.urgency, c.category];

export async function insertComplaint(agentId: string | null, input: ComplaintInput, userId: string): Promise<Complaint> {
  const id = uuidv4();
  try {
    await execute(`INSERT INTO cs_complaints (id, agent_id, ${COMPLAINT_COLUMNS.join(', ')}, dedupe_key, source, created_by, updated_by)
      VALUES (?, ?, ${COMPLAINT_COLUMNS.map(() => '?').join(', ')}, ?, 'web', ?, ?)`, [id, agentId, ...complaintValues(input), complaintDedupeKey(input), userId, userId]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateComplaintError();
    throw error;
  }
  return (await getComplaint(id))!;
}

export async function updateComplaint(id: string, input: ComplaintInput, userId: string): Promise<Complaint> {
  try {
    await execute(`UPDATE cs_complaints SET ${COMPLAINT_COLUMNS.map(c => `${c} = ?`).join(', ')}, dedupe_key = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...complaintValues(input), complaintDedupeKey(input), userId, id]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateComplaintError();
    throw error;
  }
  return (await getComplaint(id))!;
}

export async function deleteComplaint(id: string): Promise<void> {
  await execute('DELETE FROM cs_complaints WHERE id = ?', [id]);
}

export async function listNotes(from: string, to: string): Promise<WeeklyNote[]> {
  return queryAll<WeeklyNote>(`SELECT to_char(week_start, 'YYYY-MM-DD') AS "weekStart", to_char(week_end, 'YYYY-MM-DD') AS "weekEnd", channel,
    frequent_question AS "frequentQuestion", difficult_question AS "difficultQuestion"
    FROM cs_weekly_notes WHERE week_end >= ?::date AND week_start <= ?::date ORDER BY week_start, channel`, [from, to]);
}

/** Which parsed rows are already stored (for the preview). */
export async function existingKeys(agentKeys: Array<{ agentId: string; date: string }>, complaintKeys: string[], noteKeys: Array<{ weekStart: string; channel: string }>) {
  const entries = new Set<string>();
  if (agentKeys.length) {
    const rows = await queryAll<{ agent_id: string; d: string }>(`SELECT agent_id, to_char(entry_date, 'YYYY-MM-DD') AS d FROM cs_daily_entries
      WHERE agent_id = ANY(?::text[]) AND entry_date BETWEEN ?::date AND ?::date`,
    [[...new Set(agentKeys.map(k => k.agentId))], agentKeys.reduce((m, k) => (k.date < m ? k.date : m), agentKeys[0].date), agentKeys.reduce((m, k) => (k.date > m ? k.date : m), agentKeys[0].date)]);
    for (const row of rows) entries.add(`${row.agent_id}|${row.d}`);
  }
  const complaints = new Set<string>(complaintKeys.length
    ? (await queryAll<{ dedupe_key: string }>('SELECT dedupe_key FROM cs_complaints WHERE dedupe_key = ANY(?::text[])', [complaintKeys])).map(r => r.dedupe_key)
    : []);
  const notes = new Set<string>();
  if (noteKeys.length) {
    const rows = await queryAll<{ w: string; channel: string }>(`SELECT to_char(week_start, 'YYYY-MM-DD') AS w, channel FROM cs_weekly_notes WHERE week_start = ANY(?::date[])`, [[...new Set(noteKeys.map(k => k.weekStart))]]);
    for (const row of rows) notes.add(`${row.w}|${normalizeText(row.channel)}`);
  }
  return { entries, complaints, notes };
}

export interface CommitInput {
  fileName: string;
  userId: string;
  userName: string | null;
  sheets: number;
  warnings: string[];
  dateFrom: string | null;
  dateTo: string | null;
  /** Resolved agent per Excel name (already created or linked in the same transaction by the caller). */
  entries: Array<ParsedEntry & { agentId: string }>;
  complaints: ParsedComplaint[];
  notes: WeeklyNote[];
}

export interface CommitResult {
  uploadId: string;
  entries: { total: number; inserted: number; skipped: number };
  complaints: { total: number; inserted: number; skipped: number };
  notes: { total: number; inserted: number; skipped: number };
}

/** Resolves an Excel-name mapping to an agent id inside the commit transaction. */
export async function resolveAgent(tx: DatabaseTransaction, excelName: string, choice: string): Promise<string> {
  const alias = normalizeText(excelName);
  const addAlias = async (agentId: string) => {
    await tx.execute('UPDATE cs_agents SET aliases = array_append(aliases, ?::text), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND NOT (? = ANY(aliases))', [alias, agentId, alias]);
    return agentId;
  };
  if (choice.startsWith('agent:')) {
    const row = await tx.queryOne<{ id: string }>('SELECT id FROM cs_agents WHERE id = ?', [choice.slice(6)]);
    if (!row) throw new Error(`Agent for "${excelName}" no longer exists.`);
    return addAlias(row.id);
  }
  if (choice.startsWith('user:')) {
    const userId = choice.slice(5);
    const own = await tx.queryOne<{ id: string }>('SELECT id FROM cs_agents WHERE user_id = ?', [userId]);
    if (own) return addAlias(own.id);
    // A name-only agent with this alias: link it to the user instead of creating a second agent.
    const nameOnly = await tx.queryOne<{ id: string }>('SELECT id FROM cs_agents WHERE user_id IS NULL AND ? = ANY(aliases)', [alias]);
    if (nameOnly) {
      await tx.execute('UPDATE cs_agents SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [userId, nameOnly.id]);
      return nameOnly.id;
    }
    const agent = await ensureAgentForUser(userId, tx);
    return addAlias(agent.id);
  }
  const existing = await tx.queryOne<{ id: string }>('SELECT id FROM cs_agents WHERE ? = ANY(aliases) ORDER BY user_id NULLS LAST LIMIT 1', [alias]);
  if (existing) return existing.id;
  const id = uuidv4();
  await tx.execute('INSERT INTO cs_agents (id, display_name, user_id, aliases) VALUES (?, ?, NULL, ?)', [id, excelName.replace(/\s+/g, ' ').trim(), [alias]]);
  return id;
}

export async function commitUpload(input: Omit<CommitInput, 'entries'> & { entries: ParsedEntry[]; mapping: Record<string, string> }): Promise<CommitResult> {
  return executeTransaction(async tx => {
    const uploadId = uuidv4();
    await tx.execute(`INSERT INTO cs_report_uploads (id, file_name, uploaded_by, uploaded_by_name, sheets, warnings, data_from, data_to)
      VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::date, ?::date)`,
    [uploadId, input.fileName, input.userId, input.userName, input.sheets, JSON.stringify(input.warnings.slice(0, 200)), input.dateFrom, input.dateTo]);
    const agentIds = new Map<string, string>();
    for (const name of [...new Set(input.entries.map(e => e.name))]) agentIds.set(name, await resolveAgent(tx, name, input.mapping[name] ?? 'name'));

    let entriesInserted = 0;
    for (const entry of input.entries) {
      const params = [uuidv4(), agentIds.get(entry.name), entry.date, entry.status, ...COUNT_FIELDS.map(f => entry[f.key]), entry.followUpMinutes, 'upload', uploadId, input.userId, input.userId];
      entriesInserted += await tx.execute(`INSERT INTO cs_daily_entries (id, agent_id, entry_date, status, ${COUNT_COLUMNS.join(', ')}, follow_up_minutes, source, upload_id, created_by, updated_by)
        VALUES (${params.map(() => '?').join(', ')}) ON CONFLICT (agent_id, entry_date) DO NOTHING`, params);
    }
    let complaintsInserted = 0;
    for (const c of input.complaints) {
      complaintsInserted += await tx.execute(`INSERT INTO cs_complaints (id, agent_id, ${COMPLAINT_COLUMNS.join(', ')}, dedupe_key, source, upload_id, created_by, updated_by)
        VALUES (?, NULL, ${COMPLAINT_COLUMNS.map(() => '?').join(', ')}, ?, 'upload', ?, ?, ?) ON CONFLICT (dedupe_key) DO NOTHING`,
      [uuidv4(), ...complaintValues(c), c.dedupeKey, uploadId, input.userId, input.userId]);
    }
    let notesInserted = 0;
    for (const n of input.notes) {
      notesInserted += await tx.execute(`INSERT INTO cs_weekly_notes (id, week_start, week_end, channel, frequent_question, difficult_question, upload_id)
        VALUES (?, ?::date, ?::date, ?, ?, ?, ?) ON CONFLICT (week_start, channel) DO NOTHING`,
      [uuidv4(), n.weekStart, n.weekEnd, n.channel, n.frequentQuestion, n.difficultQuestion, uploadId]);
    }
    const result: CommitResult = {
      uploadId,
      entries: { total: input.entries.length, inserted: entriesInserted, skipped: input.entries.length - entriesInserted },
      complaints: { total: input.complaints.length, inserted: complaintsInserted, skipped: input.complaints.length - complaintsInserted },
      notes: { total: input.notes.length, inserted: notesInserted, skipped: input.notes.length - notesInserted },
    };
    await tx.execute(`UPDATE cs_report_uploads SET entries_total = ?, entries_inserted = ?, entries_skipped = ?, complaints_total = ?, complaints_inserted = ?,
      complaints_skipped = ?, notes_total = ?, notes_inserted = ?, notes_skipped = ? WHERE id = ?`,
    [result.entries.total, result.entries.inserted, result.entries.skipped, result.complaints.total, result.complaints.inserted, result.complaints.skipped,
      result.notes.total, result.notes.inserted, result.notes.skipped, uploadId]);
    return result;
  });
}

export interface UploadHistoryRow {
  id: string; fileName: string; uploadedByName: string | null; sheets: number; entriesTotal: number; entriesInserted: number; entriesSkipped: number;
  complaintsTotal: number; complaintsInserted: number; complaintsSkipped: number; notesInserted: number; notesSkipped: number;
  warnings: string[]; dataFrom: string | null; dataTo: string | null; createdAt: string;
}

export async function listUploads(limit = 50): Promise<UploadHistoryRow[]> {
  return queryAll<UploadHistoryRow>(`SELECT id, file_name AS "fileName", uploaded_by_name AS "uploadedByName", sheets, entries_total AS "entriesTotal",
    entries_inserted AS "entriesInserted", entries_skipped AS "entriesSkipped", complaints_total AS "complaintsTotal", complaints_inserted AS "complaintsInserted",
    complaints_skipped AS "complaintsSkipped", notes_inserted AS "notesInserted", notes_skipped AS "notesSkipped", warnings,
    to_char(data_from, 'YYYY-MM-DD') AS "dataFrom", to_char(data_to, 'YYYY-MM-DD') AS "dataTo", created_at::text AS "createdAt"
    FROM cs_report_uploads ORDER BY created_at DESC LIMIT ?`, [Math.min(Math.max(limit, 1), 200)]);
}
