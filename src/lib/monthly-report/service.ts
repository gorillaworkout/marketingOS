/** Server-side glue for the Monthly Report API routes: auth, query parsing, report loading. */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedUser, type AuthorizedUser } from '@/lib/auth';
import { queryOne } from '@/lib/database';
import { monthlyReportApiAccess, canUploadMonthlyReport } from './access';
import { buildOnboardingReport, type OnboardingReport } from './metrics';
import { GRANULARITIES, PERIOD_PRESETS, defaultGranularity, resolvePeriod, type Granularity, type PeriodInput, type PeriodPreset, type ResolvedPeriod } from './periods';
import { loadCombinedFtdSpan, loadCoverage, loadPeriodData, type UploadActor } from './store';

export async function requireMonthlyReport(
  request: NextRequest,
  options: { adminOnly?: boolean; upload?: boolean } = {},
): Promise<AuthorizedUser | NextResponse> {
  const user = await getAuthorizedUser(request);
  if ('error' in user) return NextResponse.json({ error: user.error }, { status: user.status });
  const denied = monthlyReportApiAccess(user, options);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });
  return user;
}

export function permissionsFor(user: AuthorizedUser) {
  return { canUpload: canUploadMonthlyReport(user), isAdmin: user.role === 'admin' };
}

export async function uploadActor(user: AuthorizedUser): Promise<UploadActor> {
  const row = await queryOne<{ name: string; username: string }>('SELECT name, username FROM users WHERE id = ?', [user.id]);
  return { id: user.id, name: row?.name || row?.username || 'Unknown user' };
}

/** Today's date in WIB as YYYY-MM-DD. */
export function todayWib(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

export function parseReportQuery(params: URLSearchParams): { period: ResolvedPeriod; granularity: Granularity } {
  const preset = (params.get('preset') ?? 'month') as PeriodPreset;
  if (!(PERIOD_PRESETS as readonly string[]).includes(preset)) throw new Error('preset is not supported');
  const input: PeriodInput = preset === 'custom'
    ? { preset, from: params.get('from') ?? undefined, to: params.get('to') ?? undefined }
    : { preset, anchor: params.get('anchor') || todayWib() };
  const period = resolvePeriod(input);
  const requested = params.get('granularity') as Granularity | null;
  const granularity = requested && (GRANULARITIES as readonly string[]).includes(requested) ? requested : defaultGranularity(period.preset);
  return { period, granularity };
}

export async function loadOnboardingReport(period: ResolvedPeriod, granularity: Granularity): Promise<OnboardingReport> {
  const [ftdSpan, coverage] = await Promise.all([loadCombinedFtdSpan(), loadCoverage()]);
  const [current, previous] = await Promise.all([loadPeriodData(period.range, ftdSpan), loadPeriodData(period.previous, ftdSpan)]);
  // Upload coverage drives "No data" days and the missing-data warning; days after today (WIB) are never missing.
  return buildOnboardingReport({ period, granularity, current, previous, coverage, today: todayWib() });
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function readUploadBody(request: NextRequest): Promise<Buffer | NextResponse> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'The file is larger than 25 MB' }, { status: 413 });
  const buffer = Buffer.from(await request.arrayBuffer());
  if (!buffer.length) return NextResponse.json({ error: 'The file is empty' }, { status: 400 });
  if (buffer.length > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'The file is larger than 25 MB' }, { status: 413 });
  return buffer;
}
