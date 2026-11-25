// Server-side guard for every /dashboard/cs-report route: admin, or the
// department has `cs-report` (Customer Service). View = input = upload.
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { getAuthorizedUserBySessionId } from '@/lib/auth';
import { canUseCsReport } from '@/lib/cs-report/access';
import { CsReportGate } from '@/components/cs-report/CsReportGate';

export const dynamic = 'force-dynamic';

export default async function CsReportLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const user = await getAuthorizedUserBySessionId(cookieStore.get('session_id')?.value);
  if (!user) return <CsReportGate href="/" />;
  if (!canUseCsReport(user)) return <CsReportGate href="/dashboard" />;
  return <>{children}</>;
}
