const API_BASE = process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1';
const API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';

const PRIMARY_MODEL = process.env.AI_MODEL || 'deepseek/deepseek-v4-flash';
const FALLBACK_MODEL = 'deepseek/deepseek-v4-pro';

export type ModelProvider = 'openrouter' | 'codex';

export interface ModelInfo {
  id: string;
  name: string;
  tier: 'budget' | 'balanced' | 'premium';
  provider: ModelProvider;
  input: number;
  output: number;
}

// All available models with metadata
export const AVAILABLE_MODELS: ModelInfo[] = [
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', tier: 'budget', provider: 'openrouter', input: 0.000077, output: 0.000154 },
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', tier: 'balanced', provider: 'openrouter', input: 0.000435, output: 0.00087 },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', tier: 'balanced', provider: 'openrouter', input: 0.00015, output: 0.0006 },
  { id: 'openai/gpt-5.4-pro', name: 'GPT-5.4 Pro', tier: 'premium', provider: 'openrouter', input: 0.03, output: 0.18 },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol (Codex)', tier: 'premium', provider: 'codex', input: 0, output: 0 },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra (Codex)', tier: 'balanced', provider: 'codex', input: 0, output: 0 },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna (Codex)', tier: 'budget', provider: 'codex', input: 0, output: 0 },
];

export function getModelProvider(modelId: string): ModelProvider {
  const model = AVAILABLE_MODELS.find(m => m.id === modelId);
  return model?.provider || 'openrouter';
}

export function getModelTier(modelId: string): 'budget' | 'balanced' | 'premium' {
  const model = AVAILABLE_MODELS.find(m => m.id === modelId);
  return model?.tier || 'budget';
}

export async function getUserPreferredModel(userId: string, taskType?: string): Promise<string> {
  try {
    const { getDb } = await import('@/lib/database');
    const db = await getDb();

    // Check per-task preference first
    if (taskType) {
      const taskStmt = db.prepare('SELECT model FROM task_model_preferences WHERE user_id = ? AND task_type = ?');
      taskStmt.bind([userId, taskType]);
      if (taskStmt.step()) {
        const obj = taskStmt.getAsObject();
        taskStmt.free();
        return obj.model as string;
      }
      taskStmt.free();
    }

    // Fall back to global preference
    const stmt = db.prepare('SELECT preferred_model FROM user_preferences WHERE user_id = ?');
    stmt.bind([userId]);
    let pref: string | null = null;
    if (stmt.step()) {
      const obj = stmt.getAsObject();
      pref = obj.preferred_model as string;
    }
    stmt.free();
    return pref || PRIMARY_MODEL;
  } catch {
    return PRIMARY_MODEL;
  }
}

// Dynamic pricing based on model
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'deepseek/deepseek-v4-flash': { input: 0.000000077, output: 0.000000154 },
  'deepseek/deepseek-v4-pro': { input: 0.000000435, output: 0.00000087 },
  'openai/gpt-4o-mini': { input: 0.00000015, output: 0.0000006 },
  'openai/gpt-5.4-pro': { input: 0.00003, output: 0.00018 },
  // Codex models — included in ChatGPT Plus, no per-token cost
  'gpt-5.6-sol': { input: 0, output: 0 },
  'gpt-5.6-terra': { input: 0, output: 0 },
  'gpt-5.6-luna': { input: 0, output: 0 },
};

