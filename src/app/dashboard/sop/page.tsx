'use client';

import Link from 'next/link';
import ArticleMarketNewsGenerator from './ArticleMarketNewsGenerator';
import { PageHeader, PageStack, Panel, StatusBadge } from '@/components/ui/dashboard';
import InlineModelSelector from '@/components/InlineModelSelector';

const steps = [
  {
    number: '01',
    title: 'Research and topic selection',
    badge: 'Starting sources',
    detail: 'Open Investing.com, set the site language to Indonesian, then go to News > Most Popular News. Check the five newest articles published today.',
    outcome: 'A relevant article found → use it as a reference and continue to query selection.',
  },
  {
    number: '02',
    title: 'Research and query selection',
    badge: 'Query check',
    detail: 'Open investasi.kontan.co.id > Investasi and check the five newest articles with the same criteria. Record the source, five titles/times/URLs, the keyword you identified, and readiness.',
    outcome: 'No relevant topic → stop writing and repeat the research every 10 minutes.',
  },
  {
    number: '03',
    title: 'SEO Competitor Research',
    badge: 'SERP check',
    detail: 'Use Google Incognito with the last-24-hours filter. Capture the H1/H2/H3 structure from the top five competitors and five People Also Ask questions.',
    outcome: 'Pick the strongest angle and write the SEO H1.',
  },
  {
    number: '04',
    title: 'Draft Article',
    badge: 'Production',
    detail: 'Write an 800–1000 word journalistic article in Indonesian. The title includes the main keyword and is at most 60 characters.',
    outcome: 'Prepare it in DOCX or Google Docs for review.',
  },
  {
    number: '05',
    title: 'Plagiarism Check',
    badge: 'Originality gate',
    detail: 'Check the draft in the SmallSEOTools plagiarism checker and save the result.',
    outcome: 'Score >90% → ready to publish. Score <90% → revision is required.',
  },
  {
    number: '06',
    title: 'Revise & Recheck',
    badge: 'Revision',
    detail: 'Download the report, rewrite the flagged segments specifically, then run the check again.',
    outcome: 'Repeat until the score is above 90% before the article can be published.',
  },
];

const topicKeywords = ['Emas', 'Harga Emas', 'XAUUSD/XAU/USD', 'Rupiah', 'Dollar/Dolar', 'Wall Street', 'Minyak/Harga Minyak'];

