import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { createMemoryImportDeps } from './chat-import-deps';
import {
  createApiToken,
  hashApiToken,
  listApiTokens,
  renameApiToken,
  revokeApiToken,
  type ApiTokenDeps,
  type ApiTokenRow,
} from '../src/lib/api-tokens';
import {
  handleSettingsTokens,
  handleSyncImport,
  handleSyncMemory,
  ilikeContainsPattern,
  importSyncedChat,
  readSyncedMemory,
  SYNC_QA_SEARCH_SQL,
  SYNC_QA_SQL,
  type SyncHandlerDeps,
} from '../src/lib/memory-sync';

const FORBIDDEN = 'Forbidden: your department does not allow AI Research';

function tokenHarness() {
  const rows: ApiTokenRow[] = [];
  const deps: ApiTokenDeps = {
    createId: () => `tok-${rows.length + 1}`,
    now: () => new Date('2026-10-06T00:00:00.000Z'),
    randomBytes: () => randomBytes(32),
    list: async userId => rows.filter(row => row.userId === userId).slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    insertIfUnderCap: async row => {
      const active = rows.filter(item => item.userId === row.userId && item.revokedAt == null).length;
      if (active >= 5) return 'limit';
      rows.push(row);
      return 'inserted';
    },
    findOwned: async (userId, id) => rows.find(row => row.userId === userId && row.id === id) || null,
    rename: async (userId, id, name) => {
      const row = rows.find(item => item.userId === userId && item.id === id && item.revokedAt == null);
      if (!row) return false;
      row.name = name;
      return true;
    },
    revoke: async (userId, id, at) => {
      const row = rows.find(item => item.userId === userId && item.id === id && item.revokedAt == null);
      if (!row) return false;
      row.revokedAt = at;
      return true;
    },
    findActiveByHash: async hash => {
      const row = rows.find(item => item.tokenHash === hash && item.revokedAt == null);
      return row ? { id: row.id, userId: row.userId } : null;
    },
    touch: async (id, userId) => {
      const row = rows.find(item => item.id === id && item.userId === userId && item.revokedAt == null);
      if (row) row.lastUsedAt = '2026-10-06T01:00:00.000Z';
    },
  };
  return { deps, rows };
}

function bearer(token: string) {
  return `Bearer ${token}`;
}

function syncRequest(path: string, init: { token?: string; ip?: string; proto?: string; host?: string; method?: string; body?: string; contentType?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = {
    host: init.host || 'localhost',
    'x-forwarded-for': init.ip || '203.0.113.50',
  };
  if (init.proto) headers['x-forwarded-proto'] = init.proto;
  if (init.token) headers.authorization = init.token.startsWith('Bearer ') ? init.token : bearer(init.token);
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body) headers['content-type'] = init.contentType || 'application/json';
  return new NextRequest(`http://${headers.host}${path}`, {
    method: init.method || (init.body ? 'POST' : 'GET'),
    headers,
    body: init.body,
  });
}

function authDeps(overrides: Partial<SyncHandlerDeps> = {}): SyncHandlerDeps {
  return {
    lookup: async () => ({ id: 'tok-1', userId: 'user-a' }),
    loadPrincipal: async () => ({ role: 'member', features: ['ai-research'] }),
    touch: async () => {},
    readMemory: async () => ({ memoryEnabled: true, facts: [], qa: [] }),
    importChat: async () => ({ status: 200, body: { import: { id: 'import-1', status: 'review' }, autoApproved: false } }),
    authorize: async () => ({ id: 'user-from-session', role: 'admin', departmentId: null, departmentName: null, features: ['ai-research'] }),
    listTokens: async () => [],
    createToken: async () => ({ ok: true, status: 201, body: { token: 'mos_secret', apiToken: { id: 'tok-1' } } }),
    renameToken: async () => ({ ok: true, status: 200, body: { apiToken: { id: 'tok-1' } } }),
    revokeToken: async () => ({ ok: true, status: 200, body: { revoked: true, alreadyRevoked: false } }),
    ...overrides,
  };
}

