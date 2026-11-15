/** Saved proposals, their version history, and admin proposal settings (PostgreSQL). Server only. */
import { randomUUID } from 'node:crypto';
import { executeTransaction, execute, queryAll, queryOne } from '@/lib/database';
import { computeTotals, parseProposalContent, type ProposalContent, type ProposalInput } from './proposal';
import { settingsOrDefault, type ProposalSettings } from './proposal-settings';

export type ProposalStatus = 'draft' | 'final';

export interface ProposalSummary {
  id: string;
  partnerName: string;
  template: 'slide' | 'document';
  language: 'id' | 'en';
  status: ProposalStatus;
  version: number;
  packageTotal: number;
  hasLogo: boolean;
  createdBy: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProposalRecord extends ProposalSummary {
  input: ProposalInput;
  content: ProposalContent;
  partnerLogo: string | null;
  model: string | null;
}

export interface ProposalVersionSummary {
  id: string;
  version: number;
  note: string;
  createdByName: string | null;
  createdAt: string;
}

function asJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

const str = (value: unknown) => (value === null || value === undefined ? null : String(value));
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value));

const SUMMARY_COLUMNS = `p.id, p.partner_name, p.template, p.language, p.status, p.version, p.input, (p.partner_logo IS NOT NULL) AS has_logo,
  p.created_by, cu.name AS created_by_name, uu.name AS updated_by_name, p.created_at, p.updated_at`;
const JOINS = `FROM partnership_proposals p LEFT JOIN users cu ON cu.id = p.created_by LEFT JOIN users uu ON uu.id = p.updated_by`;

function mapSummary(row: Record<string, unknown>): ProposalSummary {
  const input = asJson<ProposalInput>(row.input);
  return {
    id: String(row.id),
    partnerName: String(row.partner_name),
    template: row.template === 'document' ? 'document' : 'slide',
    language: row.language === 'en' ? 'en' : 'id',
    status: row.status === 'final' ? 'final' : 'draft',
    version: Number(row.version) || 1,
    packageTotal: computeTotals(input).packageTotal,
    hasLogo: row.has_logo === true,
    createdBy: str(row.created_by),
    createdByName: str(row.created_by_name),
    updatedByName: str(row.updated_by_name),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function getProposalSettings(): Promise<{ settings: ProposalSettings; updatedAt: string | null; updatedByName: string | null }> {
  const row = await queryOne(`SELECT s.value, s.updated_at, u.name AS updated_by_name FROM partnership_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.key = 'proposal'`);
  return { settings: settingsOrDefault(row ? asJson(row.value) : null), updatedAt: row ? iso(row.updated_at) : null, updatedByName: row ? str(row.updated_by_name) : null };
}

export async function saveProposalSettings(settings: ProposalSettings, userId: string): Promise<void> {
  await execute(
    `INSERT INTO partnership_settings (key, value, updated_by, updated_at) VALUES ('proposal', ?::jsonb, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [JSON.stringify(settings), userId],
  );
}

export async function resetProposalSettings(): Promise<void> {
  await execute(`DELETE FROM partnership_settings WHERE key = 'proposal'`);
}

export async function listProposals(limit = 200): Promise<ProposalSummary[]> {
  const rows = await queryAll(`SELECT ${SUMMARY_COLUMNS} ${JOINS} ORDER BY p.updated_at DESC LIMIT ?`, [limit]);
  return rows.map(mapSummary);
}

export async function getProposal(id: string): Promise<ProposalRecord | undefined> {
  const row = await queryOne(`SELECT ${SUMMARY_COLUMNS}, p.content, p.partner_logo, p.model ${JOINS} WHERE p.id = ?`, [id]);
  if (!row) return undefined;
  const input = asJson<ProposalInput>(row.input);
  return { ...mapSummary(row), input, content: parseProposalContent(asJson(row.content), input), partnerLogo: str(row.partner_logo), model: str(row.model) };
}

export interface ProposalWrite {
  input: ProposalInput;
  content: ProposalContent;
  partnerLogo: string | null;
  status: ProposalStatus;
  model?: string | null;
  note: string;
}

export async function createProposal(write: ProposalWrite, userId: string): Promise<string> {
  const id = randomUUID();
  await executeTransaction(async tx => {
    await tx.execute(
      `INSERT INTO partnership_proposals (id, partner_name, template, language, status, input, content, partner_logo, model, version, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, 1, ?, ?)`,
      [id, write.input.partnerName, write.input.template, write.input.language, write.status, JSON.stringify(write.input), JSON.stringify(write.content), write.partnerLogo, write.model ?? null, userId, userId],
    );
    await tx.execute(
      `INSERT INTO partnership_proposal_versions (id, proposal_id, version, input, content, note, created_by) VALUES (?, ?, 1, ?::jsonb, ?::jsonb, ?, ?)`,
      [randomUUID(), id, JSON.stringify(write.input), JSON.stringify(write.content), write.note.slice(0, 200), userId],
    );
  });
  return id;
}

/** Saves a new version. Returns the new version number, or null if the proposal is gone. */
export async function updateProposal(id: string, write: ProposalWrite, userId: string): Promise<number | null> {
  return executeTransaction(async tx => {
    const current = await tx.queryOne<{ version: number }>(`SELECT version FROM partnership_proposals WHERE id = ? FOR UPDATE`, [id]);
    if (!current) return null;
    const version = Number(current.version) + 1;
    await tx.execute(
      `UPDATE partnership_proposals SET partner_name = ?, template = ?, language = ?, status = ?, input = ?::jsonb, content = ?::jsonb, partner_logo = ?,
         model = COALESCE(?, model), version = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [write.input.partnerName, write.input.template, write.input.language, write.status, JSON.stringify(write.input), JSON.stringify(write.content), write.partnerLogo, write.model ?? null, version, userId, id],
    );
    await tx.execute(
      `INSERT INTO partnership_proposal_versions (id, proposal_id, version, input, content, note, created_by) VALUES (?, ?, ?, ?::jsonb, ?::jsonb, ?, ?)`,
      [randomUUID(), id, version, JSON.stringify(write.input), JSON.stringify(write.content), write.note.slice(0, 200), userId],
    );
    return version;
  });
}

export async function deleteProposal(id: string): Promise<void> {
  await execute(`DELETE FROM partnership_proposals WHERE id = ?`, [id]);
}

export async function listVersions(proposalId: string, limit = 30): Promise<ProposalVersionSummary[]> {
  const rows = await queryAll(
    `SELECT v.id, v.version, v.note, u.name AS created_by_name, v.created_at FROM partnership_proposal_versions v
     LEFT JOIN users u ON u.id = v.created_by WHERE v.proposal_id = ? ORDER BY v.version DESC LIMIT ?`,
    [proposalId, limit],
  );
  return rows.map(row => ({ id: String(row.id), version: Number(row.version), note: String(row.note || ''), createdByName: str(row.created_by_name), createdAt: iso(row.created_at) }));
}

export async function getVersion(proposalId: string, versionId: string): Promise<{ version: number; input: ProposalInput; content: ProposalContent } | undefined> {
  const row = await queryOne(`SELECT version, input, content FROM partnership_proposal_versions WHERE proposal_id = ? AND id = ?`, [proposalId, versionId]);
  if (!row) return undefined;
  const input = asJson<ProposalInput>(row.input);
  return { version: Number(row.version), input, content: parseProposalContent(asJson(row.content), input) };
}
