// Access management is admin only.
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuthorizedUserBySessionId } from '@/lib/auth';
import { settlementReportPageAccess } from '@/lib/settlement/access';

export const dynamic = 'force-dynamic';

export default async function SettlementReportAccessLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const access = settlementReportPageAccess(await getAuthorizedUserBySessionId(cookieStore.get('session_id')?.value), { adminOnly: true });
  if (access === 'login') redirect('/');
  if (access === 'forbidden') redirect('/dashboard/settlement-report');
  return children;
}
