/**
 * Upload handlers shared by the type-specific routes (/uploads/onboarding,
 * /uploads/ftd) and the auto-detect route (/uploads/auto). Each takes the
 * already-authorized user and the raw file body.
 * mode=preview (default) validates and compares with stored rows;
 * mode=commit writes them and records an upload history row (with the WIB data range).
 */
import { NextResponse } from 'next/server';
import type { AuthorizedUser } from '@/lib/auth';
import { classifyConflicts } from './conflicts';
import { parseFtdFile } from './ftd-parse';
import { maskIdentifier } from './metrics';
import { parseOnboardingWorkbook } from './onboarding-parse';
import { parseOnboardingSummary } from './summary-parse';
import { DEPOSIT_ROBOT, parseUserApproved } from './user-approved-parse';
import { uploadActor } from './service';
import {
  countStoredFtd, loadStoredEvents, saveFtd, saveOnboardingEvents, saveOnboardingSummary, saveUserApproved,
} from './store';
import { resolveUploadOffset } from './upload-offset';

type Extra = Record<string, unknown>;

function readError(error: unknown) {
  return NextResponse.json({ error: `Could not read the file: ${error instanceof Error ? error.message : 'unknown error'}` }, { status: 400 });
}

export async function handleOnboardingUpload(user: AuthorizedUser, body: Buffer, params: URLSearchParams, extra: Extra = {}) {
  const fileName = (params.get('fileName') || 'onboarding.xlsx').slice(0, 200);
  const commit = params.get('mode') === 'commit';
  const resolved = resolveUploadOffset(params.get('offset'), fileName);
  if ('error' in resolved) return NextResponse.json({ ...extra, error: resolved.error }, { status: 400 });

  let parsed;
  try {
    parsed = parseOnboardingWorkbook(body, { offset: resolved.offset });
  } catch (error) {
    return readError(error);
  }
  const base = {
    ...extra,
    fileName, offset: resolved.offset, offsetFrom: resolved.from, fileNameOffset: resolved.fileNameOffset, sheetName: parsed.sheetName,
    errors: parsed.errors, issues: parsed.issues.slice(0, 50), issueCount: parsed.issues.length, summary: parsed.summary,
  };
  if (parsed.errors.length) return NextResponse.json({ ...base, ok: false }, { status: commit ? 400 : 200 });
  if (!parsed.rows.length) return NextResponse.json({ ...base, ok: false, errors: ['The file has no valid rows'] }, { status: commit ? 400 : 200 });

  if (!commit) {
    const stored = await loadStoredEvents(parsed.rows.map(row => row.documentId));
    return NextResponse.json({
      ...base,
      ok: true,
      conflicts: classifyConflicts(parsed.rows, stored),
      sample: parsed.rows.slice(0, 8).map(row => ({ ...row, documentId: maskIdentifier(row.documentId), uid: maskIdentifier(row.uid), tradingAccountNo: maskIdentifier(row.tradingAccountNo) })),
    });
  }
  const saved = await saveOnboardingEvents(parsed.rows, { fileName, offset: resolved.offset, actor: await uploadActor(user), skipped: parsed.issues.length, duplicatesInFile: parsed.summary.duplicatesInFile, range: parsed.summary.wibRange });
  return NextResponse.json({ ...base, ok: true, uploadId: saved.uploadId, counts: saved.counts });
}

export async function handleOnboardingSummaryUpload(user: AuthorizedUser, body: Buffer, params: URLSearchParams, extra: Extra = {}) {
  const fileName = (params.get('fileName') || 'onboarding-summary.xlsx').slice(0, 200);
  const commit = params.get('mode') === 'commit';

  let parsed;
  try {
    parsed = parseOnboardingSummary(body);
  } catch (error) {
    return readError(error);
  }
  const base = {
    ...extra,
    fileName, sheetName: parsed.sheetName,
    errors: parsed.errors, issues: parsed.issues.slice(0, 50), issueCount: parsed.issues.length, summary: parsed.summary,
  };
  if (parsed.errors.length) return NextResponse.json({ ...base, ok: false }, { status: commit ? 400 : 200 });
  if (!parsed.rows.length) return NextResponse.json({ ...base, ok: false, errors: ['The file has no valid summary rows'] }, { status: commit ? 400 : 200 });

  if (!commit) {
    return NextResponse.json({
      ...base,
      ok: true,
      sample: parsed.rows.slice(0, 8).map(row => ({
        date: row.date,
        registrations: row.registrations,
        totalRealAccount: row.totalRealAccount,
        manualKycApproved: row.manualKycApproved,
        kycRejected: row.kycRejected,
        tra: row.totalIncludesManual ? row.totalRealAccount : row.totalRealAccount + row.manualKycApproved,
      })),
    });
  }
  const saved = await saveOnboardingSummary(parsed.rows, {
    fileName, actor: await uploadActor(user), skipped: parsed.issues.length, range: parsed.summary.wibRange,
  });
  return NextResponse.json({ ...base, ok: true, uploadId: saved.uploadId, counts: saved.counts });
}

