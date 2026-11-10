// Server-side guard for every /dashboard/settlement-report route: view access is
// admin, the department's `settlement-report` feature, or a personal grant.
import type { CSSProperties, ReactNode } from 'react';
import { cookies } from 'next/headers';
import { getAuthorizedUserBySessionId } from '@/lib/auth';
import { canUploadSettlementReport, settlementReportPageAccess } from '@/lib/settlement/access';
import { SettlementGate } from '@/components/settlement/SettlementGate';
import { SettlementProvider } from '@/components/settlement/SettlementContext';

export const dynamic = 'force-dynamic';

const DUPOIN_ACCENT = {
  '--mos-accent': '#1A8A96',
  '--mos-accent-hover': '#2EB5C4',
  '--mos-accent-soft': '#7FD6DF',
  '--mos-accent-border': 'rgba(46, 181, 196, 0.7)',
  '--mos-accent-ring': 'rgba(46, 181, 196, 0.18)',
} as CSSProperties;

export default async function SettlementReportLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const user = await getAuthorizedUserBySessionId(cookieStore.get('session_id')?.value);
  const access = settlementReportPageAccess(user);
  if (access === 'login' || !user) return <SettlementGate href="/" />;
  if (access === 'forbidden') return <SettlementGate href="/dashboard" />;
  return (
    <SettlementProvider value={{ canUpload: canUploadSettlementReport(user), isAdmin: user.role === 'admin' }}>
      <div style={DUPOIN_ACCENT}>{children}</div>
    </SettlementProvider>
  );
}
