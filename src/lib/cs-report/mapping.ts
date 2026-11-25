/** Excel name → CS agent / user suggestion for the bulk upload preview (pure). */
import { normalizeText } from './dedupe';
import type { CsAgent } from './types';

export interface MappingUser { id: string; name: string; username: string }

export type NameTarget =
  | { kind: 'agent'; agentId: string; label: string } // existing agent (by alias)
  | { kind: 'user'; userId: string; label: string } // link to a user account
  | { kind: 'name'; label: string }; // keep as a name-only agent

export interface NameSuggestion { excelName: string; target: NameTarget; reason: 'alias' | 'exact' | 'first-name' | 'none' }

function firstToken(value: string): string {
  return normalizeText(value).split(' ')[0] ?? '';
}

export function suggestMappings(excelNames: string[], agents: CsAgent[], allUsers: MappingUser[]): NameSuggestion[] {
  // Users who already have an agent are matched through that agent's aliases only.
  const linked = new Set(agents.map(a => a.userId).filter(Boolean));
  const users = allUsers.filter(u => !linked.has(u.id));
  return excelNames.map(excelName => {
    const norm = normalizeText(excelName);
    const agent = agents.find(a => a.aliases.includes(norm) || normalizeText(a.displayName) === norm);
    if (agent) return { excelName, target: { kind: 'agent', agentId: agent.id, label: agent.displayName }, reason: 'alias' };
    const exact = users.find(u => normalizeText(u.name) === norm || normalizeText(u.username) === norm);
    if (exact) return { excelName, target: { kind: 'user', userId: exact.id, label: exact.name }, reason: 'exact' };
    const first = firstToken(excelName);
    const byFirst = first.length >= 3 ? users.filter(u => firstToken(u.name) === first || normalizeText(u.username) === first) : [];
    if (byFirst.length === 1) return { excelName, target: { kind: 'user', userId: byFirst[0].id, label: byFirst[0].name }, reason: 'first-name' };
    return { excelName, target: { kind: 'name', label: excelName }, reason: 'none' };
  });
}

/** Mapping chosen in the preview, sent back on commit: Excel name → 'agent:<id>' | 'user:<id>' | 'name'. */
export type MappingChoice = Record<string, string>;

export function parseMappingChoice(raw: unknown): MappingChoice | { error: string } {
  if (raw === null || raw === undefined || raw === '') return {};
  let value: unknown = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch { return { error: 'The name mapping is not valid JSON.' }; } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'The name mapping must be an object.' };
  const out: MappingChoice = {};
  for (const [name, choice] of Object.entries(value as Record<string, unknown>)) {
    if (typeof choice !== 'string' || !/^(name|agent:[\w-]{1,80}|user:[\w-]{1,80})$/.test(choice)) return { error: `Invalid mapping for "${name}".` };
    out[name] = choice;
  }
  return out;
}
