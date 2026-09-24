import { NextRequest } from 'next/server';
import { queryOne, queryAll, execute } from '@/lib/database';
import { requireFeature } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { generateContent, getSmartSystemPrompt, fetchContextMemory, fetchStyleContext, fetchKnowledgeContext, getUserPreferredModel, type BrandGuidelines } from '@/lib/openai';
import { runVideoScriptQc } from '@/lib/video-script-qc';
import {
  VIDEO_SCRIPT_WEB_SKIPPED_MESSAGE,
  formatVideoScriptEvidence,
  researchVideoScriptWeb,
  resolveVideoScriptCitations,
  type VideoScriptWebResearch,
} from '@/lib/video-script-research';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

const TIMEOUT_MS = 300_000; // 5 min for 3 parallel options

function sseEvent(data: Record<string, unknown>) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

const STYLE_VARIANTS = [
  {
    style: 'high-energy',
    styleLabel: '⚡ High Energy & Bold',
    instruction: `STYLE: HIGH ENERGY & BOLD
- Fast-paced, punchy script with rapid scene cuts
- Bold hooks that grab attention in first 2 seconds
- Dynamic language with power words and urgency
- High energy narration with exclamation points
- Trendy references and memes where appropriate
- Designed for maximum scroll-stop impact`,
    temperature: 0.9,
  },
  {
    style: 'professional',
    styleLabel: '💼 Professional & Polished',
    instruction: `STYLE: PROFESSIONAL & POLISHED
- Clean, structured script with clear sections
- Corporate tone with credibility and authority
- Data-driven language with facts and statistics
- Smooth transitions between scenes
- Minimal slang, polished delivery
- Designed for brand trust and authority`,
    temperature: 0.5,
  },
  {
    style: 'cinematic',
    styleLabel: '✨ Cinematic & Storytelling',
    instruction: `STYLE: CINEMATIC & STORYCRAFTING
- Narrative-driven script with story arc
- Emotional hooks that create connection
- Visual storytelling with scene descriptions
- Conversational, relatable tone
- Surprise twist or unexpected angle
- Designed for engagement and memorability`,
    temperature: 0.95,
  },
];

type ScriptFields = {
  event: string;
  platform?: string;
  duration?: string;
  targetAudience?: string;
  references?: string;
};

