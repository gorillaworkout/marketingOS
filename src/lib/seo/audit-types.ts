export type IssueSeverity = 'error' | 'warning' | 'notice';

export interface AuditIssue {
  code: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  urls: string[];
}

export interface CrawledPage {
  url: string;
  finalUrl: string;
  status: number;
  redirectHops: number;
  title: string;
  metaDescription: string;
  h1Count: number;
  missingAlt: number;
  canonical: string | null;
  noindex: boolean;
  wordCount: number;
  bytes: number;
  mixedContent: number;
  depth: number;
  html: boolean;
  inSitemap: boolean;
  inbound: number;
  issueCount: number;
}

export interface NotConnectedCard {
  status: 'not-connected';
  title: string;
  needed: string;
}

export interface IndexingRow {
  url: string;
  reasons: string[];
}

export interface PsiMetrics {
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  fcp: number | null;
  ttfb: number | null;
}

export interface PsiReading {
  url: string;
  strategy: 'mobile' | 'desktop';
  performanceScore: number | null;
  lab: PsiMetrics | null;
  field: (PsiMetrics & { category: string | null }) | null;
  error: string | null;
}

export interface AuditResult {
  healthScore: number;
  issues: AuditIssue[];
  pages: CrawledPage[];
  indexing: { rows: IndexingRow[]; gsc: NotConnectedCard; ga4: NotConnectedCard };
  psi: PsiReading[];
  psiKeyUsed: boolean;
  /** timedOut: the crawl stopped at its time limit, so the result is partial. */
  limits: { maxPages: number; crawled: number; timedOut?: boolean };
}
