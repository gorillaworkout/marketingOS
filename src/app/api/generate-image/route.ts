import { NextRequest } from 'next/server';
import { getDb, saveDbToDisk } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

const OR_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OR_BASE = 'https://openrouter.ai/api/v1';

function sseEvent(data: Record<string, unknown>) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  const rl = rateLimit(request);
  if (rl) return rl;

  const auth = await getSession(request);
  if (auth.error) {
    return new Response(sseEvent({ step: 'error', message: auth.error }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }
  const userId = auth.userId;

  const db = await getDb();
  const { prompt, taskId, type } = await request.json();
  if (!prompt) {
    return new Response(sseEvent({ step: 'error', message: 'Prompt is required' }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }

  const models = [
    { id: 'openai/gpt-5-image', name: 'GPT-5 Image' },
    { id: 'openai/gpt-5-image-mini', name: 'GPT-5 Image Mini' },
    { id: 'openai/gpt-5.4-image-2', name: 'GPT-5.4 Image 2' },
  ];

  const encoder = new TextEncoder();
  let timeoutId: ReturnType<typeof setTimeout>;

  const stream = new ReadableStream({
    async start(controller) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Image generation timed out after 120s')), 120_000);
      });

      try {
        const generationPromise = (async () => {
          for (let i = 0; i < models.length; i++) {
            const model = models[i];
            const progress = Math.round(((i + 0.5) / models.length) * 80) + 10; // 10-90%

            controller.enqueue(encoder.encode(sseEvent({
              step: 'trying',
              progress,
              message: `🎨 Trying ${model.name}... (model ${i + 1}/${models.length})`,
            })));

            try {
              const ctrl = new AbortController();
              const timeout = setTimeout(() => ctrl.abort(), 60000);

              const response = await fetch(`${OR_BASE}/images/generations`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${OR_API_KEY}`,
                  'HTTP-Referer': 'https://marketingos.local',
                  'X-Title': 'MarketingOS',
                },
                body: JSON.stringify({ model: model.id, prompt, n: 1, size: '1024x1024' }),
                signal: ctrl.signal,
              });
              clearTimeout(timeout);

              const data = await response.json();

              if (response.ok && data.data?.[0]) {
                const imageData = data.data[0];
                let imgResult;

                if (imageData.b64_json) {
                  imgResult = await saveBase64Image(imageData.b64_json, taskId, type || 'generated');
                } else if (imageData.url) {
                  imgResult = await saveImage(imageData.url, taskId, type || 'generated');
                }

                if (imgResult) {
                  controller.enqueue(encoder.encode(sseEvent({
                    step: 'done',
                    progress: 100,
                    message: `✅ Image generated with ${model.name}!`,
                    result: { success: true, ...imgResult, prompt, model: model.id },
                  })));
                  return;
                }
              }
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : String(e);
              console.log(`Model ${model.id} failed: ${message}`);
              controller.enqueue(encoder.encode(sseEvent({
                step: 'trying',
                progress: Math.round(((i + 1) / models.length) * 80) + 10,
                message: `⚠️ ${model.name} failed, trying next...`,
              })));
            }
          }

          // All models failed
          controller.enqueue(encoder.encode(sseEvent({
            step: 'error',
            progress: 100,
            message: 'Image generation failed. Try again or check OpenRouter credits.',
          })));
        })();

        await Promise.race([generationPromise, timeoutPromise]);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Image generation failed';
        console.error('Image generation error:', e);
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

async function saveBase64Image(base64: string, taskId: string | null, type: string) {
  const outputDir = path.join(process.cwd(), 'public', 'outputs', 'images');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const fileName = `image-${Date.now()}.png`;
  const filePath = path.join(outputDir, fileName);

  const buffer = Buffer.from(base64, 'base64');
  fs.writeFileSync(filePath, buffer);

  return { imageUrl: `/outputs/images/${fileName}`, localPath: filePath, fileName };
}

async function saveImage(imageUrl: string, taskId: string | null, type: string) {
  const outputDir = path.join(process.cwd(), 'public', 'outputs', 'images');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const fileName = `image-${Date.now()}.png`;
  const filePath = path.join(outputDir, fileName);
  const response = await fetch(imageUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return { imageUrl: `/outputs/images/${fileName}`, localPath: filePath, fileName };
}
