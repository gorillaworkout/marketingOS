import { NextRequest } from 'next/server';
import { getDb, saveDbToDisk } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { generateContent, generateMultiStep, getSmartSystemPrompt, fetchContextMemory, fetchStyleContext, getUserPreferredModel, type BrandGuidelines } from '@/lib/openai';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

const TIMEOUT_MS = 300_000; // 5 min for 3 parallel options
const CODEX_TIMEOUT_MS = 300_000; // 5 min for Codex

function sseEvent(data: Record<string, unknown>) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

const STYLE_VARIANTS = [
  {
    style: 'bold',
    styleLabel: '🔥 Bold & Catchy',
    instruction: `STYLE: BOLD & CATCHY
- Strong, attention-grabbing hook with power words
- Use emojis generously throughout
- Punchy, short sentences
- Create urgency and FOMO
- Bold claims backed by excitement
- High energy, high impact`,
    temperature: 0.9,
  },
  {
    style: 'professional',
    styleLabel: '💼 Professional',
    instruction: `STYLE: PROFESSIONAL & CLEAN
- Structured, well-organized content
- Corporate tone with data-driven language
- Minimal emojis (1-2 max)
- Focus on credibility and trust
- Include statistics or authority references
- Clear, logical flow`,
    temperature: 0.5,
  },
  {
    style: 'creative',
    styleLabel: '✨ Creative',
    instruction: `STYLE: CREATIVE & TRENDY
- Storytelling approach with narrative arc
- Casual, conversational, relatable voice
- Emotional connection and authenticity
- Trendy references and cultural context
- Surprise twist or unexpected angle
- Memorable and shareable`,
    temperature: 0.95,
  },
];

