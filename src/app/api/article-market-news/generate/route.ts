import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireFeature } from '@/lib/auth';
import { execute } from '@/lib/database';
import { rateLimit } from '@/lib/rate-limit';
import { fetchKnowledgeContext, fetchStyleContext, generateContent, getUserPreferredModel } from '@/lib/openai';
import { persistKnowledgeQuietly, summarizeArticleKnowledge } from '@/lib/knowledge-persist';
import { ARTICLE_COMPLETION_MAX_TOKENS, MIN_DATED_RESEARCH_SOURCES, articleDraftProtectedPhrases, articleWordCountRepairGuidance, buildArticleExpandPrompt, buildArticleMarketNewsPrompts, countArticleWords, describeArticlePublicationGateFailure, ensureEndingDupoinAccountCta, fitArticleMarkdownWordCount, normalizeArticleMarketNewsInput, parseGeneratedArticle, finalizeArticleForPublication, repairArticleCitations, repairArticleStructure, stripUnsupportedProductNames, strongestAvailableArticleModel, validateGeneratedArticle } from '@/lib/article-market-news';
import { createArticleJobStore, type ArticleJob } from '@/lib/article-market-news-job';
import { researchArticleMarketNews } from '@/lib/article-market-news-research';
import { guardGeneratedText, mergeBrandFacts } from '@/lib/brand-fact-guard';
import { authCooldownModels } from '@/lib/llm-auth';
import { marketNewsCatalogNotice, marketNewsCoverage, topicsInKeyword } from '@/lib/market-news-topics';

export const maxDuration = 300;