export default function SopPage() {
  return (
    <PageStack>
      <PageHeader eyebrow="Create / Editorial standard" title="Article market news" description="Follow the SOP for research, then generate a source-gated article draft that is ready to export as DOCX." actions={<div className="flex flex-wrap items-center gap-2"><Link href="/dashboard/history?type=article-market-news" className="inline-flex h-9 items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3.5 text-sm font-medium text-[var(--mos-text-secondary)] hover:border-[var(--mos-border-strong)]">Open history</Link><StatusBadge tone="warning">Manual review required</StatusBadge></div>} />
      <InlineModelSelector feature="article-market-news" />
      <Panel padding="compact" className="border-amber-400/15 bg-amber-400/[0.045] text-sm leading-6 text-amber-100"><span className="font-semibold">Manual SOP steps:</span> the operator still does the research and the originality check. The generator only writes from facts and structure that were already entered.</Panel>

      <ArticleMarketNewsGenerator />

      <section className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
        <div className="rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-raised)] p-5 md:p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-400">Purpose</p>
          <h2 className="mt-2 text-xl font-semibold text-white">One standard from the news signal to ready to publish</h2>
          <p className="mt-3 text-sm leading-6 text-[var(--mos-text-muted)]">Use this flow so the article has current sources, a checked query, a deliberate SEO structure, and an originality score that passes before publication.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {topicKeywords.map(keyword => <span key={keyword} className="rounded-md border border-[var(--mos-border)] bg-[var(--mos-surface)] px-2.5 py-1 text-xs text-[var(--mos-text-secondary)]">{keyword}</span>)}
          </div>
        </div>
        <aside className="rounded-[var(--mos-radius-panel)] border border-red-500/25 bg-red-500/10 p-5 md:p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-red-300">Non-negotiable</p>
          <ul className="mt-3 space-y-3 text-sm leading-5 text-red-100">
            <li>• Do not invent or assume facts, figures, or quotations.</li>
            <li>• Do not name a competitor broker.</li>
            <li>• Do not publish if research has not found a valid topic or the originality score is not high enough.</li>
          </ul>
        </aside>
      </section>

      <section aria-labelledby="flow-title">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-widest text-blue-400">Workflow</p><h2 id="flow-title" className="mt-1 text-xl font-semibold text-white">Article market news production flow</h2></div>
          <span className="hidden rounded-full bg-[var(--mos-raised)] px-3 py-1 text-xs text-[var(--mos-text-muted)] sm:block">Read left to right, then the next row</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {steps.map((step, index) => (
            <article key={step.number} className="relative flex min-h-64 flex-col rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-5 transition-colors hover:border-[var(--mos-border-strong)]">
              <div className="flex items-start justify-between gap-3"><span className="font-mono text-xl text-[var(--mos-accent-soft)]">{step.number}</span><StatusBadge>{step.badge}</StatusBadge></div>
              <h3 className="mt-4 text-lg font-semibold text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--mos-text-muted)]">{step.detail}</p>
              <div className="mt-auto border-t border-[var(--mos-border)] pt-3 text-sm font-medium leading-5 text-emerald-300">{step.outcome}</div>
              {index < steps.length - 1 && <span className="absolute -bottom-3 left-1/2 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-[var(--mos-border)] bg-[var(--mos-surface)] text-xs text-[var(--mos-text-muted)] md:hidden">↓</span>}
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[var(--mos-radius-panel)] border border-amber-500/25 bg-amber-500/5 p-5 md:p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-300">Decision branch · research</p>
          <div className="mt-4 space-y-3">
            <div className="rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-surface)] p-4 text-sm text-[var(--mos-text-secondary)]"><span className="font-semibold text-white">Investing.com: is there a relevant article?</span><br />Yes → use it as a reference, continue to SEO Competitor Research, and skip Kontan. No → continue to Kontan.</div>
            <div className="rounded-[var(--mos-radius-panel)] border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100"><span className="font-semibold">Kontan: still no relevant article?</span><br />Stop writing. Repeat both research passes every <strong>10 minutes</strong> until there is a valid topic.</div>
          </div>
        </div>
        <div className="rounded-[var(--mos-radius-panel)] border border-emerald-500/25 bg-emerald-500/5 p-5 md:p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">Acceptance gate · before publish</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[var(--mos-radius-panel)] border border-emerald-500/25 bg-emerald-500/10 p-4"><p className="text-2xl font-bold text-emerald-300">&gt;90%</p><p className="mt-1 text-sm text-emerald-100">SmallSEOTools: ready to publish when the rest of the checklist is complete too.</p></div>
            <div className="rounded-[var(--mos-radius-panel)] border border-red-500/25 bg-red-500/10 p-4"><p className="text-2xl font-bold text-red-300">&lt;90%</p><p className="mt-1 text-sm text-red-100">Revise the flagged segments and check again.</p></div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
        <div className="rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-raised)] p-5 md:p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-400">Today's content data</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Metadata that must be recorded</h2>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {['Research date and time', 'Reference sources', '5 titles + time + URL', 'Identified keyword', 'SEO H1 and article angle', 'Status: ready / waiting / revision', 'Plagiarism checker score', 'DOCX / Google Docs link'].map(item => (
              <div key={item} className="rounded-lg bg-[var(--mos-surface)] px-3 py-2.5"><dt className="text-[var(--mos-text-faint)]">{item}</dt><dd className="mt-1 text-[var(--mos-text-secondary)]">Filled in by the operator</dd></div>
            ))}
          </dl>
        </div>
        <div className="rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-raised)] p-5 md:p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-400">SOP notes and prompt</p>
          <div className="mt-4 space-y-3">
            <details className="group rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-surface)] p-4"><summary className="cursor-pointer list-none font-medium text-white">Research and SEO standard <span className="float-right text-blue-400 group-open:rotate-45">+</span></summary><div className="mt-3 text-sm leading-6 text-[var(--mos-text-muted)]">Use a current article that contains one of the focus keywords. In Google Incognito, capture H1/H2/H3 from five competitors and five People Also Ask questions after applying the last-24-hours filter.</div></details>
            <details className="group rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-surface)] p-4"><summary className="cursor-pointer list-none font-medium text-white">Article draft standard <span className="float-right text-blue-400 group-open:rotate-45">+</span></summary><div className="mt-3 text-sm leading-6 text-[var(--mos-text-muted)]">Put the keyword in the first paragraph; use the H1/H2/H3 structure and the five PAA questions as headings. Name the outlet and the source date. Analyst or institution quotations are allowed only when the source data supports them. Close with one sentence that points to a Dupoin account.</div></details>
            <details className="group rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-surface)] p-4"><summary className="cursor-pointer list-none font-medium text-white">Editor reminder prompt <span className="float-right text-blue-400 group-open:rotate-45">+</span></summary><div className="mt-3 text-sm leading-6 text-[var(--mos-text-muted)]">“Write factually and journalistically in Indonesian, with no fabrication. Keep the source context, do not name competitor brokers, and make sure every claim can be traced to the research.”</div></details>
          </div>
        </div>
      </section>

      <section className="rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-raised)] p-5 md:p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-400">Output checklist</p>
        <div className="mt-4 grid gap-x-8 gap-y-3 text-sm text-[var(--mos-text-secondary)] md:grid-cols-2">
          {['A valid topic was found and the source was recorded', 'Five Kontan articles (title, time, URL) were recorded', 'The SEO H1 and five PAA questions were chosen', 'Title ≤60 characters; draft is 800–1000 words', 'The keyword is in the first paragraph and the H1/H2/H3 structure is complete', 'Outlet, source date, facts, and quotations were checked', 'A one-sentence CTA toward a Dupoin account is present', 'DOCX or Google Docs is ready; a score above 90% is documented'].map(item => <div key={item} className="flex gap-3 rounded-lg border border-[var(--mos-border)] bg-[var(--mos-surface)] px-3 py-2.5"><span className="text-blue-400">□</span><span>{item}</span></div>)}
        </div>
      </section>
    </PageStack>
  );
}
