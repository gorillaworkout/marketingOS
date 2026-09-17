import { isGenerationFeature } from '@/lib/authorization';
import { GUIDANCE_FEATURE_LABELS } from '@/lib/model-guidance';
import type { GatewayMessage } from '@/lib/ai-research';

export interface GatewayTokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Same rough estimate `generateContent` uses: ~1 token per 4 characters. */
export function estimateTokensFromChars(text: string): number {
  return Math.ceil(text.length / 4);
}

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
  }
  return null;
}

/** Reads OpenAI-compatible `usage` from a completion JSON payload or SSE chunk. */
export function parseGatewayUsage(payload: unknown): GatewayTokenUsage | null {
  if (!payload || typeof payload !== 'object') return null;
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') return null;
  const record = usage as Record<string, unknown>;
  const inputTokens = asNonNegativeInt(record.prompt_tokens) ?? asNonNegativeInt(record.input_tokens);
  const outputTokens = asNonNegativeInt(record.completion_tokens) ?? asNonNegativeInt(record.output_tokens);
  if (inputTokens == null && outputTokens == null) return null;
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
  };
}

export function resolveTokenUsage(options: {
  reported: GatewayTokenUsage | null;
  inputText: string;
  outputText: string;
}): GatewayTokenUsage {
  const reportedTotal = options.reported
    ? options.reported.inputTokens + options.reported.outputTokens
    : 0;
  if (options.reported && reportedTotal > 0) return options.reported;
  return {
    inputTokens: estimateTokensFromChars(options.inputText),
    outputTokens: estimateTokensFromChars(options.outputText),
  };
}

function contentText(content: GatewayMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(part => (part.type === 'text' && part.text ? part.text : ''))
    .join('');
}

/** Character length of gateway messages, ignoring image payloads that would inflate estimates. */
export function gatewayMessagesText(messages: GatewayMessage[]): string {
  return messages.map(message => contentText(message.content)).join('');
}

export function readCompletionStreamPayload(payload: unknown): {
  contentDelta: string;
  usage: GatewayTokenUsage | null;
} {
  const delta = (payload as { choices?: Array<{ delta?: { content?: unknown } }> } | null)
    ?.choices?.[0]?.delta?.content;
  return {
    contentDelta: typeof delta === 'string' ? delta : '',
    usage: parseGatewayUsage(payload),
  };
}

/** Parses OpenAI-compatible SSE `data:` lines, including a trailing usage chunk. */
export function consumeChatCompletionSseLines(lines: string[]): {
  content: string;
  usage: GatewayTokenUsage | null;
  reachedDone: boolean;
} {
  let content = '';
  let usage: GatewayTokenUsage | null = null;
  let reachedDone = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data) continue;
    if (data === '[DONE]') {
      reachedDone = true;
      break;
    }
    try {
      const parsedChunk = JSON.parse(data) as unknown;
      const { contentDelta, usage: chunkUsage } = readCompletionStreamPayload(parsedChunk);
      content += contentDelta;
      if (chunkUsage) usage = chunkUsage;
    } catch {
      // Skip unparseable chunks
    }
  }
  return { content, usage, reachedDone };
}

export function taskTypeLabel(taskType: string | null | undefined): string {
  const value = (taskType || '').trim();
  if (!value) return 'Legacy';
  if (isGenerationFeature(value)) return GUIDANCE_FEATURE_LABELS[value];
  return value;
}
