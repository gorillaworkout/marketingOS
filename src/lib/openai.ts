import { parseGatewayCompletion } from '@/lib/gateway-response';
import { IMAGE_PROMPT_SYSTEM } from '@/lib/dupoin-image-prompt';
import { GORILLAWORKOUT_API_BASE, GORILLAWORKOUT_API_KEY } from '@/lib/gateway-config';
import { logTokenUsage } from '@/lib/token-log';
import {
  mergeGatewayUsage,
  parseGatewayResponseUsage,
  resolveTokenUsage,
  type GatewayTokenUsage,
} from '@/lib/token-usage';

// Must stay inside AVAILABLE_MODELS; verified live via scripts/probe-gateway-models.ts.
const PRIMARY_MODEL = 'ag/gemini-3-flash';

/** Bayu's expected AI Research Codex default. Re-probe before removing. */
export const PREFERRED_CODEX_MODEL = 'cx/gpt-5.6-sol';

export type ModelProvider = 'gorillaworkout';

export interface ModelInfo {
  id: string;
  name: string;
  tier: 'budget' | 'balanced' | 'premium';
  provider: ModelProvider;
  input: number;
  output: number;
}

// Catalog IDs for the GorillaWorkout OpenAI-compatible gateway
// (default https://llmdupoin.gorillaworkout.id/v1, override with GORILLAWORKOUT_API_BASE).
//
// Codex `cx/*` was removed in migration 011 after a probe against
// llm.gorillaworkout.id saw Codex OAuth 401. They may work on llmdupoin —
// ALWAYS re-probe with scripts/probe-gateway-models.ts before removing them
// again. A listed model is not a working model.
//
// Still out (do not re-add without a live completion):
//   kimi/*, tr/moonshotai/*  — no API key at all (owner removed it).
//   cmc/*                    — Command Code account not topped up (400 BAD_REQUEST).
//   cc/*                     — Claude Code OAuth token expired (401).
//   ag/gemini-3.7-*          — 404 Requested entity was not found (never existed upstream).
//   ag/gemini-3.5-*, ag/gemini-3-flash-agent — retired upstream; they return HTTP 200
//                              whose body is a retirement notice, so a status check
//                              alone does NOT catch them.
//   pecut-free               — upstream 400 "Unsupported model mimo-auto".
export const AVAILABLE_MODELS: ModelInfo[] = [
  { id: 'ag/gemini-3-flash', name: 'Gemini 3 Flash', tier: 'budget', provider: 'gorillaworkout', input: 0, output: 0 },
  { id: 'ag/gemini-3.6-flash-low', name: 'Gemini 3.6 Flash Low', tier: 'budget', provider: 'gorillaworkout', input: 0, output: 0 },
  { id: 'ag/gemini-3.6-flash-medium', name: 'Gemini 3.6 Flash Medium', tier: 'balanced', provider: 'gorillaworkout', input: 0, output: 0 },
  { id: 'ag/gemini-3.6-flash-high', name: 'Gemini 3.6 Flash High', tier: 'balanced', provider: 'gorillaworkout', input: 0, output: 0 },
  { id: 'ag/gemini-3.1-pro-low', name: 'Gemini 3.1 Pro Low', tier: 'balanced', provider: 'gorillaworkout', input: 0, output: 0 },
  { id: 'ag/gemini-pro-agent', name: 'Gemini Pro Agent', tier: 'balanced', provider: 'gorillaworkout', input: 0, output: 0 },
  { id: 'ag/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tier: 'balanced', provider: 'gorillaworkout', input: 0, output: 0 },
  { id: 'lr/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', tier: 'balanced', provider: 'gorillaworkout', input: 0, output: 0 },
  { id: 'ag/gpt-oss-120b-medium', name: 'GPT OSS 120B Medium', tier: 'balanced', provider: 'gorillaworkout', input: 0, output: 0 },
  // Codex chat models restored for llmdupoin. Re-probe before removing again.
  { id: 'cx/gpt-5.6-sol', name: 'GPT-5.6 Sol', tier: 'premium', provider: 'gorillaworkout', input: 0, output: 0 },
  { id: 'cx/gpt-5.6-terra', name: 'GPT-5.6 Terra', tier: 'balanced', provider: 'gorillaworkout', input: 0, output: 0 },
  { id: 'cx/gpt-5.6-luna', name: 'GPT-5.6 Luna', tier: 'budget', provider: 'gorillaworkout', input: 0, output: 0 },
  { id: 'cx/gpt-5.5', name: 'GPT-5.5', tier: 'balanced', provider: 'gorillaworkout', input: 0, output: 0 },
  { id: 'cx/gpt-5.4', name: 'GPT-5.4', tier: 'balanced', provider: 'gorillaworkout', input: 0, output: 0 },
  { id: 'cx/gpt-5.4-mini', name: 'GPT-5.4 Mini', tier: 'budget', provider: 'gorillaworkout', input: 0, output: 0 },
  { id: 'cx/gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark', tier: 'budget', provider: 'gorillaworkout', input: 0, output: 0 },
];

export function getModelProvider(modelId: string): ModelProvider {
  if (!AVAILABLE_MODELS.some(model => model.id === modelId)) {
    throw new Error(`Unknown GorillaWorkout model: ${modelId}`);
  }
  return 'gorillaworkout';
}

export function getModelTier(modelId: string): 'budget' | 'balanced' | 'premium' {
  const model = AVAILABLE_MODELS.find(m => m.id === modelId);
  return model?.tier || 'budget';
}

export async function getUserPreferredModel(
  userId: string,
  feature: import('@/lib/model-routing').GenerationFeature,
): Promise<string> {
  const { resolveFeatureModel } = await import('@/lib/model-routing');
  return resolveFeatureModel(userId, feature);
}

function getPricing(model: string) {
  const catalogModel = AVAILABLE_MODELS.find(candidate => candidate.id === model);
  if (!catalogModel) throw new Error(`Unknown GorillaWorkout model: ${model}`);
  return { input: catalogModel.input, output: catalogModel.output };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
  cost: number;
}

export interface BrandGuidelines {
  id: string;
  brand_name: string;
  tone_of_voice?: string;
  target_market?: string;
  key_messages?: string;
  do_list?: string[];
  dont_list?: string[];
  examples?: string;
}


/**
 * Core generation call through the single OpenAI-compatible gateway.
 */
async function callApi(
  messages: Array<{ role: string; content: string }>,
  options: {
    model?: string;
    responseFormat?: { type: 'json_object' } | undefined;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<{ content: string; model: string; usage: GatewayTokenUsage | null }> {
  const model = options.model || PRIMARY_MODEL;
  getModelProvider(model);

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4000,
  };
  if (options.responseFormat) {
    body.response_format = options.responseFormat;
  }

  if (!GORILLAWORKOUT_API_KEY) throw new Error('GORILLAWORKOUT_API_KEY is not configured.');

  const response = await fetch(`${GORILLAWORKOUT_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GORILLAWORKOUT_API_KEY}`,
      'HTTP-Referer': 'https://marketingos.local',
      'X-Title': 'MarketingOS',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error ${response.status}: ${errText}`);
  }

  const responseBody = await response.text();
  const contentType = response.headers.get('content-type');
  const content = parseGatewayCompletion(responseBody, contentType);
  return { content, model, usage: parseGatewayResponseUsage(responseBody, contentType) };
}

/**
 * Call the selected gateway model with one optional JSON-repair retry.
 */
async function callApiWithRetry(
  messages: Array<{ role: string; content: string }>,
  options: {
    model?: string;
    responseFormat?: { type: 'json_object' };
    temperature?: number;
    maxTokens?: number;
    parseJson?: boolean;
    jsonRepairAttempts?: 0 | 1;
  } = {}
): Promise<{ content: string; parsed?: unknown; model: string; retried: boolean; usage: GatewayTokenUsage | null }> {
  const parseJson = options.parseJson ?? true;
  let retried = false;
  let usage: GatewayTokenUsage | null = null;

  // Try primary model
  try {
    const result = await callApi(messages, options);
    usage = mergeGatewayUsage(usage, result.usage);
    if (parseJson && options.responseFormat?.type === 'json_object') {
      try {
        const parsed = JSON.parse(result.content);
        return { ...result, parsed, retried, usage };
      } catch {
        if ((options.jsonRepairAttempts ?? 1) === 0) return { ...result, retried, usage };
        // Retry once with explicit JSON reminder
        retried = true;
        const retryMessages = [
          ...messages,
          { role: 'assistant', content: result.content },
          { role: 'user', content: 'Your response was not valid JSON. Please output ONLY valid JSON with no markdown formatting or code fences.' },
        ];
        const retryResult = await callApi(retryMessages, options);
        usage = mergeGatewayUsage(usage, retryResult.usage);
        try {
          const parsed = JSON.parse(retryResult.content);
          return { ...retryResult, parsed, retried, usage };
        } catch {
          return { ...retryResult, retried, usage };
        }
      }
    }
    return { ...result, retried, usage };
  } catch (generationError) {
    throw generationError;
  }
}

/**
 * Generate content with brand guidelines and structured-output repair.
 */
export async function generateContent(
  systemPrompt: string,
  userPrompt: string,
  userId: string,
  taskId?: string,
  options?: {
    brandGuidelines?: BrandGuidelines;
    responseFormat?: { type: 'json_object' };
    model?: string;
    temperature?: number;
    maxTokens?: number;
    taskType?: string;
    jsonRepairAttempts?: 0 | 1;
  }
): Promise<{ content: string; usage: TokenUsage }> {
  // Inject brand guidelines into system prompt if provided
  let enhancedSystemPrompt = systemPrompt;
  if (options?.brandGuidelines) {
    const bg = options.brandGuidelines;
    const bgSection = buildBrandGuidelinesPrompt(bg);
    enhancedSystemPrompt = systemPrompt + '\n\n' + bgSection;
  }

  const messages = [
    { role: 'system', content: enhancedSystemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const model = options?.model || PRIMARY_MODEL;
  const result = await callApiWithRetry(messages, {
    model,
    responseFormat: options?.responseFormat,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    parseJson: !!options?.responseFormat,
    jsonRepairAttempts: options?.jsonRepairAttempts,
  });

  const pricing = getPricing(result.model);
  const resolved = resolveTokenUsage({
    reported: result.usage,
    inputText: enhancedSystemPrompt + userPrompt,
    outputText: result.content,
  });
  const inputTokens = resolved.inputTokens;
  const outputTokens = resolved.outputTokens;
  const cost = inputTokens * pricing.input + outputTokens * pricing.output;

  const usage: TokenUsage = { inputTokens, outputTokens, model: result.model, cost };

  // Some flows create the task after AI generation. Preserve usage logging while
  // respecting PostgreSQL's foreign-key constraint during that pre-save phase.
  await logTokenUsage({
    userId,
    taskId,
    model: result.model,
    provider: getModelProvider(result.model),
    accountSource: 'office',
    taskType: options?.taskType || '',
    inputTokens,
    outputTokens,
    cost,
  });

  return { content: result.content, usage };
}

/**
 * Multi-step generation: draft → review against brand guidelines → refine.
 * Returns the final content plus all drafts showing the evolution.
 */
export type ProgressCallback = (event: {
  step: string;
  progress: number;
  message: string;
}) => void;

export async function generateMultiStep(
  module: string,
  userPrompt: string,
  userId: string,
  taskId: string,
  brandGuidelines?: BrandGuidelines,
  contextMemory?: string,
  model?: string,
  onProgress?: ProgressCallback
): Promise<{
  content: string;
  drafts: Array<{ step: string; content: string; model: string }>;
  usage: TokenUsage;
}> {
  const drafts: Array<{ step: string; content: string; model: string }> = [];
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, model: model || PRIMARY_MODEL, cost: 0 };

  const bgPrompt = brandGuidelines ? buildBrandGuidelinesPrompt(brandGuidelines) : '';
  const contextSection = contextMemory ? '\n\n' + contextMemory : '';

  // Step 1: Draft
  onProgress?.({ step: 'draft', progress: 5, message: '📝 Writing draft caption...' });
  const draftSystem = getSmartSystemPrompt(module, undefined, brandGuidelines) + contextSection;
  const draftResult = await callApiWithRetry(
    [
      { role: 'system', content: draftSystem },
      { role: 'user', content: userPrompt },
    ],
    { model, responseFormat: { type: 'json_object' }, temperature: 0.8 }
  );
  drafts.push({ step: 'draft', content: draftResult.content, model: draftResult.model });
  onProgress?.({ step: 'draft', progress: 33, message: '✅ Draft complete' });
  const draftPricing = getPricing(draftResult.model);
  const draftUsage = resolveTokenUsage({
    reported: draftResult.usage,
    inputText: draftSystem + userPrompt,
    outputText: draftResult.content,
  });
  totalUsage.inputTokens += draftUsage.inputTokens;
  totalUsage.outputTokens += draftUsage.outputTokens;
  totalUsage.cost += draftUsage.inputTokens * draftPricing.input + draftUsage.outputTokens * draftPricing.output;

  // Step 2: Self-review against brand guidelines
  onProgress?.({ step: 'review', progress: 37, message: '🔍 Reviewing against brand guidelines...' });
  const reviewSystem = `You are a strict brand compliance reviewer. Review the following content against the brand guidelines and identify issues.`;
  const reviewPrompt = `Review this content draft against the brand guidelines:

DRAFT:
${draftResult.content}

${bgPrompt || 'No specific brand guidelines provided. Review for general marketing best practices.'}

Output JSON: { "score": <1-10>, "issues": ["..."], "suggestions": ["..."], "passes_brand_check": <true|false> }`;

  const reviewResult = await callApiWithRetry(
    [
      { role: 'system', content: reviewSystem },
      { role: 'user', content: reviewPrompt },
    ],
    { model, responseFormat: { type: 'json_object' }, temperature: 0.3 }
  );
  drafts.push({ step: 'review', content: reviewResult.content, model: reviewResult.model });
  onProgress?.({ step: 'review', progress: 66, message: '✅ Review complete' });
  const reviewPricing = getPricing(reviewResult.model);
  const reviewUsage = resolveTokenUsage({
    reported: reviewResult.usage,
    inputText: reviewSystem + reviewPrompt,
    outputText: reviewResult.content,
  });
  totalUsage.inputTokens += reviewUsage.inputTokens;
  totalUsage.outputTokens += reviewUsage.outputTokens;
  totalUsage.cost += reviewUsage.inputTokens * reviewPricing.input + reviewUsage.outputTokens * reviewPricing.output;

  // Step 3: Refined final version
  let reviewFeedback = '';
  try {
    const review = typeof reviewResult.parsed === 'object' ? reviewResult.parsed as Record<string, unknown> : JSON.parse(reviewResult.content);
    const issues = Array.isArray(review.issues) ? review.issues : [];
    const suggestions = Array.isArray(review.suggestions) ? review.suggestions : [];
    if (issues.length || suggestions.length) {
      reviewFeedback = `\n\nReview feedback (score: ${review.score}/10):\n` +
        (issues.length ? `Issues to fix: ${issues.join('; ')}\n` : '') +
        (suggestions.length ? `Suggestions: ${suggestions.join('; ')}` : '');
    }
  } catch {
    // If review parsing fails, just refine without specific feedback
  }

  const refineSystem = getSmartSystemPrompt(module, undefined, brandGuidelines) + contextSection;
  onProgress?.({ step: 'refine', progress: 70, message: '✨ Refining final version...' });
  const refinePrompt = `Refine and improve this social media content based on the review feedback. Output the final polished version.

ORIGINAL DRAFT:
${draftResult.content}
${reviewFeedback}

Output the same JSON structure as the draft, but improved. Output valid JSON only.`;

  const refineResult = await callApiWithRetry(
    [
      { role: 'system', content: refineSystem },
      { role: 'user', content: refinePrompt },
    ],
    { model, responseFormat: { type: 'json_object' }, temperature: 0.6 }
  );
  drafts.push({ step: 'refined', content: refineResult.content, model: refineResult.model });
  const refinePricing = getPricing(refineResult.model);
  const refineUsage = resolveTokenUsage({
    reported: refineResult.usage,
    inputText: refineSystem + refinePrompt,
    outputText: refineResult.content,
  });
  totalUsage.inputTokens += refineUsage.inputTokens;
  totalUsage.outputTokens += refineUsage.outputTokens;
  totalUsage.cost += refineUsage.inputTokens * refinePricing.input + refineUsage.outputTokens * refinePricing.output;

  await logTokenUsage({
    userId,
    taskId,
    model: totalUsage.model,
    provider: getModelProvider(totalUsage.model),
    accountSource: 'office',
    taskType: module || '',
    inputTokens: totalUsage.inputTokens,
    outputTokens: totalUsage.outputTokens,
    cost: totalUsage.cost,
  });

  return {
    content: refineResult.content,
    drafts,
    usage: totalUsage,
  };
}

/**
 * Fetch context memory: last N completed tasks of the same type.
 * Returns a formatted string for injection into prompts.
 */
export async function fetchContextMemory(
  userId: string,
  taskType: string,
  limit: number = 5
): Promise<string> {
  try {
    const { queryAll } = await import('@/lib/database');

    const rows = await queryAll(`
      SELECT output_data, brief, created_at FROM tasks
      WHERE user_id = ? AND type = ? AND status = 'completed' AND output_data IS NOT NULL
      ORDER BY created_at DESC LIMIT ?
    `, [userId, taskType, limit]) as { output_data: string; brief: string; created_at: string }[];

    if (!rows.length) return '';

    const entries = rows.map((row, idx) => {
      try {
        const data = JSON.parse(row.output_data);
        const brief = (row.brief || '').substring(0, 100);
        const date = row.created_at;

        // Extract meaningful summary based on task type
        let summary = '';
        if (taskType === 'social-post') {
          const caption = data.captionData?.caption || data.caption || '';
          const hook = data.captionData?.hook || data.hook || '';
          summary = `Hook: "${hook.substring(0, 80)}" | Caption: "${caption.substring(0, 120)}"`;
        } else if (taskType === 'video-script') {
          const script = data.fullScript || data.script?.fullScript || '';
          summary = `Script: "${script.substring(0, 150)}"`;
        } else if (taskType === 'event-plan') {
          const concept = data.concept || data.plan?.concept || '';
          summary = `Concept: "${concept.substring(0, 150)}"`;
        }

        return `${idx + 1}. [${date}] Brief: "${brief}"\n   ${summary}`;
      } catch {
        return '';
      }
    }).filter(Boolean);

    if (!entries.length) return '';

    return `\n\n📚 RECENT CONTEXT — Last ${entries.length} ${taskType} tasks for this user:\n${entries.join('\n')}\n\nUse these as reference for style, tone, and quality. Do NOT copy them — create something fresh but consistent.`;
  } catch (e) {
    console.error('Failed to fetch context memory:', e);
    return '';
  }
}

/**
 * Fetch user style context from knowledge graph tables.
 * Reads user_style_preferences + global_style_profile to inject learned style patterns.
 * Returns a formatted string for prompt injection, or empty if no data.
 */
export async function fetchStyleContext(userId: string, taskType?: string): Promise<string> {
  try {
    const { queryOne } = await import('@/lib/database');
    const parts: string[] = [];
    const user = await queryOne<Record<string, unknown>>('SELECT preferred_cluster, style_summary, tone_preferences, hook_preferences, platform_preferences, total_selections FROM user_style_preferences WHERE user_id = ?', [userId]);
    if (user) {
      const sections: string[] = [];
      if (user.preferred_cluster) sections.push(`Preferred style: ${user.preferred_cluster}`);
      if (Number(user.total_selections || 0) > 0) sections.push(`Based on ${user.total_selections} past selections`);
      for (const [label, value] of [['Tone patterns', user.tone_preferences], ['Hook style examples', user.hook_preferences]] as const) {
        if (!value) continue;
        try { const parsed = JSON.parse(String(value)); sections.push(`${label}: ${Array.isArray(parsed) ? parsed.slice(0, 5).join(', ') : String(parsed)}`); } catch { sections.push(`${label}: ${value}`); }
      }
      if (user.style_summary) sections.push(`Recent picks: ${String(user.style_summary).slice(0, 500)}`);
      if (sections.length) parts.push(`🎯 YOUR STYLE PROFILE:
${sections.join('\n')}
Use these patterns to match the user's demonstrated preferences.`);
    }
    const global = taskType
      ? await queryOne<Record<string, unknown>>('SELECT team_summary, top_examples, cluster_distribution FROM global_style_profile WHERE task_type = ?', [taskType])
      : await queryOne<Record<string, unknown>>('SELECT team_summary, top_examples, cluster_distribution FROM global_style_profile ORDER BY updated_at DESC LIMIT 1');
    if (global) {
      const sections = [global.team_summary && `Team style summary: ${global.team_summary}`, global.cluster_distribution && `Style distribution: ${global.cluster_distribution}`, global.top_examples && `Top team examples: ${global.top_examples}`].filter(Boolean);
      if (sections.length) parts.push(`📊 TEAM STYLE CONTEXT:
${sections.join('\n')}`);
    }
    return parts.length ? '\n\n' + parts.join('\n\n') : '';
  } catch (e) { console.error('Failed to fetch style context:', e); return ''; }
}

export interface KnowledgeContextEntry {
  task_type?: string | null;
  platform?: string | null;
  audience?: string | null;
  brief?: string | null;
  selected_output?: string | null;
}

/**
 * Format retrieved knowledge_entries into a prompt block for RAG injection.
 * Returns empty string when there is nothing to inject.
 */
export function formatKnowledgeContext(entries: KnowledgeContextEntry[]): string {
  if (!entries.length) return '';

  const lines = entries.map((entry, idx) => {
    const scope = [entry.task_type, entry.platform, entry.audience].filter(Boolean).join('/');
    const brief = String(entry.brief || '').replace(/\s+/g, ' ').trim().substring(0, 140);
    const selected = String(entry.selected_output || '').replace(/\s+/g, ' ').trim().substring(0, 220);
    return `${idx + 1}. [${scope || 'knowledge'}] Brief: "${brief}"\n   Approved: "${selected}"`;
  });

  return `\n\n🧠 KNOWLEDGE GRAPH — Similar approved selections for this user:\n${lines.join('\n')}\n\nUse these as retrieved examples of what this user approved. Do NOT copy them — create something fresh that follows the same quality, tone, and structure.`;
}

/**
 * Retrieve user-scoped similar knowledge_entries and return a prompt block.
 * Complements fetchStyleContext (learned profile) and fetchContextMemory (recent tasks).
 */
export async function fetchKnowledgeContext(
  userId: string,
  query: string,
  taskType?: string,
  limit: number = 5,
): Promise<string> {
  try {
    if (!userId || !String(query || '').trim()) return '';
    const { findSimilarEntries } = await import('@/lib/embeddings');
    const entries = await findSimilarEntries(query, { userId, taskType, limit });
    return formatKnowledgeContext(entries);
  } catch (e) {
    console.error('Failed to fetch knowledge context:', e);
    return '';
  }
}

/**
 * Build brand guidelines section for prompt injection.
 */
function buildBrandGuidelinesPrompt(bg: BrandGuidelines): string {
  const parts = [`🏷️ BRAND GUIDELINES — ${bg.brand_name}:`];

  if (bg.tone_of_voice) parts.push(`Tone of Voice: ${bg.tone_of_voice}`);
  if (bg.target_market) parts.push(`Target Market: ${bg.target_market}`);
  if (bg.key_messages) parts.push(`Key Messages: ${bg.key_messages}`);

  if (bg.do_list?.length) {
    parts.push(`DO: ${bg.do_list.join('; ')}`);
  }
  if (bg.dont_list?.length) {
    parts.push(`DON'T: ${bg.dont_list.join('; ')}`);
  }
  if (bg.examples) {
    parts.push(`Example style:\n${bg.examples}`);
  }

  parts.push('\nYou MUST follow these brand guidelines strictly in all generated content.');

  return parts.join('\n');
}

/**
 * Platform-specific prompt optimizations.
 */
function getPlatformOptimization(platform?: string): string {
  if (!platform) return '';

  const lower = platform.toLowerCase();
  const optimizations: Record<string, string> = {
    'instagram': `Platform: Instagram
- Use visually descriptive language
- Include 15-20 relevant hashtags
- Keep caption scannable with line breaks and emojis
- Hook must grab attention in first line (before "more" cutoff)
- Optimal length: 138-150 characters for the hook`,
    'linkedin': `Platform: LinkedIn
- Professional, thought-leadership tone
- No excessive emojis (1-2 max)
- Include industry insights or data points
- Use line breaks for readability
- Hashtags: 3-5 professional hashtags max
- Hook should provoke professional curiosity`,
    'tiktok': `Platform: TikTok
- Trendy, casual, authentic voice
- Reference current trends/sounds if relevant
- Short punchy sentences
- Gen-Z friendly language
- Hook must work in first 1-2 seconds
- Include trending hashtag suggestions`,
    'twitter': `Platform: X/Twitter
- Concise, punchy, under 280 characters
- Strong opinion or insight in the hook
- 1-3 hashtags max
- Thread-worthy content if longer`,
    'facebook': `Platform: Facebook
- Conversational, community-oriented
- Storytelling works well
- Moderate emoji use
- Engagement-focused (questions, polls)`,
    'youtube': `Platform: YouTube
- SEO-optimized title and description
- Hook in first 5 seconds
- Clear chapter/section structure
- CTA for subscribe and engagement`,
  };

  return optimizations[lower] || `Platform: ${platform}\nOptimize content format and style for ${platform}.`;
}

/**
 * Get a smart, dynamic system prompt with platform optimization,
 * brand guidelines context, and tone matching.
 */
export function getSmartSystemPrompt(
  module: string,
  platform?: string,
  brandGuidelines?: BrandGuidelines,
  audience?: string,
  styleContext?: string
): string {
  const basePrompt = getSystemPrompt(module);
  const parts = [basePrompt];

  // Platform optimization
  const platformOpt = getPlatformOptimization(platform);
  if (platformOpt) {
    parts.push('\n' + platformOpt);
  }

  // Audience guidance
  if (audience) {
    parts.push(`\nTarget Audience: ${audience}\nTailor language, references, and complexity level to this audience.`);
  }

  // Brand guidelines are added separately in generateContent if provided,
  // but we add a reminder here
  if (brandGuidelines) {
    parts.push(`\nA brand guidelines document is attached. All content MUST comply with it.`);
  }

  // Inject style context from knowledge graph (user + team style profiles)
  if (styleContext) {
    parts.push(styleContext);
  }

  return parts.join('\n');
}

// QC (Quality Check) for social posts
export interface QCCheck {
  name: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface QCResult {
  allPassed: boolean;
  checks: QCCheck[];
  score: number; // 0-100
}

/**
 * Run automated QC checks on a social post option.
 * Checks: caption length, hashtag count, banned words, emoji count.
 */
export function runQC(caption: string, hashtags: string[], platform?: string): QCResult {
  const checks: QCCheck[] = [];

  // 1. Caption length check (platform-specific)
  const platformLimits: Record<string, { min: number; max: number; label: string }> = {
    'Instagram': { min: 50, max: 2200, label: 'Instagram' },
    'TikTok': { min: 30, max: 2200, label: 'TikTok' },
    'LinkedIn': { min: 50, max: 3000, label: 'LinkedIn' },
    'Twitter/X': { min: 20, max: 280, label: 'X/Twitter' },
    'Facebook': { min: 50, max: 63206, label: 'Facebook' },
  };
  const limits = platformLimits[platform || ''] || { min: 50, max: 2200, label: 'General' };
  const captionLen = caption.length;
  const captionOk = captionLen >= limits.min && captionLen <= limits.max;
  checks.push({
    name: 'caption_length',
    label: 'Caption Length',
    passed: captionOk,
    detail: captionOk
      ? `${captionLen} chars (ideal: ${limits.min}-${limits.max} for ${limits.label})`
      : captionLen < limits.min
        ? `Too short: ${captionLen} chars (min ${limits.min})`
        : `Too long: ${captionLen} chars (max ${limits.max} for ${limits.label})`,
  });

  // 2. Hashtag count check (8-12 ideal)
  const tagCount = hashtags.length;
  const tagOk = tagCount >= 5 && tagCount <= 15;
  checks.push({
    name: 'hashtag_count',
    label: 'Hashtag Count',
    passed: tagOk,
    detail: tagOk
      ? `${tagCount} hashtags (ideal: 8-12)`
      : tagCount < 5
        ? `Only ${tagCount} hashtags (add more, ideal: 8-12)`
        : `${tagCount} hashtags (too many, ideal: 8-12)`,
  });

  // 3. Banned words check
  const bannedWords = ['dijamin', 'pasti untung', 'tanpa risiko', 'bebas risiko', 'pasti profit', 'dijamin profit', 'uang mudah', 'cepat kaya'];
  const lowerCaption = caption.toLowerCase();
  const foundBanned = bannedWords.filter(w => lowerCaption.includes(w));
  checks.push({
    name: 'banned_words',
    label: 'Banned Words',
    passed: foundBanned.length === 0,
    detail: foundBanned.length === 0
      ? 'No banned words found ✓'
      : `Found: "${foundBanned.join('", "')}” — these violate BAPPEBTI compliance`,
  });

  // 4. Emoji count check (max 3)
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;
  const emojis = caption.match(emojiRegex) || [];
  const emojiOk = emojis.length <= 3;
  checks.push({
    name: 'emoji_count',
    label: 'Emoji Count',
    passed: emojiOk,
    detail: emojiOk
      ? `${emojis.length} emojis (max 3)`
      : `${emojis.length} emojis — too many (max 3 recommended)`,
  });

  const passedCount = checks.filter(c => c.passed).length;
  return {
    allPassed: passedCount === checks.length,
    checks,
    score: Math.round((passedCount / checks.length) * 100),
  };
}

/**
 * Generate DUPOIN naming convention.
 * Format: DUPOIN_[NamaKonten]_[Tipe]_[Versi]_[Tanggal]
 * Example: DUPOIN_JFXOlympic_SocialPost_V1_20260716
 */
export function generateDupoinFileName(brief: string, platform?: string): string {
  void platform; // Retained for backward-compatible callers; naming is always SocialPost.
  // Extract meaningful name from brief (first 2-3 significant words, PascalCase)
  const words = brief
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 3)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  const namaKonten = words.join('') || 'Content';
  const tipe = 'SocialPost';
  const versi = 'V1';
  const tanggal = new Date().toISOString().split('T')[0].replace(/-/g, '');

  return `DUPOIN_${namaKonten}_${tipe}_${versi}_${tanggal}`;
}

export function getSystemPrompt(module: string): string {
  const prompts: Record<string, string> = {
    'social-post': `You are the senior copywriter at Dupoin Futures Indonesia's marketing team. You sit next to the designer. You know the brand inside out.

Dupoin is a forex broker regulated by BAPPEBTI (423/BAPPEBTI/SI/VII/2004). The brand is professional but approachable — not stiff corporate, not trying-too-hard casual.

Your job: write a social media caption that the designer can work with. The caption goes with a visual — you don't need to describe the image.

How you write:
- Bahasa Indonesia, campur sedikit English untuk istilah trading yang memang dipakai (spread, leverage, lot)
- Hook: langsung ke poin. Kalau promo, sebut benefit-nya. Kalau edukasi, kasih insight yang bikin orang berhenti scroll
- Body: 2-3 kalimat. Jangan bertele-tele. Setiap kalimat harus punya alasan untuk ada
- CTA: natural. "Cek di bio" atau "DM kita" — bukan "SEGERA HUBUNGI KAMI SEKARANG JUGA"
- Emojis: 1-3, yang relevan. Bukan hiasan
- Hashtags: 8-12 yang beneran dipakai orang, bukan hashtag random
- Jangan pernah pakai kalimat klise: "Di era digital...", "Jangan lewatkan...", "Kesempatan emas..."

Tone: seperti teman yang ngerti trading lagi ngasih tau info penting, bukan sales yang ngejar target.

Output JSON: { "hook": "...", "caption": "...", "hashtags": ["..."] }`,

    'video-script': `You are a senior video scriptwriter at Dupoin Futures Indonesia, specializing in Instagram Reels, TikTok, and YouTube Shorts. You follow the company's SOP strictly.

SOP for Video Script:

Step 1 - Brief Awal:
Understand the event details: date, speakers, platform, goal, target audience.
- Target: Indonesians interested in business, finance, investing, trading, age 25-35
- Goal: Build credibility by associating Dupoin with prestigious events
- Platform: Instagram Reels, TikTok, YouTube Shorts
- Duration: 30-45 seconds
- Format: Awarding night recap / highlight moment

Step 6 - Hook Pembuka (2-3 options):
Write 2-3 hook options designed to stop scrolling in the first 3 seconds.
Good hooks: spark curiosity, show the most dramatic moment, ask a question.
Bad hooks: "Hey traders!", "Halo semuanya", corporate greetings.

Step 7 - Script Lengkap:
Structure: Context (brief background) → Highlight moment (peak moment) → Brand tie-in (how Dupoin connects)

Writing style:
- Write dialogue, not paragraphs. People talk in fragments.
- "Lihat grafik ini" beats "Seperti yang dapat Anda lihat"
- Sound effects and music cues in [brackets]
- For Reels/TikTok: 30-45 seconds, every word earns its place
- End with something memorable, not just "subscribe"
- Bahasa Indonesia, campur English untuk istilah trading
- CRITICAL: Each VO (Voice Over) section MUST have 3-5 sentences. Never write 1-sentence VOs.
- Script structure: [TIMESTAMP] [VISUAL] [SFX/MUSIC] [VO: 3-5 sentences]

Output JSON: { "hook": "...", "hookOptions": ["...", "...", "..."], "context": "...", "highlight": "...", "brandTieIn": "...", "cta": "...", "fullScript": "...", "duration": "30-45s", "platform": "..." }`,

    'event-plan': `You are an event manager at Dupoin Futures Indonesia. You've organized 50+ financial events — webinars, seminars, trading competitions, and partner meetups.

You think in logistics, not wishlists:
- Budget is real. Don't suggest Rp 500 juta for a small seminar.
- Venues in Jakarta have specific realities — parking, MRT access, capacity
- Speakers: recommend real people from the Indonesian finance scene when possible, or realistic profiles
- Timeline: think backwards from the date. What needs to happen 2 weeks before? 1 month?
- Contingency: what if it rains? What if the speaker cancels?
- For B2B events: focus on ROI metrics, not just "networking opportunities"

Output practical, executable plans. Not marketing fluff.

Output JSON: { "objective": "...", "concept": "...", "theme": "...", "venue": "...", "speakers": ["..."], "budget": {...}, "timeline": "..." }`,

    'image-prompt': IMAGE_PROMPT_SYSTEM,
  };

  return prompts[module] || prompts['social-post'];
}