export async function handleUserApprovedUpload(user: AuthorizedUser, body: Buffer, params: URLSearchParams, extra: Extra = {}) {
  const fileName = (params.get('fileName') || 'user-approved.xlsx').slice(0, 200);
  const commit = params.get('mode') === 'commit';
  const resolved = resolveUploadOffset(params.get('offset'), fileName);
  if ('error' in resolved) return NextResponse.json({ ...extra, error: resolved.error }, { status: 400 });

  let parsed;
  try {
    parsed = parseUserApproved(body, { offset: resolved.offset });
  } catch (error) {
    return readError(error);
  }
  const base = {
    ...extra,
    fileName, offset: resolved.offset, offsetFrom: resolved.from, fileNameOffset: resolved.fileNameOffset, sheetName: parsed.sheetName,
    errors: parsed.errors, issues: parsed.issues.slice(0, 50), issueCount: parsed.issues.length, summary: parsed.summary,
  };
  if (parsed.errors.length) return NextResponse.json({ ...base, ok: false }, { status: commit ? 400 : 200 });
  if (!parsed.rows.length) return NextResponse.json({ ...base, ok: false, errors: ['The file has no valid user_approved rows'] }, { status: commit ? 400 : 200 });

  if (!commit) {
    return NextResponse.json({
      ...base,
      ok: true,
      sample: parsed.rows.slice(0, 8).map(row => ({
        recordId: maskIdentifier(row.recordId),
        documentId: maskIdentifier(row.documentId ?? ''),
        approver: row.approver === DEPOSIT_ROBOT ? DEPOSIT_ROBOT : maskIdentifier(row.approver),
        approvalMethod: row.approvalMethod,
        step: row.step,
        approvedStatus: row.approvedStatus,
        successStatus: row.successStatus,
        createTime: row.createTime,
        finishedTime: row.finishedTime,
      })),
    });
  }
  const saved = await saveUserApproved(parsed.rows, {
    fileName, offset: resolved.offset, actor: await uploadActor(user),
    skipped: parsed.issues.length + parsed.summary.skippedBlankApprover,
    duplicatesInFile: parsed.summary.duplicatesInFile,
    range: parsed.summary.wibRange, robotRows: parsed.summary.skippedRobot,
  });
  return NextResponse.json({ ...base, ok: true, uploadId: saved.uploadId, counts: saved.counts });
}

export async function handleFtdUpload(user: AuthorizedUser, body: Buffer, params: URLSearchParams, extra: Extra = {}) {
  const fileName = (params.get('fileName') || 'ftd.csv').slice(0, 200);
  const commit = params.get('mode') === 'commit';
  const resolved = resolveUploadOffset(params.get('offset'), fileName);
  if ('error' in resolved) return NextResponse.json({ ...extra, error: resolved.error }, { status: 400 });

  let parsed;
  try {
    parsed = parseFtdFile(body, { fileName, offset: resolved.offset });
  } catch (error) {
    return readError(error);
  }
  const base = {
    ...extra,
    fileName, offset: resolved.offset, offsetFrom: resolved.from, fileNameOffset: resolved.fileNameOffset, layout: parsed.layout, reportMonth: parsed.reportMonth,
    errors: parsed.errors, warnings: parsed.warnings, issues: parsed.issues.slice(0, 50), issueCount: parsed.issues.length, summary: parsed.summary,
  };
  if (parsed.errors.length) return NextResponse.json({ ...base, ok: false }, { status: commit ? 400 : 200 });
  if (!parsed.rows.length) return NextResponse.json({ ...base, ok: false, errors: ['The file has no valid FTD rows'] }, { status: commit ? 400 : 200 });

  if (!commit) {
    const existing = await countStoredFtd(parsed.rows.map(row => row.accountNo));
    return NextResponse.json({
      ...base,
      ok: true,
      conflicts: { new: parsed.rows.length - existing, existing },
      sample: parsed.rows.slice(0, 8).map(row => ({ ...row, accountNo: maskIdentifier(row.accountNo) })),
    });
  }
  const saved = await saveFtd(parsed.rows, { fileName, offset: resolved.offset, actor: await uploadActor(user), skipped: parsed.issues.length, range: parsed.summary.wibRange });
  return NextResponse.json({ ...base, ok: true, uploadId: saved.uploadId, counts: saved.counts });
}
