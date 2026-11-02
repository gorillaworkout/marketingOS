// Uploads are limited to admins and users with upload rights.
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuthorizedUserBySessionId } from '@/lib/auth';
import { monthlyReportPageAccess } from '@/lib/monthly-report/access';

export const dynamic = 'force-dynamic';

export default async function MonthlyReportUploadsLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const access = monthlyReportPageAccess(await getAuthorizedUserBySessionId(cookieStore.get('session_id')?.value), { upload: true });
  if (access === 'login') redirect('/');
  if (access === 'forbidden') redirect('/dashboard/monthly-report');
  return children;
}