test('a created token starts with mos_, is 47 characters, and only its hash is stored', async () => {
  const harness = tokenHarness();
  const created = await createApiToken('user-a', ' Laptop Codex ', harness.deps);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.status, 201);
  assert.equal(created.body.token.startsWith('mos_'), true);
  assert.equal(created.body.token.length, 47);
  assert.equal(created.body.apiToken.name, 'Laptop Codex');
  assert.equal(created.body.apiToken.tokenPrefix, created.body.token.slice(0, 12));
  assert.equal(created.body.apiToken.tokenPrefix.startsWith('mos_'), true);
  const stored = harness.rows[0];
  assert.equal(stored.tokenHash, createHash('sha256').update(created.body.token, 'utf8').digest('hex'));
  assert.equal(stored.tokenHash, hashApiToken(created.body.token));
  assert.equal(stored.tokenPrefix, created.body.token.slice(0, 12));
  assert.equal('token' in stored, false);
  assert.equal(JSON.stringify(stored).includes(created.body.token), false);
  const listed = await listApiTokens('user-a', harness.deps);
  assert.equal(JSON.stringify(listed).includes(created.body.token), false);
  assert.equal(JSON.stringify(listed).includes(stored.tokenHash), false);
  assert.equal(listed[0].tokenPrefix, stored.tokenPrefix);
});

test('bad names and a sixth active token write nothing', async () => {
  const harness = tokenHarness();
  for (const name of ['', '   ', 'a'.repeat(41), 'bad\nname', 'tab\tbed', 'del\u007Fname']) {
    const result = await createApiToken('user-a', name, harness.deps);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 400);
    assert.equal(harness.rows.length, 0);
  }
  assert.equal((await createApiToken('user-a', '', harness.deps)).ok, false);
  const empty = await createApiToken('user-a', '   ', harness.deps);
  if (!empty.ok) assert.equal(empty.body.error, 'Name the token.');
  const long = await createApiToken('user-a', 'a'.repeat(41), harness.deps);
  if (!long.ok) assert.equal(long.body.error, 'Use 40 characters or fewer.');
  const plain = await createApiToken('user-a', 'bad\nname', harness.deps);
  if (!plain.ok) assert.equal(plain.body.error, 'Use a plain name.');
  const ok = await createApiToken('user-a', 'a'.repeat(40), harness.deps);
  assert.equal(ok.ok, true);
  for (let index = 0; index < 4; index += 1) {
    assert.equal((await createApiToken('user-a', `Token ${index}`, harness.deps)).ok, true);
  }
  const sixth = await createApiToken('user-a', 'Sixth', harness.deps);
  assert.equal(sixth.ok, false);
  if (!sixth.ok) assert.equal(sixth.body.error, 'You can have 5 active tokens. Revoke one to create another.');
  assert.equal(sixth.status, 409);
  assert.equal(harness.rows.length, 5);
  const revoked = await revokeApiToken('user-a', harness.rows[0].id, harness.deps);
  assert.equal(revoked.ok, true);
  if (!revoked.ok) return;
  assert.equal(revoked.body.alreadyRevoked, false);
  assert.ok(harness.rows[0].revokedAt);
  const replacement = await createApiToken('user-a', 'Replacement', harness.deps);
  assert.equal(replacement.ok, true);
  assert.equal(harness.rows.filter(row => row.revokedAt == null).length, 5);
});

test('revoke is idempotent and rename or revoke of another user is 404', async () => {
  const harness = tokenHarness();
  const created = await createApiToken('user-a', 'Laptop', harness.deps);
  if (!created.ok) return;
  const id = created.body.apiToken.id;
  await revokeApiToken('user-a', id, harness.deps);
  const stamped = harness.rows[0].revokedAt;
  const again = await revokeApiToken('user-a', id, harness.deps);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.deepEqual(again.body, { revoked: true, alreadyRevoked: true });
  assert.equal(harness.rows[0].revokedAt, stamped);
  assert.ok(stamped);
  const renamed = await renameApiToken('user-b', id, 'Other', harness.deps);
  assert.equal(renamed.ok, false);
  if (!renamed.ok) {
    assert.equal(renamed.status, 404);
    assert.equal(renamed.body.error, 'Token was not found.');
  }
  const revokedOther = await revokeApiToken('user-b', id, harness.deps);
  assert.equal(revokedOther.ok, false);
  if (!revokedOther.ok) assert.equal(revokedOther.status, 404);
  const missing = await renameApiToken('user-a', 'missing', 'Name', harness.deps);
  assert.equal(missing.ok, false);
  const active = await createApiToken('user-a', 'Office', harness.deps);
  if (!active.ok) return;
  const renamedOk = await renameApiToken('user-a', active.body.apiToken.id, ' Office laptop ', harness.deps);
  assert.equal(renamedOk.ok, true);
  if (!renamedOk.ok) return;
  assert.equal(renamedOk.body.apiToken.name, 'Office laptop');
  await revokeApiToken('user-a', active.body.apiToken.id, harness.deps);
  const revokedRename = await renameApiToken('user-a', active.body.apiToken.id, 'Again', harness.deps);
  assert.equal(revokedRename.ok, false);
  if (!revokedRename.ok) {
    assert.equal(revokedRename.status, 409);
    assert.equal(revokedRename.body.error, 'This token is revoked.');
  }
});

