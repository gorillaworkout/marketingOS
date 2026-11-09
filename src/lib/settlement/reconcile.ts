/**
 * Daily reconciliation CRM vs MT5 for report date D: window (D−1 12:00, D 12:00] WIB.
 *  CRM deposits by completedAt (incl. Unsuccessful), CRM withdrawals by requestedAt.
 *  MT5 deals by occurredAt, kinds D / W / WC (WC counts as a deposit).
 */
import { RATES, inWindow, reconciliationWindow, wibDateOf, type Rate } from './conventions';
import type { CrmTransaction, Mt5Deal } from './types';

export interface RateLine { rate: Rate; deposit: number; withdrawal: number; total: number }
export interface DifferenceLine { label: 'Deposit Reject' | 'WD Reject' | 'WD-2' | 'CRM-WC'; side: 'deposit' | 'withdrawal'; amount: number; count: number }
export interface ReconciliationBlock {
  clients: { deposit: number; withdrawal: number; reject: number };
  byRate: RateLine[];
  unknownRate: { deposit: number; withdrawal: number };
  differences: DifferenceLine[];
  total: { deposit: number; withdrawal: number; net: number };
}
export interface MismatchItem { reference: string; accountNo: string; direction: 'deposit' | 'withdrawal'; at: string | null; crmAmount: number | null; mt5Amount: number | null; rate: Rate | null; reason: 'crm_only' | 'mt5_only' | 'amount_diff' | 'account_diff' }
export interface DailyReconciliation { date: string; window: { start: string; end: string; label: string }; crm: ReconciliationBlock; mt5: ReconciliationBlock; mismatches: MismatchItem[] }

const round2 = (value: number) => Math.round(value * 100) / 100;

/** CRM deposit amount in USD: Credited, else Transfer / rate (USD transfers as-is). */
export function crmDepositUsd(tx: CrmTransaction): number {
  if (tx.amountUsd !== null) return tx.amountUsd;
  if (tx.transferAmount === null) return 0;
  if (tx.transferCurrency === 'USD' || tx.rate === 1) return tx.transferAmount;
  return tx.rate ? tx.transferAmount / tx.rate : 0;
}

function emptyBlock(): ReconciliationBlock {
  return {
    clients: { deposit: 0, withdrawal: 0, reject: 0 },
    byRate: RATES.map(rate => ({ rate, deposit: 0, withdrawal: 0, total: 0 })),
    unknownRate: { deposit: 0, withdrawal: 0 }, differences: [], total: { deposit: 0, withdrawal: 0, net: 0 },
  };
}

function add(block: ReconciliationBlock, rate: Rate | null, side: 'deposit' | 'withdrawal', amount: number) {
  const line = block.byRate.find(l => l.rate === rate);
  if (line) line[side] += amount;
  else block.unknownRate[side] += amount;
}

function finish(block: ReconciliationBlock) {
  for (const line of block.byRate) { line.deposit = round2(line.deposit); line.withdrawal = round2(line.withdrawal); line.total = round2(line.deposit + line.withdrawal); }
  const sum = (side: 'deposit' | 'withdrawal') => block.byRate.reduce((acc, l) => acc + l[side], 0) + block.unknownRate[side];
  const diff = (side: 'deposit' | 'withdrawal') => block.differences.filter(d => d.side === side).reduce((acc, d) => acc + d.amount, 0);
  const deposit = round2(sum('deposit') - diff('deposit'));
  const withdrawal = round2(sum('withdrawal') - diff('withdrawal'));
  block.total = { deposit, withdrawal, net: round2(deposit + withdrawal) };
}

