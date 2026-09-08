interface CompletionPayload {
  choices?: Array<{
    message?: { content?: string };
    delta?: { content?: string };
    text?: string;
  }>;
}

function completionContent(payload: CompletionPayload): string {
  const choice = payload.choices?.[0];
  return choice?.message?.content || choice?.delta?.content || choice?.text || '';
}

function splitConcatenatedJson(input: string): string[] {
  const values: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (start < 0) {
      if (/\s/.test(character)) continue;
      if (input.startsWith('data:', index)) {
        index += 'data:'.length - 1;
        continue;
      }
      if (input.startsWith('[DONE]', index)) {
        index += '[DONE]'.length - 1;
        continue;
      }
      if (input.startsWith('event:', index)) {
        const eventEnd = input.indexOf('\n', index);
        if (eventEnd < 0) break;
        index = eventEnd;
        continue;
      }
      if (character !== '{' && character !== '[') {
        throw new Error('Gateway SSE response contained an invalid frame.');
      }
      start = index;
      depth = 1;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{' || character === '[') depth++;
    else if (character === '}' || character === ']') {
      depth--;
      if (depth === 0) {
        values.push(input.slice(start, index + 1));
        start = -1;
      }
    }
  }
  if (start >= 0) throw new Error('Gateway SSE response contained an incomplete JSON frame.');
  return values;
}

/**
 * Some gateway models leak an empty or populated `<think>...</think>` block
 * ahead of the actual JSON payload. Strip exactly one leading reasoning
 * block (only when it appears at the very start of the trimmed content) so
 * callers doing `JSON.parse` never see it. Content whose reasoning tag is
 * never closed is treated as no usable content at all — better to fail loud
 * than silently hand back a truncated/garbage string.
 */
function stripLeadingReasoningTag(content: string): string {
  const trimmed = content.replace(/^\s+/, '');
  if (!trimmed.startsWith('<think>')) return content;
  const closeIndex = trimmed.indexOf('</think>');
  if (closeIndex < 0) return '';
  return trimmed.slice(closeIndex + '</think>'.length);
}

/** Parses either a standard OpenAI JSON response or OpenAI-compatible SSE frames. */
export function parseGatewayCompletion(body: string, contentType: string | null): string {
  if (!contentType?.toLowerCase().includes('text/event-stream')) {
    const content = stripLeadingReasoningTag(completionContent(JSON.parse(body) as CompletionPayload));
    if (!content) throw new Error('Gateway response did not contain completion content.');
    return content;
  }

  let content = '';
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:')) continue;
    const raw = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (!raw || raw === '[DONE]') continue;
    for (const value of splitConcatenatedJson(raw)) {
      const frame = JSON.parse(value) as CompletionPayload;
      content += completionContent(frame);
    }
  }
  content = stripLeadingReasoningTag(content);
  if (!content) throw new Error('Gateway SSE response did not contain completion content.');
  return content;
}