test('token SQL binds the owner and does not return the hash', async () => {
  const lib = await readFile('src/lib/api-tokens.ts', 'utf8');
  assert.match(lib, /LIST_USER_API_TOKENS_SQL[\s\S]{0,240}user_id = \?/);
  assert.match(lib, /RENAME_API_TOKEN_SQL[\s\S]{0,240}user_id = \?/);
  assert.match(lib, /REVOKE_API_TOKEN_SQL[\s\S]{0,280}user_id = \?/);
  assert.match(lib, /FIND_ACTIVE_API_TOKEN_SQL[\s\S]{0,220}token_hash = \?[\s\S]{0,80}revoked_at IS NULL/);
  assert.match(lib, /INSERT_ACTIVE_API_TOKEN_SQL[\s\S]{0,400}user_id = \?[\s\S]{0,120}revoked_at IS NULL[\s\S]{0,40}< 5/);
  assert.match(lib, /pg_advisory_xact_lock/);
  assert.match(lib, /executeTransaction/);
  const list = lib.slice(lib.indexOf('LIST_USER_API_TOKENS_SQL'), lib.indexOf('INSERT_ACTIVE_API_TOKEN_SQL'));
  assert.doesNotMatch(list, /token_hash/);
  assert.match(lib, /console\.info\('\[settings\] api token', \{ tokenId, status \}\)/);
});

test('a revoked token receives 401 on sync and last_used_at stays unchanged', async () => {
  const harness = tokenHarness();
  const created = await createApiToken('user-a', 'Laptop', harness.deps);
  if (!created.ok) return;
  const secret = created.body.token;
  await revokeApiToken('user-a', created.body.apiToken.id, harness.deps);
  let touched = false;
  const response = await handleSyncMemory(syncRequest('/api/sync/memory', { token: secret, ip: '203.0.113.10' }), authDeps({
    lookup: hash => harness.deps.findActiveByHash(hash),
    touch: async () => { touched = true; },
  }));
  assert.equal(response.status, 401);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Unauthorized');
  assert.equal(touched, false);
  assert.equal(harness.rows[0].lastUsedAt, null);
});

test('sync memory reads this user only, caps rows, and still returns them when memory is off', async () => {
  const facts = Array.from({ length: 90 }, (_, index) => ({
    id: `f-${index}`,
    kind: 'context' as const,
    content: `Fact ${index}`,
    mentionCount: 1,
    confidence: 0.8,
    updatedAt: '2026-10-06T00:00:00.000Z',
    userId: 'secret-user',
    embedding: [0.1],
  }));
  const qa = Array.from({ length: 30 }, (_, index) => ({
    id: `q-${index}`,
    question: `Question ${index}`,
    answerSummary: `Answer ${index}`,
    createdAt: '2026-10-06T00:00:00.000Z',
    userId: 'secret-user',
    sources: [{ title: 'hidden' }],
  }));
  const seen: Array<{ userId: string; pattern: string | null; kind: string }> = [];
  const result = await readSyncedMemory('user-a', null, {
    isEnabled: async () => false,
    listFacts: async (userId, pattern) => {
      seen.push({ userId, pattern, kind: 'facts' });
      return facts;
    },
    listQa: async (userId, pattern) => {
      seen.push({ userId, pattern, kind: 'qa' });
      return qa;
    },
  });
  assert.equal(result.memoryEnabled, false);
  assert.equal(result.facts.length, 80);
  assert.equal(result.qa.length, 20);
  assert.equal('userId' in result.facts[0], false);
  assert.equal('embedding' in result.facts[0], false);
  assert.equal('sources' in result.qa[0], false);
  assert.deepEqual(seen.map(item => ({ userId: item.userId, pattern: item.pattern, kind: item.kind })), [
    { userId: 'user-a', pattern: null, kind: 'facts' },
    { userId: 'user-a', pattern: null, kind: 'qa' },
  ]);
  const searched = await readSyncedMemory('user-a', '100%_a\\b', {
    isEnabled: async () => true,
    listFacts: async (userId, pattern) => {
      seen.push({ userId, pattern: pattern ?? null, kind: 'search-facts' });
      return [];
    },
    listQa: async () => [],
  });
  assert.equal(searched.memoryEnabled, true);
  assert.equal(seen.at(-1)?.pattern, ilikeContainsPattern('100%_a\\b'));
  assert.equal(seen.at(-1)?.pattern, '%100\\%\\_a\\\\b%');
});

