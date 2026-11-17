'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, DataTableFrame, EmptyState, FormField, LoadingState, MetricCard, PageHeader, PageStack, Panel, SectionHeader, Select, StatusBadge, TextArea, TextInput,
} from '@/components/ui/dashboard';
import { TregBalancePanel, TregCostNotice, useTregStatus, type TregCostResult } from '@/components/seo/TregCostNotice';
import { fetchJson } from '@/components/seo/useSeoSites';
import {
  AD_VALUE_FORMULA, HANDLE_PLATFORMS, MEDIA_CHANNELS, MEDIA_CHANNEL_LABELS, MEDIA_SOURCE_LABELS, compactNumber, engagementOf, estimatedAdValue, percent,
  type DateRange, type MediaDashboard, type MediaInsights, type MediaMention, type MediaSettings, type Sentiment,
} from '@/lib/partnership/media';
import { MEDIA_TREG_PLATFORMS, MEDIA_TREG_SPECS, estimateMediaTreg, type MediaTregPlatform } from '@/lib/partnership/media-treg-platforms';

type Run = {
  id: string; trigger: 'manual' | 'scheduled'; mode: 'free' | 'treg'; status: 'queued' | 'running' | 'succeeded' | 'failed'; progress: number; message: string;
  platforms: string[]; stats: Record<string, number> | null; cost: { estimatedMicro?: number; actualMicro?: number; source?: 'reported' | 'estimate'; balanceAfterMicro?: number | null } | null;
  notes: string[]; error: string | null; createdAt: string; finishedAt: string | null;
};
type Overview = {
  range: DateRange; settings: MediaSettings; dashboard: MediaDashboard; insights: { result: MediaInsights; model: string | null; createdAt: string } | null;
  runs: Run[]; running: Run | null; mentions: MediaMention[]; sources: { youtubeConfigured: boolean };
};