function getPricing(model: string) {
  return MODEL_PRICING[model] || { input: 0.000000077, output: 0.000000154 };
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

interface GenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  userId: string;
  taskId?: string;
  brandGuidelines?: BrandGuidelines;
  responseFormat?: { type: 'json_object' };
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Call Codex CLI for Codex-provided models.
 * Runs `env -u OPENAI_API_KEY codex exec "<prompt>" -m <model> --sandbox danger-full-access`
 * and strips CLI banner/metadata from the output.
 */
async function callCodex(prompt: string, model: string): Promise<string> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  // Escape prompt for shell - write to temp file to avoid shell escaping issues
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const tmpFile = path.join(os.tmpdir(), `codex-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, prompt);

  try {
    const { stdout } = await execAsync(
      `env -u OPENAI_API_KEY codex exec "$(cat '${tmpFile}')" -m ${model} --sandbox danger-full-access < /dev/null`,
      {
        cwd: process.cwd() || '/Users/bayudarmawan/marketingos',
        timeout: 180_000,
        maxBuffer: 1024 * 1024 * 10,
        shell: '/bin/bash',
      }
    );

  // Strip Codex CLI banner/metadata lines
  const lines = stdout.split('\n');
  const filtered = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    // Skip known banner/metadata lines
    if (/^OpenAI Codex\s/i.test(trimmed)) return false;
    if (/^[-]{3,}$/.test(trimmed)) return false;
    if (/^workdir:\s/i.test(trimmed)) return false;
    if (/^model:\s/i.test(trimmed)) return false;
    if (/^tokens used/i.test(trimmed)) return false;
    if (/^Reading additional input/i.test(trimmed)) return false;
    if (/^sandbox/i.test(trimmed)) return false;
    if (/^provider:\s/i.test(trimmed)) return false;
    if (/^session/i.test(trimmed)) return false;
    if (/^approval/i.test(trimmed)) return false;
    if (/^reasoning/i.test(trimmed)) return false;
    if (/^user$/i.test(trimmed)) return false;
    if (/^codex$/i.test(trimmed)) return false;
    if (/^\d{1,3}(,\d{3})*$/.test(trimmed)) return false; // token count like "2,026"
    return true;
  });

  // Deduplicate: if the same content appears twice, take only the first
  const seen = new Set<string>();
  const deduped = filtered.filter(line => {
    const trimmed = line.trim();
    if (seen.has(trimmed)) return false;
    seen.add(trimmed);
    return true;
  });

  const result = deduped.join('\n').trim();

  // Try to extract JSON from the output (Codex may include non-JSON text)
  const jsonMatch = result.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : result;
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

/**
 * Core API call with structured output support, retry on JSON parse failure,
 * and model fallback (primary -> fallback model).
 */
async function callApi(
  messages: Array<{ role: string; content: string }>,
  options: {
    model?: string;
    responseFormat?: { type: 'json_object' } | undefined;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<{ content: string; model: string }> {
  const model = options.model || PRIMARY_MODEL;

  // Route to Codex CLI if the model's provider is 'codex'
  const provider = getModelProvider(model);
  if (provider === 'codex') {
    // Combine messages into a single prompt for Codex exec
    const prompt = messages.map(m => {
      const role = m.role.charAt(0).toUpperCase() + m.role.slice(1);
      return `[${role}]: ${m.content}`;
    }).join('\n\n');
    const content = await callCodex(prompt, model);
    return { content, model };
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4000,
  };
  if (options.responseFormat) {
    body.response_format = options.responseFormat;
  }

  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      'HTTP-Referer': 'https://marketingos.local',
      'X-Title': 'MarketingOS',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  return { content, model };
}

/**
 * Call API with retry on JSON parse failure and model fallback.
 */
async function callApiWithFallback(
  messages: Array<{ role: string; content: string }>,
  options: {
    model?: string;
    responseFormat?: { type: 'json_object' };
    temperature?: number;
    maxTokens?: number;
    parseJson?: boolean;
  } = {}
): Promise<{ content: string; parsed?: unknown; model: string; retried: boolean }> {
  const parseJson = options.parseJson ?? true;
  let retried = false;

  // Try primary model
  try {
    const result = await callApi(messages, options);
    if (parseJson && options.responseFormat?.type === 'json_object') {
      try {
        const parsed = JSON.parse(result.content);
        return { ...result, parsed, retried };
      } catch {
        // Retry once with explicit JSON reminder
        retried = true;
        const retryMessages = [
          ...messages,
          { role: 'assistant', content: result.content },
          { role: 'user', content: 'Your response was not valid JSON. Please output ONLY valid JSON with no markdown formatting or code fences.' },
        ];
        const retryResult = await callApi(retryMessages, options);
        try {
          const parsed = JSON.parse(retryResult.content);
          return { ...retryResult, parsed, retried };
        } catch {
          // Fall through to fallback model
        }
      }
    }
    return { ...result, retried };
  } catch (primaryError) {
    // No silent fallback — if the selected model fails, report the error
    throw primaryError;
  }
}

/**
 * Generate content with brand guidelines, structured output, retry, and fallback.
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
  const result = await callApiWithFallback(messages, {
    model,
    responseFormat: options?.responseFormat,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    parseJson: !!options?.responseFormat,
  });

  const pricing = getPricing(result.model);
  // Estimate tokens from content length (rough: 1 token ≈ 4 chars)
  const inputTokens = Math.ceil((enhancedSystemPrompt.length + userPrompt.length) / 4);
  const outputTokens = Math.ceil(result.content.length / 4);
  const cost = (inputTokens / 1_000_000) * pricing.input +
               (outputTokens / 1_000_000) * pricing.output;

  const usage: TokenUsage = { inputTokens, outputTokens, model: result.model, cost };

  // Log to database
  try {
    const { getDb, saveDbToDisk } = await import('@/lib/database');
    const db = await getDb();
    const { v4: uuidv4 } = await import('uuid');
    db.prepare(
      'INSERT INTO token_logs (id, user_id, task_id, model, input_tokens, output_tokens, cost) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), userId, taskId || null, result.model, inputTokens, outputTokens, cost);
    saveDbToDisk();
  } catch (e) {
    console.error('Failed to log token usage:', e);
  }

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
  let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, model: PRIMARY_MODEL, cost: 0 };

  const bgPrompt = brandGuidelines ? buildBrandGuidelinesPrompt(brandGuidelines) : '';
  const contextSection = contextMemory ? '\n\n' + contextMemory : '';

  // Step 1: Draft
  onProgress?.({ step: 'draft', progress: 5, message: '📝 Writing draft caption...' });
  const draftSystem = getSmartSystemPrompt(module, undefined, brandGuidelines) + contextSection;
  const draftResult = await callApiWithFallback(
    [
      { role: 'system', content: draftSystem },
      { role: 'user', content: userPrompt },
    ],
    { model, responseFormat: { type: 'json_object' }, temperature: 0.8 }
  );
  drafts.push({ step: 'draft', content: draftResult.content, model: draftResult.model });
  onProgress?.({ step: 'draft', progress: 33, message: '✅ Draft complete' });
  const draftPricing = getPricing(draftResult.model);
  totalUsage.inputTokens += Math.ceil((draftSystem.length + userPrompt.length) / 4);
  totalUsage.outputTokens += Math.ceil(draftResult.content.length / 4);
  totalUsage.cost += (totalUsage.inputTokens / 1_000_000) * draftPricing.input +
                     (totalUsage.outputTokens / 1_000_000) * draftPricing.output;

  // Step 2: Self-review against brand guidelines
  onProgress?.({ step: 'review', progress: 37, message: '🔍 Reviewing against brand guidelines...' });
  const reviewSystem = `You are a strict brand compliance reviewer. Review the following content against the brand guidelines and identify issues.`;
  const reviewPrompt = `Review this content draft against the brand guidelines:

DRAFT:
${draftResult.content}

${bgPrompt || 'No specific brand guidelines provided. Review for general marketing best practices.'}

Output JSON: { "score": <1-10>, "issues": ["..."], "suggestions": ["..."], "passes_brand_check": <true|false> }`;

  const reviewResult = await callApiWithFallback(
    [
      { role: 'system', content: reviewSystem },
      { role: 'user', content: reviewPrompt },
    ],
    { model, responseFormat: { type: 'json_object' }, temperature: 0.3 }
  );
  drafts.push({ step: 'review', content: reviewResult.content, model: reviewResult.model });
  onProgress?.({ step: 'review', progress: 66, message: '✅ Review complete' });
  const reviewPricing = getPricing(reviewResult.model);
  totalUsage.inputTokens += Math.ceil((reviewSystem.length + reviewPrompt.length) / 4);
  totalUsage.outputTokens += Math.ceil(reviewResult.content.length / 4);
  totalUsage.cost += (totalUsage.inputTokens / 1_000_000) * reviewPricing.input +
                     (totalUsage.outputTokens / 1_000_000) * reviewPricing.output;

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

  const refineResult = await callApiWithFallback(
    [
      { role: 'system', content: refineSystem },
      { role: 'user', content: refinePrompt },
    ],
    { model, responseFormat: { type: 'json_object' }, temperature: 0.6 }
  );
  drafts.push({ step: 'refined', content: refineResult.content, model: refineResult.model });
  const refinePricing = getPricing(refineResult.model);
  totalUsage.inputTokens += Math.ceil((refineSystem.length + refinePrompt.length) / 4);
  totalUsage.outputTokens += Math.ceil(refineResult.content.length / 4);
  totalUsage.cost += (totalUsage.inputTokens / 1_000_000) * refinePricing.input +
                     (totalUsage.outputTokens / 1_000_000) * refinePricing.output;

  // Log total usage
  try {
    const { getDb, saveDbToDisk } = await import('@/lib/database');
    const db = await getDb();
    const { v4: uuidv4 } = await import('uuid');
    db.prepare(
      'INSERT INTO token_logs (id, user_id, task_id, model, input_tokens, output_tokens, cost) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), userId, taskId, totalUsage.model, totalUsage.inputTokens, totalUsage.outputTokens, totalUsage.cost);
    saveDbToDisk();
  } catch (e) {
    console.error('Failed to log token usage:', e);
  }

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
    const { getDb } = await import('@/lib/database');
    const db = await getDb();

    const rows = db.prepare(`
      SELECT output_data, brief, created_at FROM tasks
      WHERE user_id = ? AND type = ? AND status = 'completed' AND output_data IS NOT NULL
      ORDER BY created_at DESC LIMIT ?
    `).all(userId, taskType, limit) as { output_data: string; brief: string; created_at: string }[];

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
export async function fetchStyleContext(
  userId: string,
  taskType?: string
): Promise<string> {
  try {
    const { getDb } = await import('@/lib/database');
    const db = await getDb();

    const parts: string[] = [];

    // 1. User style preferences
    const userStmt = db.prepare(
      'SELECT preferred_cluster, style_summary, tone_preferences, hook_preferences, platform_preferences, total_selections FROM user_style_preferences WHERE user_id = ?'
    );
    userStmt.bind([userId]);
    if (userStmt.step()) {
      const row = userStmt.getAsObject();
      userStmt.free();

      const sections: string[] = [];
      if (row.preferred_cluster) {
        sections.push(`Preferred style: ${row.preferred_cluster}`);
      }
      if (row.total_selections && (row.total_selections as number) > 0) {
        sections.push(`Based on ${row.total_selections} past selections`);
      }
      if (row.tone_preferences) {
        try {
          const tones = JSON.parse(row.tone_preferences as string);
          if (Array.isArray(tones) && tones.length) {
            sections.push(`Tone patterns: ${tones.slice(0, 5).join(', ')}`);
          } else if (typeof tones === 'string') {
            sections.push(`Tone: ${tones}`);
          }
        } catch {
          sections.push(`Tone: ${row.tone_preferences}`);
        }
      }
      if (row.hook_preferences) {
        try {
          const hooks = JSON.parse(row.hook_preferences as string);
          if (Array.isArray(hooks) && hooks.length) {
            sections.push(`Hook style examples: ${hooks.slice(0, 3).join(' | ')}`);
          } else if (typeof hooks === 'string') {
            sections.push(`Hook style: ${hooks}`);
          }
        } catch {
          sections.push(`Hook style: ${row.hook_preferences}`);
        }
      }
      if (row.platform_preferences) {
        try {
          const platforms = JSON.parse(row.platform_preferences as string);
          if (typeof platforms === 'object' && platforms !== null) {
            const entries = Object.entries(platforms).slice(0, 3).map(([k, v]) => `${k}: ${v}`);
            if (entries.length) sections.push(`Platform notes: ${entries.join('; ')}`);
          }
        } catch {}
      }

      // Include recent selections as concrete examples
      if (row.style_summary) {
        try {
          const recent = JSON.parse(row.style_summary as string);
          if (Array.isArray(recent) && recent.length) {
            const examples = recent.slice(0, 3).map((s: Record<string, unknown>) => {
              const brief = typeof s.brief === 'string' ? s.brief.substring(0, 60) : '';
              const cluster = s.style_cluster || s.cluster || '';
              return cluster ? `"${brief}" (${cluster})` : `"${brief}"`;
            });
            if (examples.length) sections.push(`Recent picks: ${examples.join(', ')}`);
          }
        } catch {}
      }

      if (sections.length) {
        parts.push(`🎯 YOUR STYLE PROFILE:\n${sections.join('\n')}\nUse these patterns to match the user's demonstrated preferences.`);
      }
    } else {
      userStmt.free();
    }

    // 2. Global team style profile (singleton per task_type or general)
    const globalStmt = db.prepare(
      taskType
        ? 'SELECT team_summary, top_examples, cluster_distribution FROM global_style_profile WHERE task_type = ?'
        : 'SELECT task_type, team_summary, top_examples, cluster_distribution FROM global_style_profile ORDER BY updated_at DESC LIMIT 1'
    );
    if (taskType) {
      globalStmt.bind([taskType]);
    }
    if (globalStmt.step()) {
      const row = globalStmt.getAsObject();
      globalStmt.free();

      const globalSections: string[] = [];
      if (row.team_summary) {
        globalSections.push(`Team style summary: ${row.team_summary}`);
      }
      if (row.cluster_distribution) {
        try {
          const dist = JSON.parse(row.cluster_distribution as string);
          if (typeof dist === 'object' && dist !== null) {
            const distEntries = Object.entries(dist).map(([k, v]) => `${k}: ${v}`).join(', ');
            globalSections.push(`Style distribution: ${distEntries}`);
          }
        } catch {}
      }
      if (row.top_examples) {
        try {
          const examples = JSON.parse(row.top_examples as string);
          if (Array.isArray(examples) && examples.length) {
            globalSections.push(`Top team examples: ${examples.slice(0, 2).join(' | ')}`);
          }
        } catch {}
      }

      if (globalSections.length) {
        parts.push(`📊 TEAM STYLE CONTEXT:\n${globalSections.join('\n')}`);
      }
    } else {
      globalStmt.free();
    }

    return parts.length ? '\n\n' + parts.join('\n\n') : '';
  } catch (e) {
    console.error('Failed to fetch style context:', e);
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

export function getSystemPrompt(module: string): string {
  const prompts: Record<string, string> = {
    'social-post': `You are a professional social media content creator for Dupoin Futures Indonesia.
Follow this SOP:
1. Read the brief carefully (purpose, target audience, platform, deadline)
2. Write a hook that stops the scroll in 3 seconds
3. Main body: convey the key message clearly
4. CTA: clear call to action
5. Brand guidelines: use professional tone, appropriate for finance industry
6. Output format: caption (with emojis where appropriate) + hashtags

Output JSON: { "hook": "...", "caption": "...", "hashtags": ["..."] }`,

    'video-script': `You are a professional video script writer for Dupoin Futures Indonesia.
Follow this SOP:
1. Hook (first 3 seconds): stop the scroll
2. Context: background information
3. Highlight moment: the most interesting part
4. Brand tie-in: how Dupoin connects to this moment
5. CTA: clear call to action
Duration: 30-45 seconds for Reels/TikTok, longer for YouTube

Output JSON: { "hook": "...", "context": "...", "highlight": "...", "brandTieIn": "...", "cta": "...", "fullScript": "..." }`,

    'event-plan': `You are a professional event planner for Dupoin Futures Indonesia.
Follow this SOP:
1. Research similar events
2. Define event objectives
3. Propose concept and theme
4. Recommend venue (based on budget and location)
5. Recommend speakers (based on theme and budget)
6. Create budget estimation
7. Create timeline

Output JSON: { "objective": "...", "concept": "...", "theme": "...", "venue": "...", "speakers": ["..."], "budget": {...}, "timeline": "..." }`,

    'image-prompt': `You create detailed prompts for FLUX AI image generation.
The images should be professional, modern, and suitable for a finance/forex company.
Style: clean, corporate, blue/gold color scheme, professional.
Dimensions: 1080x1350 (Instagram portrait) or 1080x1080 (square).

Output just the prompt text, no additional explanation.`,
  };

  return prompts[module] || prompts['social-post'];
}