test('sync memory SQL filters with a bound escaped pattern and does not touch memories', async () => {
  const lib = await readFile('src/lib/memory-sync.ts', 'utf8');
  assert.match(SYNC_QA_SQL, /ai_research_qa_index/);
  assert.match(SYNC_QA_SQL, /user_id = \?/);
  assert.match(SYNC_QA_SQL, /ORDER BY created_at DESC/);
  assert.match(SYNC_QA_SQL, /LIMIT 20/);
  assert.match(lib, /user_memories[\s\S]{0,240}user_id = \?/);
  assert.match(lib, /ORDER BY updated_at DESC[\s\S]{0,40}LIMIT 80/);
  assert.match(SYNC_QA_SEARCH_SQL, /question ILIKE \?/);
  assert.match(SYNC_QA_SEARCH_SQL, /answer_summary ILIKE \?/);
  assert.match(SYNC_QA_SEARCH_SQL, /ESCAPE/);
  assert.doesNotMatch(lib, /touchMemories/);
  assert.match(lib, /createChatImport\(/);
  assert.match(lib, /approveChatImport\(/);
});

test('push reuses Phase A and does not approve unless autoApprove is true on a review draft', async () => {
  const review = createMemoryImportDeps();
  review.deps.complete = async () => '{"facts":[{"kind":"context","content":"Works on Dupoin campaigns.","confidence":0.8}],"qa":[{"question":"Where is the brand guide?","answerSummary":"Internal Docs."}]}';
  const held = await importSyncedChat('user-a', { source: 'text', text: 'User: Remember the Dupoin voice.', autoApprove: false }, review.deps);
  assert.equal(held.status, 200);
  assert.equal(held.body.autoApproved, false);
  assert.equal((held.body.import as { status: string; transcript?: string }).status, 'review');
  assert.equal('transcript' in (held.body.import as object), false);
  assert.equal(review.memories.length, 0);

  const approved = createMemoryImportDeps();
  approved.deps.complete = review.deps.complete;
  const saved = await importSyncedChat('user-a', { source: 'text', text: 'User: Remember the Dupoin voice.', autoApprove: true }, approved.deps);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.autoApproved, true);
  assert.equal(saved.body.factsSaved, 1);
  assert.equal(saved.body.qaSaved, 1);
  assert.equal((saved.body.import as { status: string; transcript?: string }).status, 'approved');
  assert.deepEqual((saved.body.import as { draft: { facts: unknown[] } }).draft.facts, []);
  assert.equal('transcript' in (saved.body.import as object), false);
  assert.equal(approved.memories[0].content, 'Works on Dupoin campaigns.');
  assert.equal(approved.memories[0].userId, 'user-a');

  const failed = createMemoryImportDeps();
  failed.deps.complete = async () => { throw new Error('down'); };
  const extractFailed = await importSyncedChat('user-a', { source: 'text', text: 'User: Remember this.', autoApprove: true }, failed.deps);
  assert.equal(extractFailed.status, 200);
  assert.equal(extractFailed.body.autoApproved, false);
  assert.equal((extractFailed.body.import as { status: string }).status, 'extract_failed');
  assert.equal(failed.memories.length, 0);
  assert.equal(failed.rows[0].status, 'extract_failed');

  const duplicate = await importSyncedChat('user-a', { source: 'text', text: 'User: Remember the Dupoin voice.', autoApprove: true }, review.deps);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, 'This chat is already imported.');
  assert.equal('autoApproved' in duplicate.body, false);
  assert.equal(review.rows[0].status, 'review');
  assert.equal(review.memories.length, 0);

  const empty = createMemoryImportDeps();
  empty.deps.complete = async () => '{"facts":[],"qa":[]}';
  const emptyApproved = await importSyncedChat('user-a', { source: 'text', text: 'User: Just a note.', autoApprove: true }, empty.deps);
  assert.equal(emptyApproved.body.autoApproved, true);
  assert.equal(emptyApproved.body.factsSaved, 0);
  assert.equal(empty.rows[0].status, 'approved');

  const limitHarness = createMemoryImportDeps();
  const tooLong = await importSyncedChat('user-a', { source: 'text', text: 'a'.repeat(200_001), autoApprove: true }, limitHarness.deps);
  assert.equal(tooLong.status, 413);
  assert.equal(tooLong.body.error, 'Paste is limited to 200,000 characters.');
  assert.equal(limitHarness.rows.length, 0);
  const multiHarness = createMemoryImportDeps();
  const multi = await importSyncedChat('user-a', { source: 'codex', text: JSON.stringify([{ title: 'A' }, { title: 'B' }]), autoApprove: false }, multiHarness.deps);
  assert.equal(multi.status, 400);
  assert.equal(multi.body.error, 'Import one chat at a time.');
  assert.equal(multiHarness.rows.length, 0);
});

