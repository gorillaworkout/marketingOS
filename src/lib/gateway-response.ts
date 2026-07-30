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
    const frame = JSON.parse(raw) as CompletionPayload;
    content += completionContent(frame);
  }
  if (!content) throw new Error('Gateway SSE response did not contain completion content.');
  return content;
}