export async function POST(request: NextRequest) {
  const rl = rateLimit(request);
  if (rl) return rl;

  const auth = await requireFeature(request, 'video-script');
  if ('error' in auth) {
    return new Response(sseEvent({ step: 'error', message: auth.error }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }
  const userId = auth.id;

  const body = await request.json();
  const { mode = 'preview' } = body;

  if (mode === 'preview') {
    return handlePreview(body, userId);
  } else if (mode === 'full') {
    return handleFull(body, userId);
  } else {
    return new Response(sseEvent({ step: 'error', message: `Unknown mode: ${mode}` }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }
}

/**
 * Preview mode: generate 3 options with hook, context, highlight, brandTieIn, cta (no fullScript).
 * Faster, no DB save.
 */
async function handlePreview(
  body: Record<string, unknown>,
  userId: string,
) {
  const { event, platform, duration, targetAudience, references, brandGuidelineId } = body as ScriptFields & {
    brandGuidelineId?: string;
  };
  if (!event) {
    return new Response(sseEvent({ step: 'error', message: 'Event description is required' }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }

  const preferredModel = await getUserPreferredModel(userId, 'video-script');
  const brandGuidelines = await loadBrandGuidelines(userId, brandGuidelineId);
  const contextMemory = await fetchContextMemory(userId, 'video-script', 5);
  const styleContext = await fetchStyleContext(userId, 'video-script');
  const knowledgeContext = await fetchKnowledgeContext(userId, event, 'video-script', 5);

  const encoder = new TextEncoder();
  let timeoutId: ReturnType<typeof setTimeout>;

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseEvent(data)));
      };
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Generation timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
      });

      try {
        const generationPromise = (async () => {
          const webResearch = await collectVideoScriptResearch({ event, platform, duration, targetAudience, references }, emit);
          const evidence = formatVideoScriptEvidence(webResearch);
          const referenceNote = references?.trim() ? `Operator reference links:\n${references.trim()}` : '';
          const smartSystem = getSmartSystemPrompt('video-script', platform, brandGuidelines, targetAudience, styleContext);

          emit({
            step: 'preview',
            progress: 12,
            message: 'Generating 3 preview style options...',
          });

          const optionPromises = STYLE_VARIANTS.map(async (variant, index) => {
            const stylePrompt = `Create a video script PREVIEW with these details:
Event/Topic: ${event}
Platform: ${platform || 'Instagram Reels'}
Duration: ${duration || '30-45 seconds'}
Target Audience: ${targetAudience || 'General'}
${referenceNote}

${variant.instruction}

${contextMemory}
${knowledgeContext}

${evidence}

Generate ONLY the preview fields (hook, context, highlight, brandTieIn, cta). Do NOT generate the full script yet.

Output JSON format with: { "hook": "the opening hook that stops the scroll", "hookOptions": ["option 1", "option 2", "option 3"], "context": "brief background context for the video", "highlight": "the peak moment or key highlight", "brandTieIn": "how Dupoin connects to this topic", "cta": "call to action", "citationIds": [1] }`;

            const progressBase = 18 + index * 16;

            emit({
              step: 'preview',
              progress: progressBase,
              message: `${variant.styleLabel} — generating preview...`,
            });

            const result = await generateContent(smartSystem, stylePrompt, userId, undefined, {
              brandGuidelines,
              responseFormat: { type: 'json_object' },
              model: preferredModel,
              temperature: variant.temperature,
              taskType: 'video-script',
            });

            return { variant, result: result.content, usage: result.usage };
          });

          const optionResults = await Promise.all(optionPromises);

          emit({
            step: 'preview',
            progress: 72,
            message: 'All 3 previews generated.',
          });

          const options = optionResults.map(({ variant, result }) => {
            const scriptData = parseModelJson(result);
            return {
              style: variant.style,
              styleLabel: variant.styleLabel,
              hook: asString(scriptData.hook),
              hookOptions: asStringList(scriptData.hookOptions),
              context: asString(scriptData.context),
              highlight: asString(scriptData.highlight),
              brandTieIn: asString(scriptData.brandTieIn),
              cta: asString(scriptData.cta),
              citations: resolveVideoScriptCitations(scriptData, webResearch.sources),
            };
          });

          emit({
            step: 'qc',
            progress: 84,
            message: 'Running script quality checks...',
          });

          const qcResults = options.map((option) => runVideoScriptQc({
            mode: 'preview',
            platform,
            duration,
            hook: option.hook,
            context: option.context,
            highlight: option.highlight,
            brandTieIn: option.brandTieIn,
            cta: option.cta,
            citations: option.citations,
          }));
          const passed = qcResults.filter((result) => result.allPassed).length;
          emit({
            step: 'qc',
            progress: 92,
            message: `Quality check complete — ${passed}/${qcResults.length} previews passed all checks. Warnings do not block the script.`,
            qcResults,
          });

          const totalUsage = {
            videoScript: {
              inputTokens: optionResults.reduce((sum, item) => sum + (item.usage?.inputTokens || 0), 0),
              outputTokens: optionResults.reduce((sum, item) => sum + (item.usage?.outputTokens || 0), 0),
              model: optionResults[0]?.usage?.model || preferredModel,
              cost: optionResults.reduce((sum, item) => sum + (item.usage?.cost || 0), 0),
            },
          };

          emit({
            step: 'done',
            progress: 100,
            message: 'Preview complete. Pick your favorite style.',
            result: {
              success: true,
              options,
              usage: totalUsage,
              webResearch,
              qcResults,
            },
          });
        })();

        await Promise.race([generationPromise, timeoutPromise]);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Generation failed';
        console.error('Video script preview error:', e);
        try {
          controller.enqueue(encoder.encode(sseEvent({ step: 'error', message })));
        } catch {}
      } finally {
        clearTimeout(timeoutId);
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

/**
 * Full mode: take the selected preview option + edited prompt, generate complete script, save to DB.
 */
async function handleFull(
  body: Record<string, unknown>,
  userId: string,
) {
  const { event, platform, duration, targetAudience, references, brandGuidelineId, selectedOption, editedPrompt, style } = body as ScriptFields & {
    brandGuidelineId?: string;
    selectedOption: Record<string, string>;
    editedPrompt: string;
    style: string;
  };

  if (!event || !selectedOption || !editedPrompt) {
    return new Response(sseEvent({ step: 'error', message: 'Event, selected option, and edited prompt are required' }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }

  const preferredModel = await getUserPreferredModel(userId, 'video-script');
  const brandGuidelines = await loadBrandGuidelines(userId, brandGuidelineId);
  const contextMemory = await fetchContextMemory(userId, 'video-script', 5);
  const styleContext = await fetchStyleContext(userId, 'video-script');
  const knowledgeContext = await fetchKnowledgeContext(userId, event, 'video-script', 5);

  let bestExamples = '';
  try {
    const examplesResult = await queryAll(`
      SELECT output_data, brief FROM tasks
      WHERE type = 'video-script' AND rating >= 4 AND output_data IS NOT NULL
      ORDER BY rating DESC, created_at DESC LIMIT 3
    `, []) as { output_data: string; brief: string }[];
    if (examplesResult.length) {
      bestExamples = '\n\nBest examples from past (highly rated):';
      for (const example of examplesResult) {
        try {
          const data = JSON.parse(example.output_data);
          const hook = data.options?.[0]?.hook || data.hook || '';
          bestExamples += `\n- Topic: "${(example.brief || '').substring(0, 100)}"\n  Hook: "${hook.substring(0, 150)}"`;
        } catch {}
      }
    }
  } catch {}

  const encoder = new TextEncoder();
  let timeoutId: ReturnType<typeof setTimeout>;

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseEvent(data)));
      };
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Generation timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
      });

      try {
        const generationPromise = (async () => {
          const taskId = uuidv4();
          const webResearch = await collectVideoScriptResearch({ event, platform, duration, targetAudience, references }, emit);
          const evidence = formatVideoScriptEvidence(webResearch);
          const referenceNote = references?.trim() ? `Operator reference links:\n${references.trim()}` : '';
          const smartSystem = getSmartSystemPrompt('video-script', platform, brandGuidelines, targetAudience, styleContext);
          const variant = STYLE_VARIANTS.find(item => item.style === style) || STYLE_VARIANTS[0];

          emit({
            step: 'full',
            progress: 18,
            message: `Generating full ${variant.styleLabel} script...`,
          });

          const fullPrompt = `Based on the following brief and selected preview, generate the COMPLETE video script.

ORIGINAL BRIEF:
${event}

SELECTED STYLE PREVIEW:
- Style: ${variant.styleLabel}
- Hook: ${selectedOption.hook || ''}
- Context: ${selectedOption.context || ''}
- Highlight: ${selectedOption.highlight || ''}
- Brand Tie-In: ${selectedOption.brandTieIn || ''}
- CTA: ${selectedOption.cta || ''}

EDITED PROMPT / INSTRUCTIONS:
${editedPrompt}

${variant.instruction}
${bestExamples}
${contextMemory}
${knowledgeContext}

${referenceNote}

${evidence}

Platform: ${platform || 'Instagram Reels'}
Duration: ${duration || '30-45 seconds'}
Target Audience: ${targetAudience || 'General'}

Generate the complete script following the SOP. Include dialogue, scene descriptions, sound effects in [brackets], and music cues.

CRITICAL: Each VO (Voice Over) section MUST have MULTIPLE SENTENCES (3-5 sentences per VO). Do NOT write 1-sentence VOs. Write full, detailed narration that flows naturally. For a 30-45 second script, aim for 4-6 sentences total split across 2-3 VO segments.

Output JSON format with: { "hook": "...", "hookOptions": ["...", "...", "..."], "context": "...", "highlight": "...", "brandTieIn": "...", "cta": "...", "fullScript": "...", "citationIds": [1] }

The fullScript must be the complete, detailed script with scene descriptions, dialogue, and timing. Each scene should have: [TIMESTAMP], [VISUAL], [SFX], [MUSIC], [VO: narration text (3-5 sentences)].`;

          const result = await generateContent(smartSystem, fullPrompt, userId, taskId, {
            brandGuidelines,
            responseFormat: { type: 'json_object' },
            model: preferredModel,
            temperature: variant.temperature,
            taskType: 'video-script',
          });

          emit({
            step: 'full',
            progress: 70,
            message: 'Full script generated.',
          });

          const scriptData = parseModelJson(result.content);
          const citations = resolveVideoScriptCitations(scriptData, webResearch.sources);
          const finalOption = {
            style: style,
            styleLabel: variant.styleLabel,
            hook: asString(scriptData.hook, selectedOption.hook || ''),
            hookOptions: asStringList(scriptData.hookOptions),
            context: asString(scriptData.context, selectedOption.context || ''),
            highlight: asString(scriptData.highlight, selectedOption.highlight || ''),
            brandTieIn: asString(scriptData.brandTieIn, selectedOption.brandTieIn || ''),
            cta: asString(scriptData.cta, selectedOption.cta || ''),
            fullScript: asString(scriptData.fullScript, result.content),
            citations,
          };

          emit({
            step: 'qc',
            progress: 82,
            message: 'Running script quality checks...',
          });
          const fullQc = runVideoScriptQc({
            mode: 'full',
            platform,
            duration,
            hook: finalOption.hook,
            context: finalOption.context,
            highlight: finalOption.highlight,
            brandTieIn: finalOption.brandTieIn,
            cta: finalOption.cta,
            fullScript: finalOption.fullScript,
            citations,
          });
          const qcResults = [fullQc];
          emit({
            step: 'qc',
            progress: 90,
            message: fullQc.allPassed
              ? 'Quality check complete — the full script passed all checks.'
              : 'Quality check complete — the full script has warnings. Creative voiceover is kept; review the issues before you record.',
            qcResults,
          });

          const totalUsage = {
            videoScript: {
              inputTokens: result.usage?.inputTokens || 0,
              outputTokens: result.usage?.outputTokens || 0,
              model: result.usage?.model || preferredModel,
              cost: result.usage?.cost || 0,
            },
          };

          const outputData = {
            options: [finalOption],
            webResearch,
            qcResults,
            event,
            platform,
            duration,
            targetAudience,
            references: references || '',
          };

          const dateStr = new Date().toISOString().split('T')[0];
          const fileName = `video-script-${taskId.substring(0, 8)}-${dateStr}.json`;
          const outputDir = path.join(process.cwd(), 'public', 'outputs', 'video-scripts');
          if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
          fs.writeFileSync(path.join(outputDir, fileName), JSON.stringify(outputData, null, 2));

          await execute('INSERT INTO tasks (id, user_id, type, title, brief, status, output_data) VALUES (?, ?, ?, ?, ?, ?, ?)', [taskId, userId, 'video-script', `Video Script: ${event.substring(0, 50)}`, event, 'completed', JSON.stringify(outputData)]);

          emit({
            step: 'done',
            progress: 100,
            message: 'Full script generation complete.',
            result: {
              success: true,
              taskId,
              options: [finalOption],
              script: finalOption,
              outputFile: `/outputs/video-scripts/${fileName}`,
              usage: totalUsage,
              webResearch,
              qcResults,
            },
          });
        })();

        await Promise.race([generationPromise, timeoutPromise]);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Generation failed';
        console.error('Video script full generation error:', e);
        try {
          controller.enqueue(encoder.encode(sseEvent({ step: 'error', message })));
        } catch {}
      } finally {
        clearTimeout(timeoutId);
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

async function collectVideoScriptResearch(
  input: ScriptFields,
  emit: (data: Record<string, unknown>) => void,
): Promise<VideoScriptWebResearch> {
  let webResearch: VideoScriptWebResearch;
  try {
    webResearch = await researchVideoScriptWeb({
      ...input,
      onProgress: (message) => {
        emit({ step: 'research', progress: 6, message });
      },
    });
  } catch (error) {
    console.warn('Video script web research failed:', error);
    webResearch = {
      status: 'empty',
      queries: [],
      sources: [],
      warnings: ['Web research failed. Continuing with brand knowledge only.'],
    };
  }

  const readCount = webResearch.sources.filter((source) => source.read).length;
  const webMessage = webResearch.status === 'skipped'
    ? webResearch.skippedReason || VIDEO_SCRIPT_WEB_SKIPPED_MESSAGE
    : webResearch.sources.length
      ? `Read ${readCount} source page${readCount === 1 ? '' : 's'} from ${webResearch.sources.length} web hit${webResearch.sources.length === 1 ? '' : 's'}.`
      : (webResearch.warnings[0] || 'Open-web search returned no usable sources. Continuing with brand knowledge only.');
  emit({
    step: 'research',
    progress: 10,
    message: webMessage,
    webResearch,
  });
  return webResearch;
}

async function loadBrandGuidelines(userId: string, brandGuidelineId?: string): Promise<BrandGuidelines | undefined> {
  if (!brandGuidelineId) return undefined;
  try {
    const row = await queryOne('SELECT id, brand_name, tone_of_voice, target_market, key_messages, do_list, dont_list, examples FROM brand_guidelines WHERE id = ? AND user_id = ?', [brandGuidelineId, userId]) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: row.id as string,
      brand_name: row.brand_name as string,
      tone_of_voice: (row.tone_of_voice as string) || undefined,
      target_market: (row.target_market as string) || undefined,
      key_messages: (row.key_messages as string) || undefined,
      do_list: JSON.parse((row.do_list as string) || '[]'),
      dont_list: JSON.parse((row.dont_list as string) || '[]'),
      examples: (row.examples as string) || undefined,
    };
  } catch (error) {
    console.warn('Failed to fetch brand guidelines:', error);
    return undefined;
  }
}

function parseModelJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