test('sync routes ignore the session cookie and settings routes ignore the bearer token', async () => {
  let looked = false;
  const cookieOnly = await handleSyncMemory(syncRequest('/api/sync/memory', { cookie: 'session_id=abc', ip: '203.0.113.21' }), authDeps({
    lookup: async () => { looked = true; return { id: 'tok-1', userId: 'user-a' }; },
  }));
  assert.equal(cookieOnly.status, 401);
  assert.equal(looked, false);

  let listed: string | null = null;
  const bearerSettings = await handleSettingsTokens(syncRequest('/api/settings/tokens', {
    token: `mos_${'a'.repeat(43)}`,
    ip: '203.0.113.22',
  }), authDeps({
    authorize: async () => ({ error: 'Unauthorized', status: 401 }),
    listTokens: async userId => { listed = userId; return []; },
  }));
  assert.equal(bearerSettings.status, 401);
  assert.equal(listed, null);

  const listedOk = await handleSettingsTokens(syncRequest('/api/settings/tokens', { ip: '203.0.113.23' }), authDeps({
    listTokens: async userId => { listed = userId; return []; },
  }));
  assert.equal(listedOk.status, 200);
  assert.equal(listed, 'user-from-session');
});

test('logged sync lines do not contain the token string', async () => {
  const secret = `mos_${'c'.repeat(43)}`;
  const lines: unknown[][] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => { lines.push(args); };
  try {
    const response = await handleSyncMemory(syncRequest('/api/sync/memory?q=dupoin', { token: secret, ip: '203.0.113.24' }), authDeps({
      readMemory: async () => ({ memoryEnabled: false, facts: [], qa: [] }),
    }));
    assert.equal(response.status, 200);
    const imported = await handleSyncImport(syncRequest('/api/sync/import', {
      token: secret,
      ip: '203.0.113.25',
      body: JSON.stringify({ source: 'text', text: `Keep this\n${secret}\nplease`, autoApprove: false }),
    }), authDeps());
    assert.equal(imported.status, 200);
  } finally {
    console.info = original;
  }
  const logged = JSON.stringify(lines);
  assert.equal(logged.includes(secret), false);
  assert.equal(logged.includes('dupoin'), false);
  assert.match(logged, /\[sync\]/);
});

