import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { connection } from 'next/server';
import { AiResearchMarkdown } from '@/components/AiResearchMarkdown';
import { COMPLIANCE_BANNER_TEXT, scanResearchCompliance } from '@/lib/ai-research-compliance';
import { loadPublicResearchShare } from '@/lib/ai-research-share';

export const metadata: Metadata = {
  title: 'Shared research — Dupoin AI Research',
  robots: { index: false, follow: false },
};

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-300">Dupoin AI Research</p>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--mos-text)]">Read-only link</h1>
        <p className="mt-2 text-sm text-[var(--mos-text-muted)]">
          Answer and sources only. No question box, fact pins, or topic watches.
        </p>
      </header>
      {children}
    </main>
  );
}

export default async function SharedResearchPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connection();
  const { token: rawToken } = await params;
  let token = rawToken;
  try {
    token = decodeURIComponent(rawToken);
  } catch {
    token = rawToken;
  }

  let share: Awaited<ReturnType<typeof loadPublicResearchShare>> = null;
  let unavailable = false;
  try {
    share = await loadPublicResearchShare(token);
  } catch (error) {
    console.error('[ai-research] share lookup failed:', error);
    unavailable = true;
  }

  if (!share) {
    return (
      <Shell>
        <div role="status" className="rounded-2xl border border-[var(--mos-border)] bg-[var(--mos-raised)] px-5 py-6">
          <h2 className="text-base font-semibold text-[var(--mos-text)]">
            {unavailable ? 'This link cannot be opened right now.' : 'This link is invalid or has expired.'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--mos-text-muted)]">
            Share links last 30 days and show only the answer as it was when it was shared.
          </p>
          <Link href="/" className="mt-4 inline-flex text-sm text-indigo-300 underline underline-offset-2">
            Sign in to MarketingOS
          </Link>
        </div>
      </Shell>
    );
  }

  const scan = scanResearchCompliance(share.answer);
  const expires = new Date(share.expiresAt).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <Shell>
      <article className="space-y-6" data-testid="ai-research-share-view">
        <section className="rounded-2xl border border-[var(--mos-border)] bg-[var(--mos-raised)] px-5 py-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--mos-text-muted)]">Question</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--mos-text)]">{share.query}</p>
        </section>
        {scan.flagged && (
          <div
            role="status"
            data-testid="ai-research-compliance"
            className="rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-3 text-sm leading-6 text-amber-100"
          >
            <p className="font-semibold">{COMPLIANCE_BANNER_TEXT}</p>
          </div>
        )}
        <section className="rounded-2xl border border-[var(--mos-border)] bg-[var(--mos-raised)] px-5 py-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--mos-text-muted)]">Answer</h2>
          <div className="mt-3 text-sm leading-relaxed text-[var(--mos-text)]">
            <AiResearchMarkdown text={share.answer} />
          </div>
        </section>
        <section className="rounded-2xl border border-[var(--mos-border)] bg-[var(--mos-raised)] px-5 py-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--mos-text-muted)]">Sources</h2>
          {share.sources.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--mos-text-muted)]">No sources were saved on this answer.</p>
          ) : (
            <ol className="mt-3 space-y-2 text-sm">
              {share.sources.map(source => (
                <li key={source.url}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-indigo-300 underline decoration-indigo-400/40 underline-offset-2"
                  >
                    {source.title}
                  </a>
                </li>
              ))}
            </ol>
          )}
        </section>
        <p className="text-xs text-[var(--mos-text-faint)]">Valid until {expires}.</p>
        <Link href="/" className="inline-flex text-sm text-indigo-300 underline underline-offset-2">
          Sign in to MarketingOS
        </Link>
      </article>
    </Shell>
  );
}
