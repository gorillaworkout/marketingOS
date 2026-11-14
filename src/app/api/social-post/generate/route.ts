import { NextRequest } from 'next/server';
import { queryOne, queryAll, execute } from '@/lib/database';
import { requireFeature } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { guardGeneratedText, mergeBrandFacts } from '@/lib/brand-fact-guard';
import { generateContent, getSmartSystemPrompt, fetchContextMemory, fetchStyleContext, fetchKnowledgeContext, getUserPreferredModel, runQC, generateDupoinFileName, type BrandGuidelines, type QCResult } from '@/lib/openai';
import { SOCIAL_POST_STORY_RULE, buildBriefPromptBlock, outputShape, parseSocialPostBrief, type SocialPostBriefInput } from '@/lib/social-post-brief';
import { getEmbedding } from '@/lib/embeddings';
import {
  buildBrandVoiceBlock,
  buildCampaignBlock,
  campaignAllowedText,
  pickVoiceSamples,
  type CampaignInput,
  type VoiceSample,
} from '@/lib/social-post-library';
import { rankCampaignSuggestion } from '@/lib/social-post-campaign-match';
import { approachInsight, buildCompetitorInsightsBlock, competitorIdsFromBody, parseCompetitorAnalysis } from '@/lib/social-post-competitor';
import { buildSocialPostImagePromptUserMessage } from '@/lib/dupoin-image-prompt';
import { DEFAULT_IMAGE_ASPECT_RATIO } from '@/lib/image-aspect-ratio';
import {
  applyGroundedFactsCheck,
  formatSocialPostEvidence,
  researchSocialPostWeb,
  resolveSocialPostCitations,
  type SocialPostWebResearch,
} from '@/lib/social-post-research';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

const TIMEOUT_MS = 300_000; // 5 min for 3 parallel options

function sseEvent(data: Record<string, unknown>) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

const STYLE_VARIANTS = [
  {
    style: 'bold',
    styleLabel: '🔥 Bold & Catchy',
    instruction: `STYLE: BOLD & CATCHY
- Strong, attention-grabbing hook with power words
- Use emojis generously, except LinkedIn which stays at 1-2
- Punchy, short sentences
- Create urgency and FOMO
- Bold claims use excitement, not invented statistics
- High energy, high impact
- Do not invent numbers, prices, or competitor facts`,
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
- Include a statistic or authority reference only when WEB_RESEARCH states it, and cite that source
- Clear, logical flow
- Do not invent numbers, prices, or competitor facts`,
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
- Memorable and shareable
- Do not invent numbers, prices, or competitor facts
- ${SOCIAL_POST_STORY_RULE}`,
    temperature: 0.95,
  },
];

