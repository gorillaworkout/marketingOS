/**
 * Competitor insights and Caption Analyzer shaping.
 * Safe to import from the browser. No database and no network.
 */

import { clipText } from '@/lib/social-post-library';
import { dedupeHashtags, isHttpUrl, isSocialNetworkUrl } from '@/lib/social-post-brief';

export const COMPETITOR_TEXT_MAX = 3_000;
export const COMPETITOR_INSIGHT_MAX = 400;
export const COMPETITORS_IN_PROMPT = 3;
export const COMPETITOR_NAME_MAX = 80;

export const ANALYZER_DIMENSIONS = ['hook', 'clarity', 'brandVoice', 'cta', 'platformFit', 'compliance'] as const;
export type AnalyzerDimension = (typeof ANALYZER_DIMENSIONS)[number];

export type CompetitorAnalysis = {
  hookPattern?: string;
  structure?: string;
  tone?: string;
  ctaStyle?: string;
  hashtagStyle?: string;
  visualNotes?: string;
  strengths?: string[];
  weaknesses?: string[];
  whatToAvoid?: string[];
  differentiationIdeas?: string[];
};

export type CaptionCheck = { name: string; label: string; passed: boolean; detail: string };

export type CaptionAnalysisResult = {
  score: number;
  summary: string;
  checks: CaptionCheck[];
  dimensions: Record<AnalyzerDimension, { score: number; note: string }>;
  recommendations: Array<{ priority: 'high' | 'medium' | 'low'; issue: string; fix: string }>;
  rewrittenHook: string;
  improvedCaption: string;
  suggestedHashtags: string[];
};

export function canDeleteCompetitor(user: { id: string; role: string }, row: { createdBy: string }): boolean {
  return user.role === 'admin' || user.id === row.createdBy;
}

export function competitorIdsFromBody(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [];
  const ids: string[] = [];
  for (const item of source) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= COMPETITORS_IN_PROMPT) break;
  }
  return ids;
}

/** A public article may be read once. A social-network URL is stored and never fetched. */
export function competitorFetchDecision(url: string, alreadyRead: boolean): { action: 'skip' | 'fetch' } | { error: string } {
  if (!isHttpUrl(url)) return { error: 'Competitor URL must start with http:// or https://.' };
  if (isSocialNetworkUrl(url)) return { error: 'Social network URLs are stored as links only and are never fetched.' };
  if (alreadyRead) return { action: 'skip' };
  return { action: 'fetch' };
}

function verbatimSpan(piece: string, source: string): boolean {
  const needle = piece.toLowerCase().replace(/\s+/g, ' ').trim();
  const haystack = source.toLowerCase().replace(/\s+/g, ' ').trim();
  if (needle.length >= 40 && haystack.includes(needle)) return true;
  if (haystack.length < 40) return false;
  for (let index = 0; index + 40 <= haystack.length; index += 20) {
    if (needle.includes(haystack.slice(index, index + 40))) return true;
  }
  return false;
}

export function approachInsight(analysis: CompetitorAnalysis, sourceText = ''): string {
  const pieces = [
    analysis.hookPattern,
    analysis.structure,
    analysis.tone,
    analysis.ctaStyle,
    analysis.hashtagStyle,
    ...(analysis.differentiationIdeas || []),
    ...(analysis.whatToAvoid || []),
  ].map(item => (item || '').trim()).filter(Boolean);
  const safe = pieces.filter(piece => !verbatimSpan(piece, sourceText));
  const text = (safe.length > 0 ? safe : ['Use a different angle. Do not copy the reference.']).join(' ');
  return clipText(text, COMPETITOR_INSIGHT_MAX);
}

export function buildCompetitorInsightsBlock(insights: string[]): string {
  const lines = insights.map(item => item.trim()).filter(Boolean).slice(0, COMPETITORS_IN_PROMPT).map(item => clipText(item, COMPETITOR_INSIGHT_MAX));
  if (lines.length === 0) return '';
  return [
    'COMPETITOR_INSIGHTS',
    'Differentiate from these approaches. Never name or disparage a competitor. Never copy their wording.',
    ...lines.map((line, index) => `${index + 1}. ${line}`),
  ].join('\n');
}

export function parseCompetitorAnalysis(value: unknown): CompetitorAnalysis {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const text = (key: string) => typeof raw[key] === 'string' ? raw[key].trim().slice(0, 240) : '';
  const list = (key: string) => Array.isArray(raw[key])
    ? raw[key].filter((item): item is string => typeof item === 'string').map(item => item.trim().slice(0, 160)).filter(Boolean).slice(0, 4)
    : [];
  return {
    hookPattern: text('hookPattern'),
    structure: text('structure'),
    tone: text('tone'),
    ctaStyle: text('ctaStyle'),
    hashtagStyle: text('hashtagStyle'),
    visualNotes: text('visualNotes'),
    strengths: list('strengths'),
    weaknesses: list('weaknesses'),
    whatToAvoid: list('whatToAvoid'),
    differentiationIdeas: list('differentiationIdeas'),
  };
}

function dimensionScore(value: unknown): number {
  const score = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(score)) return 3;
  return Math.max(1, Math.min(5, Math.round(score)));
}

export function normalizeCaptionAnalysis(raw: unknown, checks: CaptionCheck[]): CaptionAnalysisResult {
  const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const dimensions = {} as CaptionAnalysisResult['dimensions'];
  const source = body.dimensions && typeof body.dimensions === 'object' ? body.dimensions as Record<string, unknown> : {};
  for (const name of ANALYZER_DIMENSIONS) {
    const item = source[name] && typeof source[name] === 'object' ? source[name] as { score?: unknown; note?: unknown } : {};
    const note = typeof item.note === 'string' && item.note.trim()
      ? item.note.trim().slice(0, 240)
      : name === 'compliance'
        ? 'BAPPEBTI: do not promise guaranteed profit or risk-free returns.'
        : 'Not assessed.';
    dimensions[name] = { score: dimensionScore(item.score), note };
  }
  const recommendations: CaptionAnalysisResult['recommendations'] = Array.isArray(body.recommendations)
    ? body.recommendations.flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const priority = (item as { priority?: unknown }).priority;
      const issue = String((item as { issue?: unknown }).issue || '').trim().slice(0, 200);
      const fix = String((item as { fix?: unknown }).fix || '').trim().slice(0, 240);
      if (!issue || !fix) return [];
      const rank: 'high' | 'medium' | 'low' = priority === 'high' || priority === 'low' ? priority : 'medium';
      return [{ priority: rank, issue, fix }];
    }).slice(0, 6)
    : [];
  const modelScore = typeof body.score === 'number' ? body.score : Number(body.score);
  const qcScore = checks.length ? Math.round(checks.filter(check => check.passed).length / checks.length * 100) : 0;
  const score = Number.isFinite(modelScore) ? Math.max(0, Math.min(100, Math.round(modelScore))) : qcScore;
  return {
    score,
    summary: typeof body.summary === 'string' ? body.summary.trim().slice(0, 600) : '',
    checks,
    dimensions,
    recommendations,
    rewrittenHook: typeof body.rewrittenHook === 'string' ? body.rewrittenHook.trim().slice(0, 200) : '',
    improvedCaption: typeof body.improvedCaption === 'string' ? body.improvedCaption.trim().slice(0, 2_200) : '',
    suggestedHashtags: dedupeHashtags(Array.isArray(body.suggestedHashtags) ? body.suggestedHashtags.filter((item): item is string => typeof item === 'string') : []).slice(0, 20),
  };
}
