import { NextRequest } from 'next/server';
import { getDb, saveDbToDisk } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { generateContent, getSmartSystemPrompt, fetchContextMemory, fetchStyleContext, getUserPreferredModel, type BrandGuidelines } from '@/lib/openai';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

const TIMEOUT_MS = 300_000; // 5 min for 3 parallel options
const CODEX_TIMEOUT_MS = 300_000;

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
    instruction: `STYLE: CINEMATIC & STORYTELLING
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

  const auth = await getSession(request);
  if (auth.error) {
    return new Response(sseEvent({ step: 'error', message: auth.error }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }
  const userId = auth.userId!;

  const db = await getDb();
  const { event, platform, duration, targetAudience, references, brandGuidelineId } = await request.json();
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

  // Fetch context memory (last 5 video-script tasks)
  const contextMemory = await fetchContextMemory(userId, 'video-script', 5);

  // Fetch style context from knowledge graph
  const styleContext = await fetchStyleContext(userId, 'video-script');

  // Fetch best examples for auto-learning
  let bestExamples = '';
  try {
    const examplesResult = db.prepare(`
      SELECT output_data, brief FROM tasks
      WHERE type = 'video-script' AND rating >= 4 AND output_data IS NOT NULL
      ORDER BY rating DESC, created_at DESC LIMIT 3
    `).all() as { output_data: string; brief: string }[];
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
      const isCodex = preferredModel.startsWith('gpt-5.6');
      const timeout = isCodex ? CODEX_TIMEOUT_MS : TIMEOUT_MS;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Generation timed out after ${timeout / 1000}s`)), timeout);
      });

      try {
        const generationPromise = (async () => {
          const taskId = uuidv4();
          const smartSystem = getSmartSystemPrompt('video-script', platform, brandGuidelines, targetAudience, styleContext);

          // Generate 3 options in parallel
          controller.enqueue(encoder.encode(sseEvent({
            step: 'draft',
            progress: 5,
            message: '🚀 Generating 3 style options in parallel...',
          })));

          const optionPromises = STYLE_VARIANTS.map(async (variant, index) => {
            const stylePrompt = `Create a video script with these details:
Event/Topic: ${event}
Platform: ${platform || 'Instagram Reels'}
Duration: ${duration || '30-45 seconds'}
Target Audience: ${targetAudience || 'General'}
${references ? `References: ${references}` : ''}

${variant.instruction}
${bestExamples}
${contextMemory}

Follow the SOP strictly. Output JSON format with: { "hook": "...", "context": "...", "highlight": "...", "brandTieIn": "...", "cta": "...", "fullScript": "..." }`;

            const progressBase = 10 + index * 20;

            controller.enqueue(encoder.encode(sseEvent({
              step: 'draft',
              progress: progressBase,
              message: `${variant.styleLabel} — generating...`,
            })));

            const result = await generateContent(smartSystem, stylePrompt, userId, taskId, {
              brandGuidelines,
              responseFormat: { type: 'json_object' },
              model: preferredModel,
              temperature: variant.temperature,
            });

            return { variant, result: result.content, usage: result.usage };
          });

          const optionResults = await Promise.all(optionPromises);

          controller.enqueue(encoder.encode(sseEvent({
            step: 'draft',
            progress: 70,
            message: '✅ All 3 options generated!',
          })));

          // Parse all options
          const options = optionResults.map(({ variant, result }) => {
            let scriptData;
            try { scriptData = JSON.parse(result); } catch {
              scriptData = { fullScript: result, hook: '', context: '', highlight: '', brandTieIn: '', cta: '' };
            }
            return {
              style: variant.style,
              styleLabel: variant.styleLabel,
              hook: scriptData.hook || '',
              context: scriptData.context || '',
              highlight: scriptData.highlight || '',
              brandTieIn: scriptData.brandTieIn || '',
              cta: scriptData.cta || '',
              fullScript: scriptData.fullScript || result,
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

          // Save output data
          const outputData = {
            options,
          };

          const dateStr = new Date().toISOString().split('T')[0];
          const fileName = `video-script-${taskId.substring(0, 8)}-${dateStr}.json`;
          const outputDir = path.join(process.cwd(), 'public', 'outputs', 'video-scripts');
          if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
          fs.writeFileSync(path.join(outputDir, fileName), JSON.stringify(outputData, null, 2));

          // Save to DB
          db.prepare('INSERT INTO tasks (id, user_id, type, title, brief, status, output_data) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            taskId, userId, 'video-script', `Video Script: ${event.substring(0, 50)}`, event, 'completed', JSON.stringify(outputData)
          );
          saveDbToDisk();

          // Send final result (backward compat: script = first option)
          controller.enqueue(encoder.encode(sseEvent({
            step: 'done',
            progress: 100,
            message: '✅ Generation complete! Pick your favorite style.',
            result: {
              success: true,
              taskId,
              options,
              script: options[0], // backward compat for old UI
              outputFile: `/outputs/video-scripts/${fileName}`,
              usage: totalUsage,
            },
          })));
        })();

        await Promise.race([generationPromise, timeoutPromise]);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Generation failed';
        console.error('Video script generation error:', e);
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
