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

/** Parses either a standard OpenAI JSON response or OpenAI-compatible SSE frames. */
export function parseGatewayCompletion(body: string, contentType: string | null): string {
  if (!contentType?.toLowerCase().includes('text/event-stream')) {
    const content = completionContent(JSON.parse(body) as CompletionPayload);
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
  if (!content) throw new Error('Gateway SSE response did not contain completion content.');
  return content;
}
