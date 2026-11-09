/**
 * Settlement upload: detect → parse → preview (counts, new/existing, masked sample) or commit (upsert + history row).
 * One handler for all four kinds; called by POST /api/settlement-report/uploads.
 */
import { NextResponse } from 'next/server';
import type { AuthorizedUser } from '@/lib/auth';
import { maskIdentifier } from '@/lib/monthly-report/metrics';
import { uploadActor } from '@/lib/monthly-report/service';
import { parseCrmDeposits, parseCrmWithdrawals } from './crm-parse';
import { SETTLEMENT_KIND_LABELS, detectSettlementKind, type SettlementUploadKind } from './detect';
import { parseSettlementFtd } from './ftd-parse';
import { parseMt5DepositWithdrawal } from './mt5-parse';
import { FTD_PLAN, MT5_PLAN, countStoredKeys, crmPlan, saveCrmTransactions, saveMt5Deals, saveSettlementFtd, type SaveMeta } from './store';
import type { ParseResult } from './types';

export const SETTLEMENT_EXPECTED_FILES = [
  'CRM deposit report (Reports_funds_deposit_*.xlsx, sheet "Report")',
  'CRM withdrawal report (Reports_funds_withdrawal_*.xlsx, sheet "Report")',
  'MT5 "Deposit and Withdrawal Report" text export (.csv, UTF-16)',
  'Dealing FTD list (FTD <Bulan> <Tahun>.xlsx: Login, Type, FTD Time, Balance)',
];

type AnyRow = { reference?: string; accountNo?: string | null; deal?: string; login?: string | null; name?: string | null; uid?: string | null };

/** Masks personal identifiers in the preview sample (account, login, uid, name). */
export function maskSample(rows: AnyRow[]): AnyRow[] {
  return rows.slice(0, 8).map(row => ({
    ...row,
    ...(row.accountNo !== undefined ? { accountNo: maskIdentifier(row.accountNo) } : {}),
    ...(row.login !== undefined ? { login: maskIdentifier(row.login) } : {}),
    ...(row.uid ? { uid: maskIdentifier(row.uid) } : {}),
    ...(row.name ? { name: maskIdentifier(row.name) } : {}),
  }));
}

export function parseForKind(kind: SettlementUploadKind, body: Buffer): ParseResult<AnyRow> {
  switch (kind) {
    case 'settlement_crm_deposit': return parseCrmDeposits(body);
    case 'settlement_crm_withdrawal': return parseCrmWithdrawals(body);
    case 'settlement_mt5_dw': return parseMt5DepositWithdrawal(body);
    case 'settlement_ftd': return parseSettlementFtd(body);
  }
}

function planFor(kind: SettlementUploadKind) {
  if (kind === 'settlement_crm_deposit') return crmPlan('deposit');
  if (kind === 'settlement_crm_withdrawal') return crmPlan('withdrawal');
  return kind === 'settlement_mt5_dw' ? MT5_PLAN : FTD_PLAN;
}

async function save(kind: SettlementUploadKind, parsed: ParseResult<AnyRow>, meta: SaveMeta) {
  const rows = parsed.rows as never[];
  if (kind === 'settlement_crm_deposit') return saveCrmTransactions('deposit', rows, meta);
  if (kind === 'settlement_crm_withdrawal') return saveCrmTransactions('withdrawal', rows, meta);
  if (kind === 'settlement_mt5_dw') return saveMt5Deals(rows, meta);
  return saveSettlementFtd(rows, meta);
}

export async function handleSettlementUpload(user: AuthorizedUser, body: Buffer, params: URLSearchParams) {
  const fileName = (params.get('fileName') || 'settlement-upload').slice(0, 200);
  const commit = params.get('mode') === 'commit';
  const kind = detectSettlementKind(body);
  if (!kind) {
    return NextResponse.json({ ok: false, detectedKind: null, error: 'This file is not a Settlement export.', expected: SETTLEMENT_EXPECTED_FILES }, { status: 400 });
  }
  const expect = params.get('expect');
  if (commit && expect && expect !== kind) {
    return NextResponse.json({ ok: false, detectedKind: kind, error: `The file was detected as ${SETTLEMENT_KIND_LABELS[kind]}, not ${expect}. Preview it again.` }, { status: 409 });
  }
  let parsed: ParseResult<AnyRow>;
  try {
    parsed = parseForKind(kind, body);
  } catch (error) {
    return NextResponse.json({ ok: false, detectedKind: kind, error: `Could not read the file: ${error instanceof Error ? error.message : 'unknown error'}` }, { status: 400 });
  }
  const base = {
    detectedKind: kind, detectedLabel: SETTLEMENT_KIND_LABELS[kind], fileName,
    errors: parsed.errors, warnings: parsed.warnings, issues: parsed.issues.slice(0, 50), issueCount: parsed.issues.length, summary: parsed.summary,
  };
  if (parsed.errors.length) return NextResponse.json({ ...base, ok: false }, { status: commit ? 400 : 200 });
  if (!parsed.rows.length) return NextResponse.json({ ...base, ok: false, errors: ['The file has no valid rows'] }, { status: commit ? 400 : 200 });
  if (!commit) {
    const plan = planFor(kind) as { table: string; key: string; keyOf: (row: never) => string };
    const existing = await countStoredKeys(plan.table, plan.key, parsed.rows.map(row => plan.keyOf(row as never)));
    return NextResponse.json({ ...base, ok: true, conflicts: { new: parsed.rows.length - existing, existing }, sample: maskSample(parsed.rows) });
  }
  const saved = await save(kind, parsed, { fileName, actor: await uploadActor(user), skipped: parsed.issues.length, range: parsed.summary.wibRange });
  return NextResponse.json({ ...base, ok: true, uploadId: saved.uploadId, counts: saved.counts });
}