export async function POST(request: NextRequest) {
  const rl = rateLimit(request);
  if (rl) return rl;

  const auth = await requireFeature(request, 'social-post');
  if ('error' in auth) {
    return new Response(sseEvent({ step: 'error', message: auth.error }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }
  const userId = auth.id;
  const payload = await request.json();
  const { brief, platform, targetAudience, goal, brandGuidelineId, campaignId } = payload as {
    brief?: string; platform?: string; targetAudience?: string; goal?: string; brandGuidelineId?: string; campaignId?: string;
  };
  const selectedCampaignId = typeof campaignId === 'string' ? campaignId.trim() : '';
  const parsedBrief = parseSocialPostBrief(payload);
  if (!parsedBrief.ok) {
    return new Response(sseEvent({ step: 'error', message: parsedBrief.error }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }
  const generationBrief: SocialPostBriefInput = parsedBrief.brief;
  if (!brief) {
    return new Response(sseEvent({ step: 'error', message: 'Brief is required' }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }

  const preferredModel = await getUserPreferredModel(userId, 'social-post');

  // Fetch brand guidelines if specified
  let brandGuidelines: BrandGuidelines | undefined;
  let voiceCharacter = '';
  let bannedPhrases: string[] = [];
  let voiceSamples: VoiceSample[] = [];
  if (brandGuidelineId) {
    try {
      const row = await queryOne('SELECT id, brand_name, tone_of_voice, target_market, key_messages, do_list, dont_list, examples, voice_character, banned_phrases FROM brand_guidelines WHERE id = ? AND (user_id = ? OR is_shared = TRUE)', [brandGuidelineId, userId]) as Record<string, unknown> | undefined;
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
        voiceCharacter = typeof row.voice_character === 'string' ? row.voice_character : '';
        bannedPhrases = Array.isArray(JSON.parse(String(row.banned_phrases || '[]'))) ? JSON.parse(String(row.banned_phrases || '[]')).filter((item: unknown) => typeof item === 'string') : [];
        const sampleRows = await queryAll('SELECT platform, content_type, caption, note FROM brand_voice_samples WHERE brand_guideline_id = ? ORDER BY created_at DESC LIMIT 20', [brandGuidelineId]) as Array<{ platform: string | null; content_type: string | null; caption: string; note: string | null }>;
        voiceSamples = sampleRows.map(sample => ({ platform: sample.platform, contentType: sample.content_type, caption: sample.caption, note: sample.note }));
      }
    } catch (e) {
      console.warn('Failed to fetch brand guidelines:', e);
    }
  }

  let campaign: CampaignInput | null = null;
  let campaignSuggestion: { id: string; name: string; score: number } | null = null;
  try {
    if (selectedCampaignId) {
      const row = await queryOne<{
        name: string; status: string; starts_on: string | null; ends_on: string | null; objective: string | null;
        key_facts: string; approved_claims: string; links: string; hashtags: string; notes: string | null;
      }>('SELECT name, status, starts_on, ends_on, objective, key_facts, approved_claims, links, hashtags, notes FROM campaigns WHERE id = ?', [selectedCampaignId]);
      if (row) {
        const parsed = {
          name: row.name,
          status: (['planned', 'active', 'ended', 'archived'].includes(row.status) ? row.status : 'active') as CampaignInput['status'],
          startsOn: row.starts_on,
          endsOn: row.ends_on,
          objective: row.objective,
          keyFacts: JSON.parse(row.key_facts || '[]'),
          approvedClaims: JSON.parse(row.approved_claims || '[]'),
          links: JSON.parse(row.links || '[]'),
          hashtags: JSON.parse(row.hashtags || '[]'),
          notes: row.notes,
        };
        campaign = parsed;
      }
    } else {
      const rows = await queryAll<{ id: string; name: string; status: string; embedding: string | null }>(
        `SELECT id, name, status, embedding FROM campaigns WHERE status = 'active' ORDER BY updated_at DESC LIMIT 50`,
      );
      const match = rankCampaignSuggestion(await getEmbedding(String(brief).slice(0, 2_000)), rows);
      campaignSuggestion = match ? { id: match.id, name: match.name, score: Number(match.score.toFixed(3)) } : null;
    }
  } catch (error) {
    console.warn('Campaign memory unavailable:', error);
  }
  const voiceBlock = buildBrandVoiceBlock({
    character: voiceCharacter,
    banned: bannedPhrases,
    samples: pickVoiceSamples(voiceSamples, platform, generationBrief.contentType),
  });
  const campaignBlock = campaign ? buildCampaignBlock(campaign) : '';
  const competitorIds = competitorIdsFromBody((payload as { competitorRefIds?: unknown }).competitorRefIds);
  let competitorBlock = '';
  try {
    if (competitorIds.length) {
      const rows = await queryAll<{ id: string; pasted_text: string | null; analysis: unknown }>(
        `SELECT id, pasted_text, analysis FROM competitor_references WHERE id IN (${competitorIds.map(() => '?').join(', ')})`,
        competitorIds,
      );
      const byId = new Map(rows.map(row => [row.id, row]));
      const insights = competitorIds.flatMap(id => {
        const row = byId.get(id);
        if (!row?.analysis) return [];
        return [approachInsight(parseCompetitorAnalysis(row.analysis), row.pasted_text || '')];
      });
      competitorBlock = buildCompetitorInsightsBlock(insights);
    }
  } catch (error) {
    console.warn('Competitor insights unavailable:', error);
  }

  // Fetch context memory
  const contextMemory = await fetchContextMemory(userId, 'social-post', 5);

  // Fetch style context from knowledge graph
  const styleContext = await fetchStyleContext(userId, 'social-post');

  // Retrieve similar approved knowledge_entries for this user (RAG)
  const knowledgeContext = await fetchKnowledgeContext(userId, brief, 'social-post', 5);

  // Fetch best examples for auto-learning
  let bestExamples = '';
  try {
    const examplesResult = await queryAll(`
      SELECT output_data, brief FROM tasks
      WHERE type = 'social-post' AND rating >= 4 AND output_data IS NOT NULL
      ORDER BY rating DESC, created_at DESC LIMIT 3
    `, []) as { output_data: string; brief: string }[];
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
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Generation timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
      });

      try {
        const generationPromise = (async () => {
          const taskId = uuidv4();
          const smartSystem = getSmartSystemPrompt('social-post', platform, brandGuidelines, targetAudience, styleContext);

          // Step 0: Open-web grounding, then past posts as a secondary signal.
          let webResearch: SocialPostWebResearch;
          try {
            webResearch = await researchSocialPostWeb({
              brief,
              platform,
              targetAudience,
              goal,
              onProgress: (message) => {
                controller.enqueue(encoder.encode(sseEvent({
                  step: 'research',
                  progress: 4,
                  message,
                })));
              },
            });
          } catch (error) {
            console.warn('Social post web research failed:', error);
            webResearch = {
              status: 'empty',
              queries: [],
              sources: [],
              warnings: ['Web research failed. Continuing with past posts only.'],
            };
          }

          const readCount = webResearch.sources.filter((source) => source.read).length;
          const webMessage = webResearch.status === 'skipped'
            ? webResearch.skippedReason || 'Web grounding was skipped. Continuing with past posts only.'
            : webResearch.sources.length
              ? `Read ${readCount} source page${readCount === 1 ? '' : 's'} from ${webResearch.sources.length} web hit${webResearch.sources.length === 1 ? '' : 's'}.`
              : (webResearch.warnings[0] || 'Open-web search returned no usable sources. Continuing with past posts only.');
          controller.enqueue(encoder.encode(sseEvent({
            step: 'research',
            progress: 8,
            message: webMessage,
            webResearch,
          })));

          let researchPosts: Array<{ brief: string; style: string; rating: number; caption: string }> = [];
          try {
            const pastTasks = await queryAll(`
              SELECT output_data, brief, rating FROM tasks
              WHERE type = 'social-post' AND status = 'completed' AND output_data IS NOT NULL
              ORDER BY created_at DESC LIMIT 10
            `, []) as { output_data: string; brief: string; rating: number | null }[];

            // Filter for similar posts (brief contains similar words) — simple keyword matching
            const briefWords = brief.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
            const scored = pastTasks.map(t => {
              const taskWords = (t.brief || '').toLowerCase().split(/\s+/);
              const overlap = briefWords.filter((w: string) => taskWords.includes(w)).length;
              return { ...t, overlap };
            }).filter(t => t.overlap > 0).sort((a, b) => b.overlap - a.overlap).slice(0, 5);

            // If not enough similar posts, fill with recent ones
            if (scored.length < 5) {
              const remaining = pastTasks.filter(t => !scored.find(s => s.brief === t.brief)).slice(0, 5 - scored.length);
              scored.push(...remaining.map(t => ({ ...t, overlap: 0 })));
            }

            researchPosts = scored.slice(0, 5).map(t => {
              try {
                const data = JSON.parse(t.output_data);
                const firstOpt = data.options?.[0] || data.captionData || {};
                return {
                  brief: (t.brief || '').substring(0, 80),
                  style: firstOpt.style || 'unknown',
                  rating: t.rating || 0,
                  caption: (firstOpt.caption || '').substring(0, 120),
                };
              } catch {
                return { brief: t.brief || '', style: 'unknown', rating: 0, caption: '' };
              }
            });
          } catch (e) {
            console.warn('Research step failed:', e);
          }

          controller.enqueue(encoder.encode(sseEvent({
            step: 'research',
            progress: 12,
            message: `Found ${researchPosts.length} past post${researchPosts.length === 1 ? '' : 's'}. ${webResearch.status === 'grounded' ? 'Web sources are included in the caption prompt.' : 'Web grounding was not available, so captions use past posts only.'}`,
            researchPosts,
            webResearch,
          })));

          const evidence = formatSocialPostEvidence(webResearch);

          // Generate 3 options in parallel
          controller.enqueue(encoder.encode(sseEvent({
            step: 'draft',
            progress: 16,
            message: 'Generating 3 style options in parallel...',
          })));

          const optionPromises = STYLE_VARIANTS.map(async (variant, index) => {
            const stylePrompt = `Create a social media post with these details:
Brief: ${String(brief).slice(0, 2_000)}
Platform: ${platform || 'Instagram'}
Target Audience: ${targetAudience || 'General'}
Goal: ${goal || 'Awareness'}
${buildBriefPromptBlock(generationBrief)}
${voiceBlock}
${campaignBlock}
${competitorBlock}

${variant.instruction}
${bestExamples}
${contextMemory}
${knowledgeContext}

${evidence}

Follow the SOP strictly. Return citationIds for every WEB_RESEARCH excerpt you used. Output JSON format with: ${outputShape(generationBrief.contentType)}`;

            const progressBase = 20 + index * 16;

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
              taskType: 'social-post',
            });
            return { variant, result: result.content, usage: result.usage, fallbackLabel: result.fallbackLabel || null };
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
              hashtags: Array.isArray(captionData.hashtags) ? captionData.hashtags : [],
              citations: resolveSocialPostCitations(captionData, webResearch.sources),
              videoHook: typeof captionData.videoHook === 'string' ? captionData.videoHook : '',
              shotList: Array.isArray(captionData.shotList) ? captionData.shotList.filter((line: unknown) => typeof line === 'string') : [],
              slides: Array.isArray(captionData.slides) ? captionData.slides : [],
              imagePrompt: '',
            };
          });

          // Run QC on each option
          controller.enqueue(encoder.encode(sseEvent({
            step: 'qc',
            progress: 72,
            message: '🔍 Running quality checks...',
          })));

          const brandFacts = mergeBrandFacts(brandGuidelines?.key_messages);
          const claimWarnings = options.map(opt => {
            const hook = guardGeneratedText(opt.hook, brandFacts);
            const caption = guardGeneratedText(opt.caption, brandFacts);
            opt.hook = hook.text;
            opt.caption = caption.text;
            return [...hook.warnings, ...caption.warnings];
          });

          const qcResults: QCResult[] = options.map((opt, index) => {
            const qc = applyGroundedFactsCheck(
            runQC(`${opt.hook}\n${opt.caption}`, opt.hashtags, platform, {
              style: opt.style,
              keyMessage: generationBrief.keyMessage,
              cta: generationBrief.cta,
              ctaUrl: generationBrief.ctaUrl,
              allowedUrls: campaign?.links.map(link => link.url) || [],
              restrictUrls: Boolean(campaign),
              bannedPhrases,
              campaignFacts: campaign ? campaignAllowedText(campaign, `${brief || ''}\n${generationBrief.keyMessage}`) : undefined,
            }),
            opt.caption,
            opt.citations,
            );
            const warnings = claimWarnings[index] || [];
            if (!warnings.length) return qc;
            const checks = [...qc.checks, { name: 'verified_claims', label: 'Verified claims', passed: false, detail: warnings[0] }];
            const passedCount = checks.filter(check => check.passed).length;
            return { checks, allPassed: passedCount === checks.length, score: Math.round((passedCount / checks.length) * 100) };
          });

          controller.enqueue(encoder.encode(sseEvent({
            step: 'qc',
            progress: 75,
            message: `✅ QC complete — ${qcResults.filter(r => r.allPassed).length}/${qcResults.length} passed all checks`,
            qcResults,
          })));

          // Generate DUPOIN naming convention
          const dupoinFileName = generateDupoinFileName(brief, platform);

          // Generate one advertising creative prompt per caption option. Video skips images.
          const isVideo = generationBrief.contentType === 'video';
          controller.enqueue(encoder.encode(sseEvent({
            step: 'image-prompt',
            progress: 80,
            message: isVideo
              ? 'Video post: caption, 3-second hook, and shot list only. Image generation skipped.'
              : '🎨 Building advertising creative directions...',
          })));
          const smartImageSystem = getSmartSystemPrompt('image-prompt', platform, brandGuidelines, undefined, styleContext);
          const imagePrompts = isVideo ? [] : await Promise.all(options.map(async selectedCaption => generateContent(
            smartImageSystem,
            `${buildSocialPostImagePromptUserMessage({
              brief,
              platform,
              targetAudience,
              hook: selectedCaption.hook,
              caption: selectedCaption.caption,
              aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
            })}\nContent type: ${generationBrief.contentType}\nKey message: ${generationBrief.keyMessage}\nCTA: ${generationBrief.cta}${campaign ? `\nPromo facts allowed on the image: ${campaign.keyFacts.join('; ').slice(0, 400)}. Do not invent prices or URLs.` : ''}${knowledgeContext}`,
            userId,
            taskId,
            { brandGuidelines, model: preferredModel, taskType: 'social-post' }
          )));

          if (!isVideo) options.forEach((option, index) => { option.imagePrompt = guardGeneratedText(imagePrompts[index].content, brandFacts).text; });

          // Aggregate usage
          const totalUsage = {
            caption: {
              inputTokens: optionResults.reduce((sum, r) => sum + (r.usage?.inputTokens || 0), 0),
              outputTokens: optionResults.reduce((sum, r) => sum + (r.usage?.outputTokens || 0), 0),
              model: optionResults[0]?.usage?.model || preferredModel,
              cost: optionResults.reduce((sum, r) => sum + (r.usage?.cost || 0), 0),
            },
            imagePrompt: {
              inputTokens: imagePrompts.reduce((sum, result) => sum + result.usage.inputTokens, 0),
              outputTokens: imagePrompts.reduce((sum, result) => sum + result.usage.outputTokens, 0),
              model: imagePrompts[0]?.usage.model || preferredModel,
              cost: imagePrompts.reduce((sum, result) => sum + result.usage.cost, 0),
            },
          };

          const outputData = {
            input: {
              contentType: generationBrief.contentType,
              tone: generationBrief.tone,
              toneCustom: generationBrief.toneCustom,
              cta: generationBrief.cta,
              ctaUrl: generationBrief.ctaUrl,
              keyMessage: generationBrief.keyMessage,
              reference: generationBrief.reference,
              brandGuidelineId: brandGuidelineId || null,
              campaignId: selectedCampaignId || null,
              competitorRefIds: competitorIds,
              platform: platform || 'Instagram',
              targetAudience: targetAudience || '',
              goal: goal || '',
            },
            options,
            imagePrompt: imagePrompts[0]?.content || '',
            webResearch,
          };

          const dateStr = new Date().toISOString().split('T')[0];
          const fileName = `social-post-${taskId.substring(0, 8)}-${dateStr}.json`;
          const outputDir = path.join(process.cwd(), 'public', 'outputs', 'social-posts');
          if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
          fs.writeFileSync(path.join(outputDir, fileName), JSON.stringify(outputData, null, 2));

          // Save to DB (store first option as captionData for backward compat)
          await execute('INSERT INTO tasks (id, user_id, type, title, brief, status, output_data) VALUES (?, ?, ?, ?, ?, ?, ?)', [taskId, userId, 'social-post', `Social Post: ${brief.substring(0, 50)}`, brief, 'draft', JSON.stringify({ ...outputData, qcResults, dupoinFileName, researchPosts })]);

          // Send final result
          controller.enqueue(encoder.encode(sseEvent({
            step: 'done',
            progress: 100,
            message: '✅ Generation complete! Pick your favorite style.',
            result: {
              success: true,
              taskId,
              options,
              imagePrompt: imagePrompts[0]?.content || '',
              contentType: generationBrief.contentType,
              outputFile: `/outputs/social-posts/${fileName}`,
              usage: totalUsage,
              fallbackLabel: optionResults.find(r => r.fallbackLabel)?.fallbackLabel || null,
              qcResults,
              dupoinFileName,
              researchPosts,
              webResearch,
              status: 'draft',
              campaignSuggestion,
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
