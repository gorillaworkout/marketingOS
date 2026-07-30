import { NextRequest } from 'next/server';
import { queryOne, queryAll, execute } from '@/lib/database';
import { requireFeature } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { generateContent, getSmartSystemPrompt, fetchContextMemory, fetchStyleContext, getUserPreferredModel, type BrandGuidelines } from '@/lib/openai';
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
  const { event, platform, duration, targetAudience, references, brandGuidelineId } = body as {
    event: string;
    platform?: string;
    duration?: string;
    targetAudience?: string;
    references?: string;
    brandGuidelineId?: string;
  };
  if (!event) {
    return new Response(sseEvent({ step: 'error', message: 'Event description is required' }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }

  const preferredModel = await getUserPreferredModel(userId, 'video-script');

  // Fetch brand guidelines if specified
  let brandGuidelines: BrandGuidelines | undefined;
  if (brandGuidelineId) {
    try {
      const row = await queryOne('SELECT id, brand_name, tone_of_voice, target_market, key_messages, do_list, dont_list, examples FROM brand_guidelines WHERE id = ? AND user_id = ?', [brandGuidelineId, userId]) as Record<string, unknown> | undefined;
      if (row) {
        brandGuidelines = {
          id: row.id as string,
          brand_name: row.brand_name as string,
          tone_of_voice: (row.tone_of_voice as string) || undefined,
          target_market: (row.target_market as string) || undefined,
          key_messages: (row.key_messages as string) || undefined,
          do_list: JSON.parse((row.do_list as string) || '[]'),
          dont_list: JSON.parse((row.dont_list as string) || '[]'),
          examples: (row.examples as string) || undefined,
        };
      }
    } catch (e) {
      console.warn('Failed to fetch brand guidelines:', e);
    }
  }

  // Fetch context memory
  const contextMemory = await fetchContextMemory(userId, 'video-script', 5);

  // Fetch style context
  const styleContext = await fetchStyleContext(userId, 'video-script');

  const encoder = new TextEncoder();
  let timeoutId: ReturnType<typeof setTimeout>;

  const stream = new ReadableStream({
    async start(controller) {
      // Fetch reference links inside the stream so we can send progress
      let referencesContent = '';
      if (references && references.trim()) {
        const links = references.split(/[\n,]+/).map(l => l.trim()).filter(l => l.startsWith('http'));
        if (links.length > 0) {
          controller.enqueue(encoder.encode(sseEvent({
            step: 'references', progress: 2,
            message: `🔍 Analyzing ${links.length} reference link(s)...`,
          })));

          const fetched = await Promise.allSettled(
            links.slice(0, 2).map(link => fetchReferenceContent(link))
          );
          const summaries = fetched
            .map(r => r.status === 'fulfilled' ? r.value : null)
            .filter(Boolean);
          if (summaries.length > 0) {
            referencesContent = `\n\n📎 REFERENCE LINK ANALYSIS:\n${summaries.join('\n---\n')}`;
            controller.enqueue(encoder.encode(sseEvent({
              step: 'references', progress: 3,
              message: `✅ ${summaries.length} reference(s) analyzed`,
            })));
          }
        }
      }

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Generation timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
      });

      try {
        const generationPromise = (async () => {
          const smartSystem = getSmartSystemPrompt('video-script', platform, brandGuidelines, targetAudience, styleContext);

          controller.enqueue(encoder.encode(sseEvent({
            step: 'preview',
            progress: 5,
            message: '🚀 Generating 3 preview style options...',
          })));

          const optionPromises = STYLE_VARIANTS.map(async (variant, index) => {
            const stylePrompt = `Create a video script PREVIEW with these details:
Event/Topic: ${event}
Platform: ${platform || 'Instagram Reels'}
Duration: ${duration || '30-45 seconds'}
Target Audience: ${targetAudience || 'General'}
${references ? `References: ${references}` : ''}
${referencesContent}

${variant.instruction}

${contextMemory}

Generate ONLY the preview fields (hook, context, highlight, brandTieIn, cta). Do NOT generate the full script yet.

Output JSON format with: { "hook": "the opening hook that stops the scroll", "hookOptions": ["option 1", "option 2", "option 3"], "context": "brief background context for the video", "highlight": "the peak moment or key highlight", "brandTieIn": "how Dupoin connects to this topic", "cta": "call to action" }`;

            const progressBase = 10 + index * 20;

            controller.enqueue(encoder.encode(sseEvent({
              step: 'preview',
              progress: progressBase,
              message: `${variant.styleLabel} — generating preview...`,
            })));

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

          controller.enqueue(encoder.encode(sseEvent({
            step: 'preview',
            progress: 70,
            message: '✅ All 3 previews generated!',
          })));

          // Parse all options
          const options = optionResults.map(({ variant, result }) => {
            let scriptData;
            try { scriptData = JSON.parse(result); } catch {
              scriptData = { hook: '', context: '', highlight: '', brandTieIn: '', cta: '' };
            }
            return {
              style: variant.style,
              styleLabel: variant.styleLabel,
              hook: scriptData.hook || '',
              hookOptions: scriptData.hookOptions || [],
              context: scriptData.context || '',
              highlight: scriptData.highlight || '',
              brandTieIn: scriptData.brandTieIn || '',
              cta: scriptData.cta || '',
            };
          });

          // Aggregate usage
          const totalUsage = {
            videoScript: {
              inputTokens: optionResults.reduce((sum, r) => sum + (r.usage?.inputTokens || 0), 0),
              outputTokens: optionResults.reduce((sum, r) => sum + (r.usage?.outputTokens || 0), 0),
              model: optionResults[0]?.usage?.model || preferredModel,
              cost: optionResults.reduce((sum, r) => sum + (r.usage?.cost || 0), 0),
            },
          };

          controller.enqueue(encoder.encode(sseEvent({
            step: 'done',
            progress: 100,
            message: '✅ Preview complete! Pick your favorite style.',
            result: {
              success: true,
              options,
              usage: totalUsage,
            },
          })));
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
  const { event, platform, duration, targetAudience, references, brandGuidelineId, selectedOption, editedPrompt, style } = body as {
    event: string;
    platform?: string;
    duration?: string;
    targetAudience?: string;
    references?: string;
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

  let brandGuidelines: BrandGuidelines | undefined;
  if (brandGuidelineId) {
    try {
      const row = await queryOne('SELECT id, brand_name, tone_of_voice, target_market, key_messages, do_list, dont_list, examples FROM brand_guidelines WHERE id = ? AND user_id = ?', [brandGuidelineId, userId]) as Record<string, unknown> | undefined;
      if (row) {
        brandGuidelines = {
          id: row.id as string,
          brand_name: row.brand_name as string,
          tone_of_voice: (row.tone_of_voice as string) || undefined,
          target_market: (row.target_market as string) || undefined,
          key_messages: (row.key_messages as string) || undefined,
          do_list: JSON.parse((row.do_list as string) || '[]'),
          dont_list: JSON.parse((row.dont_list as string) || '[]'),
          examples: (row.examples as string) || undefined,
        };
      }
    } catch (e) {
      console.warn('Failed to fetch brand guidelines:', e);
    }
  }

  const contextMemory = await fetchContextMemory(userId, 'video-script', 5);
  const styleContext = await fetchStyleContext(userId, 'video-script');

  // Fetch best examples
  let bestExamples = '';
  try {
    const examplesResult = await queryAll(`
      SELECT output_data, brief FROM tasks
      WHERE type = 'video-script' AND rating >= 4 AND output_data IS NOT NULL
      ORDER BY rating DESC, created_at DESC LIMIT 3
    `, []) as { output_data: string; brief: string }[];
    if (examplesResult.length) {
      bestExamples = '\n\n📚 Best examples from past (highly rated):';
      for (const v of examplesResult) {
        try {
          const data = JSON.parse(v.output_data);
          const hook = data.options?.[0]?.hook || data.hook || '';
          bestExamples += `\n- Topic: "${(v.brief || '').substring(0, 100)}"\n  Hook: "${hook.substring(0, 150)}"`;
        } catch {}
      }
    }
  } catch {}

  const encoder = new TextEncoder();
  let timeoutId: ReturnType<typeof setTimeout>;

  const stream = new ReadableStream({
    async start(controller) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Generation timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
      });

      try {
        const generationPromise = (async () => {
          const taskId = uuidv4();
          const smartSystem = getSmartSystemPrompt('video-script', platform, brandGuidelines, targetAudience, styleContext);

          const variant = STYLE_VARIANTS.find(v => v.style === style) || STYLE_VARIANTS[0];

          controller.enqueue(encoder.encode(sseEvent({
            step: 'full',
            progress: 10,
            message: `🎬 Generating full ${variant.styleLabel} script...`,
          })));

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

Platform: ${platform || 'Instagram Reels'}
Duration: ${duration || '30-45 seconds'}
Target Audience: ${targetAudience || 'General'}

Generate the complete script following the SOP. Include dialogue, scene descriptions, sound effects in [brackets], and music cues.

CRITICAL: Each VO (Voice Over) section MUST have MULTIPLE SENTENCES (3-5 sentences per VO). Do NOT write 1-sentence VOs. Write full, detailed narration that flows naturally. For a 30-45 second script, aim for 4-6 sentences total split across 2-3 VO segments.

Output JSON format with: { "hook": "...", "hookOptions": ["...", "...", "..."], "context": "...", "highlight": "...", "brandTieIn": "...", "cta": "...", "fullScript": "..." }

The fullScript must be the complete, detailed script with scene descriptions, dialogue, and timing. Each scene should have: [TIMESTAMP], [VISUAL], [SFX], [MUSIC], [VO: narration text (3-5 sentences)].`;

          const result = await generateContent(smartSystem, fullPrompt, userId, taskId, {
            brandGuidelines,
            responseFormat: { type: 'json_object' },
            model: preferredModel,
            temperature: variant.temperature,
            taskType: 'video-script',
          });

          controller.enqueue(encoder.encode(sseEvent({
            step: 'full',
            progress: 70,
            message: '✅ Full script generated!',
          })));

          // Parse the result
          let scriptData;
          try { scriptData = JSON.parse(result.content); } catch {
            scriptData = { fullScript: result.content, hook: selectedOption.hook || '', context: selectedOption.context || '', highlight: selectedOption.highlight || '', brandTieIn: selectedOption.brandTieIn || '', cta: selectedOption.cta || '' };
          }

          const finalOption = {
            style: style,
            styleLabel: variant.styleLabel,
            hook: scriptData.hook || selectedOption.hook || '',
            hookOptions: scriptData.hookOptions || [],
            context: scriptData.context || selectedOption.context || '',
            highlight: scriptData.highlight || selectedOption.highlight || '',
            brandTieIn: scriptData.brandTieIn || selectedOption.brandTieIn || '',
            cta: scriptData.cta || selectedOption.cta || '',
            fullScript: scriptData.fullScript || result.content,
          };

          const totalUsage = {
            videoScript: {
              inputTokens: result.usage?.inputTokens || 0,
              outputTokens: result.usage?.outputTokens || 0,
              model: result.usage?.model || preferredModel,
              cost: result.usage?.cost || 0,
            },
          };

          // Save output data
          const outputData = {
            options: [finalOption],
          };

          const dateStr = new Date().toISOString().split('T')[0];
          const fileName = `video-script-${taskId.substring(0, 8)}-${dateStr}.json`;
          const outputDir = path.join(process.cwd(), 'public', 'outputs', 'video-scripts');
          if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
          fs.writeFileSync(path.join(outputDir, fileName), JSON.stringify(outputData, null, 2));

          // Save to DB
          await execute('INSERT INTO tasks (id, user_id, type, title, brief, status, output_data) VALUES (?, ?, ?, ?, ?, ?, ?)', [taskId, userId, 'video-script', `Video Script: ${event.substring(0, 50)}`, event, 'completed', JSON.stringify(outputData)]);

          controller.enqueue(encoder.encode(sseEvent({
            step: 'done',
            progress: 100,
            message: '✅ Full script generation complete!',
            result: {
              success: true,
              taskId,
              options: [finalOption],
              script: finalOption,
              outputFile: `/outputs/video-scripts/${fileName}`,
              usage: totalUsage,
            },
          })));
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
/**
 * Fetch content from a reference URL and return a summary/analysis.
 * Handles TikTok, Instagram, and general URLs.
 */
async function fetchReferenceContent(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarketingOS/1.0)',
        'Accept': 'text/html,application/json,*/*',
      },
    });
    clearTimeout(timeout);

    const html = await response.text();
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 1000);

    if (text.length < 50) return null;

    return `🔗 Source: ${url}
📝 Content preview: "${text.substring(0, 500)}"
💡 Hook style: ${text.includes('?') ? 'Question-based hook' : text.includes('!') ? 'Exclamation-based hook' : 'Statement-based hook'}
📏 Length: ${text.length} chars`;
  } catch {
    // If we can't fetch the link, just skip it
    return null;
  }
}