test('the 31st sync call in a window returns 429', async () => {
  const sameToken = `mos_${'d'.repeat(43)}`;
  let lookups = 0;
  for (let index = 0; index < 30; index += 1) {
    const response = await handleSyncMemory(syncRequest('/api/sync/memory', { token: sameToken, ip: `198.51.100.${index + 1}` }), authDeps({
      lookup: async () => { lookups += 1; return null; },
    }));
    assert.equal(response.status, 401);
  }
  const blocked = await handleSyncMemory(syncRequest('/api/sync/memory', { token: sameToken, ip: '198.51.100.31' }), authDeps({
    lookup: async () => { lookups += 1; return null; },
  }));
  assert.equal(blocked.status, 429);
  const body = await blocked.json() as { error: string };
  assert.equal(body.error, 'Too many requests. Please try again later.');
  assert.ok(blocked.headers.get('retry-after'));
  assert.equal(lookups, 30);

  const mixedIp = '203.0.113.32';
  let mixedLookups = 0;
  for (let index = 0; index < 30; index += 1) {
    const token = `mos_${String(index).padStart(43, 'e')}`;
    const response = await handleSyncMemory(syncRequest('/api/sync/memory', { token, ip: mixedIp }), authDeps({
      lookup: async () => { mixedLookups += 1; return null; },
    }));
    assert.equal(response.status, 401);
  }
  const mixedBlocked = await handleSyncMemory(syncRequest('/api/sync/memory', {
    token: `mos_${'f'.repeat(43)}`,
    ip: mixedIp,
  }), authDeps({
    lookup: async () => { mixedLookups += 1; return { id: 'should-not', userId: 'user-a' }; },
  }));
  assert.equal(mixedBlocked.status, 429);
  assert.equal(mixedLookups, 30);
});

test('a non-loopback request with x-forwarded-proto http returns 400 before lookup', async () => {
  let lookups = 0;
  const response = await handleSyncMemory(syncRequest('/api/sync/memory', {
    token: `mos_${'a'.repeat(43)}`,
    ip: '203.0.113.40',
    host: 'marketingos.example.com',
    proto: 'http',
  }), authDeps({
    lookup: async () => { lookups += 1; return { id: 'tok-1', userId: 'user-a' }; },
  }));
  assert.equal(response.status, 400);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Use HTTPS.');
  assert.equal(lookups, 0);

  const loopback = await handleSyncMemory(syncRequest('/api/sync/memory', {
    ip: '203.0.113.41',
    host: '127.0.0.1:3000',
    proto: 'http',
  }), authDeps());
  assert.equal(loopback.status, 401);

  const secure = await handleSyncMemory(syncRequest('/api/sync/memory', {
    token: `mos_${'a'.repeat(43)}`,
    ip: '203.0.113.42',
    host: 'marketingos.example.com',
    proto: 'https',
  }), authDeps());
  assert.equal(secure.status, 200);
});

test('a non-boolean autoApprove returns 400 before create', async () => {
  let created = false;
  const response = await handleSyncImport(syncRequest('/api/sync/import', {
    token: `mos_${'a'.repeat(43)}`,
    ip: '203.0.113.60',
    body: JSON.stringify({ source: 'text', text: 'Hello', autoApprove: 'yes' }),
  }), authDeps({
    importChat: async () => { created = true; return { status: 200, body: {} }; },
  }));
  assert.equal(response.status, 400);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'autoApprove must be true or false.');
  assert.equal(created, false);

  const omitted = await handleSyncImport(syncRequest('/api/sync/import', {
    token: `mos_${'a'.repeat(43)}`,
    ip: '203.0.113.61',
    body: JSON.stringify({ source: 'text', text: 'Hello' }),
  }), authDeps({
    importChat: async (_userId, input) => {
      created = input.autoApprove === false;
      return { status: 200, body: { autoApproved: false } };
    },
  }));
  assert.equal(omitted.status, 200);
  assert.equal(created, true);
});

test('a search longer than 200 characters returns 400 and reads no rows', async () => {
  let reads = 0;
  const response = await handleSyncMemory(syncRequest(`/api/sync/memory?q=${'a'.repeat(201)}`, {
    token: `mos_${'g'.repeat(43)}`,
    ip: '203.0.113.80',
  }), authDeps({
    readMemory: async () => { reads += 1; return { memoryEnabled: true, facts: [], qa: [] }; },
  }));
  assert.equal(response.status, 400);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Search is limited to 200 characters.');
  assert.equal(reads, 0);
});

