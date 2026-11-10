/**
 * The single Withdrawal % definition. Bayu chose office-hour (Excel):
 * office ÷ total, office = total − 2nd withdrawal.
 * Changing the constant is the only switch; nothing else hard-codes a mode.
 */
export const WITHDRAWAL_PCT_MODES = ['office-hour', 'wd-over-dep', 'both'] as const;
export type WithdrawalPctMode = typeof WITHDRAWAL_PCT_MODES[number];
export const WITHDRAWAL_PCT_KPI: WithdrawalPctMode = 'office-hour';

export const WITHDRAWAL_PCT_LABEL = {
  'office-hour': 'Withdrawal % (office hour)',
  'wd-over-dep': 'Withdrawal % (of deposits)',
} as const;

const OFFICE_TEXT = 'Withdrawal % (office hour) = (total − 2nd withdrawal) ÷ total. A 2nd withdrawal is completed on a later WIB calendar day than it was requested. Same-day requests count in the numerator.';
const RATIO_TEXT = 'Withdrawal % (of deposits) = withdrawals ÷ deposits, in IDR.';

export function withdrawalPctMethodology(mode: WithdrawalPctMode = WITHDRAWAL_PCT_KPI): string {
  if (mode === 'office-hour') return OFFICE_TEXT;
  if (mode === 'wd-over-dep') return RATIO_TEXT;
  return `${OFFICE_TEXT} ${RATIO_TEXT}`;
}
