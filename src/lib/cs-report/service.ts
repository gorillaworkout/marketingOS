/** CS Report service: ties the parser, the store and the dashboard together. */
import { parseCsWorkbook, type ParsedWorkbook } from './parse';
import { suggestMappings, type MappingChoice, type NameSuggestion } from './mapping';
import { buildCsDashboard, type CsDashboard } from './metrics';
import { buildCsWorkbook } from './export';
import { buildCsDocx, csDocxFileName } from './docx-export';
import type { PeriodKind } from './dates';
import { normalizeText } from './dedupe';
import * as store from './store';

export interface UploadPreview {
  fileName: string;
  sheets: ParsedWorkbook['sheets'];
  warnings: string[];
  dateFrom: string | null;
  dateTo: string | null;
  names: NameSuggestion[];
  users: Array<{ id: string; name: string; username: string }>;
  agents: Array<{ id: string; displayName: string; linked: boolean }>;
  totals: {
    entries: number; entriesNew: number; entriesExisting: number;
    complaints: number; complaintsNew: number; complaintsExisting: number;
    notes: number; notesNew: number; notesExisting: number;
    sickDays: number; annualLeaveDays: number;
  };
}

/** Agent id per Excel name for the preview (only names that already resolve to an agent). */
function previewAgentIds(suggestions: NameSuggestion[], agentsByUser: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of suggestions) {
    if (s.target.kind === 'agent') out.set(s.excelName, s.target.agentId);
    else if (s.target.kind === 'user' && agentsByUser.has(s.target.userId)) out.set(s.excelName, agentsByUser.get(s.target.userId)!);
  }
  return out;
}

export async function previewUpload(buffer: Buffer, fileName: string): Promise<UploadPreview> {
  const parsed = await parseCsWorkbook(buffer);
  const [agents, users] = await Promise.all([store.listAgents(), store.listCsUsers()]);
  const names = suggestMappings(parsed.names, agents, users);
  const agentsByUser = new Map(agents.filter(a => a.userId).map(a => [a.userId!, a.id]));
  const ids = previewAgentIds(names, agentsByUser);
  const agentKeys = parsed.entries.filter(e => ids.has(e.name)).map(e => ({ agentId: ids.get(e.name)!, date: e.date }));
  const existing = await store.existingKeys(agentKeys, parsed.complaints.map(c => c.dedupeKey), parsed.notes.map(n => ({ weekStart: n.weekStart, channel: n.channel })));
  const entriesExisting = parsed.entries.filter(e => ids.has(e.name) && existing.entries.has(`${ids.get(e.name)}|${e.date}`)).length;
  const complaintsExisting = parsed.complaints.filter(c => existing.complaints.has(c.dedupeKey)).length;
  const notesExisting = parsed.notes.filter(n => existing.notes.has(`${n.weekStart}|${normalizeText(n.channel)}`)).length;
  return {
    fileName,
    sheets: parsed.sheets,
    warnings: parsed.warnings,
    dateFrom: parsed.dateFrom,
    dateTo: parsed.dateTo,
    names,
    users,
    agents: agents.map(a => ({ id: a.id, displayName: a.displayName, linked: Boolean(a.userId) })),
    totals: {
      entries: parsed.entries.length, entriesNew: parsed.entries.length - entriesExisting, entriesExisting,
      complaints: parsed.complaints.length, complaintsNew: parsed.complaints.length - complaintsExisting, complaintsExisting,
      notes: parsed.notes.length, notesNew: parsed.notes.length - notesExisting, notesExisting,
      sickDays: parsed.sheets.reduce((sum, s) => sum + s.sickDays, 0),
      annualLeaveDays: parsed.sheets.reduce((sum, s) => sum + s.annualLeaveDays, 0),
    },
  };
}

export class UploadInputError extends Error {}

export async function commitUploadFile(buffer: Buffer, fileName: string, mapping: MappingChoice, user: { id: string; name: string | null }): Promise<store.CommitResult> {
  const parsed = await parseCsWorkbook(buffer);
  if (!parsed.entries.length && !parsed.complaints.length && !parsed.notes.length) throw new UploadInputError('Nothing to import: no Weekly Work List, Notes or Report Complaint rows were found.');
  const [agents, users] = await Promise.all([store.listAgents(), store.listCsUsers()]);
  const suggestions = suggestMappings(parsed.names, agents, users);
  const allowedUsers = new Set(users.map(u => u.id));
  const allowedAgents = new Set(agents.map(a => a.id));
  const resolved: Record<string, string> = {};
  for (const s of suggestions) {
    const choice = mapping[s.excelName]
      ?? (s.target.kind === 'agent' ? `agent:${s.target.agentId}` : s.target.kind === 'user' ? `user:${s.target.userId}` : 'name');
    if (choice.startsWith('user:') && !allowedUsers.has(choice.slice(5))) throw new UploadInputError(`"${s.excelName}" is mapped to a user who does not have CS Report access.`);
    if (choice.startsWith('agent:') && !allowedAgents.has(choice.slice(6))) throw new UploadInputError(`"${s.excelName}" is mapped to an unknown agent.`);
    resolved[s.excelName] = choice;
  }
  return store.commitUpload({
    fileName, userId: user.id, userName: user.name, sheets: parsed.sheets.length, warnings: parsed.warnings,
    dateFrom: parsed.dateFrom, dateTo: parsed.dateTo, entries: parsed.entries, complaints: parsed.complaints, notes: parsed.notes, mapping: resolved,
  });
}

export async function getDashboard(from: string, to: string, agentId: string | null): Promise<CsDashboard> {
  const [entries, complaints, notes] = await Promise.all([
    store.listEntries(from, to, agentId),
    store.listComplaints(from, to, agentId),
    store.listNotes(from, to),
  ]);
  return buildCsDashboard({ from, to, entries, complaints, notes });
}

export async function exportWorkbook(from: string, to: string, agentId: string | null): Promise<{ buffer: Buffer; filename: string }> {
  const [entries, complaints, notes] = await Promise.all([
    store.listEntries(from, to, agentId),
    store.listComplaints(from, to, agentId),
    store.listNotes(from, to),
  ]);
  const buffer = await buildCsWorkbook({ entries, complaints, notes });
  return { buffer, filename: `cs-report-${from}-to-${to}.xlsx` };
}

/** Word report for the same period and agent filter as the dashboard (figures from getDashboard). */
export async function exportDocx(from: string, to: string, agentId: string | null, kind: PeriodKind): Promise<{ buffer: Buffer; filename: string }> {
  const [dashboard, agent] = await Promise.all([getDashboard(from, to, agentId), agentId ? store.getAgent(agentId) : Promise.resolve(null)]);
  const agentName = agent?.displayName ?? null;
  const generatedAt = `${new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')} WIB`;
  const buffer = await buildCsDocx(dashboard, { kind, agentName, generatedAt });
  return { buffer, filename: csDocxFileName(dashboard, { kind, agentName }) };
}
