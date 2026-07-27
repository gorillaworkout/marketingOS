'use client';

import { useMemo, useState } from 'react';
import { jakartaDate, validateGeneratedArticle, type ArticleMarketNewsInput, type ArticleQualityCheck } from '@/lib/article-market-news';
import { articleDocxFilename, buildArticleDocxBlob } from '@/lib/article-market-news-docx';

interface SourceForm {
  outlet: string;
  title: string;
  url: string;
  publishedAt: string;
  verifiedFacts: string;
}

interface ArticleResult {
  title: string;
  metaDescription?: string;
  articleMarkdown: string;
  excerpt?: string;
  sourcesCited?: string[];
  wordCount: number;
  model: string;
  qc: ArticleQualityCheck;
  historyId?: string;
  normalizedInput?: ArticleMarketNewsInput;
}

const emptySource = (): SourceForm => ({ outlet: '', title: '', url: '', publishedAt: '', verifiedFacts: '' });

export default function ArticleMarketNewsGenerator() {
  const [keyword, setKeyword] = useState('');
  const [researchDate, setResearchDate] = useState(jakartaDate);
  const [angle, setAngle] = useState('');
  const [competitorHeadings, setCompetitorHeadings] = useState('');
  const [paaText, setPaaText] = useState('');
  const [sources, setSources] = useState<SourceForm[]>([]);
  const [noCompetitorBroker, setNoCompetitorBroker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ArticleResult | null>(null);
  const [generatedInput, setGeneratedInput] = useState<ArticleMarketNewsInput | null>(null);
  const [factReviewConfirmed, setFactReviewConfirmed] = useState(false);

  const paaQuestions = useMemo(() => paaText.split('\n').map(value => value.trim()).filter(Boolean), [paaText]);
  const competitorResearchCount = useMemo(() => new Set([...competitorHeadings.matchAll(/(?:competitor|artikel)\s*([1-5])\s*:/gi)].map(match => match[1])).size, [competitorHeadings]);
  const optionalReferencesReady = sources.length === 0 || Boolean(
    noCompetitorBroker && sources.every(source => source.outlet.trim() && source.title.trim() && source.url.trim() && source.publishedAt && source.verifiedFacts.trim()),
  );
  const ready = Boolean(
    keyword.trim() && researchDate && angle.trim() && competitorHeadings.trim() && competitorResearchCount === 5 &&
    paaQuestions.length === 5 && new Set(paaQuestions).size === 5 && optionalReferencesReady,
  );
  const currentValidation = useMemo(() => {
    if (!result || !generatedInput) return null;
    return validateGeneratedArticle(result.title, result.articleMarkdown, generatedInput, result.metaDescription || '');
  }, [result, generatedInput]);

  const updateSource = (index: number, field: keyof SourceForm, value: string) => {
    setSources(current => current.map((source, sourceIndex) => sourceIndex === index ? { ...source, [field]: value } : source));
  };

  const fillExample = () => {
    setKeyword('harga emas');
    setAngle('Membahas pergerakan harga emas hari ini, faktor pendorongnya, dan hal yang perlu diperhatikan trader pemula.');
    setCompetitorHeadings(Array.from({ length: 5 }, (_, index) => `Competitor ${index + 1}:\nH1: Harga Emas Hari Ini\nH2: Faktor Penggerak Harga Emas\nH3: Risiko yang Perlu Diperhatikan`).join('\n\n'));
    setPaaText([
      'Apa yang memengaruhi harga emas hari ini?',
      'Mengapa harga emas dapat naik atau turun?',
      'Bagaimana hubungan dolar AS dengan harga emas?',
      'Apa perbedaan emas fisik dan XAUUSD?',
      'Apa risiko trading emas untuk pemula?',
    ].join('\n'));
    setSources([]);
    setNoCompetitorBroker(false);
  };

  const generateArticle = async () => {
    if (!ready || loading) return;
    const requestInput: ArticleMarketNewsInput = {
      keyword, researchDate, angle, competitorHeadings, paaQuestions, sources,
      noCompetitorBroker, factsVerified: noCompetitorBroker,
    };
    setLoading(true);
    setError('');
    setResult(null);
    setGeneratedInput(null);
    setFactReviewConfirmed(false);
    setProgress('Validating research gate…');
    try {
      const response = await fetch('/api/article-market-news/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestInput),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Server error ${response.status}`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Generation stream is unavailable.');
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const event = JSON.parse(line.slice(6));
          if (event.message) setProgress(event.message);
          if (event.step === 'error') throw new Error(event.message || 'Article generation failed.');
          if (event.step === 'done' && event.result) {
            setResult(event.result as ArticleResult);
            setGeneratedInput((event.result as ArticleResult).normalizedInput || requestInput);
            completed = true;
          }
        }
      }
      if (!completed) throw new Error('Generation ended without a completed article.');
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Article generation failed.');
    } finally {
      setLoading(false);
    }
  };

  const downloadDocx = async () => {
    if (!result || !generatedInput || !currentValidation || currentValidation.violations.length > 0 || !factReviewConfirmed) {
      setError(`Draft cannot be downloaded: ${currentValidation?.violations.join(' ') || (!factReviewConfirmed ? 'complete the manual nonnumeric fact review.' : 'publication gate is incomplete.')}`);
      return;
    }
    const blob = await buildArticleDocxBlob(result.title, result.metaDescription || '', result.articleMarkdown);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = articleDocxFilename(generatedInput.keyword, generatedInput.researchDate);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const currentWordCount = currentValidation?.wordCount || 0;

  return (
    <section className="rounded-2xl border border-cyan-500/25 bg-gradient-to-br from-cyan-950/30 via-gray-800/70 to-gray-800/50 p-5 md:p-7" aria-labelledby="article-generator-title">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">Article Generator</p>
          <h2 id="article-generator-title" className="mt-1 text-2xl font-semibold text-white">Generate Article Market News</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-300">Isi keyword, angle, struktur kompetitor, dan lima PAA. Sistem selalu melakukan research otomatis dari publisher feeds; reference tambahan dari user bersifat opsional.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/dashboard/history" className="rounded-lg border border-gray-600 px-3 py-2 text-xs text-gray-200 hover:border-cyan-500">Buka History</a>
          <button type="button" onClick={fillExample} className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500">Isi Contoh</button>
        </div>
      </div>

      <details className="mt-5 rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-4 text-sm text-gray-300">
        <summary className="cursor-pointer font-semibold text-cyan-200">Lihat contoh input</summary>
        <div className="mt-3 space-y-2 leading-6">
          <p><strong>Keyword:</strong> harga emas</p>
          <p><strong>Angle:</strong> pergerakan harga emas hari ini, faktor pendorong, dan risiko untuk trader pemula.</p>
          <p><strong>Competitor structure:</strong> lima blok berurutan dari Competitor 1–5; setiap blok wajib memiliki H1, H2, dan H3.</p>
          <p><strong>PAA:</strong> tepat lima pertanyaan unik dan masing-masing berakhir dengan tanda tanya.</p>
          <p><strong>Reference:</strong> boleh dikosongkan. Jika diisi, reference akan menjadi tambahan; automated research tetap dijalankan.</p>
        </div>
      </details>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <label className="block text-sm text-gray-300">Main Keyword
            <input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="Contoh: Harga Emas Hari Ini" className="mt-1.5 w-full rounded-lg border border-gray-600 bg-gray-900/70 px-3 py-2.5 text-white outline-none focus:border-cyan-500" />
          </label>
          <label className="block text-sm text-gray-300">Research Date
            <input type="date" value={researchDate} min={jakartaDate()} max={jakartaDate()} onChange={event => setResearchDate(event.target.value)} className="mt-1.5 w-full rounded-lg border border-gray-600 bg-gray-900/70 px-3 py-2.5 text-white outline-none focus:border-cyan-500" />
          </label>
          <label className="block text-sm text-gray-300">Article Angle
            <textarea value={angle} onChange={event => setAngle(event.target.value)} rows={3} placeholder="Sudut utama yang dipilih berdasarkan riset" className="mt-1.5 w-full rounded-lg border border-gray-600 bg-gray-900/70 px-3 py-2.5 text-white outline-none focus:border-cyan-500" />
          </label>
          <label className="block text-sm text-gray-300">Competitor H1/H2/H3 Structure — exactly 5 articles
            <textarea value={competitorHeadings} onChange={event => setCompetitorHeadings(event.target.value)} rows={12} placeholder={'Competitor 1:\nH1: ...\nH2: ...\nH3: ...\n\nUlangi sampai Competitor 5.'} className="mt-1.5 w-full rounded-lg border border-gray-600 bg-gray-900/70 px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-cyan-500" />
            <span className={`mt-1 block text-xs ${competitorResearchCount === 5 ? 'text-emerald-400' : 'text-gray-500'}`}>{competitorResearchCount}/5 competitor structures</span>
          </label>
          <label className="block text-sm text-gray-300">People Also Ask — exactly 5 questions
            <textarea value={paaText} onChange={event => setPaaText(event.target.value)} rows={6} placeholder={'Satu pertanyaan per baris\n1. ...\n2. ...'} className="mt-1.5 w-full rounded-lg border border-gray-600 bg-gray-900/70 px-3 py-2.5 text-white outline-none focus:border-cyan-500" />
            <span className={`mt-1 block text-xs ${paaQuestions.length === 5 ? 'text-emerald-400' : 'text-gray-500'}`}>{paaQuestions.length}/5 questions</span>
          </label>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div><h3 className="font-semibold text-white">Reference Articles (Optional)</h3><p className="text-xs text-gray-400">Boleh kosong. Jika diisi, tambahkan maksimal lima reference yang sudah kamu periksa; sistem tetap melakukan research otomatis.</p></div>
            <button type="button" onClick={() => setSources(current => [...current, emptySource()])} disabled={sources.length >= 5} className="rounded-lg border border-gray-600 px-3 py-2 text-xs text-gray-200 hover:border-cyan-500 disabled:opacity-40">+ Add source</button>
          </div>
          {sources.map((source, index) => (
            <div key={index} className="rounded-xl border border-gray-700 bg-gray-900/45 p-4 space-y-3">
              <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-cyan-300">Source {index + 1}</h4><button type="button" onClick={() => setSources(current => current.filter((_, itemIndex) => itemIndex !== index))} className="text-xs text-red-300 hover:text-red-200">Remove</button></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input value={source.outlet} onChange={event => updateSource(index, 'outlet', event.target.value)} placeholder="Outlet: Investing.com" className="rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-white" />
                <label className="text-xs text-gray-400">
                  Publication Time (WIB)
                  <div className="mt-1 flex items-center gap-2">
                    <span className="rounded-lg border border-gray-700 bg-gray-800/70 px-3 py-2 text-sm text-gray-300" title="Tanggal otomatis mengikuti Research Date">{researchDate}</span>
                    <input type="time" value={source.publishedAt.split('T')[1] || ''} onChange={event => updateSource(index, 'publishedAt', event.target.value ? `${researchDate}T${event.target.value}` : '')} aria-label={`Source ${index + 1} publication time in WIB`} className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-white" />
                  </div>
                  <span className="mt-1 block text-[11px] text-gray-500">Tanggal otomatis mengikuti Research Date.</span>
                </label>
              </div>
              <input value={source.title} onChange={event => updateSource(index, 'title', event.target.value)} placeholder="Article title" className="w-full rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-white" />
              <input type="url" value={source.url} onChange={event => updateSource(index, 'url', event.target.value)} placeholder="https://..." className="w-full rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-white" />
              <textarea value={source.verifiedFacts} onChange={event => updateSource(index, 'verifiedFacts', event.target.value)} rows={5} placeholder="Verified Facts / Quotes: angka, harga, perubahan %, institusi, dan kutipan yang benar-benar tercantum di sumber." className="w-full rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-white" />
            </div>
          ))}
          {sources.length > 0 && <label className="flex cursor-pointer gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-100">
            <input type="checkbox" checked={noCompetitorBroker} onChange={event => setNoCompetitorBroker(event.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-500" />
            <span>Saya sudah memeriksa bahwa optional reference tidak menyebut competitor broker dan seluruh fakta/kutipan yang saya masukkan dapat ditelusuri ke sumber.</span>
          </label>}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 border-t border-gray-700/60 pt-5 sm:flex-row sm:items-center">
        <button type="button" onClick={generateArticle} disabled={!ready || loading} className="rounded-xl bg-cyan-600 px-6 py-3 font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40">
          {loading ? 'Generating Article…' : 'Generate Article'}
        </button>
        {!ready && <p className="text-xs text-gray-400">Lengkapi keyword, angle, lima struktur kompetitor, tepat lima PAA, serta optional reference jika kamu menambahkannya.</p>}
        {progress && <p className="text-sm text-cyan-200">{progress}</p>}
      </div>
      {error && <div className="mt-4 rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300" role="alert">{error}</div>}

      {result && (
        <div className="mt-7 space-y-5 border-t border-gray-700 pt-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div><p className="text-xs uppercase tracking-wider text-emerald-400">Draft generated</p><h3 className="mt-1 text-xl font-semibold text-white">{result.title}</h3><p className="mt-1 text-xs text-gray-400">Model: {result.model} · {currentWordCount} words</p></div>
            <button type="button" onClick={downloadDocx} disabled={!currentValidation || currentValidation.violations.length > 0 || !factReviewConfirmed} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40">Download DOCX</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ['Title ≤60', currentValidation?.qc.titleWithin60Characters || false],
              ['800–1,000 words', currentValidation?.qc.wordCountWithinRange || false],
              ['Keyword lead', currentValidation?.qc.keywordInFirstParagraph || false],
              ['Five PAA', currentValidation?.qc.fivePaaIncluded || false],
              ['Originality', false],
            ].map(([label, passed]) => <div key={String(label)} className={`rounded-lg border px-3 py-2 text-xs ${passed ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/25 bg-amber-500/10 text-amber-200'}`}>{passed ? '✓' : 'Manual'} {label}</div>)}
          </div>
          <label className="block text-sm text-gray-300">Editable Article Draft
            <textarea value={result.articleMarkdown} onChange={event => { setFactReviewConfirmed(false); setResult(current => current ? { ...current, articleMarkdown: event.target.value } : current); }} rows={32} className="mt-2 w-full rounded-xl border border-gray-600 bg-gray-950/70 p-4 font-mono text-sm leading-6 text-gray-100 outline-none focus:border-cyan-500" />
          </label>
          {currentValidation && currentValidation.violations.length > 0 && <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200"><strong>Download locked:</strong> {currentValidation.violations.join(' ')}</div>}
          <label className="flex cursor-pointer gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">
            <input type="checkbox" checked={factReviewConfirmed} onChange={event => setFactReviewConfirmed(event.target.checked)} disabled={!currentValidation || currentValidation.violations.length > 0} className="mt-0.5 h-4 w-4 accent-emerald-500" />
            <span>Saya sudah memeriksa ulang setiap klaim nonnumeric, nama institusi/analis, peristiwa pasar, dan kutipan terhadap source snapshot yang digunakan saat generate.</span>
          </label>
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100"><strong>Manual publication gate:</strong> upload DOCX ke SmallSEOTools. Skor harus &gt;90%. Jika di bawah 90%, revisi bagian yang ditandai lalu periksa kembali.</div>
        </div>
      )}
    </section>
  );
}
