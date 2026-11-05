import { NextRequest, NextResponse } from 'next/server';
import { FTD_IS_MANUAL_MESSAGE, autoUploadAction, detectUploadKind } from '@/lib/monthly-report/detect';
import { readUploadBody, requireMonthlyReport } from '@/lib/monthly-report/service';
import {
  handleOnboardingSummaryUpload, handleOnboardingUpload, handleUserApprovedUpload,
} from '@/lib/monthly-report/upload-handlers';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Auto-detect upload. Sniffs the file header, then runs the matching upload
 * handler (classic onboarding, daily summary, or user_approved). Every response
 * carries `detectedKind` / `detectedLabel` so the preview shows the type.
 * FTD is entered manually per day (/api/monthly-report/ftd-daily), so a
 * detected FTD file returns 400 with `ftdManual: true` and FTD_IS_MANUAL_MESSAGE
 * (admins can still import the legacy FTD CSV via "Choose type manually").
 * On commit, `?expect=` (the type shown in the preview) must match the detected
 * type, so a different file can't be saved by mistake.
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
  if (autoUploadAction(detected) === 'ftd-manual') {
    return NextResponse.json({ ok: false, detectedKind: detected.kind, detectedLabel: detected.label, ftdManual: true, error: FTD_IS_MANUAL_MESSAGE }, { status: 400 });
  }
  const expect = params.get('expect');
  if (params.get('mode') === 'commit' && expect && expect !== detected.kind) {
    return NextResponse.json({ ok: false, detectedKind: detected.kind, error: `The file was detected as ${detected.label}, not ${expect}. Preview it again.` }, { status: 409 });
  }
  const extra = { detectedKind: detected.kind, detectedLabel: detected.label };
  if (detected.kind === 'onboarding_summary') return handleOnboardingSummaryUpload(user, body, params, extra);
  if (detected.kind === 'user_approved') return handleUserApprovedUpload(user, body, params, extra);
  return handleOnboardingUpload(user, body, params, extra);
}
