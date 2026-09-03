'use client';
import { useEffect, useState } from 'react';
import { articleDocxFilename, buildArticleDocxBlob } from '@/lib/article-market-news-docx';
import type { ArticleSourceInput } from '@/lib/article-market-news';
import { buildMarketResearchDocxBlob, marketResearchDocxFilename } from '@/lib/market-research-docx';
import type { MarketResearchItem } from '@/lib/market-research';
import { Button, EmptyState, FilterGroup, LoadingState, Panel, PageHeader, PageStack, StatusBadge, Toolbar } from '@/components/ui/dashboard';

interface HistoryTask {
  id: string;
  type: string;
  title: string;
  brief?: string;
  status: string;
  output_data?: string;
  created_at: string;
}

export default function HistoryPage() {
  const [tasks, setTasks] = useState<HistoryTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<HistoryTask | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'social-post' | 'video-script' | 'event-plan' | 'article-market-news' | 'market-research'>('all');
  const [articleFactReviewConfirmed, setArticleFactReviewConfirmed] = useState(false);
  const [marketResearchReviewConfirmed, setMarketResearchReviewConfirmed] = useState(false);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    // Fetch per type. The API caps at 50 rows, so filtering a mixed "all" list
    // client-side used to hide Market Research entirely once newer tasks of
    // other types filled that window.
    let active = true;
    const load = async () => {
      const query = typeFilter === 'all' ? '' : `type=${encodeURIComponent(typeFilter)}`;
      try {
        const response = await fetch(`/api/dashboard/history${query ? `?${query}` : ''}`);
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `History request failed with HTTP ${response.status}.`);
        }
        const data = await response.json();
        if (!active) return;
        setTasks(data.tasks || []);
        setHistoryError('');
      } catch (cause) {
        if (!active) return;
        setTasks([]);
        setHistoryError(cause instanceof Error ? cause.message : 'Failed to load history.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [typeFilter]);

  const typeLabels: Record<string, string> = { 'social-post': 'Social Post', 'video-script': 'Video Script', 'event-plan': 'Event Plan', 'article-market-news': 'Article Market News', 'market-research': 'Market Research' };
  const filteredTasks = tasks;

  const downloadJSON = (task: HistoryTask) => {
    const blob = new Blob([task.output_data || '{}'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${task.type}-${task.id.substring(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadArticleDocx = async (task: HistoryTask) => {
    if (!articleFactReviewConfirmed) return;
    const data = JSON.parse(task.output_data || '{}');
    const article = data.article || {};
    const input = data.input || {};
    if (!article.title || !article.articleMarkdown || !input.keyword || !input.researchDate) return;
    const blob = await buildArticleDocxBlob(article.title, article.metaDescription || '', article.articleMarkdown);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = articleDocxFilename(input.keyword, input.researchDate);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadMarketResearchDocx = async (task: HistoryTask) => {
    if (!marketResearchReviewConfirmed) return;
    const data = JSON.parse(task.output_data || '{}');
    const input = data.input || {};
    const items = data.report?.items || [];
    if (!input.brief || !input.researchDate || !Array.isArray(items) || items.length === 0) return;
    const blob = await buildMarketResearchDocxBlob(input.brief, input.researchDate, items);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = marketResearchDocxFilename(input.researchDate);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <LoadingState label="Loading task history" />;

  return (
    <PageStack>
      <PageHeader eyebrow="Library / Archive" title="Task history" description="Review and download generated content across every production workflow." />

      <Toolbar><FilterGroup>
        {(['all', 'social-post', 'video-script', 'event-plan', 'article-market-news', 'market-research'] as const).map(type => (
          <button key={type} onClick={() => setTypeFilter(type)} className={`rounded-lg px-3 py-1.5 text-sm ${typeFilter === type ? 'bg-blue-600 text-white' : 'bg-[var(--mos-raised)] text-[var(--mos-text-muted)] hover:text-white'}`}>
            {type === 'all' ? 'All Tasks' : type === 'event-plan' ? 'Event Plans' : typeLabels[type]}
          </button>
        ))}
      </FilterGroup></Toolbar>

      {historyError && <div className="rounded-[var(--mos-radius-panel)] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{historyError}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Task List */}
        <Panel padding="none" className="lg:col-span-1 max-h-[70vh] overflow-y-auto">
          {filteredTasks.length > 0 ? filteredTasks.map(task => (
            <div key={task.id}
              onClick={() => { setSelected(task); setArticleFactReviewConfirmed(false); setMarketResearchReviewConfirmed(false); }}
              className={`p-4 border-b border-[var(--mos-border)] cursor-pointer hover:bg-[var(--mos-raised)] transition-colors ${selected?.id === task.id ? 'bg-blue-600/10 border-l-2 border-l-blue-500' : ''}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-[var(--mos-text-faint)]">{typeLabels[task.type] || task.type}</span>
                <StatusBadge className="ml-auto" tone={task.status === 'completed' ? 'success' : 'warning'} dot>{task.status}</StatusBadge>
              </div>
              <p className="text-sm text-[var(--mos-text-secondary)] truncate">{task.title}</p>
              <p className="text-xs text-gray-600 mt-1">{new Date(task.created_at).toLocaleString()}</p>
            </div>
          )) : <EmptyState title="No tasks yet" className="min-h-48" />}
        </Panel>

        {/* Detail View */}
        <div className="lg:col-span-2">
          {selected ? (
            <Panel>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{selected.title}</h3>
                    <p className="text-xs text-[var(--mos-text-faint)]">{new Date(selected.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <Button variant="primary" onClick={() => selected.type === 'market-research' ? void downloadMarketResearchDocx(selected) : selected.type === 'article-market-news' ? void downloadArticleDocx(selected) : downloadJSON(selected)}
                  disabled={(selected.type === 'article-market-news' && !articleFactReviewConfirmed) || (selected.type === 'market-research' && !marketResearchReviewConfirmed)}
                >
                  {selected.type === 'article-market-news' || selected.type === 'market-research' ? 'Download DOCX' : 'Download'}
                </Button>
              </div>

              <div className="space-y-4">
                {/* Brief */}
                {selected.brief && (
                  <div>
                    <label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Brief</label>
                    <p className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-raised)] p-3 rounded-lg">{selected.brief}</p>
                  </div>
                )}

                {/* Output Content */}
                {selected.output_data && (() => {
                  try {
                    const data = JSON.parse(selected.output_data);

                    if (selected.type === 'article-market-news') {
                      const article = data.article || data;
                      const input = data.input || {};
                      return (
                        <>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Model</label><p className="mt-1 text-[var(--mos-text-secondary)]">{data.model || 'Codex'}</p></div>
                            <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Word Count</label><p className="mt-1 text-[var(--mos-text-secondary)]">{article.wordCount || '—'}</p></div>
                          </div>
                          <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Meta Description</label><p className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-raised)] p-3 rounded-lg">{article.metaDescription}</p></div>
                          <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Article</label><pre className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-surface)] p-4 rounded-lg text-sm whitespace-pre-wrap font-mono max-h-[50vh] overflow-y-auto">{article.articleMarkdown}</pre></div>
                          {Array.isArray(input.sources) && input.sources.length > 0 && <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Research Sources</label><ul className="mt-2 space-y-2">{input.sources.map((source: ArticleSourceInput, index: number) => <li key={`${source.url}-${index}`} className="rounded-lg bg-[var(--mos-raised)] p-3 text-sm"><span className="text-[var(--mos-text-secondary)]">{source.outlet} — {source.title}</span><a href={source.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-cyan-400 hover:underline">{source.url}</a><span className="mt-1 block text-xs text-[var(--mos-text-faint)]">{source.provenance === 'automated' ? 'Automated publisher research' : 'Optional user reference'}</span></li>)}</ul></div>}
                          <label className="flex cursor-pointer gap-3 rounded-[var(--mos-radius-panel)] border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">
                            <input type="checkbox" checked={articleFactReviewConfirmed} onChange={event => setArticleFactReviewConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-500" />
                            <span>Saya sudah memeriksa ulang klaim nonnumeric dan source snapshot artikel ini. Aktifkan untuk Download DOCX.</span>
                          </label>
                        </>
                      );
                    }

                    if (selected.type === 'market-research') {
                      const items = (data.report?.items || []) as MarketResearchItem[];
                      return (
                        <>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Model</label><p className="mt-1 text-[var(--mos-text-secondary)]">{data.model || 'Codex'}</p></div>
                            <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Candidates Compared</label><p className="mt-1 text-[var(--mos-text-secondary)]">{data.candidateCount || '—'}</p></div>
                            <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Selected</label><p className="mt-1 text-[var(--mos-text-secondary)]">{items.length}</p></div>
                          </div>
                          {Array.isArray(data.sourceStatus) && <div className="rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-surface)] p-4"><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Publisher Feed Status</label><div className="mt-2 space-y-1">{data.sourceStatus.map((source: { outlet: string; status: 'ok' | 'error'; candidateCount: number; error?: string }) => <p key={source.outlet} className={source.status === 'ok' ? 'text-xs text-emerald-400' : 'text-xs text-red-300'}>{source.outlet}: {source.status === 'ok' ? `OK · ${source.candidateCount} candidate` : `Failed · ${source.error || 'Unavailable'}`}</p>)}</div></div>}
                          <div className="space-y-3">
                            {items.map((item, index) => <article key={item.candidateId} className="rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-surface)] p-4">
                              <p className="text-xs font-semibold text-cyan-400">#{index + 1} · {item.symbol || item.productCategory} · {item.productCategory}{item.importanceCategory ? ` · ${item.importanceCategory}` : ''}</p>
                              <h4 className="mt-1 font-semibold text-white">{item.articleTitle}</h4>
                              <p className="mt-1 text-xs text-[var(--mos-text-faint)]">{item.newsSource} · {item.publicationDate} {item.publicationTime} WIB · Latest Update Time: {item.latestUpdateTime ? `${item.latestUpdateTime} WIB` : 'Not provided'}</p>
                              <dl className="mt-3 space-y-2 text-sm"><div><dt className="text-[var(--mos-text-faint)]">Main Event</dt><dd className="text-[var(--mos-text-secondary)]">{item.mainEvent}</dd></div><div><dt className="text-[var(--mos-text-faint)]">Latest Factual Development</dt><dd className="text-[var(--mos-text-secondary)]">{item.latestFactualDevelopment}</dd></div><div><dt className="text-[var(--mos-text-faint)]">Market Relevance</dt><dd className="text-[var(--mos-text-secondary)]">{item.marketRelevance}</dd></div></dl>
                              <a href={item.articleUrl} target="_blank" rel="noreferrer" className="mt-3 block break-all text-sm text-cyan-400 hover:underline">{item.articleUrl}</a>
                            </article>)}
                          </div>
                          <label className="flex cursor-pointer gap-3 rounded-[var(--mos-radius-panel)] border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">
                            <input type="checkbox" checked={marketResearchReviewConfirmed} onChange={event => setMarketResearchReviewConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-500" />
                            <span>Saya sudah membuka seluruh link dan membaca artikel lengkap. Aktifkan untuk Download DOCX.</span>
                          </label>
                        </>
                      );
                    }

                    if (selected.type === 'social-post') {
                      const caption = data.captionData || data;
                      return (
                        <>
                          <div>
                            <label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">📝 Caption</label>
                            <div className="bg-white rounded-[var(--mos-radius-panel)] p-4 mt-1 max-w-md">
                              {caption.hook && <p className="text-gray-900 font-semibold mb-2">{caption.hook}</p>}
                              <p className="text-gray-800 text-sm whitespace-pre-wrap">{caption.caption || caption.captionData?.caption}</p>
                              {caption.hashtags?.length > 0 && <p className="text-blue-600 text-sm mt-2">{caption.hashtags.join(' ')}</p>}
                            </div>
                          </div>
                          {data.imagePrompt && (
                            <div>
                              <label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Image Prompt</label>
                              <p className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-surface)] p-3 rounded-lg font-mono text-sm">{data.imagePrompt}</p>
                            </div>
                          )}
                        </>
                      );
                    }

                    if (selected.type === 'video-script') {
                      const script = data.scriptData || data;
                      return (
                        <>
                          {script.hook && <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Hook</label><p className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-raised)] p-3 rounded-lg">{script.hook}</p></div>}
                          {script.context && <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Context</label><p className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-raised)] p-3 rounded-lg">{script.context}</p></div>}
                          {script.highlight && <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Highlight</label><p className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-raised)] p-3 rounded-lg">{script.highlight}</p></div>}
                          {script.fullScript && <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Full Script</label><pre className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-raised)] p-4 rounded-lg text-sm whitespace-pre-wrap font-mono">{script.fullScript}</pre></div>}
                        </>
                      );
                    }

                    if (selected.type === 'event-plan') {
                      const plan = data.options?.[0] || data.planData || data;
                      return (
                        <>
                          {plan.objective && <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Objective</label><p className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-raised)] p-3 rounded-lg">{plan.objective}</p></div>}
                          {plan.concept && <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Concept</label><p className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-raised)] p-3 rounded-lg">{plan.concept}</p></div>}
                          {plan.venue && <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">📍 Venue</label><p className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-raised)] p-3 rounded-lg">{plan.venue}</p></div>}
                          {plan.speakers?.length > 0 && <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Speakers</label><ul className="mt-1 space-y-1">{plan.speakers.map((s: string, i: number) => <li key={i} className="text-[var(--mos-text-secondary)] bg-[var(--mos-raised)] p-2 rounded-lg">• {s}</li>)}</ul></div>}
                          {plan.budget && <div><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Budget</label><pre className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-raised)] p-3 rounded-lg text-sm">{JSON.stringify(plan.budget, null, 2)}</pre></div>}
                        </>
                      );
                    }

                    return <pre className="text-[var(--mos-text-secondary)] text-sm">{JSON.stringify(data, null, 2)}</pre>;
                  } catch {
                    return <p className="text-[var(--mos-text-muted)] text-sm">{selected.output_data}</p>;
                  }
                })()}
              </div>
            </Panel>
          ) : (
            <Panel padding="none"><EmptyState title="Select a task" description="Choose an item to view its generated output and review controls." /></Panel>
          )}
        </div>
      </div>
    </PageStack>
  );
}
