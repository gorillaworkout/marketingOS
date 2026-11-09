/** Server-side glue for the Settlement Report API routes. */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedUser, type AuthorizedUser } from '@/lib/auth';
import { canUploadSettlementReport, settlementReportApiAccess } from './access';

export async function requireSettlementReport(
  request: NextRequest,
  options: { adminOnly?: boolean; upload?: boolean } = {},
): Promise<AuthorizedUser | NextResponse> {
  const user = await getAuthorizedUser(request);
  if ('error' in user) return NextResponse.json({ error: user.error }, { status: user.status });
  const denied = settlementReportApiAccess(user, options);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });
  return user;
}

export function settlementPermissions(user: AuthorizedUser) {
  return { canUpload: canUploadSettlementReport(user), isAdmin: user.role === 'admin' };
}
