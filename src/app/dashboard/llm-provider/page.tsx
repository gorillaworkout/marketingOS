import { redirect } from 'next/navigation';

export default function LlmProviderRedirectPage() {
  redirect('/dashboard/models');
}
