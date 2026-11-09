/** MT5 Deposit & Withdrawal comment → kind / CRM reference / swap date (SPEC §2). */
export type Mt5Kind = 'D' | 'W' | 'WC' | 'S' | 'SR' | 'TI' | 'TO' | 'AD' | 'OTHER';
export interface ParsedComment { kind: Mt5Kind; crmReference: string | null; swapDate: string | null }

export function parseMt5Comment(raw: unknown): ParsedComment {
  const comment = String(raw ?? '').trim();
  let match = /^CRM-(D|W|WC)-(\d+)/.exec(comment);
  if (match) return { kind: match[1] as Mt5Kind, crmReference: match[2], swapDate: null };
  match = /^CRM-S-\d+,(\d{2})(\d{2})(\d{2}),Swap/i.exec(comment);
  if (match) return { kind: 'S', crmReference: null, swapDate: `20${match[1]}-${match[2]}-${match[3]}` };
  if (/^CRM-S-/.test(comment)) return { kind: 'S', crmReference: null, swapDate: null };
  if (/^CRM-SR-/.test(comment)) return { kind: 'SR', crmReference: null, swapDate: null };
  if (/^CRM-TI-/.test(comment)) return { kind: 'TI', crmReference: null, swapDate: null };
  if (/^CRM-TO-/.test(comment)) return { kind: 'TO', crmReference: null, swapDate: null };
  if (/^CRM-AD-/.test(comment)) return { kind: 'AD', crmReference: null, swapDate: null };
  return { kind: 'OTHER', crmReference: null, swapDate: null };
}
