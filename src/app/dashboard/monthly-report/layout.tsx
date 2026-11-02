// Server-side guard for every /dashboard/monthly-report route: view access is
// admin, the department's `monthly-report` feature, or a personal grant.
import type { CSSProperties, ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuthorizedUserBySessionId } from '@/lib/auth';
import { canUploadMonthlyReport, monthlyReportPageAccess } from '@/lib/monthly-report/access';
import { MonthlyReportProvider } from '@/components/monthly-report/MonthlyReportContext';

export const dynamic = 'force-dynamic';

// Dupoin brand accent (teal) for the Monthly Report pages only; the rest of the app keeps its theme.
const DUPOIN_ACCENT = {
  '--mos-accent': '#1A8A96',
  '--mos-accent-hover': '#2EB5C4',
  '--mos-accent-soft': '#7FD6DF',
  '--mos-accent-border': 'rgba(46, 181, 196, 0.7)',
  '--mos-accent-ring': 'rgba(46, 181, 196, 0.18)',
} as CSSProperties;

export default async function MonthlyReportLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const user = await getAuthorizedUserBySessionId(cookieStore.get('session_id')?.value);
  const access = monthlyReportPageAccess(user);
  if (access === 'login' || !user) redirect('/');
  if (access === 'forbidden') redirect('/dashboard');
  return (
    <MonthlyReportProvider value={{ canUpload: canUploadMonthlyReport(user), isAdmin: user.role === 'admin' }}>
      <div style={DUPOIN_ACCENT}>{children}</div>
    </MonthlyReportProvider>
  );
}