export function buildDailyReconciliation(date: string, deposits: CrmTransaction[], withdrawals: CrmTransaction[], deals: Mt5Deal[]): DailyReconciliation {
  const window = reconciliationWindow(date);
  const crm = emptyBlock();
  const dep = deposits.filter(tx => inWindow(tx.completedAt, window));
  const wd = withdrawals.filter(tx => inWindow(tx.requestedAt, window));
  let depReject = 0; let depRejectCount = 0; let wdReject = 0; let wdRejectCount = 0; let wd2 = 0; let wd2Count = 0;
  for (const tx of dep) {
    const usd = crmDepositUsd(tx);
    add(crm, tx.rate, 'deposit', usd);
    if (tx.status === 'Unsuccessful') { depReject += usd; depRejectCount += 1; }
  }
  for (const tx of wd) {
    const usd = -(tx.amountUsd ?? 0);
    add(crm, tx.rate, 'withdrawal', usd);
    if (tx.status === 'Unsuccessful') { wdReject += usd; wdRejectCount += 1; }
    if (tx.status === 'Successful' && tx.completedAt && wibDateOf(tx.completedAt) > date) { wd2 += usd; wd2Count += 1; }
  }
  crm.clients = { deposit: dep.length, withdrawal: wd.length, reject: depRejectCount + wdRejectCount };
  crm.differences = [
    { label: 'Deposit Reject', side: 'deposit', amount: round2(depReject), count: depRejectCount },
    { label: 'WD Reject', side: 'withdrawal', amount: round2(wdReject), count: wdRejectCount },
    { label: 'WD-2', side: 'withdrawal', amount: round2(wd2), count: wd2Count },
  ];
  finish(crm);

  const mt5 = emptyBlock();
  const windowDeals = deals.filter(d => (d.kind === 'D' || d.kind === 'W' || d.kind === 'WC') && inWindow(d.occurredAt, window));
  let wc = 0; let wcCount = 0;
  for (const d of windowDeals) {
    const side = d.amountUsd > 0 ? 'deposit' : 'withdrawal';
    add(mt5, d.rate, side, d.amountUsd);
    if (side === 'deposit') mt5.clients.deposit += 1; else mt5.clients.withdrawal += 1;
    if (d.kind === 'WC') { wc += d.amountUsd; wcCount += 1; }
  }
  mt5.clients.reject = wcCount;
  mt5.differences = [{ label: 'CRM-WC', side: 'deposit', amount: round2(wc), count: wcCount }];
  finish(mt5);

  return { date, window, crm, mt5, mismatches: findMismatches(dep, wd, windowDeals, deposits, withdrawals, deals) };
}

/**
 * Successful CRM rows in the window without an MT5 deal (any time, so a deal across the cut-off still matches),
 * MT5 D/W deals in the window without a CRM row, and matched pairs with different amount or account.
 */
export function findMismatches(dep: CrmTransaction[], wd: CrmTransaction[], windowDeals: Mt5Deal[], allDeposits: CrmTransaction[], allWithdrawals: CrmTransaction[], allDeals: Mt5Deal[]): MismatchItem[] {
  const dealByRef = new Map<string, Mt5Deal>();
  for (const d of allDeals) if ((d.kind === 'D' || d.kind === 'W') && d.crmReference) dealByRef.set(`${d.kind}:${d.crmReference}`, d);
  const depRefs = new Set(allDeposits.map(tx => tx.reference));
  const wdRefs = new Set(allWithdrawals.map(tx => tx.reference));
  const items: MismatchItem[] = [];
  const check = (tx: CrmTransaction, kind: 'D' | 'W') => {
    if (tx.status !== 'Successful') return;
    const deal = dealByRef.get(`${kind}:${tx.reference}`);
    const crmAmount = kind === 'D' ? crmDepositUsd(tx) : -(tx.amountUsd ?? 0);
    const base = { reference: tx.reference, accountNo: tx.accountNo, direction: tx.direction, at: kind === 'D' ? tx.completedAt : tx.requestedAt, crmAmount, rate: tx.rate };
    if (!deal) return void items.push({ ...base, mt5Amount: null, reason: 'crm_only' });
    if (deal.login !== tx.accountNo) items.push({ ...base, mt5Amount: deal.amountUsd, reason: 'account_diff' });
    else if (Math.abs(deal.amountUsd - crmAmount) > 0.01) items.push({ ...base, mt5Amount: deal.amountUsd, reason: 'amount_diff' });
  };
  dep.forEach(tx => check(tx, 'D'));
  wd.forEach(tx => check(tx, 'W'));
  for (const d of windowDeals) {
    if (!d.crmReference || d.kind === 'WC') continue;
    const known = d.kind === 'D' ? depRefs.has(d.crmReference) : wdRefs.has(d.crmReference);
    if (!known) items.push({ reference: d.crmReference, accountNo: d.login, direction: d.kind === 'D' ? 'deposit' : 'withdrawal', at: d.occurredAt, crmAmount: null, mt5Amount: d.amountUsd, rate: d.rate, reason: 'mt5_only' });
  }
  return items;
}
