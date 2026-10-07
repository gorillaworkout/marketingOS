const MISSING_ENV = 'Create a token at /dashboard/settings/api-tokens and set MARKETINGOS_API_TOKEN and MARKETINGOS_API_URL.';
const BAD_ORIGIN = 'MARKETINGOS_API_URL must be https, or http://localhost, or http://127.0.0.1.';
const OVER_LIMIT = 'This chat is over the import limit.';
const MEMORY_OFF = 'Memory is off. Dupoin AI will not use these until you turn memory on in AI Research.';
const IMPORT_LIMIT = 200_000;

export function resolveOrigin(value) {
  if (!value || !String(value).trim()) return { ok: false, message: MISSING_ENV };
  let raw = String(value).trim();
  if (raw.endsWith('/')) raw = raw.slice(0, -1);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, message: BAD_ORIGIN };
  }
  const https = parsed.protocol === 'https:';
  const loopback = parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  if (!https && !loopback) return { ok: false, message: BAD_ORIGIN };
  return { ok: true, origin: parsed.origin };
}

export function clipQuery(value) {
  return String(value || '').trim().slice(0, 200);
}

export function preparePushText(text, token) {
  const source = String(text || '');
  if (!token) return source;
  return source.split('\n').filter(line => line.trim() !== token).join('\n');
}

export function classifyPushFile(text) {
  const first = String(text).trimStart()[0];
  if (first === '{' || first === '[') {
    try {
      JSON.parse(text);
      return 'codex';
    } catch {
      return 'text';
    }
  }
  return 'text';
}

export function formatThread(turns) {
  return (turns || []).map(turn => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.content}`).join('\n\n');
}

function redact(message, token) {
  if (!token || !message || !message.includes(token)) return message || '';
  return message.split(token).join('[redacted]');
}

function formatPull(body) {
  const lines = [];
  for (const fact of body.facts || []) lines.push(`${fact.kind}: ${fact.content}`);
  for (const row of body.qa || []) lines.push(`${row.question}\n${row.answerSummary}`);
  if (body.memoryEnabled === false) lines.push(MEMORY_OFF);
  return lines.join('\n');
}

function formatPush(status, body) {
  if (status === 409) return 'This chat is already imported. Open it from Memory.';
  if (typeof body.error === 'string') return body.error;
  if (body.autoApproved === true) {
    return `Facts saved: ${body.factsSaved}. Facts already saved: ${body.factsAlreadySaved}. Q&A saved: ${body.qaSaved}. Q&A already saved: ${body.qaAlreadySaved}.`;
  }
  const imported = body.import || {};
  if (imported.status === 'extract_failed') return 'Open Memory and choose Retry extract.';
  if (imported.status === 'review') return `Open AI Research → Memory, find ${imported.title}, and choose Review facts.`;
  return 'The chat was saved. Open AI Research → Memory to review it.';
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return { error: 'Sync failed.' };
  }
}

export async function runPull({ url, token, query, fetchImpl }) {
  if (!url || !token) return { ok: false, message: MISSING_ENV };
  const origin = resolveOrigin(url);
  if (!origin.ok) return { ok: false, message: origin.message };
  const q = clipQuery(query || '');
  const target = q
    ? `${origin.origin}/api/sync/memory?q=${encodeURIComponent(q)}`
    : `${origin.origin}/api/sync/memory`;
  const response = await fetchImpl(target, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await readJson(response);
  return { ok: response.ok, message: redact(formatPull(body), token) };
}

export async function runPush({ url, token, text, file = false, approve = false, fetchImpl }) {
  if (!url || !token) return { ok: false, called: false, message: MISSING_ENV };
  const origin = resolveOrigin(url);
  if (!origin.ok) return { ok: false, called: false, message: origin.message };
  const prepared = preparePushText(text, token);
  if (prepared.length > IMPORT_LIMIT) return { ok: false, called: false, message: OVER_LIMIT };
  const source = file ? classifyPushFile(prepared) : 'text';
  const response = await fetchImpl(`${origin.origin}/api/sync/import`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source,
      text: prepared,
      autoApprove: approve === true,
    }),
  });
  const body = await readJson(response);
  return { ok: response.ok, called: true, message: redact(formatPush(response.status, body), token) };
}
