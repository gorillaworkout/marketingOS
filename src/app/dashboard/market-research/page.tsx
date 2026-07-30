'use client';

import Link from 'next/link';
import { useState } from 'react';
import { buildMarketResearchDocxBlob, marketResearchDocxFilename } from '@/lib/market-research-docx';
import type { MarketResearchInput, MarketResearchItem } from '@/lib/market-research';
import { Button, FormField, Panel, PageHeader, PageStack, SectionHeader, StatusBadge, TextArea, TextInput, Toolbar } from '@/components/ui/dashboard';

interface MarketResearchResult {
  items: MarketResearchItem[];
  input: MarketResearchInput;
  model: string;
  groupsSearched: string[];
  groupCandidateCounts: Record<string, number>;
  sourceStatus: Array<{ outlet: string; status: 'ok' | 'error'; candidateCount: number; error?: string }>;
  candidateCount: number;
  historyId: string;
}

function todayWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export default function MarketResearchPage() {
  const [brief, setBrief] = useState('');
  const [researchDate] = useState(todayWib);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<MarketResearchResult | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  const fillExample = () => setBrief('Siapkan morning briefing untuk tim marketing Dupoin. Prioritaskan keputusan bank sentral, data ekonomi resmi, geopolitik, OPEC+, dan perkembangan faktual yang paling berdampak terhadap sentimen trading hari ini.');

  const generate = async () => {
    setLoading(true); setError(''); setResult(null); setReviewConfirmed(false); setProgress(4); setStatus('Preparing secure same-day research…');
    try {
      const response = await fetch('/api/market-research/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief, researchDate }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Request failed with HTTP ${response.status}.`);
      }
      if (!response.body) throw new Error('Research stream is unavailable.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const rawEvent of events) {
          const line = rawEvent.split('\n').find(part => part.startsWith('data: '));
          if (!line) continue;
          const event = JSON.parse(line.slice(6));
          setProgress(Number(event.progress) || 0);
          setStatus(event.message || '');
          if (event.step === 'error') throw new Error(event.message || 'Market research failed.');
          if (event.step === 'done') { setResult(event.result as MarketResearchResult); completed = true; }
        }
      }
      if (!completed) throw new Error('Research stream ended without a completed report.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Market research failed.');
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    if (!result || !reviewConfirmed) return;
    const blob = await buildMarketResearchDocxBlob(result.input.brief, result.input.researchDate, result.items);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = marketResearchDocxFilename(result.input.researchDate);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageStack>
      <PageHeader eyebrow="Create / Market intelligence" title="Market research" description="Berikan brief. MarketingOS memindai Forex, Gold, Oil, dan US Indices secara terpisah, lalu memilih maksimal lima berita faktual dan high-impact yang diterbitkan hari ini." actions={<Link href="/dashboard/history" className="inline-flex h-9 items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3.5 text-sm font-medium text-[var(--mos-text-secondary)] hover:border-[var(--mos-border-strong)]">Buka history</Link>} />

      <Panel>
        <SectionHeader title="Research brief" description="Tanggal riset dikunci otomatis ke hari ini dalam WIB." action={<Button size="sm" onClick={fillExample}>Isi contoh</Button>} />
        <div className="mt-5 grid gap-4 md:grid-cols-[1fr_220px]">
          <FormField label="Brief" hint={`${brief.trim().length}/2000 karakter`}><TextArea value={brief} onChange={event => setBrief(event.target.value)} rows={6} maxLength={2000} placeholder="Contoh: Cari perkembangan faktual paling penting untuk morning briefing hari ini…" /></FormField>
          <FormField label="Research date" hint="WIB"><TextInput type="date" value={researchDate} readOnly /></FormField>
        </div>
        <div className="mt-4"><p className="text-xs font-semibold uppercase tracking-wider text-[var(--mos-text-faint)]">Product groups selalu dipindai</p><div className="mt-2 flex flex-wrap gap-2">{['Forex', 'Gold', 'Oil', 'US Indices'].map(group => <StatusBadge key={group}>{group}</StatusBadge>)}</div></div>
        <div className="mt-5 rounded-[var(--mos-radius-panel)] border border-amber-500/25 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100"><strong>Verification boundary:</strong> selection memakai headline dan summary metadata publisher. Latest Update Time ditampilkan hanya jika feed menyediakannya. Buka setiap link dan baca artikel lengkap sebelum menggunakan hasil secara eksternal.</div>
        <Button type="button" variant="primary" onClick={generate} disabled={loading || brief.trim().length < 20} className="mt-5">{loading ? 'Researching…' : 'Generate market research'}</Button>
        {loading && <div className="mt-4"><div className="h-2 overflow-hidden rounded-full bg-[var(--mos-raised)]"><div className="h-full bg-cyan-500 transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-sm text-[var(--mos-text-muted)]">{status}</p></div>}
        {error && <div className="mt-4 rounded-[var(--mos-radius-panel)] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}
      </Panel>

      {result && <section className="space-y-4">
        <Toolbar><SectionHeader title="Selected market news" description={`${result.items.length} dipilih dari ${result.candidateCount} candidate · Model: ${result.model}`} /><Button variant="primary" onClick={() => void download()} disabled={!reviewConfirmed}>Download DOCX</Button></Toolbar>
        <div className="grid gap-3 md:grid-cols-2">
          <Panel padding="compact"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--mos-text-faint)]">Candidate coverage per product</p><div className="mt-3 flex flex-wrap gap-2">{result.groupsSearched.map(group => <StatusBadge key={group}>{group}: {result.groupCandidateCounts?.[group] ?? 0}</StatusBadge>)}</div></Panel>
          <Panel padding="compact"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--mos-text-faint)]">Publisher feed status</p><div className="mt-3 space-y-2">{result.sourceStatus?.map(source => <div key={source.outlet} className="flex items-start justify-between gap-3 text-xs"><span className="text-[var(--mos-text-secondary)]">{source.outlet}</span><StatusBadge tone={source.status === 'ok' ? 'success' : 'danger'} dot>{source.status === 'ok' ? `OK · ${source.candidateCount} candidate` : `Failed · ${source.error || 'Unavailable'}`}</StatusBadge></div>)}</div></Panel>
        </div>
        {result.items.map((item, index) => <Panel key={item.candidateId}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-[var(--mos-accent-soft)]">#{index + 1} · {item.productCategory}</p><h3 className="mt-1 text-base font-semibold text-white">{item.articleTitle}</h3><p className="mt-1 text-sm text-[var(--mos-text-muted)]">{item.newsSource}</p></div><div className="text-right text-xs text-[var(--mos-text-muted)]"><p>Published: {item.publicationDate} {item.publicationTime} WIB</p><p>Latest Update Time: {item.latestUpdateTime ? `${item.latestUpdateTime} WIB` : 'Not provided'}</p></div></div><dl className="mt-5 grid gap-4 divide-y divide-[var(--mos-border-subtle)] md:grid-cols-3 md:divide-x md:divide-y-0">{[['Main event', item.mainEvent], ['Latest factual development', item.latestFactualDevelopment], ['Market relevance', item.marketRelevance]].map(([label, value]) => <div key={label} className="py-3 md:px-4 md:py-0 first:pl-0"><dt className="text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">{label}</dt><dd className="mt-2 text-sm leading-6 text-[var(--mos-text-secondary)]">{value}</dd></div>)}</dl><a href={item.articleUrl} target="_blank" rel="noreferrer" className="mt-4 block break-all text-sm text-[var(--mos-accent-soft)] hover:underline">Open publisher article: {item.articleUrl}</a></Panel>)}
        <label className="flex cursor-pointer gap-3 rounded-[var(--mos-radius-panel)] border border-amber-500/25 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100"><input type="checkbox" checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-emerald-500" /><span>Saya sudah membuka seluruh link, membaca artikel lengkap, dan memeriksa title, waktu, main event, factual development, serta market relevance. Aktifkan untuk Download DOCX.</span></label>
      </section>}
    </PageStack>
  );
}
