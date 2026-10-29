// SEO OS settings are admin-only, enforced on the server.
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuthorizedUserBySessionId } from '@/lib/auth';
import { seoPageAccess } from '@/lib/seo/access';

export const dynamic = 'force-dynamic';

export default async function SeoSettingsLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const user = await getAuthorizedUserBySessionId(cookieStore.get('session_id')?.value);
  const access = seoPageAccess(user, { adminOnly: true });
  if (access === 'login') redirect('/');
  if (access === 'forbidden') redirect('/dashboard/seo');
  return children;
}