const PRESETS = [7, 30, 90] as const;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const jakartaToday = () => isoDay(new Date(Date.now() + 7 * 3_600_000));
const presetRange = (days: number): DateRange => ({ from: isoDay(new Date(Date.parse(jakartaToday()) - (days - 1) * 86_400_000)), to: jakartaToday() });
const when = (value: string | null) => (value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const isRunning = (run: Run | null | undefined) => run?.status === 'queued' || run?.status === 'running';
const SENT_TONE: Record<Sentiment, 'success' | 'neutral' | 'danger'> = { positive: 'success', neutral: 'neutral', negative: 'danger' };
const SENT_BAR: Record<Sentiment | 'unscored', string> = { positive: 'bg-emerald-400/80', neutral: 'bg-slate-400/70', negative: 'bg-red-400/80', unscored: 'bg-white/10' };

function TrendChart({ dashboard }: { dashboard: MediaDashboard }) {
  const series = dashboard.timeline;
  const maxM = Math.max(1, ...series.map(point => point.mentions));
  const maxE = Math.max(1, ...series.map(point => point.engagement));
  const W = 900; const H = 180; const bw = W / Math.max(1, series.length);
  const line = series.map((point, index) => `${index === 0 ? 'M' : 'L'}${(index + 0.5) * bw},${H - (point.engagement / maxE) * (H - 10)}`).join(' ');
  const step = Math.max(1, Math.ceil(series.length / 10));
  return <div>
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="h-52 w-full" role="img" aria-label="Mentions and engagement per day">
      {series.map((point, index) => {
        const h = (point.mentions / maxM) * (H - 10);
        return <g key={point.date}>
          <rect x={index * bw + bw * 0.15} y={H - h} width={Math.max(1, bw * 0.7)} height={h} fill="#2EB5C4" opacity={0.85}><title>{`${point.date}: ${point.mentions} mention(s), ${point.engagement} engagement`}</title></rect>
          {index % step === 0 && <text x={index * bw + bw / 2} y={H + 14} fontSize="10" textAnchor="middle" fill="currentColor" opacity={0.5}>{point.date.slice(5)}</text>}
        </g>;
      })}
      {series.length > 1 && <path d={line} fill="none" stroke="#F2A93B" strokeWidth={2} />}
    </svg>
    <p className="mt-1 text-xs text-[var(--mos-text-muted)]"><span className="text-[#2EB5C4]">■</span> Mentions per day (max {maxM}) · <span className="text-[#F2A93B]">━</span> Engagement per day (max {compactNumber(maxE)}) · Peak engagement {dashboard.peaks.engagementDay ?? '—'} · Most mentions {dashboard.peaks.mentionsDay ?? '—'}</p>
  </div>;
}

function SettingsPanel({ settings, onSaved }: { settings: MediaSettings; onSaved: (message: string) => void }) {
  const [form, setForm] = useState(() => ({
    brandName: settings.brandName,
    keywords: settings.keywords.join('\n'),
    hashtags: settings.hashtags.join('\n'),
    alertFeeds: settings.alertFeeds.join('\n'),
    language: settings.language,
    handles: Object.fromEntries([...HANDLE_PLATFORMS, 'website'].map(key => [key, settings.officialHandles[key as keyof typeof settings.officialHandles] ?? ''])) as Record<string, string>,
    currency: settings.adValue.currency,
    cpm: Object.fromEntries(MEDIA_CHANNELS.map(channel => [channel, String(settings.adValue.cpm[channel])])) as Record<string, string>,
    onlineMediaReach: String(settings.adValue.onlineMediaReach),
    engagementToReach: String(settings.adValue.engagementToReach),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    const { ok, data } = await fetchJson<{ settings: MediaSettings }>('/api/partnership/media/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        brandName: form.brandName, keywords: form.keywords, hashtags: form.hashtags, alertFeeds: form.alertFeeds, language: form.language, officialHandles: form.handles,
        adValue: { currency: form.currency, cpm: form.cpm, onlineMediaReach: form.onlineMediaReach, engagementToReach: form.engagementToReach },
      }),
    });
    setBusy(false);
    if (!ok) { setError(data.error || 'Could not save.'); return; }
    onSaved('Settings saved. Refresh to collect with the new keywords and feeds.');
  };
  return <Panel data-testid="media-settings">
    <SectionHeader title="Settings" description="What to monitor, which accounts are official (owned), where Google Alerts deliver, and how the ad value is estimated." />
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <FormField label="Brand"><TextInput value={form.brandName} maxLength={120} onChange={event => setForm({ ...form, brandName: event.target.value })} /></FormField>
      <FormField label="Language" hint="Google News edition and treg news search.">
        <Select value={form.language} onChange={event => setForm({ ...form, language: event.target.value as MediaSettings['language'] })}>
          <option value="id">Indonesian</option><option value="en">English</option><option value="both">Both</option>
        </Select>
      </FormField>
      <FormField label="Keywords" hint="One per line, e.g. Dupoin Futures. Used for Google News, GDELT, YouTube and treg."><TextArea rows={4} value={form.keywords} onChange={event => setForm({ ...form, keywords: event.target.value })} /></FormField>
      <FormField label="Hashtags" hint="One per line, e.g. #dupoin. Used by treg Instagram hashtag search."><TextArea rows={4} value={form.hashtags} onChange={event => setForm({ ...form, hashtags: event.target.value })} /></FormField>
      <FormField label="Google Alerts RSS feeds" className="md:col-span-2" hint='At google.com/alerts create an alert, open "Show options", set "Deliver to: RSS feed", then copy the RSS link (https://www.google.com/alerts/feeds/…). One per line.'>
        <TextArea rows={3} spellCheck={false} placeholder="https://www.google.com/alerts/feeds/…/…" value={form.alertFeeds} onChange={event => setForm({ ...form, alertFeeds: event.target.value })} />
      </FormField>
    </div>
    <h3 className="mt-6 text-xs font-medium uppercase tracking-wide text-[var(--mos-text-faint)]">Official accounts (owned media)</h3>
    <p className="mt-1 text-xs text-[var(--mos-text-muted)]">Only add accounts you have verified. Leave blank if unsure. Posts from these accounts are marked Official; everything else is Earned.</p>
    <div className="mt-3 grid gap-3 md:grid-cols-4">
      {[...HANDLE_PLATFORMS, 'website'].map(key => <FormField key={key} label={key === 'website' ? 'Website' : MEDIA_CHANNEL_LABELS[key as keyof typeof MEDIA_CHANNEL_LABELS]}>
        <TextInput value={form.handles[key]} spellCheck={false} placeholder={key === 'website' ? 'https://' : '@handle'} onChange={event => setForm({ ...form, handles: { ...form.handles, [key]: event.target.value } })} />
      </FormField>)}
    </div>
    <h3 className="mt-6 text-xs font-medium uppercase tracking-wide text-[var(--mos-text-faint)]">Ad value: estimate formula</h3>
    <p className="mt-1 text-xs text-[var(--mos-text-muted)]">{AD_VALUE_FORMULA} The defaults are placeholder assumptions, not agency rates. Replace them with your media-buying CPMs.</p>
    <div className="mt-3 grid gap-3 md:grid-cols-5">
      <FormField label="Currency"><TextInput value={form.currency} maxLength={3} onChange={event => setForm({ ...form, currency: event.target.value })} /></FormField>
      {MEDIA_CHANNELS.map(channel => <FormField key={channel} label={`CPM · ${MEDIA_CHANNEL_LABELS[channel]}`}>
        <TextInput inputMode="decimal" value={form.cpm[channel]} onChange={event => setForm({ ...form, cpm: { ...form.cpm, [channel]: event.target.value } })} />
      </FormField>)}
      <FormField label="Readers per online article"><TextInput inputMode="numeric" value={form.onlineMediaReach} onChange={event => setForm({ ...form, onlineMediaReach: event.target.value })} /></FormField>
      <FormField label="Engagement → reach ×"><TextInput inputMode="decimal" value={form.engagementToReach} onChange={event => setForm({ ...form, engagementToReach: event.target.value })} /></FormField>
    </div>
    {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    <div className="mt-4"><Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</Button></div>
  </Panel>;
}

export default function MediaMonitoringPage() {
  const [range, setRange] = useState<DateRange>(() => presetRange(30));
  const [overview, setOverview] = useState<Overview | null>(null);
  const [message, setMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showTreg, setShowTreg] = useState(false);
  const [platforms, setPlatforms] = useState<MediaTregPlatform[]>(['tiktok', 'x', 'news']);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [insightsBusy, setInsightsBusy] = useState(false);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const { status: treg, reload: reloadTreg } = useTregStatus('/api/partnership/media/treg');

  const load = useCallback(async () => {
    const { ok, data } = await fetchJson<Overview>(`/api/partnership/media?from=${range.from}&to=${range.to}`);
    if (!ok) { setMessage(data.error || 'Could not load Media Monitoring.'); return; }
    setOverview(data);
  }, [range]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const running = overview?.running ?? null;
  useEffect(() => {
    if (!isRunning(running)) return;
    const timer = window.setInterval(() => { void load(); }, 3000);
    return () => window.clearInterval(timer);
  }, [running, load]);

  const estimate = useMemo(() => (overview ? estimateMediaTreg(overview.settings, platforms) : { calls: 0, totalMicro: 0, maxMicro: 0, platforms: [] }), [overview, platforms]);
  const lastTregRun = overview?.runs.find(run => run.mode === 'treg' && run.cost && run.cost.actualMicro !== undefined) ?? null;
  const tregResult: TregCostResult | null = lastTregRun && lastTregRun.status === 'succeeded' && lastTregRun.cost
    ? { estimatedMicro: lastTregRun.cost.estimatedMicro ?? 0, actualMicro: lastTregRun.cost.actualMicro ?? null, source: lastTregRun.cost.source ?? null, balanceAfterMicro: lastTregRun.cost.balanceAfterMicro ?? null }
    : null;

  const refresh = async (mode: 'free' | 'treg') => {
    setBusy(true); setMessage('');
    const body = mode === 'treg' ? { mode, platforms, confirmedEstimateMicro: estimate.totalMicro } : { mode };
    const { ok, data } = await fetchJson<{ id: string; treg: string; note: string | null }>('/api/partnership/media/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    setBusy(false); setConfirming(false);
    if (!ok) { setMessage(data.error || 'Could not start the refresh.'); return; }
    setMessage(data.treg === 'reserved'
      ? 'Refresh started with treg (paid) plus free sources. The actual cost shows here when it finishes.'
      : data.note || 'Refresh started (free sources: Google Alerts, Google News, GDELT, YouTube if configured). This takes a minute or two.');
    await load();
    void reloadTreg();
  };

  const generateInsights = async () => {
    setInsightsBusy(true); setMessage('');
    const { ok, data } = await fetchJson('/api/partnership/media/insights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(range) });
    setInsightsBusy(false);
    if (!ok) { setMessage(data.error || 'Could not generate insights.'); return; }
    await load();
  };

  const setSentiment = async (id: string, sentiment: Sentiment) => {
    const { ok, data } = await fetchJson(`/api/partnership/media/mentions/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sentiment }) });
    if (!ok) setMessage(data.error || 'Could not update.');
    await load();
  };

  if (!overview) return <PageStack><PageHeader eyebrow="Partnership" title="Media Monitoring" />{message ? <p className="text-sm text-red-300">{message}</p> : <LoadingState label="Loading Media Monitoring" />}</PageStack>;

  const { dashboard, settings, insights } = overview;
  const scored = dashboard.sentiment.positive + dashboard.sentiment.neutral + dashboard.sentiment.negative;
  const mentions = overview.mentions.filter(mention => channelFilter === 'all' || mention.channel === channelFilter);
  const lastRun = overview.runs[0] ?? null;
  const ins = insights?.result ?? null;

  return <PageStack>
    <PageHeader
      eyebrow="Partnership"
      title="Media Monitoring"
      description={`Mentions of ${settings.brandName} across online media and social, with sentiment, reach and ad value (estimates). Free sources refresh on a schedule; treg (paid) runs only when you start it.`}
    />

    <Panel padding="compact" data-testid="media-refresh-controls">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-1">
          {PRESETS.map(days => <Button key={days} size="sm" variant={range.from === presetRange(days).from && range.to === presetRange(days).to ? 'primary' : 'secondary'} onClick={() => setRange(presetRange(days))}>{days}d</Button>)}
        </div>
        <FormField label="From"><TextInput type="date" value={range.from} max={range.to} onChange={event => event.target.value && setRange({ ...range, from: event.target.value })} /></FormField>
        <FormField label="To"><TextInput type="date" value={range.to} min={range.from} onChange={event => event.target.value && setRange({ ...range, to: event.target.value })} /></FormField>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy || isRunning(running)} onClick={() => refresh('free')}>Refresh (Free)</Button>
          <Button disabled={isRunning(running)} onClick={() => { setShowTreg(!showTreg); setConfirming(false); }}>Generate with treg</Button>
          <a href={`/api/partnership/media/export?from=${range.from}&to=${range.to}`} className="inline-flex h-9 items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3.5 text-sm font-medium text-[var(--mos-text-secondary)] hover:text-[var(--mos-text)]">Export PDF</a>
          <Button variant="ghost" onClick={() => setShowSettings(!showSettings)}>{showSettings ? 'Hide settings' : 'Settings'}</Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-[var(--mos-text-muted)]">
        Last refresh: {lastRun ? `${when(lastRun.finishedAt ?? lastRun.createdAt)} · ${lastRun.trigger === 'scheduled' ? 'Scheduled' : 'Manual'} · ${lastRun.mode === 'treg' ? 'Free + treg' : 'Free'} · ${lastRun.status}` : 'never'}
        {' · '}Feeds: {settings.alertFeeds.length} Google Alerts · YouTube {overview.sources.youtubeConfigured ? 'on' : 'off (no YOUTUBE_API_KEY)'}
      </p>
      {isRunning(running) && <div className="mt-3"><div className="h-1.5 w-full overflow-hidden rounded bg-white/10"><div className="h-full bg-[var(--mos-accent)] transition-all" style={{ width: `${running!.progress}%` }} /></div><p className="mt-1 text-xs text-[var(--mos-text-muted)]">{running!.message} ({running!.progress}%)</p></div>}
      {message && <p className="mt-2 text-sm text-[var(--mos-text-secondary)]">{message}</p>}
      {!settings.alertFeeds.length && <p className="mt-2 text-xs text-amber-200">No Google Alerts RSS feed yet. Open Settings and paste the feed URL from google.com/alerts (Deliver to: RSS feed).</p>}
    </Panel>

    {showTreg && <Panel data-testid="media-treg-panel">
      <SectionHeader title="Generate with treg (paid)" description={`Searches each platform for up to 3 keywords (hashtags for Instagram hashtag posts). Shares the treg daily limit with Competitor Intelligence and Keyword Gap. Falls back to free sources on low balance or a treg error.`} />
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {MEDIA_TREG_PLATFORMS.map(id => {
          const spec = MEDIA_TREG_SPECS[id];
          const one = estimateMediaTreg(settings, [id]);
          return <label key={id} className="flex items-start gap-2 rounded-[6px] border border-[var(--mos-border)] p-2 text-sm text-[var(--mos-text-secondary)]">
            <input type="checkbox" className="mt-1" checked={platforms.includes(id)} onChange={event => { setConfirming(false); setPlatforms(event.target.checked ? [...platforms, id] : platforms.filter(item => item !== id)); }} />
            <span><span className="font-medium text-[var(--mos-text)]">{spec.label}</span> <span className="text-xs text-[var(--mos-text-faint)]">({spec.endpoint})</span><br />
              <span className="text-xs">{spec.detail} · ~${(spec.priceMicro / 1_000_000).toFixed(4)}/call · {one.calls} call(s): {one.platforms[0]?.terms.join(', ') || 'no terms'}</span></span>
          </label>;
        })}
      </div>
      <div className="mt-3"><TregBalancePanel status={treg} /></div>
      <TregCostNotice feature="Media Monitoring" status={treg} estimate={{ totalMicro: estimate.totalMicro, calls: estimate.calls, detail: estimate.platforms.map(row => `${MEDIA_TREG_SPECS[row.platform].label} ×${row.calls}`).join(', ') }}
        scopeLabel="this run" confirming={confirming} busy={busy} onConfirm={() => refresh('treg')} onCancel={() => setConfirming(false)} />
      {!confirming && <div className="mt-3 flex gap-2">
        <Button variant="primary" disabled={!treg?.canRun || !estimate.calls || busy || isRunning(running)} onClick={() => setConfirming(true)}>Run with treg (~${(estimate.totalMicro / 1_000_000).toFixed(4)})</Button>
        {treg && !treg.configured && <span className="self-center text-xs text-[var(--mos-text-muted)]">treg is not configured on this server; use Refresh (Free).</span>}
      </div>}
      {tregResult && <TregCostNotice feature="Media Monitoring" status={treg} estimate={{ totalMicro: tregResult.estimatedMicro, calls: 0 }} result={tregResult} />}
    </Panel>}

    {showSettings && <SettingsPanel key={settings.updatedAt ?? 'new'} settings={settings} onSaved={text => { setMessage(text); setShowSettings(false); void load(); void reloadTreg(); }} />}

    <Panel padding="none">
      <div className="grid grid-cols-2 md:grid-cols-4">
        <MetricCard label="Total Mentions" value={compactNumber(dashboard.totals.mentions)} note={`Official ${dashboard.totals.official} · Earned ${dashboard.totals.earned}`} />
        <MetricCard label="Total Engagement" value={compactNumber(dashboard.totals.engagement)} note="Likes + comments + shares" />
        <MetricCard label="Potential Reach (estimate)" value={compactNumber(dashboard.totals.reach)} note="Views, followers, or assumed readers" />
        <MetricCard label={`Ad Value (estimate, ${dashboard.currency})`} value={compactNumber(dashboard.totals.adValue)} note="Reach ÷ 1,000 × CPM (Settings)" />
      </div>
    </Panel>

    {ins?.executiveSummary && <Panel><SectionHeader title="Executive summary" description={`AI-assisted, from the mentions in ${dashboard.range.from} to ${dashboard.range.to}.`} /><p className="mt-3 text-sm leading-6 text-[var(--mos-text-secondary)]">{ins.executiveSummary}</p></Panel>}

    <Panel>
      <SectionHeader title="Mentions & engagement over time" description={`${dashboard.range.from} to ${dashboard.range.to} (Asia/Jakarta days)`} />
      <div className="mt-3 text-[var(--mos-text-muted)]">{dashboard.totals.mentions ? <TrendChart dashboard={dashboard} /> : <EmptyState title="No mentions in this range" description="Refresh, widen the date range, or add keywords and Google Alerts feeds in Settings." />}</div>
      {ins?.trendNote && <p className="mt-2 text-sm text-[var(--mos-text-secondary)]">{ins.trendNote}</p>}
    </Panel>

    <div className="grid gap-6 lg:grid-cols-2">
      <Panel>
        <SectionHeader title="Sentiment" description={dashboard.sentiment.unscored ? `${dashboard.sentiment.unscored} mention(s) not yet scored (scored on the next refresh).` : 'Scored by the MarketingOS model; you can correct any label below.'} />
        <div className="mt-4 flex h-4 w-full overflow-hidden rounded">
          {(['positive', 'neutral', 'negative', 'unscored'] as const).map(key => dashboard.sentiment[key] > 0 && <div key={key} className={SENT_BAR[key]} style={{ width: `${(dashboard.sentiment[key] / Math.max(1, dashboard.totals.mentions)) * 100}%` }} title={`${key}: ${dashboard.sentiment[key]}`} />)}
        </div>
        <p className="mt-2 text-sm text-[var(--mos-text-secondary)]">Positive {dashboard.sentiment.positive} ({percent(dashboard.sentiment.positive, scored)}) · Neutral {dashboard.sentiment.neutral} ({percent(dashboard.sentiment.neutral, scored)}) · Negative {dashboard.sentiment.negative} ({percent(dashboard.sentiment.negative, scored)})</p>
        {ins?.sentimentNote && <p className="mt-2 text-sm text-[var(--mos-text-secondary)]">{ins.sentimentNote}</p>}
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="py-2">Channel</th><th className="py-2 text-right">Positive</th><th className="py-2 text-right">Neutral</th><th className="py-2 text-right">Negative</th><th className="py-2 text-right">Total</th></tr></thead>
          <tbody>{dashboard.byChannel.map(row => <tr key={row.channel} className="border-t border-[var(--mos-border)] text-[var(--mos-text-secondary)]"><td className="py-2">{MEDIA_CHANNEL_LABELS[row.channel]}</td><td className="py-2 text-right">{row.positive}</td><td className="py-2 text-right">{row.neutral}</td><td className="py-2 text-right">{row.negative}</td><td className="py-2 text-right font-medium text-[var(--mos-text)]">{row.total}</td></tr>)}</tbody>
        </table>
        {ins?.channelObservations.length ? <ul className="mt-3 list-disc pl-5 text-sm text-[var(--mos-text-secondary)]">{ins.channelObservations.map(item => <li key={item}>{item}</li>)}</ul> : null}
      </Panel>
      <Panel>
        <SectionHeader title="Top sources" description={dashboard.bySource.map(row => `${MEDIA_SOURCE_LABELS[row.source]}: ${row.mentions}`).join(' · ') || 'No data yet.'} />
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="py-2">Source</th><th className="py-2">Channel</th><th className="py-2 text-right">Mentions</th><th className="py-2 text-right">Engagement</th></tr></thead>
          <tbody>{dashboard.topSources.map(source => <tr key={`${source.channel}-${source.name}`} className="border-t border-[var(--mos-border)] text-[var(--mos-text-secondary)]"><td className="max-w-[220px] truncate py-2" title={source.name}>{source.name}</td><td className="py-2 text-xs">{MEDIA_CHANNEL_LABELS[source.channel]}</td><td className="py-2 text-right">{source.mentions}</td><td className="py-2 text-right">{compactNumber(source.engagement)}</td></tr>)}</tbody>
        </table>
      </Panel>
    </div>

    <DataTableFrame title="Top 5 posts" description="By engagement, then estimated reach.">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="p-3">Channel</th><th className="p-3">Author / source</th><th className="p-3">Post</th><th className="p-3 text-right">Engagement</th><th className="p-3 text-right">Ad value (est.)</th></tr></thead>
        <tbody>{dashboard.topPosts.map(post => <tr key={post.id} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
          <td className="p-3 text-xs">{MEDIA_CHANNEL_LABELS[post.channel]}{post.isOfficial && <StatusBadge className="ml-1" tone="info">Official</StatusBadge>}</td>
          <td className="p-3 text-xs">{post.author}</td>
          <td className="max-w-[420px] p-3"><a href={post.url} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--mos-accent-soft)] hover:underline">{post.title || post.url}</a></td>
          <td className="p-3 text-right">{compactNumber(post.engagement)}</td>
          <td className="p-3 text-right">{compactNumber(post.adValue)}</td>
        </tr>)}</tbody>
      </table>
      {!dashboard.topPosts.length && <p className="p-3 text-sm text-[var(--mos-text-muted)]">No posts in this range.</p>}
      {ins?.topPostsNote && <p className="p-3 text-sm text-[var(--mos-text-secondary)]">{ins.topPostsNote}</p>}
    </DataTableFrame>

    <Panel data-testid="media-insights">
      <SectionHeader title="Insights & recommendations" description={insights ? `Generated ${when(insights.createdAt)}${insights.model ? ` · ${insights.model}` : ''}. Based only on the mentions in this range.` : 'Not generated for this range yet.'}
        action={<Button disabled={insightsBusy || !dashboard.totals.mentions} onClick={generateInsights}>{insightsBusy ? 'Generating…' : insights ? 'Regenerate insights' : 'Generate insights'}</Button>} />
      {ins && <div className="mt-4 grid gap-5 text-sm text-[var(--mos-text-secondary)] lg:grid-cols-2">
        {ins.perception.summary && <div><h3 className="font-medium text-[var(--mos-text)]">Perception</h3><p className="mt-1">{ins.perception.summary}</p>
          <ul className="mt-2 list-disc pl-5"><li>Awareness: {ins.perception.awareness}</li><li>Interpretation: {ins.perception.interpretation}</li><li>Niche discussion: {ins.perception.nicheDiscussion}</li></ul>
          {ins.perception.overallTone && <p className="mt-2">{ins.perception.overallTone}</p>}</div>}
        {ins.keyInsights.length > 0 && <div><h3 className="font-medium text-[var(--mos-text)]">Key insights</h3><ol className="mt-1 list-decimal pl-5">{ins.keyInsights.map(item => <li key={item}>{item}</li>)}</ol></div>}
        <div><h3 className="font-medium text-[var(--mos-text)]">Sentiment drivers</h3><ul className="mt-1 list-disc pl-5"><li>Positive: {ins.sentimentDrivers.positive || '—'}</li><li>Neutral: {ins.sentimentDrivers.neutral || '—'}</li><li>Negative: {ins.sentimentDrivers.negative || '—'}</li></ul></div>
        <div><h3 className="font-medium text-[var(--mos-text)]">Recommendations</h3>
          {(['strengths', 'fixes', 'additional'] as const).map(key => ins.recommendations[key].length > 0 && <div key={key} className="mt-1"><p className="text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">{key}</p><ul className="list-disc pl-5">{ins.recommendations[key].map(item => <li key={item}>{item}</li>)}</ul></div>)}
        </div>
      </div>}
    </Panel>

    <DataTableFrame title={`Mentions (${mentions.length}${overview.mentions.length >= 300 ? '+' : ''})`} description="Deduplicated by URL. Newest first."
      action={<Select value={channelFilter} onChange={event => setChannelFilter(event.target.value)}><option value="all">All channels</option>{MEDIA_CHANNELS.map(channel => <option key={channel} value={channel}>{MEDIA_CHANNEL_LABELS[channel]}</option>)}</Select>}>
      <table className="w-full min-w-[960px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="p-3">Date</th><th className="p-3">Channel</th><th className="p-3">Mention</th><th className="p-3">Source</th><th className="p-3 text-right">Engagement</th><th className="p-3 text-right">Ad value</th><th className="p-3">Sentiment</th></tr></thead>
        <tbody>{mentions.map(mention => <tr key={mention.id} className="border-b border-[var(--mos-border)] align-top text-[var(--mos-text-secondary)]">
          <td className="whitespace-nowrap p-3 text-xs">{mention.publishedAt ? mention.publishedAt.slice(0, 10) : '—'}</td>
          <td className="p-3 text-xs">{MEDIA_CHANNEL_LABELS[mention.channel]}{mention.isOfficial && <StatusBadge className="ml-1" tone="info">Official</StatusBadge>}</td>
          <td className="max-w-[420px] p-3"><a href={mention.url} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--mos-accent-soft)] hover:underline">{mention.title || mention.url}</a>{mention.snippet && <p className="mt-1 line-clamp-2 text-xs text-[var(--mos-text-muted)]">{mention.snippet}</p>}</td>
          <td className="p-3 text-xs">{mention.author || mention.sourceName || '—'}<br /><span className="text-[var(--mos-text-faint)]">{MEDIA_SOURCE_LABELS[mention.source]}</span></td>
          <td className="p-3 text-right">{compactNumber(engagementOf(mention))}</td>
          <td className="p-3 text-right">{compactNumber(estimatedAdValue(mention, settings.adValue))}</td>
          <td className="p-3">
            <Select aria-label="Sentiment" value={mention.sentiment ?? ''} onChange={event => event.target.value && setSentiment(mention.id, event.target.value as Sentiment)}>
              {!mention.sentiment && <option value="">Not scored</option>}
              {(['positive', 'neutral', 'negative'] as const).map(value => <option key={value} value={value}>{value}</option>)}
            </Select>
            {mention.sentiment && <StatusBadge className="mt-1" tone={SENT_TONE[mention.sentiment]}>{mention.sentiment}</StatusBadge>}
          </td>
        </tr>)}</tbody>
      </table>
      {!mentions.length && <p className="p-3 text-sm text-[var(--mos-text-muted)]">No mentions.</p>}
    </DataTableFrame>

    {overview.runs.length > 0 && <DataTableFrame title="Refresh history" description="Scheduled refreshes are free-only; treg runs are manual.">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="p-3">Started</th><th className="p-3">Trigger</th><th className="p-3">Mode</th><th className="p-3">Status</th><th className="p-3">Result</th><th className="p-3">treg cost</th></tr></thead>
        <tbody>{overview.runs.map(run => <tr key={run.id} className="border-b border-[var(--mos-border)] align-top text-[var(--mos-text-secondary)]">
          <td className="p-3 text-xs">{when(run.createdAt)}</td>
          <td className="p-3 text-xs">{run.trigger === 'scheduled' ? 'Scheduled' : 'Manual'}</td>
          <td className="p-3 text-xs">{run.mode === 'treg' ? `Free + treg (${run.platforms.length})` : 'Free'}</td>
          <td className="p-3 text-xs"><StatusBadge tone={run.status === 'succeeded' ? 'success' : run.status === 'failed' ? 'danger' : 'info'}>{run.status}</StatusBadge></td>
          <td className="max-w-[380px] p-3 text-xs">{run.error || (run.stats ? `${run.stats.unique ?? 0} unique · ${run.stats.inserted ?? 0} new · ${run.stats.scored ?? 0} scored` : run.message)}
            {run.notes.length > 0 && <details className="mt-1"><summary className="cursor-pointer text-[var(--mos-text-faint)]">Notes ({run.notes.length})</summary><ul className="mt-1 list-disc pl-4">{run.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></details>}</td>
          <td className="p-3 text-xs">{run.cost?.actualMicro !== undefined ? `$${((run.cost.actualMicro ?? 0) / 1_000_000).toFixed(4)} (est. $${((run.cost.estimatedMicro ?? 0) / 1_000_000).toFixed(4)})` : '—'}</td>
        </tr>)}</tbody>
      </table>
    </DataTableFrame>}
  </PageStack>;
}