export async function POST(request: NextRequest) {
  const rl = rateLimit(request);
  if (rl) return rl;

  const auth = await getSession(request);
  if (auth.error) {
    return new Response(sseEvent({ step: 'error', message: auth.error }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }
  const userId = auth.userId!;

  const db = await getDb();
  const { brief, platform, targetAudience, goal, brandGuidelineId } = await request.json();
  if (!brief) {
    return new Response(sseEvent({ step: 'error', message: 'Brief is required' }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }

  const preferredModel = await getUserPreferredModel(userId, 'caption');

  // Fetch brand guidelines if specified
  let brandGuidelines: BrandGuidelines | undefined;
  if (brandGuidelineId) {
    try {
      const row = db.prepare(
        'SELECT id, brand_name, tone_of_voice, target_market, key_messages, do_list, dont_list, examples FROM brand_guidelines WHERE id = ? AND user_id = ?'
      ).get(brandGuidelineId, userId) as Record<string, unknown> | undefined;
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
  const contextMemory = await fetchContextMemory(userId, 'social-post', 5);

  // Fetch style context from knowledge graph
  const styleContext = await fetchStyleContext(userId, 'social-post');

  // Fetch best examples for auto-learning
  let bestExamples = '';
  try {
    const examplesResult = db.prepare(`
      SELECT output_data, brief FROM tasks
      WHERE type = 'social-post' AND rating >= 4 AND output_data IS NOT NULL
      ORDER BY rating DESC, created_at DESC LIMIT 3
    `).all() as { output_data: string; brief: string }[];
    if (examplesResult.length) {
      bestExamples = '\n\n📚 Best examples from past (highly rated):';
      for (const v of examplesResult) {
        try {
          const data = JSON.parse(v.output_data);
          const caption = data.captionData?.caption || data.caption || '';
          bestExamples += `\n- Brief: "${(v.brief || '').substring(0, 100)}"\n  Caption: "${caption.substring(0, 150)}"`;
        } catch {}
      }
    }
  } catch {}

  const encoder = new TextEncoder();
  let timeoutId: ReturnType<typeof setTimeout>;

  const stream = new ReadableStream({
    async start(controller) {
      const isCodex = preferredModel.startsWith('gpt-5.6');
      const timeout = isCodex ? CODEX_TIMEOUT_MS : TIMEOUT_MS;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Generation timed out after ${timeout / 1000}s`)), timeout);
      });

      try {
        const generationPromise = (async () => {
          const taskId = uuidv4();
          const smartSystem = getSmartSystemPrompt('social-post', platform, brandGuidelines, targetAudience, styleContext);

          // Generate 3 options in parallel
          controller.enqueue(encoder.encode(sseEvent({
            step: 'draft',
            progress: 5,
            message: '🚀 Generating 3 style options in parallel...',
          })));

          const optionPromises = STYLE_VARIANTS.map(async (variant, index) => {
            const stylePrompt = `Create a social media post with these details:
Brief: ${brief}
Platform: ${platform || 'Instagram'}
Target Audience: ${targetAudience || 'General'}
Goal: ${goal || 'Awareness'}

${variant.instruction}
${bestExamples}
${contextMemory}

Follow the SOP strictly. Output JSON format with: { "hook": "...", "caption": "...", "hashtags": ["..."] }`;

            const progressBase = 10 + index * 20;

            controller.enqueue(encoder.encode(sseEvent({
              step: 'draft',
              progress: progressBase,
              message: `${variant.styleLabel} — generating...`,
            })));

            if (isCodex) {
              // Codex: single step
              const result = await generateContent(smartSystem, stylePrompt, userId, taskId, {
                brandGuidelines,
                model: preferredModel,
                temperature: variant.temperature,
              });
              return { variant, result: result.content, usage: result.usage };
            } else {
              // OpenRouter: single-step with style-specific temperature
              const result = await generateContent(smartSystem, stylePrompt, userId, taskId, {
                brandGuidelines,
                responseFormat: { type: 'json_object' },
                model: preferredModel,
                temperature: variant.temperature,
              });
              return { variant, result: result.content, usage: result.usage };
            }
          });

          const optionResults = await Promise.all(optionPromises);

          controller.enqueue(encoder.encode(sseEvent({
            step: 'draft',
            progress: 70,
            message: '✅ All 3 options generated!',
          })));

          // Parse all options
          const options = optionResults.map(({ variant, result }) => {
            let captionData;
            try { captionData = JSON.parse(result); } catch { captionData = { caption: result, hook: '', hashtags: [] }; }
            return {
              style: variant.style,
              styleLabel: variant.styleLabel,
              hook: captionData.hook || '',
              caption: captionData.caption || result,
              hashtags: captionData.hashtags || [],
              imagePrompt: '', // Will be filled below
            };
          });

          // Generate image prompt (single, for the overall brief)
          controller.enqueue(encoder.encode(sseEvent({
            step: 'image-prompt',
            progress: 80,
            message: '🎨 Generating image prompt...',
          })));

          const imagePromptModel = await getUserPreferredModel(userId, 'image-prompt');
          const smartImageSystem = getSmartSystemPrompt('image-prompt', platform, brandGuidelines, undefined, styleContext);
          const imagePrompt = await generateContent(
            smartImageSystem,
            `Create a FLUX image prompt for a social media post about: ${brief}. Platform: ${platform || 'Instagram'}. Target: ${targetAudience || 'General'}.`,
            userId,
            taskId,
            { brandGuidelines, model: imagePromptModel }
          );

          // Set imagePrompt on all options
          for (const opt of options) {
            opt.imagePrompt = imagePrompt.content;
          }

          // Aggregate usage
          const totalUsage = {
            caption: {
              inputTokens: optionResults.reduce((sum, r) => sum + (r.usage?.inputTokens || 0), 0),
              outputTokens: optionResults.reduce((sum, r) => sum + (r.usage?.outputTokens || 0), 0),
              model: optionResults[0]?.usage?.model || preferredModel,
              cost: optionResults.reduce((sum, r) => sum + (r.usage?.cost || 0), 0),
            },
            imagePrompt: imagePrompt.usage,
          };

          // Save output data
          const outputData = {
            options,
            imagePrompt: imagePrompt.content,
          };

          const dateStr = new Date().toISOString().split('T')[0];
          const fileName = `social-post-${taskId.substring(0, 8)}-${dateStr}.json`;
          const outputDir = path.join(process.cwd(), 'public', 'outputs', 'social-posts');
          if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
          fs.writeFileSync(path.join(outputDir, fileName), JSON.stringify(outputData, null, 2));

          // Save to DB (store first option as captionData for backward compat)
          db.prepare('INSERT INTO tasks (id, user_id, type, title, brief, status, output_data) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            taskId, userId, 'social-post', `Social Post: ${brief.substring(0, 50)}`, brief, 'completed', JSON.stringify(outputData)
          );
          saveDbToDisk();

          // Send final result
          controller.enqueue(encoder.encode(sseEvent({
            step: 'done',
            progress: 100,
            message: '✅ Generation complete! Pick your favorite style.',
            result: {
              success: true,
              taskId,
              options,
              imagePrompt: imagePrompt.content,
              outputFile: `/outputs/social-posts/${fileName}`,
              usage: totalUsage,
            },
          })));
        })();

        await Promise.race([generationPromise, timeoutPromise]);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Generation failed';
        console.error('Social post generation error:', e);
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
