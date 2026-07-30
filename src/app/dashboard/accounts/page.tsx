// Server wrapper. Marks the route dynamic so Next.js does not emit a long-lived
// prerender cache header that pinned old bundles to Cloudflare after redeploys.
import AccountsClient from './AccountsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function AccountsPage() {
  return <AccountsClient />;
}
