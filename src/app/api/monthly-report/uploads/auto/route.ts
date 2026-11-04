import { NextRequest, NextResponse } from 'next/server';
import { detectUploadKind } from '@/lib/monthly-report/detect';
import { readUploadBody, requireMonthlyReport } from '@/lib/monthly-report/service';
import { handleFtdUpload, handleOnboardingUpload } from '@/lib/monthly-report/upload-handlers';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Auto-detect upload. Sniffs the file header, then runs the onboarding or FTD
 * upload with the same parameters (mode, fileName, offset). Every response
 * carries `detectedKind` / `detectedLabel` so the preview shows the type.
 * On commit, `?expect=onboarding|ftd` (the type shown in the preview) must
 * match the detected type, so a different file can't be saved by mistake.
 * Unknown formats return 400 with the expected columns.
 */
export async function POST(request: NextRequest) {
  const user = await requireMonthlyReport(request, { upload: true });
  if (user instanceof NextResponse) return user;
  const body = await readUploadBody(request);
  if (body instanceof NextResponse) return body;
  const params = request.nextUrl.searchParams;

  const detected = detectUploadKind(body);
  if (!detected.ok) {
    return NextResponse.json({ ok: false, detectedKind: null, error: detected.error, hints: detected.hints, expected: detected.expected }, { status: 400 });
  }
  const expect = params.get('expect');
  if (params.get('mode') === 'commit' && expect && expect !== detected.kind) {
    return NextResponse.json({ ok: false, detectedKind: detected.kind, error: `The file was detected as ${detected.label}, not ${expect}. Preview it again.` }, { status: 409 });
  }
  const extra = { detectedKind: detected.kind, detectedLabel: detected.label };
  return detected.kind === 'onboarding'
    ? handleOnboardingUpload(user, body, params, extra)
    : handleFtdUpload(user, body, params, extra);
}
