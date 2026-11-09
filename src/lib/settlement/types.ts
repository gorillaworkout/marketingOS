import type { Mt5Kind } from './comment-parse';
import type { Rate } from './conventions';

export type CrmDirection = 'deposit' | 'withdrawal';

/** One CRM funds request (deposit or withdrawal). Times are ISO UTC. */
export interface CrmTransaction {
  direction: CrmDirection;
  reference: string;
  ticket: string | null;
  accountNo: string;
  uid: string | null;
  fundingMethod: string;
  requestedAt: string;
  completedAt: string | null;
  status: string;
  /** Deposit: Credited amount (USD). Withdrawal: Withdrawal amount (USD). */
  amountUsd: number | null;
  transferAmount: number | null;
  transferCurrency: string | null;
  rate: Rate | null;
  channel: string | null;
  paymentMethod: string | null;
  gatewayReference: string | null;
}

/** One MT5 balance deal from the "Deposit and Withdrawal" report. */
export interface Mt5Deal {
  deal: string;
  login: string;
  name: string | null;
  /** Server wall-clock "YYYY-MM-DD HH:MM:SS" (EET/EEST). */
  serverTime: string;
  occurredAt: string;
  comment: string | null;
  kind: Mt5Kind;
  crmReference: string | null;
  swapDate: string | null;
  amountUsd: number;
  currency: string | null;
  rate: Rate | null;
}

export interface ParseIssue { row: number; message: string }

export interface ParseSummary {
  rows: number;
  invalid: number;
  duplicatesInFile: number;
  unknownRate: number;
  byStatus: Record<string, number>;
  wibRange: { from: string; to: string } | null;
}

export interface ParseResult<T> { rows: T[]; issues: ParseIssue[]; errors: string[]; warnings: string[]; summary: ParseSummary }

export function emptySummary(): ParseSummary {
  return { rows: 0, invalid: 0, duplicatesInFile: 0, unknownRate: 0, byStatus: {}, wibRange: null };
}

export function widenRange(summary: ParseSummary, day: string) {
  if (!summary.wibRange) summary.wibRange = { from: day, to: day };
  else {
    if (day < summary.wibRange.from) summary.wibRange.from = day;
    if (day > summary.wibRange.to) summary.wibRange.to = day;
  }
}
