import { NextRequest } from 'next/server';
import { getDb, saveDbToDisk } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { generateContent, getSmartSystemPrompt, fetchContextMemory, fetchStyleContext, getUserPreferredModel, type BrandGuidelines } from '@/lib/openai';
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
    styleLabel: '🔥 Bold & Grand',
    instruction: `STYLE: BOLD & GRAND-SCALE
- Propose an ambitious, high-impact event concept
- Big venue, high-profile speakers, maximum reach
- Innovative ideas that push boundaries (live trading competitions, flash mobs, immersive experiences)
- Strong marketing hooks and viral potential
- Premium budget allocation with maximum ROI vision
- Bold themes: "Trading Revolution", "Financial Freedom Summit", "Market Mastery Live"`,
    temperature: 0.9,
  },
  {
    style: 'professional',
    styleLabel: '💼 Professional',
    instruction: `STYLE: PROFESSIONAL & CORPORATE
- Structured, corporate-standard event plan
- Focus on credibility, authority, and trust-building
- Data-driven venue selection and speaker recommendations
- Conservative budget with clear cost-benefit analysis
- Industry-standard format with detailed timeline and milestones
- Professional themes: "Annual Trading Conference", "Investment Forum", "Market Outlook Seminar"`,
    temperature: 0.5,
  },
  {
    style: 'creative',
    styleLabel: '✨ Creative',
    instruction: `STYLE: CREATIVE & EXPERIENTIAL
- Unique, memorable event concept with storytelling angle
- Experiential elements: workshops, interactive sessions, gamification
- Community-driven, engaging atmosphere
- Budget-conscious but creative with resources
- Unconventional venues or formats (rooftop, hybrid online-offline, pop-up)
- Creative themes: "Trading Journey", "Market Explorers", "Finance Meets Fun"`,
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
  const userId = auth.userId as string;

  const db = await getDb();
  const { eventName, theme, location, budget, targetDate, brandGuidelineId } = await request.json();
  if (!eventName) {
    return new Response(sseEvent({ step: 'error', message: 'Event name is required' }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }

  const preferredModel = await getUserPreferredModel(userId, 'event-plan');

  // Fetch brand guidelines if specified
  let brandGuidelines: BrandGuidelines | undefined;
  if (brandGuidelineId) {
    try {
      const stmt = db.prepare(
        'SELECT id, brand_name, tone_of_voice, target_market, key_messages, do_list, dont_list, examples FROM brand_guidelines WHERE id = ? AND user_id = ?'
      );
      stmt.bind([brandGuidelineId, userId]);
      if (stmt.step()) {
        const row = stmt.getAsObject();
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
      stmt.free();
    } catch (e) {
      console.warn('Failed to fetch brand guidelines:', e);
    }
  }

  // Fetch context memory (last 5 event-plan tasks)
  const contextMemory = await fetchContextMemory(userId, 'event-plan', 5);

  // Fetch style context from knowledge graph
  const styleContext = await fetchStyleContext(userId, 'event-plan');

  // Fetch best examples for auto-learning
  let bestExamples = '';
  try {
    const stmt = db.prepare(`
      SELECT output_data, title FROM tasks
      WHERE type = 'event-plan' AND rating >= 4 AND output_data IS NOT NULL
      ORDER BY rating DESC, created_at DESC LIMIT 3
    `);
    stmt.bind([]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      try {
        const data = JSON.parse(row.output_data as string);
        const concept = data.concept || data.options?.[0]?.concept || '';
        bestExamples += `\n- Title: "${(row.title || '').substring(0, 100)}"\n  Concept: "${concept.substring(0, 150)}"`;
      } catch {}
    }
    stmt.free();
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
          const smartSystem = getSmartSystemPrompt('event-plan', undefined, brandGuidelines, undefined, styleContext);

          // Generate 3 options in parallel
          controller.enqueue(encoder.encode(sseEvent({
            step: 'draft',
            progress: 5,
            message: '🚀 Generating 3 event plan styles in parallel...',
          })));

          const optionPromises = STYLE_VARIANTS.map(async (variant, index) => {
            const stylePrompt = `Create an event plan with these details:
Event Name: ${eventName}
Theme: ${theme || 'General'}
Location: ${location || 'Jakarta'}
Budget: ${budget || 'TBD'}
Target Date: ${targetDate || 'TBD'}

${variant.instruction}
${bestExamples}
${contextMemory}

Follow the SOP strictly. Output JSON format with: { "objective": "...", "concept": "...", "theme": "...", "venue": "...", "speakers": ["..."], "budget": {...}, "timeline": "..." }`;

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
            message: '✅ All 3 event plan options generated!',
          })));

          // Parse all options with robust fallback for double-encoded/malformed JSON
          const options = optionResults.map(({ variant, result }) => {
            let planData;
            try { planData = JSON.parse(result); } catch { planData = { concept: result }; }

            // Helper: try to extract fields from a JSON string even if malformed
            function extractFromJsonString(str: string): Record<string, unknown> | null {
              try {
                return JSON.parse(str);
              } catch {
                // Try to fix common JSON issues (trailing commas, truncated)
                try {
                  const cleaned = str.replace(/,\s*([}\]])/g, '$1').replace(/\n/g, ' ');
                  return JSON.parse(cleaned);
                } catch { /* still invalid */ }
              }
              // Last resort: regex extraction for key fields
              const extracted: Record<string, unknown> = {};
              const patterns = [
                { key: 'objective', re: /"objective"\s*:\s*"([^"]*?)"/ },
                { key: 'concept', re: /"concept"\s*:\s*"([^"]*?)"/ },
                { key: 'theme', re: /"theme"\s*:\s*"([^"]*?)"/ },
                { key: 'venue', re: /"venue"\s*:\s*"([^"]*?)"/ },
                { key: 'timeline', re: /"timeline"\s*:\s*"([^"]*?)"/ },
              ];
              for (const { key, re } of patterns) {
                const m = str.match(re);
                if (m) extracted[key] = m[1];
              }
              // Extract speakers array
              const spMatch = str.match(/"speakers"\s*:\s*\[([\s\S]*?)\]/);
              if (spMatch) {
                try { extracted.speakers = JSON.parse('[' + spMatch[1] + ']'); } catch { extracted.speakers = []; }
              }
              // Extract budget object (first level only)
              const budgetMatch = str.match(/"budget"\s*:\s*(\{[\s\S]*?\})\s*,\s*"(?:timeline|speakers)"/);
              if (budgetMatch) {
                try { extracted.budget = JSON.parse(budgetMatch[1]); } catch { extracted.budget = {}; }
              }
              return Object.keys(extracted).length > 0 ? extracted : null;
            }

            // Handle double-encoded JSON (model returned JSON string inside concept field)
            if (typeof planData.concept === 'string' && planData.concept.trim().startsWith('{')) {
              const inner = extractFromJsonString(planData.concept);
              if (inner && (inner.concept || inner.objective || inner.venue)) {
                planData = inner;
              }
            }

            // Also handle case where model wraps everything in a single field
            if (planData.response && typeof planData.response === 'string' && planData.response.trim().startsWith('{')) {
              const inner = extractFromJsonString(planData.response);
              if (inner && (inner.concept || inner.objective || inner.venue)) {
                planData = inner;
              }
            }

            return {
              style: variant.style,
              styleLabel: variant.styleLabel,
              objective: planData.objective || '',
              concept: planData.concept || result,
              theme: planData.theme || theme || '',
              venue: planData.venue || '',
              speakers: planData.speakers || [],
              budget: planData.budget || {},
              timeline: planData.timeline || '',
            };
          });

          // Aggregate usage
          const totalUsage = {
            plan: {
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
          const fileName = `event-plan-${taskId.substring(0, 8)}-${dateStr}.json`;
          const outputDir = path.join(process.cwd(), 'public', 'outputs', 'event-plans');
          if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
          fs.writeFileSync(path.join(outputDir, fileName), JSON.stringify(outputData, null, 2));

          // Save to DB
          db.prepare('INSERT INTO tasks (id, user_id, type, title, brief, status, output_data) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            taskId, userId, 'event-plan', `Event Plan: ${eventName.substring(0, 50)}`, eventName, 'completed', JSON.stringify(outputData)
          );
          saveDbToDisk();

          // Send final result
          controller.enqueue(encoder.encode(sseEvent({
            step: 'done',
            progress: 100,
            message: '✅ Generation complete! Pick your favorite event plan style.',
            result: {
              success: true,
              taskId,
              options,
              outputFile: `/outputs/event-plans/${fileName}`,
              usage: totalUsage,
            },
          })));
        })();

        await Promise.race([generationPromise, timeoutPromise]);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Generation failed';
        console.error('Event plan generation error:', e);
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
