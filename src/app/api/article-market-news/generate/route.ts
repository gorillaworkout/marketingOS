import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireFeature } from '@/lib/auth';
import { execute } from '@/lib/database';
import { rateLimit } from '@/lib/rate-limit';
import { generateContent, getUserPreferredModel } from '@/lib/openai';
import { buildArticleMarketNewsPrompts, ensureEndingDupoinAccountCta, normalizeArticleMarketNewsInput, parseGeneratedArticle, validateGeneratedArticle } from '@/lib/article-market-news';
import { researchArticleMarketNews } from '@/lib/article-market-news-research';

export const maxDuration = 300;

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

Revise the prior draft instead of starting over. Keep compliant material, correct every listed issue, expand only from the verified source material, target 950–975 words, and return only the required JSON.
The last prose paragraph before the Sources or Sumber heading must be one imperative Dupoin account-opening sentence starting with Buka, Mulai, Daftar, or Buat. Do not invent prices, percentages, dates, or other numbers.`;
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

  const model = await getUserPreferredModel(auth.id, 'article-market-news');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseEvent({ step: 'sources', progress: 10, message: 'Searching publisher feeds and the open web for sources...' })));
        const automatedSources = (await researchArticleMarketNews(input.keyword, input.researchDate, {
          angle: input.angle,
          onProgress: (message) => {
            controller.enqueue(encoder.encode(sseEvent({ step: 'sources', progress: 18, message })));
          },
        })).slice(0, Math.max(1, 5 - input.sources.length));
        const researchedInput = { ...input, sources: [...automatedSources, ...input.sources] };
        const effectiveInput = {
          ...researchedInput,
          sources: [...new Map(researchedInput.sources.map(source => [source.url, source])).values()],
        };
        const { systemPrompt, userPrompt } = buildArticleMarketNewsPrompts(effectiveInput);
        controller.enqueue(encoder.encode(sseEvent({ step: 'draft', progress: 35, message: 'Writing the SOP-compliant article draft…' })));

        let generated: Awaited<ReturnType<typeof generateContent>> | undefined;
        let article: Record<string, unknown> | undefined;
        let title = '';
        let metaDescription = '';
        let articleMarkdown = '';
        let validation: ReturnType<typeof validateGeneratedArticle> | undefined;
        let attemptPrompt = userPrompt;

        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            generated = await generateContent(systemPrompt, attemptPrompt, auth.id, undefined, {
              model,
              responseFormat: { type: 'json_object' },
              // Lower temperature for Claude JSON reliability; publication gate still retries QC failures.
              temperature: 0.3,
              maxTokens: 7_000,
              taskType: 'article-market-news',
              // Keep gateway JSON-repair off: fenced-but-recoverable Claude payloads would otherwise
              // burn an extra completion before local parseGeneratedArticle / repairLooseJson runs.
              jsonRepairAttempts: 0,
            });
            article = parseGeneratedArticle(generated.content);
            title = typeof article.title === 'string' ? article.title.trim() : '';
            metaDescription = typeof article.metaDescription === 'string' ? article.metaDescription.trim() : '';
            articleMarkdown = typeof article.articleMarkdown === 'string' ? article.articleMarkdown.trim() : '';
            if (!title || !articleMarkdown) throw new Error('AI returned an incomplete article.');
            if (!metaDescription || metaDescription.length > 155) throw new Error(`Meta description must be 1–155 characters; received ${metaDescription.length}.`);
            articleMarkdown = ensureEndingDupoinAccountCta(articleMarkdown);
            validation = validateGeneratedArticle(title, articleMarkdown, effectiveInput, metaDescription);
            if (validation.violations.length === 0) break;
            throw new Error(validation.violations.join(' '));
          } catch (attemptError) {
            if (attempt === 3) {
              throw new Error(`Generated draft failed the publication gate after 3 attempts: ${attemptError instanceof Error ? attemptError.message : 'invalid draft'}`);
            }
            const feedback = attemptError instanceof Error ? attemptError.message : 'The prior draft was invalid.';
            controller.enqueue(encoder.encode(sseEvent({ step: 'draft', progress: 35 + attempt * 15, message: `Repairing draft after publication-gate feedback (attempt ${attempt + 1}/3)…` })));
            attemptPrompt = buildRepairPrompt(userPrompt, feedback, generated?.content);
          }
        }

        if (!generated || !article || !validation || validation.violations.length > 0) {
          throw new Error('Article generation ended without a publication-ready draft.');
        }

        const historyId = randomUUID();
        await execute(
          'INSERT INTO tasks (id, user_id, type, title, brief, status, output_data) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [historyId, auth.id, 'article-market-news', `Article Market News: ${title}`, effectiveInput.angle, 'completed', JSON.stringify({
            article: { ...article, title, metaDescription, articleMarkdown, wordCount: validation.wordCount },
            input: effectiveInput,
            model,
            qc: validation.qc,
          })],
        );

        controller.enqueue(encoder.encode(sseEvent({
          step: 'done',
          progress: 100,
          message: 'Article draft complete. Run manual fact and originality checks before publishing.',
          result: { ...article, title, articleMarkdown, wordCount: validation.wordCount, qc: validation.qc, usage: generated.usage, model, historyId, normalizedInput: effectiveInput },
        })));
      } catch (error) {
        controller.enqueue(encoder.encode(sseEvent({ step: 'error', progress: 100, message: error instanceof Error ? error.message : 'Article generation failed.' })));
      } finally {
        controller.close();
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
