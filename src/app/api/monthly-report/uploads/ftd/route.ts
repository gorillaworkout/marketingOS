import { NextRequest, NextResponse } from 'next/server';
import { parseFtdFile } from '@/lib/monthly-report/ftd-parse';
import { maskIdentifier } from '@/lib/monthly-report/metrics';
import { countStoredFtd, saveFtd } from '@/lib/monthly-report/store';
import { readUploadBody, requireMonthlyReport, uploadActor } from '@/lib/monthly-report/service';
import { resolveUploadOffset } from '@/lib/monthly-report/upload-offset';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * FTD upload: the monthly FTD report CSV (MONTHLY block) or a clean table with
 * Account, Type, Join Date, FTD Time, Amount. Upserts by Account.
 * Same query parameters as the onboarding upload.
 */
export async function POST(request: NextRequest) {
  const user = await requireMonthlyReport(request, { upload: true });
  if (user instanceof NextResponse) return user;
  const params = request.nextUrl.searchParams;
  const fileName = (params.get('fileName') || 'ftd.csv').slice(0, 200);
  const commit = params.get('mode') === 'commit';
  const resolved = resolveUploadOffset(params.get('offset'), fileName);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });

  const body = await readUploadBody(request);
  if (body instanceof NextResponse) return body;

  let parsed;
  try {
    parsed = parseFtdFile(body, { fileName, offset: resolved.offset });
  } catch (error) {
    return NextResponse.json({ error: `Could not read the file: ${error instanceof Error ? error.message : 'unknown error'}` }, { status: 400 });
  }
  const base = {
    fileName, offset: resolved.offset, offsetFrom: resolved.from, layout: parsed.layout, reportMonth: parsed.reportMonth,
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