test('a token user without AI Research receives 403', async () => {
  const response = await handleSyncMemory(syncRequest('/api/sync/memory', {
    token: `mos_${'a'.repeat(43)}`,
    ip: '203.0.113.70',
  }), authDeps({
    loadPrincipal: async () => ({ role: 'member', features: ['social-post'] }),
  }));
  assert.equal(response.status, 403);
  const body = await response.json() as { error: string };
  assert.equal(body.error, FORBIDDEN);
  const missing = await handleSyncMemory(syncRequest('/api/sync/memory', {
    token: `mos_${'b'.repeat(43)}`,
    ip: '203.0.113.71',
  }), authDeps({
    loadPrincipal: async () => null,
  }));
  assert.equal(missing.status, 401);
});

test('settings and sync route files keep the credential split', async () => {
  const settings = await readFile('src/app/api/settings/tokens/route.ts', 'utf8');
  const settingsId = await readFile('src/app/api/settings/tokens/[id]/route.ts', 'utf8');
  const memory = await readFile('src/app/api/sync/memory/route.ts', 'utf8');
  const imported = await readFile('src/app/api/sync/import/route.ts', 'utf8');
  const lib = await readFile('src/lib/memory-sync.ts', 'utf8');
  assert.match(settings, /requireFeature\(request, 'ai-research'\)/);
  assert.match(settingsId, /requireFeature\(request, 'ai-research'\)/);
  assert.match(lib, /settings-tokens:/);
  assert.doesNotMatch(`${settings}\n${settingsId}`, /authorization/i);
  assert.doesNotMatch(`${memory}\n${imported}\n${lib}`, /getAuthorizedUser|requireFeature|session_id|cookies\.get/);
  assert.match(memory, /handleSyncMemory/);
  assert.match(imported, /handleSyncImport/);
  assert.match(imported, /createChatImport|importSyncedChat|handleSyncImport/);
});

test('API tokens sit in the AI workspace and Token usage stays admin-only', async () => {
  const layout = await readFile('src/app/dashboard/layout.tsx', 'utf8');
  const page = await readFile('src/app/dashboard/settings/api-tokens/page.tsx', 'utf8');
  const panel = await readFile('src/components/AiResearchMemoryPanel.tsx', 'utf8');
  assert.match(layout, /label: 'AI workspace'/);
  assert.match(layout, /href: '\/dashboard\/settings\/api-tokens', label: 'API tokens', icon: 'tokens', feature: 'ai-research'/);
  assert.match(layout, /href: '\/dashboard\/tokens', label: 'Token usage', icon: 'tokens', adminOnly: true/);
  const adminOnly = layout.slice(layout.indexOf('const adminOnlyPages'), layout.indexOf('];', layout.indexOf('const adminOnlyPages')));
  assert.doesNotMatch(adminOnly, /api-tokens/);
  assert.match(page, /No API tokens yet\. Create one to sync memory with Codex on your laptop\./);
  assert.match(page, /This token is shown once\. Store it as MARKETINGOS_API_TOKEN\./);
  assert.match(page, /Revoke this token\? Codex on your laptop will stop syncing until you create a new one\./);
  assert.match(page, />Create token</);
  assert.match(page, />Copy</);
  assert.match(page, />Rename</);
  assert.match(page, />Revoke</);
  assert.match(page, />Revoked</);
  assert.match(page, /Never/);
  assert.match(page, /\/api\/settings\/tokens/);
  assert.doesNotMatch(page, /token_hash|Authorization/);
  assert.match(page, /setSecret\(null\)|setCreatedToken\(null\)/);
  assert.doesNotMatch(panel, /\/api\/sync|API tokens/);
});

