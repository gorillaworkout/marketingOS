import { NextRequest, NextResponse } from 'next/server';
import { classifyConflicts } from '@/lib/monthly-report/conflicts';
import { maskIdentifier } from '@/lib/monthly-report/metrics';
import { parseOnboardingWorkbook } from '@/lib/monthly-report/onboarding-parse';
import { loadStoredEvents, saveOnboardingEvents } from '@/lib/monthly-report/store';
import { readUploadBody, requireMonthlyReport, uploadActor } from '@/lib/monthly-report/service';
import { resolveUploadOffset } from '@/lib/monthly-report/upload-offset';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Onboarding export upload. Body = the raw .xlsx/.csv file.
 * ?mode=preview (default) validates and compares with stored rows; ?mode=commit upserts by Document ID.
 * ?fileName= is the original name (used for the UTC offset suffix), ?offset= overrides it.
 */
export async function POST(request: NextRequest) {
  const user = await requireMonthlyReport(request, { upload: true });
  if (user instanceof NextResponse) return user;
  const params = request.nextUrl.searchParams;
  const fileName = (params.get('fileName') || 'onboarding.xlsx').slice(0, 200);
  const commit = params.get('mode') === 'commit';
  const resolved = resolveUploadOffset(params.get('offset'), fileName);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });

  const body = await readUploadBody(request);
  if (body instanceof NextResponse) return body;

  let parsed;
  try {
    parsed = parseOnboardingWorkbook(body, { offset: resolved.offset });
  } catch (error) {
    return NextResponse.json({ error: `Could not read the file: ${error instanceof Error ? error.message : 'unknown error'}` }, { status: 400 });
  }
  const base = {
    fileName, offset: resolved.offset, offsetFrom: resolved.from, sheetName: parsed.sheetName,
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
  const saved = await saveOnboardingEvents(parsed.rows, { fileName, offset: resolved.offset, actor: await uploadActor(user), skipped: parsed.issues.length, range: parsed.summary.wibRange });
  return NextResponse.json({ ...base, ok: true, uploadId: saved.uploadId, counts: saved.counts });
}