const articleJobs = createArticleJobStore();

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function buildRepairPrompt(userPrompt: string, feedback: string, priorContent: string | undefined): string {
  const formatFailure = /invalid article format|ambiguous article format|incomplete article|Meta description must be/i.test(feedback);
  if (formatFailure) {
    return `${userPrompt}

RETRY FEEDBACK FROM THE DETERMINISTIC PUBLICATION GATE:
${feedback}

The prior model response was not usable as article JSON. Do not revise broken text.
Return ONLY one valid JSON object with string fields title, metaDescription, and articleMarkdown.
Encode newlines as \\n and quotes as \\" inside those strings.
No markdown fences, no prose before or after the JSON, no trailing commas, and no reasoning tags.`;
  }

  let priorDraft = priorContent?.trim() || '{}';
  if (priorDraft.length > 12_000) {
    priorDraft = `${priorDraft.slice(0, 12_000)}\n…[truncated prior draft for retry context]`;
  }

  return `${userPrompt}

RETRY FEEDBACK FROM THE DETERMINISTIC PUBLICATION GATE:
${feedback}

PRIOR DRAFT JSON TO REVISE:
${priorDraft}

Revise the prior draft instead of starting over. Keep compliant material and correct every listed issue. When the draft is outside 800–1,000 words, shorten or expand the analysis until it is 920–980 words. Add facts only from the verified source material, and return only the required JSON.
The last prose paragraph before the Sources or Sumber heading must be one imperative Dupoin account-opening sentence starting with Buka, Mulai, Daftar, or Buat. Do not invent prices, percentages, dates, or other numbers.
${articleWordCountRepairGuidance(feedback)}`;
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(request);
  if (limited) return limited;

  const auth = await requireFeature(request, 'article-market-news');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let input;
  try {
    input = normalizeArticleMarketNewsInput(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid article request.' }, { status: 400 });
  }

  const topics = topicsInKeyword(input.keyword);
  const researchFallback = topics.some(topic => marketNewsCoverage(topic) === 'research-fallback');
  const catalogNotice = marketNewsCatalogNotice(input.keyword);
  const preferred = await getUserPreferredModel(auth.id, researchFallback ? 'ai-research' : 'article-market-news');
  const model = strongestAvailableArticleModel(preferred, authCooldownModels());
  const job = articleJobs.create(auth.id);
  void runArticleJob(job, auth.id, input, model, researchFallback, catalogNotice);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let sent = 0;
      const keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`)); } catch { /* client disconnected; the job keeps running */ }
      }, 10_000);
      try {
        while (true) {
          const current = articleJobs.get(job.id, auth.id);
          if (!current) break;
          while (sent < current.events.length) {
            controller.enqueue(encoder.encode(sseEvent(current.events[sent])));
            sent += 1;
          }
          if (current.status !== 'running') break;
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      } catch {
        // The browser or proxy closed the stream. The server job continues.
      } finally {
        clearInterval(keepalive);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'article-market-news');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const jobId = request.nextUrl.searchParams.get('jobId') || '';
  const job = articleJobs.get(jobId, auth.id);
  if (!job) return NextResponse.json({ error: 'Article job not found' }, { status: 404 });
  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    result: job.result ?? null,
    error: job.error ?? null,
  });
}

async function runArticleJob(
  job: ArticleJob,
  userId: string,
  input: ReturnType<typeof normalizeArticleMarketNewsInput>,
  model: string,
  researchFallback: boolean,
  catalogNotice: string | null,
) {
  const send = (event: Record<string, unknown>) => {
    articleJobs.push(job.id, userId, { jobId: job.id, ...event });
  };
  try {
        send({ step: 'sources', progress: 10, message: 'Searching publisher feeds and the open web for sources...' });
        const automatedSources = (await researchArticleMarketNews(input.keyword, input.researchDate, {
          angle: input.angle,
          minimumDatedSources: researchFallback ? MIN_DATED_RESEARCH_SOURCES : undefined,
          onProgress: (message) => {
            send({ step: 'sources', progress: 18, message });
          },
        })).slice(0, Math.max(1, 5 - input.sources.length));
        const researchedInput = { ...input, sources: [...automatedSources, ...input.sources] };
        const effectiveInput = {
          ...researchedInput,
          sources: [...new Map(researchedInput.sources.map(source => [source.url, source])).values()],
        };
        const knowledgeContext = await fetchKnowledgeContext(userId, `${input.keyword}\n${input.angle}`, undefined, 5, 'internal');
        const styleContext = await fetchStyleContext(userId, 'article-market-news');
        const builtPrompts = buildArticleMarketNewsPrompts(effectiveInput);
        const systemPrompt = `${builtPrompts.systemPrompt}${knowledgeContext}${styleContext}\n\nStyle notes, if present, apply to voice only. Do not use them to add facts, numbers, or sources.`;
        const userPrompt = builtPrompts.userPrompt;
        if (catalogNotice) send({ step: 'notice', progress: 30, message: catalogNotice });
        send({ step: 'draft', progress: 35, message: 'Writing the SOP-compliant article draft…' });

        let generated: Awaited<ReturnType<typeof generateContent>> | undefined;
        let article: Record<string, unknown> | undefined;
        let title = '';
        let metaDescription = '';
        let articleMarkdown = '';
        let validation: ReturnType<typeof validateGeneratedArticle> | undefined;
        let attemptPrompt = userPrompt;
        let expanded = false;
        let productWarnings: string[] = [];
        let gateInput = effectiveInput;

        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            generated = await generateContent(systemPrompt, attemptPrompt, userId, undefined, {
              model,
              responseFormat: { type: 'json_object' },
              temperature: 0.3,
              maxTokens: ARTICLE_COMPLETION_MAX_TOKENS,
              taskType: 'article-market-news',
              jsonRepairAttempts: 0,
            });
            article = parseGeneratedArticle(generated.content);
            title = typeof article.title === 'string' ? article.title.trim() : '';
            metaDescription = typeof article.metaDescription === 'string' ? article.metaDescription.trim() : '';
            articleMarkdown = guardGeneratedText(typeof article.articleMarkdown === 'string' ? article.articleMarkdown.trim() : '', mergeBrandFacts('')).text;
            if (!title || !articleMarkdown) throw new Error('AI returned an incomplete article.');
            if (!metaDescription || metaDescription.length > 155) throw new Error(`Meta description must be 1–155 characters; received ${metaDescription.length}.`);
            const corpus = [gateInput.keyword, gateInput.angle, ...gateInput.paaQuestions, ...gateInput.sources.flatMap(source => [source.outlet, source.title, source.verifiedFacts])].join('\n');
            const products = stripUnsupportedProductNames(articleMarkdown, corpus);
            articleMarkdown = products.markdown;
            productWarnings = products.removed;
            const citations = repairArticleCitations(articleMarkdown, gateInput.sources);
            articleMarkdown = citations.markdown;
            gateInput = { ...gateInput, sources: citations.sources };
            articleMarkdown = ensureEndingDupoinAccountCta(articleMarkdown);
            const fitted = fitArticleMarkdownWordCount(articleMarkdown, articleDraftProtectedPhrases(gateInput));
            if (fitted.trimmed) articleMarkdown = fitted.markdown;
            // Last step before the gate: repair H1, PAA headings, keyword lead and Sources
            // deterministically, so the gate only fails on problems that cannot be repaired.
            const structure = repairArticleStructure(title, articleMarkdown, gateInput);
            articleMarkdown = structure.markdown;
            validation = validateGeneratedArticle(title, articleMarkdown, gateInput, metaDescription);
            if (validation.violations.length) {
              // Same deterministic repair the DOCX download lock runs: drop unsupported-number
              // sentences, attribute or drop unlisted outlets, resolve conflicting metric values.
              const finalized = finalizeArticleForPublication(title, articleMarkdown, gateInput, metaDescription);
              if (finalized.markdown !== articleMarkdown || finalized.metaDescription !== metaDescription) {
                articleMarkdown = finalized.markdown;
                metaDescription = finalized.metaDescription;
                gateInput = finalized.input;
                validation = finalized.validation;
                send({ step: 'notice', progress: 88, message: `Final repair: ${finalized.repairs.join(' ')}` });
              }
            }
            if (structure.repairs.length) send({ step: 'draft', progress: 35 + attempt * 15, message: `Repaired the draft structure: ${structure.repairs.join(' ')}` });
            validation.qc.unsupportedProducts = productWarnings;
            const tooShort = countArticleWords(articleMarkdown) < 800;
            if (validation.violations.length === 0) {
              if (fitted.trimmed) {
                send({ step: 'draft', progress: 35 + attempt * 15, message: `Draft was ${fitted.originalWordCount} words, so it was shortened to ${fitted.wordCount} before the publication gate.` });
              }
              if (productWarnings.length) {
                send({ step: 'notice', progress: 90, message: `Removed unsupported product names: ${productWarnings.join(', ')}.` });
              }
              break;
            }
            if (tooShort && !expanded) {
              expanded = true;
              send({ step: 'draft', progress: 55, message: `Draft is ${countArticleWords(articleMarkdown)} words. Expanding the existing text instead of starting over…` });
              attemptPrompt = buildArticleExpandPrompt({
                keyword: gateInput.keyword,
                articleMarkdown,
                wordCount: countArticleWords(articleMarkdown),
                sourceBlock: gateInput.sources.map(source => `${source.outlet}: ${source.verifiedFacts}`).join('\n'),
              });
              continue;
            }
            throw new Error(validation.violations.join(' '));
          } catch (attemptError) {
            if (attempt === 3) {
              const detail = attemptError instanceof Error ? attemptError.message : 'invalid draft';
              throw new Error(describeArticlePublicationGateFailure(detail));
            }
            const feedback = attemptError instanceof Error ? attemptError.message : 'The prior draft was invalid.';
            send({ step: 'draft', progress: 35 + attempt * 15, message: `Repairing draft after publication-gate feedback (attempt ${attempt + 1}/3)…` });
            attemptPrompt = buildRepairPrompt(userPrompt, feedback, generated?.content);
          }
        }

        if (!generated || !article || !validation || validation.violations.length > 0) {
          throw new Error('Article generation ended without a publication-ready draft.');
        }

        const historyId = randomUUID();
        const result = { ...article, title, metaDescription, articleMarkdown, wordCount: validation.wordCount, qc: validation.qc, usage: generated.usage, model, historyId, normalizedInput: gateInput, fallbackLabel: generated.fallbackLabel || null, productWarnings };
        await execute(
          'INSERT INTO tasks (id, user_id, type, title, brief, status, output_data) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [historyId, userId, 'article-market-news', `Article Market News: ${title}`, gateInput.angle, 'completed', JSON.stringify({
            article: { ...article, title, metaDescription, articleMarkdown, wordCount: validation.wordCount },
            input: gateInput,
            model,
            qc: validation.qc,
          })],
        );

        const articleKnowledge = summarizeArticleKnowledge({
          keyword: gateInput.keyword,
          title,
          articleMarkdown,
          sourceUrls: gateInput.sources.map(source => source.url),
        });
        if (articleKnowledge) {
          await persistKnowledgeQuietly({
            userId,
            taskType: 'article-market-news',
            taskId: historyId,
            brief: articleKnowledge.brief,
            selectedOutput: articleKnowledge.selectedOutput,
            sourceUrls: articleKnowledge.sourceUrls,
            action: 'complete',
          });
        }

        send({
          step: 'done',
          progress: 100,
          message: 'Article draft complete. Run manual fact and originality checks before publishing.',
          result,
        });
        articleJobs.finish(job.id, userId, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Article generation failed.';
        send({ step: 'error', progress: 100, message });
        articleJobs.fail(job.id, userId, message);
      }
}
