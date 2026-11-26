/** Synthetic CS Report data (made-up agents, clients and UIDs) for the Word export tests and sample. */
import { COUNT_FIELDS } from '../../src/lib/cs-report/fields';
import { addDays } from '../../src/lib/cs-report/dates';
import type { Complaint, DailyEntry } from '../../src/lib/cs-report/types';
import type { WeeklyNote } from '../../src/lib/cs-report/types';

const AGENTS = [
  { id: 'agent-a', name: 'Alya Test' },
  { id: 'agent-b', name: 'Bima Test' },
  { id: 'agent-c', name: 'Citra Test' },
];
const QUESTIONS = ['How do I verify my account?', 'When will my withdrawal arrive?', 'How do I reset my MT5 password?', 'What is the minimum deposit?'];
const DIFFICULT = ['Why was my order closed by stop out?', 'Swap was charged on a swap-free account', 'Bonus was not credited after deposit'];

/** Deterministic pseudo-random 0..max. */
function n(seed: number, max: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return Math.floor((x - Math.floor(x)) * (max + 1));
}

export function syntheticEntries(from = '2026-10-01', to = '2026-10-31'): DailyEntry[] {
  const out: DailyEntry[] = [];
  let seed = 1;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 0) continue;
    AGENTS.forEach(agent => {
      seed += 1;
      const status = n(seed, 40) === 0 ? 'sick' : n(seed + 7, 45) === 0 ? 'annual_leave' : 'present';
      const counts = Object.fromEntries(COUNT_FIELDS.map((f, j) => [f.key, status === 'present' ? n(seed * 31 + j, j < 5 ? 25 : 6) : null])) as Record<string, number | null>;
      if (status === 'present' && n(seed, 3) === 0) counts.socialMediaReception = null; // left blank = 0
      out.push({
        id: `${agent.id}-${date}`, agentId: agent.id, agentName: agent.name, date, status,
        unsolvedUids: status === 'present' && (counts.unsolvedIssues ?? 0) > 3 ? `UID-${100000 + seed}` : '',
        followUpMinutes: 4,
        frequentQuestion: status === 'present' && n(seed, 4) === 0 ? QUESTIONS[n(seed * 7 + 11, QUESTIONS.length - 1)] : '',
        difficultQuestion: status === 'present' && n(seed + 3, 6) === 0 ? DIFFICULT[n(seed * 13 + 5, DIFFICULT.length - 1)] : '',
        source: 'web', updatedAt: null, updatedByName: null, ...counts,
      } as DailyEntry);
    });
  }
  return out;
}

export function syntheticComplaints(): Complaint[] {
  const base = { account: '9000001', cause: 'Synthetic cause', resolution: 'Synthetic resolution', source: 'web' as const, createdBy: null, updatedAt: null, updatedByName: null };
  const rows: Array<[string, string, string, string, string, string, string | null, boolean | null, string | null]> = [
    ['2026-10-02', 'Client One', 'Deposit/Withdraw', 'High', 'Solved', 'Withdrawal pending for 2 days', '2026-10-03', true, 'agent-a'],
    ['2026-10-06', 'Client Two', 'Account Problem', 'Medium', 'Solved', 'Cannot log in after KYC', '2026-10-06', null, null],
    ['2026-10-09', 'Client Three', 'Orders and Transactions', 'High', 'Solved', 'Order executed at a different price', '2026-10-13', false, 'agent-b'],
    ['2026-10-15', 'Client Four', 'Deposit/Withdraw', 'Low', 'On Progress', 'Deposit not reflected in balance', null, null, 'agent-c'],
    ['2026-10-21', 'Client Five', 'APP & ActsTrade & MT5', 'Medium', 'Solved', 'App crashes on chart screen', '2026-10-22', true, 'agent-a'],
    ['2026-10-28', 'Client Six', 'Reward Program', 'Low', 'On Hold', 'Reward points missing', null, null, 'agent-b'],
  ];
  return rows.map(([date, clientName, category, urgency, status, description, completionDate, slaMet, agentId], i) => ({
    ...base, id: `c-${i}`, date, clientName, uid: `UID-${200000 + i}`, platform: i % 2 ? 'Apps' : 'MT5', category, urgency, status, description, completionDate, slaMet,
    agentId, agentName: AGENTS.find(a => a.id === agentId)?.name ?? null,
  }));
}

export function syntheticNotes(): WeeklyNote[] {
  return [{ weekStart: '2026-10-05', weekEnd: '2026-10-11', channel: 'CRM/IM', frequentQuestion: 'How long does a withdrawal take?', difficultQuestion: 'Margin call on a hedged position' }];
}
