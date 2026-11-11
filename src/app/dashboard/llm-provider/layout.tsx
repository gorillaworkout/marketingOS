import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuthorizedUserBySessionId } from '@/lib/auth';
import { canManageLlmProvider } from '@/lib/llm-provider';

export const dynamic = 'force-dynamic';

export default async function LlmProviderLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const user = await getAuthorizedUserBySessionId(cookieStore.get('session_id')?.value);
  if (!user) redirect('/');
  if (!canManageLlmProvider(user)) redirect('/dashboard');
  return children;
}
