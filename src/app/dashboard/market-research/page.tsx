'use client';

import Link from 'next/link';
import { useState } from 'react';
import { buildMarketResearchDocxBlob, marketResearchDocxFilename } from '@/lib/market-research-docx';
import type { MarketResearchInput, MarketResearchItem } from '@/lib/market-research';

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
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      <header className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-950/70 via-gray-800/80 to-gray-900 p-6 md:p-8">
        <div className="absolute -right-16 -top-16 h-52 w-52 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Latest Market News Research & Selection</p><h1 className="mt-2 text-3xl font-bold text-white md:text-4xl">Market Research</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-gray-300">Berikan brief. MarketingOS memindai Forex, Gold, Oil, dan US Indices secara terpisah, lalu memilih maksimal lima berita faktual dan high-impact yang diterbitkan hari ini.</p></div>
          <Link href="/dashboard/history" className="inline-flex w-fit rounded-lg border border-gray-600 bg-gray-900/50 px-4 py-2 text-sm font-medium text-gray-200 hover:border-cyan-400 hover:text-white">Buka History</Link>
        </div>
      </header>

      <section className="rounded-2xl border border-gray-700/60 bg-gray-800/50 p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold text-white">Research Brief</h2><p className="mt-1 text-sm text-gray-400">Tanggal riset dikunci otomatis ke hari ini dalam WIB.</p></div><button type="button" onClick={fillExample} className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20">Isi Contoh</button></div>
        <div className="mt-5 grid gap-4 md:grid-cols-[1fr_220px]">
          <label className="text-sm text-gray-300">Brief<textarea value={brief} onChange={event => setBrief(event.target.value)} rows={6} maxLength={2000} placeholder="Contoh: Cari perkembangan faktual paling penting untuk morning briefing hari ini…" className="mt-2 w-full rounded-xl border border-gray-700 bg-gray-950/70 px-4 py-3 text-sm text-white outline-none focus:border-cyan-500" /><span className="mt-1 block text-xs text-gray-500">{brief.trim().length}/2000 karakter</span></label>
          <label className="text-sm text-gray-300">Research Date (WIB)<input type="date" value={researchDate} readOnly className="mt-2 w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-gray-300" /></label>
        </div>
        <div className="mt-4"><p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Product groups selalu dipindai</p><div className="mt-2 flex flex-wrap gap-2">{['Forex', 'Gold', 'Oil', 'US Indices'].map(group => <span key={group} className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">{group}</span>)}</div></div>
        <div className="mt-5 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100"><strong>Verification boundary:</strong> selection memakai headline dan summary metadata publisher. Latest Update Time ditampilkan hanya jika feed menyediakannya. Buka setiap link dan baca artikel lengkap sebelum menggunakan hasil secara eksternal.</div>
        <button type="button" onClick={generate} disabled={loading || brief.trim().length < 20} className="mt-5 rounded-xl bg-cyan-600 px-5 py-3 font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40">{loading ? 'Researching…' : 'Generate Market Research'}</button>
        {loading && <div className="mt-4"><div className="h-2 overflow-hidden rounded-full bg-gray-700"><div className="h-full bg-cyan-500 transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-sm text-gray-400">{status}</p></div>}
        {error && <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}
      </section>

      {result && <section className="space-y-4">
        <div className="flex flex-col gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-semibold text-white">Selected Market News</h2><p className="mt-1 text-sm text-gray-400">{result.items.length} dipilih dari {result.candidateCount} candidate · Model: {result.model}</p></div><button type="button" onClick={() => void download()} disabled={!reviewConfirmed} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40">Download DOCX</button></div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Candidate coverage per product</p><div className="mt-3 flex flex-wrap gap-2">{result.groupsSearched.map(group => <span key={group} className="rounded-full bg-gray-950/70 px-3 py-1 text-xs text-gray-300">{group}: {result.groupCandidateCounts?.[group] ?? 0}</span>)}</div></div>
          <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Publisher feed status</p><div className="mt-3 space-y-2">{result.sourceStatus?.map(source => <div key={source.outlet} className="flex items-start justify-between gap-3 text-xs"><span className="text-gray-300">{source.outlet}</span><span className={source.status === 'ok' ? 'text-emerald-400' : 'text-red-300'}>{source.status === 'ok' ? `OK · ${source.candidateCount} candidate` : `Failed · ${source.error || 'Unavailable'}`}</span></div>)}</div></div>
        </div>
        {result.items.map((item, index) => <article key={item.candidateId} className="rounded-2xl border border-gray-700/60 bg-gray-800/50 p-5 md:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-cyan-400">#{index + 1} · {item.productCategory}</p><h3 className="mt-1 text-lg font-semibold text-white">{item.articleTitle}</h3><p className="mt-1 text-sm text-gray-400">{item.newsSource}</p></div><div className="text-right text-xs text-gray-400"><p>Published: {item.publicationDate} {item.publicationTime} WIB</p><p>Latest Update Time: {item.latestUpdateTime ? `${item.latestUpdateTime} WIB` : 'Not provided'}</p></div></div><dl className="mt-5 grid gap-4 md:grid-cols-3"><div className="rounded-xl bg-gray-950/50 p-4"><dt className="text-xs uppercase tracking-wide text-gray-500">Main Event</dt><dd className="mt-2 text-sm leading-6 text-gray-300">{item.mainEvent}</dd></div><div className="rounded-xl bg-gray-950/50 p-4"><dt className="text-xs uppercase tracking-wide text-gray-500">Latest Factual Development</dt><dd className="mt-2 text-sm leading-6 text-gray-300">{item.latestFactualDevelopment}</dd></div><div className="rounded-xl bg-gray-950/50 p-4"><dt className="text-xs uppercase tracking-wide text-gray-500">Market Relevance</dt><dd className="mt-2 text-sm leading-6 text-gray-300">{item.marketRelevance}</dd></div></dl><a href={item.articleUrl} target="_blank" rel="noreferrer" className="mt-4 block break-all text-sm text-cyan-400 hover:underline">Open publisher article: {item.articleUrl}</a></article>)}
        <label className="flex cursor-pointer gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100"><input type="checkbox" checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-emerald-500" /><span>Saya sudah membuka seluruh link, membaca artikel lengkap, dan memeriksa title, waktu, main event, factual development, serta market relevance. Aktifkan untuk Download DOCX.</span></label>
      </section>}
    </div>
  );
}
