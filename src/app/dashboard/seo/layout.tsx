// Server-side guard for every /dashboard/seo route. The dashboard shell only
// redirects on the client, so SEO OS checks the session and the `seo`
// department feature here before any page renders.
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuthorizedUserBySessionId } from '@/lib/auth';
import { seoPageAccess } from '@/lib/seo/access';

export const dynamic = 'force-dynamic';

export default async function SeoLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const user = await getAuthorizedUserBySessionId(cookieStore.get('session_id')?.value);
  const access = seoPageAccess(user);
  if (access === 'login') redirect('/');
  if (access === 'forbidden') redirect('/dashboard');
  return children;
}
