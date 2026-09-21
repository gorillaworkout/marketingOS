import {
  validateGeneratedArticle,
  type ArticleMarketNewsInput,
  type ArticleQualityCheck,
  type ArticleSourceInput,
} from './article-market-news';

export const ARTICLE_MARKET_NEWS_HISTORY_TYPE = 'article-market-news' as const;

export interface ArticleMarketNewsHistoryTask {
  id: string;
  title: string;
  brief?: string;
  output_data?: string;
  created_at: string;
  type?: string;
}

export interface RestoredArticleMarketNews {
  keyword: string;
  researchDate: string;
  angle: string;
  competitorHeadings: string;
  paaText: string;
  sources: ArticleSourceInput[];
  noCompetitorBroker: boolean;
  generatedInput: ArticleMarketNewsInput;
  factReviewConfirmed: false;
  result: {
    title: string;
    metaDescription?: string;
    articleMarkdown: string;
    excerpt?: string;
    sourcesCited?: string[];
    wordCount: number;
    model: string;
    qc: ArticleQualityCheck;
    historyId: string;
    normalizedInput: ArticleMarketNewsInput;
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function restoreSources(value: unknown): ArticleSourceInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const source = asRecord(item);
    if (!source) return [];
    const outlet = typeof source.outlet === 'string' ? source.outlet : '';
    const title = typeof source.title === 'string' ? source.title : '';
    const url = typeof source.url === 'string' ? source.url : '';
    const publishedAt = typeof source.publishedAt === 'string' ? source.publishedAt : '';
    const verifiedFacts = typeof source.verifiedFacts === 'string' ? source.verifiedFacts : '';
    if (!outlet && !title && !url) return [];
    const provenance = source.provenance === 'automated' || source.provenance === 'user'
      ? source.provenance
      : undefined;
    return [{ outlet, title, url, publishedAt, verifiedFacts, ...(provenance ? { provenance } : {}) }];
  });
}

export function isArticleMarketNewsHistoryType(type: string | null | undefined): boolean {
  return type === ARTICLE_MARKET_NEWS_HISTORY_TYPE;
}

export function restoreArticleMarketNews(task: ArticleMarketNewsHistoryTask): RestoredArticleMarketNews {
  let stored: unknown;
  try {
    stored = JSON.parse(task.output_data || '{}');
  } catch {
    throw new Error('Saved article is incomplete.');
  }

  const output = asRecord(stored);
  if (!output) throw new Error('Saved article is incomplete.');

  const article = asRecord(output.article) || output;
  const input = asRecord(output.input);
  const title = typeof article.title === 'string' ? article.title.trim() : '';
  const articleMarkdown = typeof article.articleMarkdown === 'string' ? article.articleMarkdown : '';
  const keyword = typeof input?.keyword === 'string' ? input.keyword : '';
  const researchDate = typeof input?.researchDate === 'string' ? input.researchDate : '';
  const angle = typeof input?.angle === 'string' ? input.angle : '';

  if (!input || !title || !articleMarkdown || !keyword || !researchDate) {
    throw new Error('Saved article is incomplete.');
  }

  const paaQuestions = Array.isArray(input.paaQuestions)
    ? input.paaQuestions.filter((question): question is string => typeof question === 'string')
    : [];
  const generatedInput: ArticleMarketNewsInput = {
    keyword,
    researchDate,
    angle,
    competitorHeadings: typeof input.competitorHeadings === 'string' ? input.competitorHeadings : '',
    paaQuestions,
    sources: restoreSources(input.sources),
    noCompetitorBroker: input.noCompetitorBroker === true,
    factsVerified: input.factsVerified === true,
  };
  const metaDescription = typeof article.metaDescription === 'string' ? article.metaDescription : '';
  const validation = validateGeneratedArticle(title, articleMarkdown, generatedInput, metaDescription);
  const storedQc = asRecord(output.qc) as ArticleQualityCheck | null;

  return {
    keyword,
    researchDate,
    angle,
    competitorHeadings: generatedInput.competitorHeadings,
    paaText: paaQuestions.join('\n'),
    sources: generatedInput.sources,
    noCompetitorBroker: generatedInput.noCompetitorBroker,
    generatedInput,
    factReviewConfirmed: false,
    result: {
      title,
      metaDescription,
      articleMarkdown,
      excerpt: typeof article.excerpt === 'string' ? article.excerpt : undefined,
      sourcesCited: Array.isArray(article.sourcesCited)
        ? article.sourcesCited.filter((item): item is string => typeof item === 'string')
        : undefined,
      wordCount: Number(article.wordCount) || validation.wordCount,
      model: typeof output.model === 'string' && output.model ? output.model : 'Unknown',
      qc: storedQc || validation.qc,
      historyId: task.id,
      normalizedInput: generatedInput,
    },
  };
}