test('the Codex skill pulls and pushes without printing the token', async () => {
  const skill = await import('../codex/skills/marketingos-memory/sync.mjs') as {
    resolveOrigin: (value: string) => { ok: boolean; origin?: string; message?: string };
    preparePushText: (text: string, token: string) => string;
    classifyPushFile: (text: string) => 'codex' | 'text';
    formatThread: (turns: Array<{ role: string; content: string }>) => string;
    clipQuery: (value: string) => string;
    runPull: (input: { url?: string; token?: string; query?: string; fetchImpl: typeof fetch }) => Promise<{ ok: boolean; message: string }>;
    runPush: (input: { url?: string; token?: string; text: string; file?: boolean; approve?: boolean; fetchImpl: typeof fetch }) => Promise<{ ok: boolean; message: string; called: boolean }>;
  };
  const readme = await readFile('codex/skills/marketingos-memory/README.md', 'utf8');
  const instructions = await readFile('codex/skills/marketingos-memory/SKILL.md', 'utf8');
  assert.match(readme, /MARKETINGOS_API_TOKEN/);
  assert.match(readme, /MARKETINGOS_API_URL/);
  assert.match(readme, /\/dashboard\/settings\/api-tokens/);
  assert.match(instructions, /autoApprove/);
  assert.match(instructions, /Review facts/);
  assert.equal(skill.resolveOrigin('https://marketingos.example.com/').ok, true);
  assert.equal(skill.resolveOrigin('https://marketingos.example.com/').origin, 'https://marketingos.example.com');
  assert.equal(skill.resolveOrigin('http://localhost:3000').origin, 'http://localhost:3000');
  assert.equal(skill.resolveOrigin('http://example.com').ok, false);
  assert.equal(skill.clipQuery(`  ${'a'.repeat(250)}  `).length, 200);
  assert.equal(skill.classifyPushFile('{"title":"A"}'), 'codex');
  assert.equal(skill.classifyPushFile('Just notes'), 'text');
  assert.match(skill.formatThread([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }]), /User: Hi[\s\S]*Assistant: Hello/);
  const secret = `mos_${'z'.repeat(43)}`;
  assert.equal(skill.preparePushText(`hello\n${secret}\nthere`, secret).includes(secret), false);

  let called = false;
  const missing = await skill.runPull({ query: 'brand', fetchImpl: async () => { called = true; return new Response('{}'); } });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /\/dashboard\/settings\/api-tokens/);
  assert.equal(called, false);

  const pulls: string[] = [];
  const pulled = await skill.runPull({
    url: 'http://127.0.0.1:3000/',
    token: secret,
    query: 'brand',
    fetchImpl: async (input, init) => {
      pulls.push(String(input));
      assert.equal((init?.headers as { Authorization?: string }).Authorization, `Bearer ${secret}`);
      return Response.json({ memoryEnabled: false, facts: [{ kind: 'context', content: 'Works on Dupoin.' }], qa: [{ question: 'Where?', answerSummary: 'Docs.' }] });
    },
  });
  assert.equal(pulled.ok, true);
  assert.equal(pulls[0], 'http://127.0.0.1:3000/api/sync/memory?q=brand');
  assert.match(pulled.message, /context: Works on Dupoin\./);
  assert.match(pulled.message, /Memory is off\. Dupoin AI will not use these until you turn memory on in AI Research\./);
  assert.equal(pulled.message.includes(secret), false);

  const refused = await skill.runPush({
    url: 'http://example.com',
    token: secret,
    text: 'hello',
    fetchImpl: async () => { throw new Error('should not send'); },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.called, false);

  const oversized = await skill.runPush({
    url: 'https://marketingos.example.com',
    token: secret,
    text: 'a'.repeat(200_001),
    fetchImpl: async () => { throw new Error('should not send'); },
  });
  assert.match(oversized.message, /over the import limit/);
  assert.equal(oversized.called, false);

  const pushed: { url: string; body: { source: string; text: string; autoApprove: boolean } } = {
    url: '',
    body: { source: '', text: '', autoApprove: true },
  };
  const review = await skill.runPush({
    url: 'https://marketingos.example.com',
    token: secret,
    text: `{"messages":[]}`,
    file: true,
    fetchImpl: async (input, init) => {
      pushed.url = String(input);
      pushed.body = JSON.parse(String(init?.body));
      return Response.json({ import: { title: 'Voice guide', status: 'review' }, autoApproved: false });
    },
  });
  assert.equal(pushed.body.source, 'codex');
  assert.equal(pushed.body.autoApprove, false);
  assert.match(review.message, /Review facts/);
  assert.equal(review.message.includes(secret), false);

  const approved = await skill.runPush({
    url: 'https://marketingos.example.com',
    token: secret,
    text: 'plain notes',
    file: true,
    approve: true,
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { source: string; autoApprove: boolean };
      assert.equal(body.source, 'text');
      assert.equal(body.autoApprove, true);
      return Response.json({ autoApproved: true, factsSaved: 1, factsAlreadySaved: 0, qaSaved: 2, qaAlreadySaved: 3, import: { status: 'approved', title: 'Notes' } });
    },
  });
  assert.match(approved.message, /1/);
  assert.match(approved.message, /Facts saved/);
  assert.match(approved.message, /Q&A already saved: 3/);
});
