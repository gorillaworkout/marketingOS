# Import Chat Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in AI Research user paste or upload one Codex/ChatGPT, Claude, or plain-text chat, save that full chat immediately as their private `imported-chat` knowledge-graph node, and write reviewed facts and Q&A into `user_memories` and `ai_research_qa_index` only after they approve.

**Architecture:** Pure parsers, the content hash, size checks, and draft filtering live in library modules with no database. Route handlers call `requireFeature(request, 'ai-research')`, enforce limits, and pass an injected `ChatImportDeps` store. The chat row and graph node commit before the model call. Approve reads the stored draft, mirrors through the existing `mirrorUserMemory` / `mirrorQaTurn` functions, then adds one `learned_from` edge per approved row to the import node. The Memory panel owns the import modal; the admin graph only adds a visibility predicate, the `Imported Chat` palette entry, and the same row actions.

**Tech Stack:** Next.js 16 App Router (`params` is a `Promise`), React 19, TypeScript 5, PostgreSQL via `queryOne` / `execute` / `executeTransaction` (`?` placeholders), `node:test` through `npx tsx --test`, local `getEmbedding`, `AI_RESEARCH_MEMORY_MODEL`.

**Spec:** `docs/superpowers/specs/2026-10-06-import-chat-memory-design.md`

## Global Constraints

- Phase A only. No webhooks, background poll, shared credentials, job queue, or continuous Codex ↔ MarketingOS sync.
- Do not import a multi-conversation export. The error sentence is `Import one chat at a time.` Nothing is saved.
- No delete route. Cancel and a failed extract do not delete the graph node.
- The user cannot add a checklist row the model did not return, and cannot edit the stored transcript.
- Do not create an `ai_research_conversations` row from an import.
- Do not share an import. Do not return `chat_imports.transcript` or `imported-chat` `selected_output` from `/api/admin/knowledge-graph`.
- English UI only. No new locale files.
- Do not change `parseExtractedMemories`, its 4-fact cap, `extractUserMemories`, `indexQaTurn`, or `ai_memory_enabled` prompt gating.
- The Memory on/off switch does not block import or approve.
- Embeddings stay on local `getEmbedding`. Extract uses `AI_RESEARCH_MEMORY_MODEL` (`ag/gemini-3-flash`), `temperature` 0.1, `maxTokens` 2000, `responseFormat: { type: 'json_object' }`, `jsonRepairAttempts` 0, and `taskType: 'ai-research'`.
- New graph task type is `imported-chat`. Legend label is `Imported Chat`. Color is `#E11D48`.
- Do not add `imported-chat` to `AI_RESEARCH_RETRIEVAL_TASK_TYPES`.
- `shouldUpdateStylePreferences('imported-chat', 'approve')` is false. The style-sample query excludes `imported-chat` next to `user-memory` and `ai-research-qa`.
- Unique key is `(user_id, content_hash)`. The same transcript may exist for two users.
- Paste and decoded file text use JavaScript string length. Over 200,000 characters is rejected. File bytes over `5 * 1024 * 1024` are rejected. Both rejections happen before insert.
- Graph `brief` is the title, at most 240 characters. Graph `selected_output` is the canonical transcript prefix, at most 8,000 characters. `quality_score` is 0.7. `conversation_id` is null. `content_hash` is the transcript hash, not `task_id`.
- At most 12 facts and 8 Q&A pairs. Fact content is 3–280 characters. Question is 3–2,000 characters. Answer summary is 1–500 characters.
- Fact confidence is clamped to 0–1. Missing or non-numeric confidence becomes 0.5. An inserted approved fact uses confidence at least 0.8.
- When the transcript is longer than 24,000 characters, the model sees the first 12,000, a line `...[middle omitted]...`, and the last 12,000. The stored transcript stays complete.
- Every import read and write binds `user_id` to the session user. A missing row and another user's row both return 404 `Import was not found.`
- Admin graph predicate, on every `knowledge_entries` list or count, is `(<alias>.task_type <> 'imported-chat' OR <alias>.user_id = ?)` with the signed-in admin id. An edge is included only when both endpoints pass. Learning-health queries stay on `tasks`.
- `tests/admin-knowledge-graph.test.ts` asserts `doesNotMatch(route, /WHERE ke\.user_id =/)`. Write `OR ke.user_id = ?` inside the predicate. Do not add a line `WHERE ke.user_id =`.
- Log the import id and status only. Do not log the transcript, paste, file bytes, or filename.
- Uploaded filenames are not titles and are not storage keys.
- Migration `028_chat_imports.sql` is forward-only and idempotent, like `026_ai_research_memory.sql`.
- Approve never calls `indexQaTurn` or `extractUserMemories`.
- `learned_from` weight is 1, one edge per approved fact (new or updated) and per newly inserted Q&A. No cap of 8 on those import edges. `similar_question` still comes from `mirrorQaTurn` → `planSimilarQaEdges` (score at least 0.6, at most 8).
- Memory-off review copy is exactly: `Memory is off. This chat is still saved. Approved facts and answers are stored, and Dupoin AI will not use them until you turn memory on.`
- Cancel copy is exactly: `Draft discarded. The chat stays in your knowledge graph.`
- Parser-fallback copy is exactly: `This chat was saved as plain text.`
- Saved-chat copy is exactly: `Full chat saved to your knowledge graph.`
- Extract-failed copy is exactly: `The chat was saved. Fact extraction failed.`
- Duplicate copy is exactly: `This chat is already imported.`
- Extract-failure error stored on the row is exactly: `Fact extraction failed.`

---

## File Structure

**Create**

- `db/migrations/028_chat_imports.sql` — `chat_imports` table, unique `(user_id, content_hash)`, user index.
- `src/lib/chat-import-parse.ts` — source check, parsers, canonical transcript, sha256 hash, paste/file limits, UTF-8 decode.
- `src/lib/chat-import-extract.ts` — model window, draft parse, question/answer validation, approval selection, model call.
- `src/lib/chat-import-graph.ts` — graph-node field builder (real content hash), `learned_from` edge plan, unique-violation check, node INSERT SQL.
- `src/lib/chat-import.ts` — row types, SQL, `ChatImportDeps`, create/list/read/approve/cancel/retry.
- `src/lib/chat-import-ui.ts` — English labels, list actions, dates. No React.
- `src/app/api/ai-research/imports/route.ts` — `POST` create and `GET` list.
- `src/app/api/ai-research/imports/[id]/route.ts` — `GET` one import plus transcript.
- `src/app/api/ai-research/imports/[id]/approve/route.ts` — `POST` approve.
- `src/app/api/ai-research/imports/[id]/cancel/route.ts` — `POST` cancel.
- `src/app/api/ai-research/imports/[id]/extract/route.ts` — `POST` retry extract.
- `src/components/AiResearchImportModal.tsx` — paste/upload, review, failure, cancel, duplicate, transcript.
- `src/components/ImportedChatRecordActions.tsx` — admin selected-record actions. Does not render the transcript.
- `tests/chat-import-parse.test.ts` — parsers, hash, limits.
- `tests/chat-import-extract.test.ts` — draft filter, window, approval selection.
- `tests/chat-import-graph.test.ts` — palette, retrieval exclusion, style exclusion, node fields, learned-from plan.
- `tests/chat-import.test.ts` — create/list/read/approve/cancel/retry against a fake store, plus route SQL strings.
- `tests/chat-import-deps.ts` — in-memory `ChatImportDeps` for the route-behavior tests.
- `tests/chat-import-ui.test.ts` — Memory panel, modal copy, admin record actions.

**Modify**

- `src/lib/knowledge-task-types.ts` — add `imported-chat` after `ai-research-qa` and export `IMPORTED_CHAT_TASK_TYPE`.
- `src/lib/knowledge-graph-colors.ts` — color `#E11D48`, label `Imported Chat`.
- `src/lib/embeddings.ts` — `knowledgeEmbeddingInput` treats `imported-chat` like `user-memory`.
- `src/lib/knowledge-persist.ts` — `shouldUpdateStylePreferences` returns false for `imported-chat`; style-sample SQL excludes it.
- `src/app/api/admin/knowledge-graph/route.ts` — visibility predicate, `task_id` on the node query, `taskId` on own `imported-chat` nodes.
- `src/components/AiResearchMemoryPanel.tsx` — **Import chat** button and the owner's import list.
- `src/app/dashboard/knowledge-graph/page.tsx` — `taskId` on the node type and selected-record actions.
- `tests/canonical-migrations.test.ts` — assert migration 028 the same way 026 is asserted.

**Do not modify**

- `src/lib/ai-research-memory.ts` live extract path, except by calling existing exports (`validateMemoryContent`, `memoryContentHash`, `normalizeQuestion`, `isMemoryKind`, `isSensitiveMemory`, `AI_RESEARCH_MEMORY_MODEL`).
- `src/app/api/ai-research/chat/route.ts`.
- `src/app/api/knowledge/graph/route.ts` (it already filters `user_id = ?`).
- `src/app/dashboard/knowledge-graph/KnowledgeGraphCanvas.tsx` and `KnowledgeFeatureLegend.tsx`. Node color already comes from `knowledgeFeatureColor(node.taskType)`. The legend and **Filter by source feature** control already call `knowledgeFeatureLabel`.

---

### Task 1: Register `imported-chat` on the graph palette

**Files:**
- Modify: `src/lib/knowledge-task-types.ts`
- Modify: `src/lib/knowledge-graph-colors.ts`
- Modify: `src/lib/embeddings.ts`
- Modify: `src/lib/knowledge-persist.ts` (`shouldUpdateStylePreferences` around line 96, style-sample SQL around line 704)
- Test: `tests/chat-import-graph.test.ts`

**Interfaces:**
- Produces: `IMPORTED_CHAT_TASK_TYPE = 'imported-chat'`.
- `KNOWLEDGE_TASK_TYPES` includes `'imported-chat'` immediately after `'ai-research-qa'`.
- `knowledgeFeatureLabel('imported-chat')` returns `Imported Chat`.
- `knowledgeFeatureColor('imported-chat')` returns `#E11D48`.
- `knowledgeEmbeddingInput('imported-chat', brief, selectedOutput)` returns `${brief}\n${selectedOutput}` when both are non-empty.
- `shouldUpdateStylePreferences('imported-chat', 'approve' | 'select' | 'publish')` returns `false`.
- `AI_RESEARCH_RETRIEVAL_TASK_TYPES` stays `['ai-research', 'market-research', 'internal-docs', 'article-market-news']`.

- [ ] **Step 1: Write the failing test**

Create `tests/chat-import-graph.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { knowledgeEmbeddingInput } from '../src/lib/embeddings';
import { shouldUpdateStylePreferences } from '../src/lib/knowledge-persist';
import { KNOWLEDGE_FEATURE_COLORS, knowledgeFeatureColor, knowledgeFeatureLabel } from '../src/lib/knowledge-graph-colors';
import { AI_RESEARCH_RETRIEVAL_TASK_TYPES, IMPORTED_CHAT_TASK_TYPE, KNOWLEDGE_TASK_TYPES } from '../src/lib/knowledge-task-types';

test('imported chat is a graph task type with a unique legend color and is not retrieved as research', () => {
  assert.equal(IMPORTED_CHAT_TASK_TYPE, 'imported-chat');
  assert.equal(KNOWLEDGE_TASK_TYPES[KNOWLEDGE_TASK_TYPES.length - 1], 'imported-chat');
  assert.equal(KNOWLEDGE_TASK_TYPES.includes('ai-research-qa'), true);
  assert.equal(knowledgeFeatureLabel('imported-chat'), 'Imported Chat');
  assert.equal(knowledgeFeatureColor('imported-chat'), '#E11D48');
  assert.equal(KNOWLEDGE_FEATURE_COLORS['imported-chat'], '#E11D48');
  assert.deepEqual([...AI_RESEARCH_RETRIEVAL_TASK_TYPES], ['ai-research', 'market-research', 'internal-docs', 'article-market-news']);
  assert.equal(AI_RESEARCH_RETRIEVAL_TASK_TYPES.includes('imported-chat' as never), false);
  assert.equal(shouldUpdateStylePreferences('imported-chat', 'approve'), false);
  assert.equal(shouldUpdateStylePreferences('imported-chat', 'select'), false);
  assert.equal(shouldUpdateStylePreferences('imported-chat', 'publish'), false);
  assert.equal(shouldUpdateStylePreferences('social-post', 'select'), true);
  assert.equal(knowledgeEmbeddingInput('imported-chat', 'Campaign voice', 'user\nHello'), 'Campaign voice\nuser\nHello');
  assert.equal(knowledgeEmbeddingInput('social-post', 'brief', 'caption'), 'caption');
});

test('style samples skip imported chats along with memory and Q&A', async () => {
  const persist = await readFile('src/lib/knowledge-persist.ts', 'utf8');
  assert.match(persist, /task_type NOT IN \('user-memory', 'ai-research-qa', 'imported-chat'\)/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/chat-import-graph.test.ts`

Expected: FAIL with `IMPORTED_CHAT_TASK_TYPE` is not exported, or `knowledgeFeatureLabel('imported-chat')` is `Other`.

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/knowledge-task-types.ts`, add the constant and the array entry after `'ai-research-qa'`:

```ts
export const KNOWLEDGE_TASK_TYPES = [
  'social-post',
  'video-script',
  'event-plan',
  'market-research',
  'article-market-news',
  'ai-research',
  'internal-docs',
  'user-memory',
  'ai-research-qa',
  'imported-chat',
] as const;

export const USER_MEMORY_TASK_TYPE = 'user-memory' as const;
export const AI_RESEARCH_QA_TASK_TYPE = 'ai-research-qa' as const;
export const IMPORTED_CHAT_TASK_TYPE = 'imported-chat' as const;
```

Leave `AI_RESEARCH_RETRIEVAL_TASK_TYPES` unchanged.

In `src/lib/knowledge-graph-colors.ts`, add the key to both maps:

```ts
  'user-memory': '#C026D3',
  'ai-research-qa': '#84CC16',
  'imported-chat': '#E11D48',
  other: '#94A3B8',
```

```ts
  'user-memory': 'User Memory',
  'ai-research-qa': 'Research Q&A',
  'imported-chat': 'Imported Chat',
  other: 'Other',
```

In `src/lib/embeddings.ts`, import `IMPORTED_CHAT_TASK_TYPE` from `./knowledge-task-types` and change `knowledgeEmbeddingInput`:

```ts
export function knowledgeEmbeddingInput(taskType: string | null | undefined, brief: string, selectedOutput: string): string {
  const answer = (selectedOutput || '').trim();
  if (taskType === 'ai-research' || taskType === 'ai-research-qa' || taskType === 'user-memory' || taskType === IMPORTED_CHAT_TASK_TYPE) {
    const question = (brief || '').trim();
    if (question && answer) return `${question}\n${answer}`;
    return question || answer;
  }
  return answer;
}
```

In `src/lib/knowledge-persist.ts`, import `IMPORTED_CHAT_TASK_TYPE` and add it to the early return:

```ts
export function shouldUpdateStylePreferences(taskType: string, action: KnowledgePersistAction): boolean {
  if (action !== 'select' && action !== 'approve' && action !== 'publish') return false;
  if (
    taskType === AI_RESEARCH_KNOWLEDGE_TASK
    || taskType === 'ai-research-qa'
    || taskType === 'user-memory'
    || taskType === IMPORTED_CHAT_TASK_TYPE
    || taskType === 'market-research'
    || taskType === 'internal-docs'
  ) return false;
  return true;
}
```

Change the style-sample SQL string to:

```ts
       WHERE user_id = ? AND task_type NOT IN ('user-memory', 'ai-research-qa', 'imported-chat')
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test tests/chat-import-graph.test.ts tests/knowledge-graph-colors.test.ts tests/knowledge-persist.test.ts tests/ai-research-memory.test.ts`

Expected: PASS. The color test still requires every pair of legend colors to be at least 70 RGB apart. `#E11D48` meets that against the current palette. `shouldUpdateStylePreferences('social-post', 'select')` stays true.

- [ ] **Step 5: Commit**

```bash
git add src/lib/knowledge-task-types.ts src/lib/knowledge-graph-colors.ts src/lib/embeddings.ts src/lib/knowledge-persist.ts tests/chat-import-graph.test.ts
git commit -m "Register imported-chat on the knowledge graph palette."
```

---

### Task 2: Add the `chat_imports` migration

**Files:**
- Create: `db/migrations/028_chat_imports.sql`
- Modify: `tests/canonical-migrations.test.ts`

**Interfaces:**
- Produces: table `chat_imports` with columns `id`, `user_id`, `source`, `parser`, `parser_fallback`, `title`, `transcript`, `content_hash`, `status`, `draft`, `knowledge_entry_id`, `error`, `approve_result`, `created_at`, `updated_at`.
- `source` check: `'codex', 'claude', 'text'`. `parser` check: the same three. `status` check: `'review', 'extract_failed', 'approved', 'chat_only'`.
- Unique `(user_id, content_hash)`. Index `idx_chat_imports_user` on `(user_id, created_at DESC)`.
- Later tasks insert these column names. Do not add columns to `knowledge_entries`.

- [ ] **Step 1: Write the failing test**

Append this test to `tests/canonical-migrations.test.ts` next to the 026 test:

```ts
test('028 adds chat_imports and is idempotent', () => {
  const sql = readFileSync('db/migrations/028_chat_imports.sql', 'utf8');
  const executable = withoutSqlComments(sql);
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS chat_imports/);
  assert.match(sql, /user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(sql, /source TEXT NOT NULL CHECK \(source IN \('codex', 'claude', 'text'\)\)/);
  assert.match(sql, /parser TEXT NOT NULL CHECK \(parser IN \('codex', 'claude', 'text'\)\)/);
  assert.match(sql, /parser_fallback BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(sql, /status TEXT NOT NULL CHECK \(status IN \('review', 'extract_failed', 'approved', 'chat_only'\)\)/);
  assert.match(sql, /draft JSONB NOT NULL DEFAULT '\{"facts":\[\],"qa":\[\]\}'::jsonb/);
  assert.match(sql, /knowledge_entry_id TEXT REFERENCES knowledge_entries\(id\) ON DELETE SET NULL/);
  assert.match(sql, /UNIQUE \(user_id, content_hash\)/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_chat_imports_user/);
  assert.match(sql, /ON chat_imports \(user_id, created_at DESC\)/);
  assert.doesNotMatch(executable, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.doesNotMatch(executable, /ALTER TABLE knowledge_entries/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/canonical-migrations.test.ts`

Expected: FAIL because `db/migrations/028_chat_imports.sql` does not exist.

- [ ] **Step 3: Write the migration**

Create `db/migrations/028_chat_imports.sql`:

```sql
-- One imported chat per user, plus the extract draft waiting for approval.
-- Idempotent and forward-only. Deploy applies this on push to main.

BEGIN;

CREATE TABLE IF NOT EXISTS chat_imports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('codex', 'claude', 'text')),
  parser TEXT NOT NULL CHECK (parser IN ('codex', 'claude', 'text')),
  parser_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  title TEXT NOT NULL,
  transcript TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('review', 'extract_failed', 'approved', 'chat_only')),
  draft JSONB NOT NULL DEFAULT '{"facts":[],"qa":[]}'::jsonb,
  knowledge_entry_id TEXT REFERENCES knowledge_entries(id) ON DELETE SET NULL,
  error TEXT,
  approve_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_chat_imports_user
  ON chat_imports (user_id, created_at DESC);

COMMIT;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test tests/canonical-migrations.test.ts`

Expected: PASS, including the existing 026 test.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/028_chat_imports.sql tests/canonical-migrations.test.ts
git commit -m "Add the chat_imports migration."
```

---

### Task 3: Parse one chat and hash the canonical transcript

**Files:**
- Create: `src/lib/chat-import-parse.ts`
- Test: `tests/chat-import-parse.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:

```ts
export const CHAT_IMPORT_SOURCES = ['codex', 'claude', 'text'] as const;
export type ChatImportSource = (typeof CHAT_IMPORT_SOURCES)[number];
export type ImportParser = 'codex' | 'claude' | 'text';
export type ImportMessage = { role: 'user' | 'assistant'; content: string };
export class MultiChatImportError extends Error {}
export type ParsedChat = {
  title: string;
  messages: ImportMessage[];
  parser: ImportParser;
  parserFallback: boolean;
  transcript: string;
  contentHash: string;
};
export function isChatImportSource(value: unknown): value is ChatImportSource;
export function parseImportedChat(source: ChatImportSource, raw: string): ParsedChat;
export function canonicalTranscript(messages: ImportMessage[]): string;
export function chatContentHash(messages: ImportMessage[]): string;
export function normalizeMessageContent(content: string): string;
export const IMPORT_CHAT_CHAR_LIMIT = 200_000;
export const IMPORT_FILE_BYTE_LIMIT = 5 * 1024 * 1024;
export function importPasteError(text: string): { status: 400 | 413; error: string } | null;
export function importFileError(input: { filename: string; bytes: number; text: string | null }): { status: 400 | 413; error: string } | null;
export function decodeUtf8(bytes: Uint8Array): string | null;
```

`parseImportedChat` throws `MultiChatImportError` with message `Import one chat at a time.` before it builds a transcript. Any other failure to find a user or assistant message returns `parser: 'text'`, `parserFallback: true`, and the plain-text transcript of the original string. Source `text` never parses JSON and has `parserFallback: false`.

- [ ] **Step 1: Write the failing test**

Create `tests/chat-import-parse.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPORT_CHAT_CHAR_LIMIT,
  IMPORT_FILE_BYTE_LIMIT,
  MultiChatImportError,
  canonicalTranscript,
  chatContentHash,
  decodeUtf8,
  importFileError,
  importPasteError,
  parseImportedChat,
} from '../src/lib/chat-import-parse';

test('Codex mapping follows parent to children and drops system and tool turns', () => {
  const raw = JSON.stringify({
    title: 'Campaign voice',
    create_time: 1,
    mapping: {
      a: { parent: null, children: ['b'], message: { author: { role: 'system' }, content: { parts: ['sys'] } } },
      b: { parent: 'a', children: ['c'], message: { author: { role: 'user' }, content: { parts: ['Hello', 'there'] } } },
      c: { parent: 'b', children: ['d'], message: { author: { role: 'tool' }, content: { parts: ['tool out'] } } },
      d: { parent: 'c', children: [], message: { author: { role: 'assistant' }, content: 'Done' } },
    },
  });
  const parsed = parseImportedChat('codex', raw);
  assert.deepEqual(parsed.messages, [
    { role: 'user', content: 'Hello\nthere' },
    { role: 'assistant', content: 'Done' },
  ]);
  assert.equal(parsed.title, 'Campaign voice');
  assert.equal(parsed.parser, 'codex');
  assert.equal(parsed.parserFallback, false);
  assert.equal(parsed.transcript, canonicalTranscript(parsed.messages));
});

test('a one-element Codex or Claude array imports that conversation', () => {
  const codex = parseImportedChat('codex', JSON.stringify([
    { title: 'Only', messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Yo' }] },
  ]));
  assert.equal(codex.messages.length, 2);
  assert.equal(codex.title, 'Only');
  assert.equal(codex.parser, 'codex');
  const claude = parseImportedChat('claude', JSON.stringify({
    conversations: [{ name: 'Brand', chat_messages: [{ sender: 'human', text: 'Q' }] }],
  }));
  assert.equal(claude.title, 'Brand');
  assert.equal(claude.parser, 'claude');
  assert.deepEqual(claude.messages, [{ role: 'user', content: 'Q' }]);
});

test('two conversations are a hard error and are not hashed as one blob', () => {
  const raw = JSON.stringify([
    { title: 'A', messages: [{ role: 'user', content: 'one' }] },
    { title: 'B', messages: [{ role: 'user', content: 'two' }] },
  ]);
  assert.throws(() => parseImportedChat('codex', raw), (error: unknown) => {
    assert.ok(error instanceof MultiChatImportError);
    assert.equal((error as Error).message, 'Import one chat at a time.');
    return true;
  });
  assert.throws(() => parseImportedChat('claude', JSON.stringify({ conversations: [{}, {}] })), MultiChatImportError);
  assert.equal(raw.includes('one') && raw.includes('two'), true);
});

test('Claude human and assistant map, and text blocks join', () => {
  const parsed = parseImportedChat('claude', JSON.stringify({
    title: 'Fallback title',
    name: 'Brand',
    chat_messages: [
      { sender: 'human', content: [{ type: 'text', text: 'Where?' }, { type: 'tool_use', text: 'no' }, { type: 'text', text: 'Which doc?' }] },
      { sender: 'assistant', text: 'In Docs.' },
      { sender: 'system', text: 'ignore' },
    ],
  }));
  assert.equal(parsed.title, 'Brand');
  assert.deepEqual(parsed.messages, [
    { role: 'user', content: 'Where?\nWhich doc?' },
    { role: 'assistant', content: 'In Docs.' },
  ]);
});

test('plain text splits on speaker labels and otherwise stays one user message', () => {
  const split = parseImportedChat('text', 'You: hi\nstill you\nChatGPT: hello\nCodex: more');
  assert.equal(split.parserFallback, false);
  assert.deepEqual(split.messages, [
    { role: 'user', content: 'hi\nstill you' },
    { role: 'assistant', content: 'hello' },
    { role: 'assistant', content: 'more' },
  ]);
  const prose = parseImportedChat('text', 'Just prose\nwith lines');
  assert.deepEqual(prose.messages, [{ role: 'user', content: 'Just prose\nwith lines' }]);
  const jsonAsText = parseImportedChat('text', '{"messages":[{"role":"user","content":"Hi"}]}');
  assert.equal(jsonAsText.parser, 'text');
  assert.equal(jsonAsText.messages.length, 1);
  assert.match(jsonAsText.messages[0].content, /messages/);
});

test('invalid Codex JSON falls back to plain text and still has a transcript', () => {
  const parsed = parseImportedChat('codex', 'You: hi\nAssistant: there');
  assert.equal(parsed.parser, 'text');
  assert.equal(parsed.parserFallback, true);
  assert.equal(parsed.messages.length, 2);
  assert.ok(parsed.transcript.includes('user\nhi'));
  assert.ok(parsed.contentHash.length === 64);
});

test('the hash ignores title and timestamps, keeps case, and ignores line-ending noise', () => {
  const left = parseImportedChat('codex', JSON.stringify({
    title: 'A', created_at: 1, messages: [{ role: 'user', content: 'Same' }],
  }));
  const right = parseImportedChat('codex', JSON.stringify({
    title: 'B', created_at: 99, messages: [{ role: 'user', content: 'Same' }],
  }));
  const lower = parseImportedChat('codex', JSON.stringify({
    title: 'A', messages: [{ role: 'user', content: 'same' }],
  }));
  assert.equal(left.contentHash, right.contentHash);
  assert.notEqual(left.contentHash, lower.contentHash);
  assert.equal(
    chatContentHash([{ role: 'user', content: 'Hello \r\nWorld  \n' }]),
    chatContentHash([{ role: 'user', content: 'Hello \nWorld' }]),
  );
});

test('several null-parent Codex nodes walk in object key order', () => {
  const parsed = parseImportedChat('codex', JSON.stringify({
    mapping: {
      z: { parent: null, children: [], message: { role: 'user', content: 'second' } },
      a: { parent: null, children: [], message: { role: 'assistant', content: 'first' } },
    },
  }));
  assert.deepEqual(parsed.messages.map(message => message.content), ['second', 'first']);
});

test('title falls back to the first user message, then Imported chat', () => {
  const fromUser = parseImportedChat('text', `User: ${'x'.repeat(100)}`);
  assert.equal(fromUser.title, 'x'.repeat(80));
  const emptyLabel = parseImportedChat('codex', JSON.stringify({
    messages: [{ role: 'assistant', content: 'Only the assistant spoke' }],
  }));
  assert.equal(emptyLabel.title, 'Imported chat');
});

test('paste and file limits fail before any caller would insert', () => {
  assert.equal(importPasteError(''), { status: 400, error: 'Add a chat to import.' });
  assert.equal(importPasteError('   '), { status: 400, error: 'Add a chat to import.' });
  assert.equal(importPasteError('hello'), null);
  assert.equal(importPasteError('x'.repeat(IMPORT_CHAT_CHAR_LIMIT + 1)), {
    status: 413,
    error: 'Paste is limited to 200,000 characters.',
  });
  assert.equal(importFileError({ filename: 'notes.PDF', bytes: 10, text: 'hi' }), {
    status: 400,
    error: 'Use a .md, .txt, or .json file.',
  });
  assert.equal(importFileError({ filename: 'chat.JSON', bytes: 4, text: 'hi' }), null);
  assert.equal(importFileError({ filename: 'chat.txt', bytes: IMPORT_FILE_BYTE_LIMIT + 1, text: 'hi' }), {
    status: 413,
    error: 'File is limited to 5 MB.',
  });
  assert.equal(importFileError({ filename: 'chat.md', bytes: 4, text: null }), {
    status: 400,
    error: 'That file is not valid UTF-8 text.',
  });
  assert.equal(importFileError({ filename: 'chat.txt', bytes: 12, text: 'x'.repeat(IMPORT_CHAT_CHAR_LIMIT + 1) }), {
    status: 413,
    error: 'Chat is limited to 200,000 characters.',
  });
  assert.equal(decodeUtf8(new Uint8Array([0xff, 0xfe])), null);
  assert.equal(decodeUtf8(new TextEncoder().encode('You: hi')), 'You: hi');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/chat-import-parse.test.ts`

Expected: FAIL with `Cannot find module '../src/lib/chat-import-parse'`.

- [ ] **Step 3: Write the parser module**

Create `src/lib/chat-import-parse.ts`. Do not import the database, the model client, or React. Copy this module:

```ts
import { createHash } from 'node:crypto';

export const CHAT_IMPORT_SOURCES = ['codex', 'claude', 'text'] as const;
export type ChatImportSource = (typeof CHAT_IMPORT_SOURCES)[number];
export type ImportParser = 'codex' | 'claude' | 'text';
export type ImportMessage = { role: 'user' | 'assistant'; content: string };

export const IMPORT_CHAT_CHAR_LIMIT = 200_000;
export const IMPORT_FILE_BYTE_LIMIT = 5 * 1024 * 1024;

export class MultiChatImportError extends Error {
  constructor() {
    super('Import one chat at a time.');
    this.name = 'MultiChatImportError';
  }
}

export type ParsedChat = {
  title: string;
  messages: ImportMessage[];
  parser: ImportParser;
  parserFallback: boolean;
  transcript: string;
  contentHash: string;
};

const USER_LABELS = new Set(['you', 'user', 'human']);
const SPEAKER = /^(you|user|human|assistant|claude|chatgpt|codex):\s*(.*)$/i;

export function isChatImportSource(value: unknown): value is ChatImportSource {
  return typeof value === 'string' && (CHAT_IMPORT_SOURCES as readonly string[]).includes(value);
}

export function normalizeMessageContent(content: string): string {
  const normalized = content.normalize('NFKC').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
  const lines = normalized.split('\n');
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start += 1;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(start, end).join('\n');
}

export function canonicalTranscript(messages: ImportMessage[]): string {
  return messages.map(message => `${message.role}\n${normalizeMessageContent(message.content)}`).join('\n---\n');
}

export function chatContentHash(messages: ImportMessage[]): string {
  return createHash('sha256').update(canonicalTranscript(messages)).digest('hex');
}

function clipTitle(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  return trimmed.length > 80 ? trimmed.slice(0, 80).trimEnd() : trimmed;
}

function fallbackTitle(messages: ImportMessage[], exportTitle?: string): string {
  const fromExport = exportTitle ? clipTitle(exportTitle) : '';
  if (fromExport) return fromExport;
  const firstUser = messages.find(message => message.role === 'user');
  if (firstUser) {
    const clipped = clipTitle(firstUser.content);
    if (clipped) return clipped;
  }
  return 'Imported chat';
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return '';
  const record = content as { parts?: unknown; text?: unknown };
  if (Array.isArray(record.parts)) return record.parts.filter((part): part is string => typeof part === 'string').join('\n');
  if (typeof record.text === 'string') return record.text;
  return '';
}

function pushMessage(messages: ImportMessage[], role: unknown, content: unknown) {
  if (role !== 'user' && role !== 'assistant') return;
  const text = normalizeMessageContent(messageText(content));
  if (!text) return;
  messages.push({ role, content: text });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function oneConversation(value: unknown): Record<string, unknown> | 'multi' | null {
  if (Array.isArray(value)) {
    if (value.length !== 1) return 'multi';
    return asRecord(value[0]);
  }
  const record = asRecord(value);
  if (!record) return null;
  if (Array.isArray(record.conversations)) {
    if (record.conversations.length !== 1) return 'multi';
    return asRecord(record.conversations[0]);
  }
  return record;
}

function walkMapping(mapping: Record<string, unknown>): ImportMessage[] {
  const messages: ImportMessage[] = [];
  const visited = new Set<string>();
  const roots = Object.keys(mapping).filter(key => {
    const node = asRecord(mapping[key]);
    return Boolean(node && node.parent == null);
  });
  const visit = (key: string) => {
    if (visited.has(key)) return;
    visited.add(key);
    const node = asRecord(mapping[key]);
    if (!node) return;
    const message = asRecord(node.message);
    if (message) {
      const author = asRecord(message.author);
      const role = typeof message.role === 'string' ? message.role : author?.role;
      pushMessage(messages, role, message.content);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      if (typeof child === 'string') visit(child);
    }
  };
  for (const root of roots) visit(root);
  return messages;
}

function parseCodexConversation(record: Record<string, unknown>): { messages: ImportMessage[]; title?: string } {
  const title = typeof record.title === 'string' ? record.title : undefined;
  if (Array.isArray(record.messages)) {
    const messages: ImportMessage[] = [];
    for (const item of record.messages) {
      const message = asRecord(item);
      if (!message || typeof message.content !== 'string') continue;
      pushMessage(messages, message.role, message.content);
    }
    if (messages.length) return { messages, title };
  }
  const mapping = asRecord(record.mapping);
  if (mapping) return { messages: walkMapping(mapping), title };
  return { messages: [], title };
}

function parseClaudeConversation(record: Record<string, unknown>): { messages: ImportMessage[]; title?: string } {
  const named = typeof record.name === 'string' ? record.name : '';
  const titled = typeof record.title === 'string' ? record.title : '';
  const title = named || titled || undefined;
  const messages: ImportMessage[] = [];
  const rows = Array.isArray(record.chat_messages) ? record.chat_messages : [];
  for (const item of rows) {
    const message = asRecord(item);
    if (!message) continue;
    const sender = message.sender === 'human' ? 'user' : message.sender === 'assistant' ? 'assistant' : null;
    if (!sender) continue;
    if (typeof message.text === 'string' && message.text.trim()) {
      pushMessage(messages, sender, message.text);
      continue;
    }
    if (Array.isArray(message.content)) {
      const text = message.content.map(block => {
        const row = asRecord(block);
        if (!row || row.type !== 'text' || typeof row.text !== 'string') return '';
        return row.text;
      }).filter(Boolean).join('\n');
      pushMessage(messages, sender, text);
    }
  }
  return { messages, title };
}

function parsePlainText(raw: string): ImportMessage[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const messages: ImportMessage[] = [];
  let role: 'user' | 'assistant' | null = null;
  let buffer: string[] = [];
  let labeled = false;
  const flush = () => {
    if (!role) return;
    pushMessage(messages, role, buffer.join('\n'));
    buffer = [];
  };
  for (const line of lines) {
    const match = line.match(SPEAKER);
    if (match) {
      labeled = true;
      flush();
      role = USER_LABELS.has(match[1].toLowerCase()) ? 'user' : 'assistant';
      buffer = [match[2] ?? ''];
      continue;
    }
    if (role) buffer.push(line);
  }
  flush();
  if (!labeled || messages.length === 0) {
    const whole = normalizeMessageContent(raw);
    return whole ? [{ role: 'user', content: whole }] : [];
  }
  return messages;
}

function finish(parser: ImportParser, parserFallback: boolean, messages: ImportMessage[], exportTitle?: string): ParsedChat {
  return {
    title: fallbackTitle(messages, exportTitle),
    messages,
    parser,
    parserFallback,
    transcript: canonicalTranscript(messages),
    contentHash: chatContentHash(messages),
  };
}

export function parseImportedChat(source: ChatImportSource, raw: string): ParsedChat {
  if (source === 'text') return finish('text', false, parsePlainText(raw));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return finish('text', true, parsePlainText(raw));
  }
  const conversation = oneConversation(parsed);
  if (conversation === 'multi') throw new MultiChatImportError();
  if (!conversation) return finish('text', true, parsePlainText(raw));
  const extracted = source === 'codex' ? parseCodexConversation(conversation) : parseClaudeConversation(conversation);
  if (!extracted.messages.length) return finish('text', true, parsePlainText(raw));
  return finish(source, false, extracted.messages, extracted.title);
}

export function importPasteError(text: string): { status: 400 | 413; error: string } | null {
  if (text.length > IMPORT_CHAT_CHAR_LIMIT) return { status: 413, error: 'Paste is limited to 200,000 characters.' };
  if (!text.trim()) return { status: 400, error: 'Add a chat to import.' };
  return null;
}

export function importFileError(input: { filename: string; bytes: number; text: string | null }): { status: 400 | 413; error: string } | null {
  const name = input.filename.toLowerCase();
  if (!name.endsWith('.md') && !name.endsWith('.txt') && !name.endsWith('.json')) {
    return { status: 400, error: 'Use a .md, .txt, or .json file.' };
  }
  if (input.bytes > IMPORT_FILE_BYTE_LIMIT) return { status: 413, error: 'File is limited to 5 MB.' };
  if (input.text == null) return { status: 400, error: 'That file is not valid UTF-8 text.' };
  if (input.text.length > IMPORT_CHAT_CHAR_LIMIT) return { status: 413, error: 'Chat is limited to 200,000 characters.' };
  if (!input.text.trim()) return { status: 400, error: 'Add a chat to import.' };
  return null;
}

export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test tests/chat-import-parse.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-import-parse.ts tests/chat-import-parse.test.ts
git commit -m "Parse one imported chat and hash its transcript."
```

---

### Task 4: Filter the extract draft and window the model input

**Files:**
- Create: `src/lib/chat-import-extract.ts`
- Test: `tests/chat-import-extract.test.ts`

**Interfaces:**
- Consumes: `isMemoryKind`, `isSensitiveMemory`, `validateMemoryContent`, `AI_RESEARCH_MEMORY_MODEL` from `src/lib/ai-research-memory.ts`. Do not call `parseExtractedMemories`, `extractUserMemories`, or `indexQaTurn`.
- Produces:

```ts
export const IMPORT_FACT_LIMIT = 12;
export const IMPORT_QA_LIMIT = 8;
export const IMPORT_MODEL_CHAR_LIMIT = 24_000;
export const IMPORT_MODEL_EDGE = 12_000;
export const FACT_EXTRACTION_FAILED = 'Fact extraction failed.';
export const IMPORT_EXTRACT_SYSTEM: string;
export type ImportFactDraft = { id: string; kind: MemoryKind; content: string; confidence: number; included: true };
export type ImportQaDraft = { id: string; question: string; answerSummary: string; included: true };
export type ImportDraft = { facts: ImportFactDraft[]; qa: ImportQaDraft[] };
export function emptyImportDraft(): ImportDraft;
export function extractionInput(transcript: string): string;
export function parseImportExtraction(raw: string, createId?: () => string): ImportDraft | null;
export function readStoredDraft(value: unknown): ImportDraft;
export function validateImportQuestion(value: unknown): { ok: true; question: string } | { ok: false; error: string };
export function validateImportAnswer(value: unknown): { ok: true; answerSummary: string } | { ok: false; error: string };
export function requestImportDraft(input: {
  transcript: string;
  complete: (prompt: string) => Promise<string>;
  createId?: () => string;
}): Promise<{ ok: true; draft: ImportDraft } | { ok: false; error: typeof FACT_EXTRACTION_FAILED }>;
export function completeImportExtraction(userId: string, prompt: string): Promise<string>;
```

`parseImportExtraction` returns `null` for empty input or unparseable JSON. A parsed object with no usable rows returns `{ facts: [], qa: [] }`, which is success. `completeImportExtraction` calls `generateContent` from `src/lib/openai.ts` with the model options in Global Constraints and returns `result.content`. It does not window the prompt again; `requestImportDraft` passes `extractionInput(transcript)`.

- [ ] **Step 1: Write the failing test**

Create `tests/chat-import-extract.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseExtractedMemories } from '../src/lib/ai-research-memory';
import {
  FACT_EXTRACTION_FAILED,
  extractionInput,
  parseImportExtraction,
  readStoredDraft,
  requestImportDraft,
  validateImportAnswer,
  validateImportQuestion,
} from '../src/lib/chat-import-extract';

function ids(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

test('extraction keeps bounded facts and Q&A and drops sensitive or invalid rows', () => {
  const facts = Array.from({ length: 14 }, (_, index) => ({
    kind: index === 1 ? 'secret' : 'context',
    content: index === 2 ? 'my password is hunter2' : `Fact number ${index} about the user`,
    confidence: index === 3 ? 4 : index === 4 ? 'high' : 0.8,
  }));
  const qa = [
    { question: 'Where is the brand guide?', answerSummary: 'Internal Docs, Dupoin brand guideline.' },
    { question: 'Hi', answerSummary: 'Hello' },
    { question: 'What is the api key?', answerSummary: 'sk-abcdefghij' },
    ...Array.from({ length: 10 }, (_, index) => ({ question: `Reusable question ${index} here`, answerSummary: `Reusable answer ${index}` })),
  ];
  const draft = parseImportExtraction(JSON.stringify({ facts, qa }), ids());
  assert.ok(draft);
  assert.equal(draft.facts.length, 12);
  assert.equal(draft.facts[0].id, 'id-1');
  assert.equal(draft.facts[0].included, true);
  assert.equal(draft.facts.every(fact => fact.content.length >= 3 && fact.content.length <= 280), true);
  assert.equal(draft.facts.some(fact => fact.content.includes('password')), false);
  assert.equal(draft.facts[1].confidence, 1);
  assert.equal(draft.facts[2].confidence, 0.5);
  assert.equal(draft.qa.length, 8);
  assert.equal(draft.qa[0].question, 'Where is the brand guide?');
  assert.equal(draft.qa.some(row => row.answerSummary.includes('sk-')), false);
  assert.equal(parseImportExtraction(''), null);
  assert.equal(parseImportExtraction('not json'), null);
  assert.deepEqual(parseImportExtraction('{"memories":[{"kind":"role","content":"Engineer"}]}', ids()), { facts: [], qa: [] });
  const fenced = parseImportExtraction('```json\n{"facts":[{"kind":"role","content":"Frontend engineer","confidence":0.9}],"qa":[]}\n```', ids());
  assert.equal(fenced?.facts[0].content, 'Frontend engineer');
});

test('the model window keeps the ends of a long transcript and the stored text is not required to shrink', () => {
  const short = 'user\nHello';
  assert.equal(extractionInput(short), short);
  const transcript = `${'A'.repeat(12_000)}${'M'.repeat(10_000)}${'Z'.repeat(12_000)}`;
  assert.equal(transcript.length > 24_000, true);
  const windowed = extractionInput(transcript);
  assert.ok(windowed.startsWith('A'.repeat(12_000)));
  assert.ok(windowed.endsWith('Z'.repeat(12_000)));
  assert.match(windowed, /\n\.\.\.\[middle omitted\]\.\.\.\n/);
  assert.equal(windowed.includes('M'), false);
});

test('requestImportDraft sends the windowed prompt and turns model failure into the safe error', async () => {
  let seen = '';
  const ok = await requestImportDraft({
    transcript: `${'A'.repeat(12_000)}${'M'.repeat(10_000)}${'Z'.repeat(12_000)}`,
    complete: async prompt => {
      seen = prompt;
      return '{"facts":[{"kind":"role","content":"Works on Dupoin campaigns.","confidence":0.8}],"qa":[]}';
    },
    createId: () => 'fact-1',
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.draft.facts[0].content, 'Works on Dupoin campaigns.');
  assert.match(seen, /\[middle omitted\]/);
  const failed = await requestImportDraft({
    transcript: 'user\nHello',
    complete: async () => { throw new Error('timeout with transcript user Hello'); },
  });
  assert.deepEqual(failed, { ok: false, error: FACT_EXTRACTION_FAILED });
  const empty = await requestImportDraft({ transcript: 'user\nHello', complete: async () => '' });
  assert.deepEqual(empty, { ok: false, error: FACT_EXTRACTION_FAILED });
});

test('stored drafts keep their ids and question bounds match the live caps', () => {
  const draft = readStoredDraft({
    facts: [
      { id: 'keep', kind: 'interest', content: 'Likes short answers.', confidence: 0.4, included: false },
      { id: 'drop', kind: 'interest', content: 'password', confidence: 0.9 },
    ],
    qa: [{ id: 'qa-1', question: 'Where is the guide?', answerSummary: 'In Docs.', included: true }],
  });
  assert.deepEqual(draft.facts.map(fact => fact.id), ['keep']);
  assert.equal(draft.facts[0].included, true);
  assert.equal(draft.qa[0].id, 'qa-1');
  assert.equal(validateImportQuestion('Hi').ok, false);
  assert.equal(validateImportAnswer('').ok, false);
  const longAnswer = validateImportAnswer('x'.repeat(800));
  assert.equal(longAnswer.ok, true);
  if (longAnswer.ok) assert.equal(longAnswer.answerSummary.length, 500);
});

test('import extraction does not use the live 4-fact parser', async () => {
  const live = JSON.stringify({ memories: Array.from({ length: 6 }, (_, index) => ({ kind: 'context', content: `Live fact ${index} is long enough`, confidence: 0.9, explicit: true })) });
  assert.equal(parseExtractedMemories(live).length, 4);
  const extract = await readFile('src/lib/chat-import-extract.ts', 'utf8');
  assert.match(extract, /AI_RESEARCH_MEMORY_MODEL/);
  assert.match(extract, /temperature: 0\.1/);
  assert.match(extract, /maxTokens: 2000/);
  assert.match(extract, /jsonRepairAttempts: 0/);
  assert.match(extract, /taskType: 'ai-research'/);
  assert.doesNotMatch(extract, /parseExtractedMemories|extractUserMemories|indexQaTurn/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/chat-import-extract.test.ts`

Expected: FAIL with `Cannot find module '../src/lib/chat-import-extract'`.

- [ ] **Step 3: Write the extract module**

Create `src/lib/chat-import-extract.ts`.

`extractionInput`: if `transcript.length <= 24_000`, return it unchanged. Otherwise return `` `${transcript.slice(0, 12_000)}\n...[middle omitted]...\n${transcript.slice(-12_000)}` ``.

`parseImportExtraction`: strip a single surrounding ```json fence, `JSON.parse`, and return `null` on failure or when the value is not a non-array object. Read `facts` and `qa` only when they are arrays. For each fact, require `isMemoryKind`, collapse whitespace, slice to 280, drop length under 3, drop `isSensitiveMemory`, clamp confidence (non-finite becomes 0.5), set `included: true`, and stop at 12. For each Q&A, collapse and slice the question to 2,000 and the answer to 500, drop a question under 3 or an answer under 1, drop either side when `isSensitiveMemory` matches, set `included: true`, and stop at 8. Ids come from `createId`, default `uuidv4` from `uuid`.

`readStoredDraft` accepts an object or a JSON string. It keeps a string `id` already on the row and otherwise uses the same bounds. Stored `included` is ignored; the returned row always has `included: true`. Invalid JSON becomes `emptyImportDraft()`.

`validateImportQuestion` and `validateImportAnswer` collapse whitespace, slice to 2,000 and 500, and return `{ ok: false, error: 'Enter the question.' }`, `{ ok: false, error: 'Enter the answer summary.' }`, or `{ ok: false, error: "That memory can't be saved." }` when sensitive. These are the approve errors for Q&A. Facts keep using `validateMemoryContent`.

`IMPORT_EXTRACT_SYSTEM` is this exact prompt:

```ts
export const IMPORT_EXTRACT_SYSTEM = [
  'You extract durable memory from one imported chat.',
  'Return JSON: {"facts":[{"kind":"role","content":"string","confidence":0.8}],"qa":[{"question":"string","answerSummary":"string"}]}.',
  'kind is one of role, interest, preference, style, context.',
  'A fact is a durable statement about the user.',
  'Keep a Q&A pair only when the answer states a reusable fact, decision, preference, or procedure.',
  'Drop greetings and acknowledgements.',
].join('\n');
```

`requestImportDraft` calls `complete(extractionInput(transcript))` inside try/catch. A throw, a blank body, or `parseImportExtraction` returning `null` becomes `{ ok: false, error: FACT_EXTRACTION_FAILED }`. The catch must not put `error.message` into the result.

`completeImportExtraction(userId, prompt)` dynamically imports `./openai` and calls:

```ts
const result = await generateContent(IMPORT_EXTRACT_SYSTEM, prompt, userId, undefined, {
  model: AI_RESEARCH_MEMORY_MODEL,
  temperature: 0.1,
  maxTokens: 2000,
  responseFormat: { type: 'json_object' },
  jsonRepairAttempts: 0,
  taskType: 'ai-research',
});
return result.content;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test tests/chat-import-extract.test.ts tests/ai-research-memory.test.ts`

Expected: PASS. The live memory test still sees a 4-fact cap.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-import-extract.ts tests/chat-import-extract.test.ts
git commit -m "Filter imported-chat extract drafts."
```

---

### Task 5: Select the approved rows from the stored draft

**Files:**
- Modify: `src/lib/chat-import-extract.ts`
- Modify: `tests/chat-import-extract.test.ts`

**Interfaces:**
- Consumes: `ImportDraft`, `validateImportQuestion`, `validateImportAnswer`, `readStoredDraft`, and `validateMemoryContent`.
- Produces:

```ts
export type ApprovalFact = { id: string; kind: MemoryKind; content: string; confidence: number };
export type ApprovalQa = { id: string; question: string; answerSummary: string };
export function applyApproval(
  draft: ImportDraft,
  body: { facts?: unknown; qa?: unknown },
): { ok: true; facts: ApprovalFact[]; qa: ApprovalQa[] } | { ok: false; error: string };
```

A client id that is not in the draft returns `{ ok: false, error: 'That row is not in this draft.' }` and the caller writes nothing. A fact kind outside the five memory kinds returns `{ ok: false, error: 'Choose a memory kind.' }`. Omitted draft ids are unchecked. `facts` or `qa` omitted entirely means every row of that list is unchecked. An included row that fails validation returns that validator's error. Unchecked rows are not validated and are not returned. Confidence on `ApprovalFact` is the stored draft confidence, not a client field.

- [ ] **Step 1: Write the failing test**

Append to `tests/chat-import-extract.test.ts`:

```ts
import { applyApproval, type ImportDraft } from '../src/lib/chat-import-extract';

function draft(): ImportDraft {
  return {
    facts: [
      { id: 'f1', kind: 'context', content: 'Works on Dupoin campaigns.', confidence: 0.4, included: true },
      { id: 'f2', kind: 'role', content: 'Frontend engineer.', confidence: 0.9, included: true },
    ],
    qa: [
      { id: 'q1', question: 'Where is the brand guide?', answerSummary: 'Internal Docs.', included: true },
    ],
  };
}

test('approval keeps checked edits, drops omitted rows, and rejects unknown ids', () => {
  const selected = applyApproval(draft(), {
    facts: [{ id: 'f1', kind: 'interest', content: 'Works on Dupoin campaigns.', included: true }],
    qa: [{ id: 'q1', question: 'Where is the brand guide?', answerSummary: 'Internal Docs.', included: false }],
  });
  assert.equal(selected.ok, true);
  if (selected.ok) {
    assert.deepEqual(selected.facts, [{ id: 'f1', kind: 'interest', content: 'Works on Dupoin campaigns.', confidence: 0.4 }]);
    assert.deepEqual(selected.qa, []);
  }
  const unknown = applyApproval(draft(), {
    facts: [{ id: 'nope', kind: 'context', content: 'Works on Dupoin campaigns.', included: true }],
    qa: [],
  });
  assert.deepEqual(unknown, { ok: false, error: 'That row is not in this draft.' });
  const badKind = applyApproval(draft(), {
    facts: [{ id: 'f2', kind: 'secret', content: 'Frontend engineer.', included: false }],
    qa: [],
  });
  assert.deepEqual(badKind, { ok: false, error: 'Choose a memory kind.' });
  const sensitive = applyApproval(draft(), {
    facts: [{ id: 'f1', kind: 'context', content: 'my password is hunter2', included: true }],
    qa: [],
  });
  assert.equal(sensitive.ok, false);
  const none = applyApproval(draft(), {});
  assert.equal(none.ok, true);
  if (none.ok) assert.deepEqual(none, { ok: true, facts: [], qa: [] });
});
```

Place the `applyApproval` import on the existing import from `../src/lib/chat-import-extract` instead of adding a second import.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/chat-import-extract.test.ts`

Expected: FAIL with `applyApproval` is not exported.

- [ ] **Step 3: Implement `applyApproval`**

In `src/lib/chat-import-extract.ts`:

```ts
export interface ApprovalFact {
  id: string;
  kind: MemoryKind;
  content: string;
  confidence: number;
}

export interface ApprovalQa {
  id: string;
  question: string;
  answerSummary: string;
}

export function applyApproval(
  draft: ImportDraft,
  body: { facts?: unknown; qa?: unknown },
): { ok: true; facts: ApprovalFact[]; qa: ApprovalQa[] } | { ok: false; error: string } {
  const factItems = body.facts === undefined ? [] : body.facts;
  const qaItems = body.qa === undefined ? [] : body.qa;
  if (!Array.isArray(factItems) || !Array.isArray(qaItems)) {
    return { ok: false, error: 'That row is not in this draft.' };
  }
  const factById = new Map(draft.facts.map(fact => [fact.id, fact]));
  const qaById = new Map(draft.qa.map(row => [row.id, row]));
  const facts: ApprovalFact[] = [];
  const qa: ApprovalQa[] = [];
  for (const item of factItems) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'That row is not in this draft.' };
    const row = item as { id?: unknown; kind?: unknown; content?: unknown; included?: unknown };
    if (typeof row.id !== 'string' || !factById.has(row.id)) return { ok: false, error: 'That row is not in this draft.' };
    if (!isMemoryKind(row.kind)) return { ok: false, error: 'Choose a memory kind.' };
    if (row.included !== true) continue;
    const validated = validateMemoryContent(row.content);
    if (!validated.ok) return { ok: false, error: validated.error };
    facts.push({
      id: row.id,
      kind: row.kind,
      content: validated.content,
      confidence: factById.get(row.id)!.confidence,
    });
  }
  for (const item of qaItems) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'That row is not in this draft.' };
    const row = item as { id?: unknown; question?: unknown; answerSummary?: unknown; included?: unknown };
    if (typeof row.id !== 'string' || !qaById.has(row.id)) return { ok: false, error: 'That row is not in this draft.' };
    if (row.included !== true) continue;
    const question = validateImportQuestion(row.question);
    if (!question.ok) return { ok: false, error: question.error };
    const answer = validateImportAnswer(row.answerSummary);
    if (!answer.ok) return { ok: false, error: answer.error };
    qa.push({ id: row.id, question: question.question, answerSummary: answer.answerSummary });
  }
  return { ok: true, facts, qa };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test tests/chat-import-extract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-import-extract.ts tests/chat-import-extract.test.ts
git commit -m "Select approved import rows from the stored draft."
```

---

### Task 6: Describe the imported-chat graph node and its learned-from edges

**Files:**
- Create: `src/lib/chat-import-graph.ts`
- Modify: `tests/chat-import-graph.test.ts`

**Interfaces:**
- Consumes: `IMPORTED_CHAT_TASK_TYPE`, `knowledgeEmbeddingInput`, `PlannedEdge` from `src/lib/ai-research-memory-graph.ts`.
- Produces:

```ts
export const IMPORTED_CHAT_GRAPH_BRIEF_LIMIT = 240;
export const IMPORTED_CHAT_GRAPH_TEXT_LIMIT = 8_000;
export const IMPORTED_CHAT_QUALITY_SCORE = 0.7;
export function importedChatNodeFields(input: {
  id: string;
  title: string;
  transcript: string;
  contentHash: string;
  knowledgeEntryId: string;
}): {
  id: string;
  taskType: typeof IMPORTED_CHAT_TASK_TYPE;
  taskId: string;
  brief: string;
  selectedOutput: string;
  conversationId: null;
  qualityScore: 0.7;
  contentHash: string;
  embeddingInput: string;
};
export function planImportLearnedFromEdges(input: { importNodeId: string; sourceNodeIds: string[] }): PlannedEdge[];
export function isUniqueViolation(error: unknown): boolean;
export const INSERT_IMPORTED_CHAT_NODE_SQL: string;
```

`planImportLearnedFromEdges` returns one edge per non-empty source id, including when there are more than 8. `sourceId` is the memory or Q&A node. `targetId` is the import node. `relationship` is `learned_from`. `weight` is `1`. Do not call `postgresGraphStore.save`; that helper writes `task_id` into `content_hash`.

- [ ] **Step 1: Write the failing test**

Add these imports to the top of `tests/chat-import-graph.test.ts`, then append the two tests:

```ts
import {
  INSERT_IMPORTED_CHAT_NODE_SQL,
  importedChatNodeFields,
  isUniqueViolation,
  planImportLearnedFromEdges,
} from '../src/lib/chat-import-graph';

test('the imported chat node stores the transcript hash and a short prefix', () => {
  const fields = importedChatNodeFields({
    id: 'import-1',
    title: ` ${'T'.repeat(300)} `,
    transcript: 'Z'.repeat(9_000),
    contentHash: 'abc123',
    knowledgeEntryId: 'node-1',
  });
  assert.equal(fields.id, 'node-1');
  assert.equal(fields.taskId, 'import-1');
  assert.equal(fields.taskType, 'imported-chat');
  assert.equal(fields.conversationId, null);
  assert.equal(fields.qualityScore, 0.7);
  assert.equal(fields.contentHash, 'abc123');
  assert.notEqual(fields.contentHash, fields.taskId);
  assert.equal(fields.brief.length, 240);
  assert.equal(fields.selectedOutput.length, 8_000);
  assert.equal(fields.embeddingInput, `${fields.brief}\n${fields.selectedOutput}`);
  assert.match(INSERT_IMPORTED_CHAT_NODE_SQL, /INSERT INTO knowledge_entries/);
  assert.match(INSERT_IMPORTED_CHAT_NODE_SQL, /content_hash/);
  assert.match(INSERT_IMPORTED_CHAT_NODE_SQL, /task_id/);
});

test('learned_from edges point at the import node with no cap of 8', () => {
  const edges = planImportLearnedFromEdges({
    importNodeId: 'node-1',
    sourceNodeIds: Array.from({ length: 9 }, (_, index) => `mem-${index}`),
  });
  assert.equal(edges.length, 9);
  assert.deepEqual(edges[8], { sourceId: 'mem-8', targetId: 'node-1', relationship: 'learned_from', weight: 1 });
  assert.equal(isUniqueViolation({ code: '23505' }), true);
  assert.equal(isUniqueViolation({ code: '23503' }), false);
  assert.equal(isUniqueViolation(new Error('duplicate')), false);
});
```

The behavior test is `fields.contentHash !== fields.taskId`. The INSERT may name both `task_id` and `content_hash`; the value bound to `content_hash` is the transcript hash.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/chat-import-graph.test.ts`

Expected: FAIL with `Cannot find module '../src/lib/chat-import-graph'`.

- [ ] **Step 3: Write the graph helper**

Create `src/lib/chat-import-graph.ts`:

```ts
import { IMPORTED_CHAT_TASK_TYPE } from './knowledge-task-types';
import { knowledgeEmbeddingInput } from './embeddings';
import type { PlannedEdge } from './ai-research-memory-graph';

export const IMPORTED_CHAT_GRAPH_BRIEF_LIMIT = 240;
export const IMPORTED_CHAT_GRAPH_TEXT_LIMIT = 8_000;
export const IMPORTED_CHAT_QUALITY_SCORE = 0.7;

export const INSERT_IMPORTED_CHAT_NODE_SQL = `
  INSERT INTO knowledge_entries (
    id, user_id, brief, task_type, selected_output, rejected_outputs, embedding,
    conversation_id, quality_score, task_id, content_hash
  ) VALUES (?, ?, ?, ?, ?, '[]', ?, NULL, ?, ?, ?)
`;

export function importedChatNodeFields(input: {
  id: string;
  title: string;
  transcript: string;
  contentHash: string;
  knowledgeEntryId: string;
}) {
  const brief = input.title.replace(/\s+/g, ' ').trim().slice(0, IMPORTED_CHAT_GRAPH_BRIEF_LIMIT) || 'Imported chat';
  const selectedOutput = input.transcript.slice(0, IMPORTED_CHAT_GRAPH_TEXT_LIMIT);
  return {
    id: input.knowledgeEntryId,
    taskType: IMPORTED_CHAT_TASK_TYPE,
    taskId: input.id,
    brief,
    selectedOutput,
    conversationId: null as null,
    qualityScore: IMPORTED_CHAT_QUALITY_SCORE as 0.7,
    contentHash: input.contentHash,
    embeddingInput: knowledgeEmbeddingInput(IMPORTED_CHAT_TASK_TYPE, brief, selectedOutput),
  };
}

export function planImportLearnedFromEdges(input: { importNodeId: string; sourceNodeIds: string[] }): PlannedEdge[] {
  const edges: PlannedEdge[] = [];
  for (const sourceId of input.sourceNodeIds) {
    if (!sourceId || sourceId === input.importNodeId) continue;
    edges.push({ sourceId, targetId: input.importNodeId, relationship: 'learned_from', weight: 1 });
  }
  return edges;
}

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '23505');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test tests/chat-import-graph.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-import-graph.ts tests/chat-import-graph.test.ts
git commit -m "Describe the imported-chat graph node."
```

---

### Task 7: Save, list, and read an import

**Files:**
- Create: `src/lib/chat-import.ts`
- Create: `src/app/api/ai-research/imports/route.ts`
- Create: `src/app/api/ai-research/imports/[id]/route.ts`
- Create: `tests/chat-import-deps.ts`
- Create: `tests/chat-import.test.ts`

**Interfaces:**
- Consumes: `parseImportedChat`, `MultiChatImportError`, `ChatImportSource`, `isChatImportSource`, `importPasteError`, `importFileError`, `decodeUtf8`, `IMPORT_FILE_BYTE_LIMIT` from `src/lib/chat-import-parse.ts`; `emptyImportDraft`, `readStoredDraft`, `requestImportDraft`, `FACT_EXTRACTION_FAILED`, `ImportDraft` from `src/lib/chat-import-extract.ts`; `importedChatNodeFields`, `INSERT_IMPORTED_CHAT_NODE_SQL`, `isUniqueViolation` from `src/lib/chat-import-graph.ts`.
- Produces the types and functions below. Task 8 and Task 9 add `approveChatImport`, `cancelChatImport`, and `retryChatImport` to this same module. This task's module must already export `ChatImportDeps` with the methods those tasks call, even if approve/cancel/retry are not implemented yet. Include the method signatures on the interface now, and implement `findMemory`, `bumpMemory`, `writeMemory`, `findQa`, `writeQa`, `mirrorMemory`, `mirrorQa`, `linkLearnedFrom`, and `markApproved` on the Postgres deps and the test double so Task 8 only adds the orchestrator.

```ts
export type ChatImportStatus = 'review' | 'extract_failed' | 'approved' | 'chat_only';
export interface ApproveCounts {
  factsSaved: number;
  factsAlreadySaved: number;
  qaSaved: number;
  qaAlreadySaved: number;
}
export interface ChatImportRow {
  id: string;
  userId: string;
  source: ChatImportSource;
  parser: ImportParser;
  parserFallback: boolean;
  title: string;
  transcript: string;
  contentHash: string;
  status: ChatImportStatus;
  draft: ImportDraft;
  knowledgeEntryId: string | null;
  error: string | null;
  approveResult: ApproveCounts | null;
  createdAt: string;
}
export interface PublicImport {
  id: string;
  source: ChatImportSource;
  parser: ImportParser;
  parserFallback: boolean;
  title: string;
  status: ChatImportStatus;
  knowledgeEntryId: string | null;
  memoryEnabled: boolean;
  draft: ImportDraft;
  error: string | null;
}
export interface PublicImportListItem {
  id: string;
  title: string;
  status: ChatImportStatus;
  source: ChatImportSource;
  parserFallback: boolean;
  createdAt: string;
  knowledgeEntryId: string | null;
}
export interface PublicImportDetail extends PublicImport { transcript: string }
export interface ChatImportDeps {
  createId(): string;
  isMemoryEnabled(userId: string): Promise<boolean>;
  findByHash(userId: string, contentHash: string): Promise<ChatImportRow | null>;
  findById(userId: string, id: string): Promise<ChatImportRow | null>;
  list(userId: string): Promise<ChatImportRow[]>;
  insertSavedChat(row: ChatImportRow): Promise<'inserted' | 'duplicate'>;
  saveDraft(userId: string, id: string, draft: ImportDraft): Promise<void>;
  saveExtractFailure(userId: string, id: string): Promise<void>;
  findMemory(userId: string, contentHash: string): Promise<{ id: string; mentionCount: number } | null>;
  bumpMemory(userId: string, id: string): Promise<void>;
  writeMemory(row: { id: string; userId: string; kind: MemoryKind; content: string; contentHash: string; mentionCount: number; confidence: number }): Promise<string>;
  findQa(userId: string, questionNorm: string): Promise<{ id: string } | null>;
  writeQa(row: { id: string; userId: string; question: string; questionNorm: string; answerSummary: string }): Promise<string>;
  mirrorMemory(input: { userId: string; memoryId: string; kind: string; content: string; embedding: number[] | null }): Promise<string | null>;
  mirrorQa(input: { userId: string; qaId: string; question: string; answerSummary: string; embedding: number[] | null }): Promise<string | null>;
  linkLearnedFrom(sourceNodeId: string, importNodeId: string): Promise<void>;
  markApproved(userId: string, id: string, result: ApproveCounts): Promise<void>;
  markChatOnly(userId: string, id: string): Promise<void>;
  embed(text: string): Promise<number[]>;
  complete(userId: string, prompt: string): Promise<string>;
  log(id: string, status: string): void;
}
export function presentImport(row: ChatImportRow, memoryEnabled: boolean): PublicImport;
export function presentImportDetail(row: ChatImportRow, memoryEnabled: boolean): PublicImportDetail;
export function presentImportListItem(row: ChatImportRow): PublicImportListItem;
export function createChatImport(userId: string, source: ChatImportSource, raw: string, deps: ChatImportDeps): Promise<ChatImportResult>;
export function listChatImports(userId: string, deps: ChatImportDeps): Promise<PublicImportListItem[]>;
export function readChatImport(userId: string, id: string, deps: ChatImportDeps): Promise<ChatImportResult>;
export function postgresChatImportDeps(): ChatImportDeps;
export const LIST_CHAT_IMPORTS_SQL: string;
export const READ_CHAT_IMPORT_SQL: string;
export const INSERT_CHAT_IMPORT_SQL: string;
export const SAVE_DRAFT_SQL: string;
export const SAVE_EXTRACT_FAILURE_SQL: string;
```

`ChatImportResult` is `{ ok: true; status: 200; body: Record<string, unknown> } | { ok: false; status: 400 | 404 | 409; body: { error: string; existingImportId?: string; knowledgeEntryId?: string | null } }`.

Create commits the graph node and the `chat_imports` row in one transaction with status `extract_failed`, an empty draft, and `error` null, then runs extraction. Success updates status to `review` and stores the draft. Failure sets `error` to `Fact extraction failed.` and leaves `extract_failed`. A duplicate hash returns 409 `{ error: 'This chat is already imported.', existingImportId, knowledgeEntryId }` both when `findByHash` hits first and when `insertSavedChat` returns `'duplicate'`. The response `import` object does not include `transcript`. `readChatImport` does. List rows do not include `transcript` or `draft`.

- [ ] **Step 1: Write the failing test**

Create `tests/chat-import-deps.ts` with this harness. `findByHash` and `findById` filter on `userId`. `list` sorts that user's rows by `createdAt` descending. `insertSavedChat` returns `'duplicate'` when that user already has `contentHash`.

```ts
import { emptyImportDraft } from '../src/lib/chat-import-extract';
import type { ApproveCounts, ChatImportDeps, ChatImportRow } from '../src/lib/chat-import';
import type { MemoryKind } from '../src/lib/ai-research-memory';

type Memory = { id: string; userId: string; kind: MemoryKind; content: string; contentHash: string; mentionCount: number; confidence: number };
type Qa = { id: string; userId: string; questionNorm: string };

export function createMemoryImportDeps() {
  const rows: ChatImportRow[] = [];
  const memories: Memory[] = [];
  const qa: Qa[] = [];
  const mirrors: unknown[] = [];
  const edges: Array<{ sourceNodeId: string; importNodeId: string }> = [];
  const logs: Array<{ id: string; status: string }> = [];
  let enabled = true;
  let seq = 0;
  const deps: ChatImportDeps = {
    createId: () => `id-${++seq}`,
    isMemoryEnabled: async () => enabled,
    findByHash: async (userId, contentHash) => rows.find(row => row.userId === userId && row.contentHash === contentHash) || null,
    findById: async (userId, id) => rows.find(row => row.userId === userId && row.id === id) || null,
    list: async userId => rows.filter(row => row.userId === userId).slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    insertSavedChat: async row => {
      if (rows.some(item => item.userId === row.userId && item.contentHash === row.contentHash)) return 'duplicate';
      rows.push(row);
      return 'inserted';
    },
    saveDraft: async (userId, id, draft) => {
      const row = rows.find(item => item.userId === userId && item.id === id);
      if (!row) return;
      row.status = 'review';
      row.draft = draft;
      row.error = null;
    },
    saveExtractFailure: async (userId, id) => {
      const row = rows.find(item => item.userId === userId && item.id === id);
      if (!row) return;
      row.status = 'extract_failed';
      row.draft = emptyImportDraft();
      row.error = 'Fact extraction failed.';
    },
    findMemory: async (userId, contentHash) => {
      const row = memories.find(item => item.userId === userId && item.contentHash === contentHash);
      return row ? { id: row.id, mentionCount: row.mentionCount } : null;
    },
    bumpMemory: async (userId, id) => {
      const row = memories.find(item => item.userId === userId && item.id === id);
      if (row) row.mentionCount += 1;
    },
    writeMemory: async row => {
      memories.push({ ...row });
      return row.id;
    },
    findQa: async (userId, questionNorm) => qa.find(item => item.userId === userId && item.questionNorm === questionNorm) || null,
    writeQa: async row => {
      qa.push({ id: row.id, userId: row.userId, questionNorm: row.questionNorm });
      return row.id;
    },
    mirrorMemory: async input => {
      mirrors.push(input);
      return `node-${input.memoryId}`;
    },
    mirrorQa: async input => {
      mirrors.push(input);
      return `node-${input.qaId}`;
    },
    linkLearnedFrom: async (sourceNodeId, importNodeId) => {
      edges.push({ sourceNodeId, importNodeId });
    },
    markApproved: async (userId, id, result: ApproveCounts) => {
      const row = rows.find(item => item.userId === userId && item.id === id);
      if (!row) return;
      row.status = 'approved';
      row.draft = emptyImportDraft();
      row.error = null;
      row.approveResult = result;
    },
    markChatOnly: async (userId, id) => {
      const row = rows.find(item => item.userId === userId && item.id === id);
      if (!row || (row.status !== 'review' && row.status !== 'extract_failed')) return;
      row.status = 'chat_only';
      row.draft = emptyImportDraft();
      row.error = null;
    },
    embed: async () => [],
    complete: async () => '{"facts":[],"qa":[]}',
    log: (id, status) => { logs.push({ id, status }); },
  };
  return { deps, rows, memories, qa, mirrors, edges, logs, setEnabled: (value: boolean) => { enabled = value; } };
}
```

Create `tests/chat-import.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createChatImport, listChatImports, readChatImport } from '../src/lib/chat-import';
import { createMemoryImportDeps } from './chat-import-deps';

const codex = JSON.stringify({
  title: 'Campaign voice',
  created_at: 5,
  messages: [
    { role: 'user', content: 'How should Dupoin campaigns sound?' },
    { role: 'assistant', content: 'Use a direct voice.' },
  ],
});

test('create saves the chat before extract and hides the transcript', async () => {
  const harness = createMemoryImportDeps();
  harness.deps.complete = async () => '{"facts":[{"kind":"style","content":"Prefers a direct voice.","confidence":0.9}],"qa":[]}';
  const result = await createChatImport('user-a', 'codex', codex, harness.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, 200);
  const body = result.body.import as { status: string; transcript?: string; parserFallback: boolean; title: string; draft: { facts: Array<{ content: string }> }; knowledgeEntryId: string };
  assert.equal(body.status, 'review');
  assert.equal(body.title, 'Campaign voice');
  assert.equal(body.parserFallback, false);
  assert.equal(body.transcript, undefined);
  assert.equal(body.draft.facts[0].content, 'Prefers a direct voice.');
  assert.equal(harness.rows.length, 1);
  assert.equal(harness.rows[0].transcript.includes('Dupoin'), true);
  assert.equal(harness.rows[0].knowledgeEntryId, body.knowledgeEntryId);
  assert.deepEqual(harness.logs.map(entry => entry.status), ['extract_failed', 'review']);
  assert.equal(JSON.stringify(harness.logs).includes('Dupoin'), false);
});

test('extract failure still returns the saved chat', async () => {
  const harness = createMemoryImportDeps();
  harness.deps.complete = async () => { throw new Error('boom'); };
  const result = await createChatImport('user-a', 'text', 'Just a note for later.', harness.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const body = result.body.import as { status: string; error: string; draft: { facts: unknown[] } };
  assert.equal(body.status, 'extract_failed');
  assert.equal(body.error, 'Fact extraction failed.');
  assert.deepEqual(body.draft.facts, []);
  assert.equal(harness.rows.length, 1);
});

test('the same hash is a duplicate for one user and a new import for another, including a concurrent insert', async () => {
  const harness = createMemoryImportDeps();
  harness.deps.complete = async () => '{"facts":[],"qa":[]}';
  const first = await createChatImport('user-a', 'text', 'Same transcript', harness.deps);
  const second = await createChatImport('user-a', 'text', 'Same transcript', harness.deps);
  const other = await createChatImport('user-b', 'text', 'Same transcript', harness.deps);
  assert.equal(second.ok, false);
  if (second.ok || first.ok === false) return;
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'This chat is already imported.');
  assert.equal(second.body.existingImportId, (first.body.import as { id: string }).id);
  assert.equal(other.ok, true);
  assert.equal(harness.rows.length, 2);

  const race = createMemoryImportDeps();
  const existing = harness.rows[0];
  race.rows.push({ ...existing, userId: 'user-c' });
  let lookups = 0;
  race.deps.findByHash = async (userId, contentHash) => {
    lookups += 1;
    if (lookups === 1) return null;
    return race.rows.find(row => row.userId === userId && row.contentHash === contentHash) || null;
  };
  race.deps.insertSavedChat = async () => 'duplicate';
  const raced = await createChatImport('user-c', 'text', 'Same transcript', race.deps);
  assert.equal(raced.ok, false);
  if (!raced.ok) assert.equal(raced.body.existingImportId, existing.id);
});

test('multi-chat JSON writes nothing', async () => {
  const harness = createMemoryImportDeps();
  const result = await createChatImport('user-a', 'codex', JSON.stringify([{ title: 'A' }, { title: 'B' }]), harness.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.body.error, 'Import one chat at a time.');
  assert.equal(harness.rows.length, 0);
});

test('list and read are owner-only and only the detail includes the transcript', async () => {
  const harness = createMemoryImportDeps();
  harness.deps.complete = async () => '{"facts":[],"qa":[]}';
  const created = await createChatImport('user-a', 'text', 'Owner note', harness.deps);
  if (!created.ok) return;
  const id = (created.body.import as { id: string }).id;
  const list = await listChatImports('user-a', harness.deps);
  assert.equal(list.length, 1);
  assert.equal('transcript' in list[0], false);
  assert.equal('draft' in list[0], false);
  const missing = await readChatImport('user-b', id, harness.deps);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.body.error, 'Import was not found.');
  const detail = await readChatImport('user-a', id, harness.deps);
  assert.equal(detail.ok, true);
  if (detail.ok) assert.equal((detail.body.import as { transcript: string }).transcript.includes('Owner note'), true);
});

test('route SQL binds user_id and limits run before insert', async () => {
  const lib = await readFile('src/lib/chat-import.ts', 'utf8');
  const route = await readFile('src/app/api/ai-research/imports/route.ts', 'utf8');
  const detail = await readFile('src/app/api/ai-research/imports/[id]/route.ts', 'utf8');
  for (const name of ['LIST_CHAT_IMPORTS_SQL', 'READ_CHAT_IMPORT_SQL', 'INSERT_CHAT_IMPORT_SQL', 'SAVE_DRAFT_SQL', 'SAVE_EXTRACT_FAILURE_SQL']) {
    assert.match(lib, new RegExp(`${name}[\\s\\S]{0,240}user_id = \\?`));
  }
  assert.match(route, /requireFeature\(request, 'ai-research'\)/);
  assert.match(detail, /requireFeature\(request, 'ai-research'\)/);
  assert.match(route, /Choose a source\./);
  assert.match(route, /Send the chat as JSON or as a file\./);
  const paste = route.indexOf('importPasteError');
  const parse = route.indexOf('parseImportedChat');
  const insert = route.indexOf('createChatImport');
  assert.ok(paste !== -1 && paste < parse && parse < insert);
  const size = route.indexOf('file.size');
  const buffer = route.indexOf('arrayBuffer');
  assert.ok(size !== -1 && buffer !== -1 && size < buffer);
  assert.doesNotMatch(route, /file\.name[\s\S]{0,80}title/);
  assert.doesNotMatch(`${route}\n${detail}\n${lib}`, /console\.(info|warn|error)\([^)]*transcript/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/chat-import.test.ts`

Expected: FAIL with `Cannot find module '../src/lib/chat-import'`.

- [ ] **Step 3: Implement the store and the two routes**

`createChatImport`:

`isMemoryEnabled` is read only to set `memoryEnabled` on the response. Do not skip create, extract, or approve when memory is off.

1. `parseImportedChat(source, raw)`. On `MultiChatImportError`, return 400 `{ error: 'Import one chat at a time.' }`.
2. `findByHash`. On a row, return the 409 body. Do not call `complete`.
3. Build a row with `createId()` for the import id and another `createId()` for `knowledgeEntryId`, status `extract_failed`, `emptyImportDraft()`, `error: null`, `approveResult: null`, `createdAt` from `new Date().toISOString()`.
4. `insertSavedChat`. On `'duplicate'`, `findByHash` again and return 409. If the re-read misses, return 409 with `existingImportId` equal to the id from the race row when present, otherwise 404 `Import was not found.`
5. `log(id, 'extract_failed')`.
6. `requestImportDraft({ transcript, complete: prompt => deps.complete(userId, prompt) })`.
7. On failure, `saveExtractFailure`, `log(id, 'extract_failed')`, return 200 with the import in `extract_failed` and `error: FACT_EXTRACTION_FAILED`.
8. On success, `saveDraft`, `log(id, 'review')`, return 200 with status `review` and the draft. `presentImport` omits `transcript`. Include `memoryEnabled` from `deps.isMemoryEnabled`.

`postgresChatImportDeps` uses `queryOne` / `queryAll` / `execute` / `executeTransaction` from `src/lib/database.ts`. `insertSavedChat` computes `importedChatNodeFields`, then `getEmbedding(fields.embeddingInput)` before the transaction. Inside `executeTransaction`, insert the knowledge row with `INSERT_IMPORTED_CHAT_NODE_SQL` and values `[knowledgeEntryId, userId, brief, taskType, selectedOutput, JSON.stringify(embedding), qualityScore, taskId, contentHash]`, then insert `chat_imports`. Catch `isUniqueViolation` and return `'duplicate'`. `complete` calls `completeImportExtraction`. `log` is `console.info('[ai-research] chat import', { id, status })`. `embed` calls `getEmbedding`. Memory writes in this task can be implemented now:

- `findMemory`: `SELECT id, mention_count FROM user_memories WHERE user_id = ? AND content_hash = ?`
- `bumpMemory`: `UPDATE user_memories SET mention_count = mention_count + 1, updated_at = NOW() WHERE id = ? AND user_id = ?`
- `writeMemory`: `INSERT INTO user_memories (id, user_id, kind, content, content_hash, embedding, source_conversation_id, mention_count, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NOW(), NOW())`. Let a `23505` error propagate. Do not bump inside `writeMemory`. `approveChatImport` catches `isUniqueViolation`, re-reads with `findMemory`, calls `bumpMemory`, and counts `factsAlreadySaved`.
- `findQa`: `SELECT id FROM ai_research_qa_index WHERE user_id = ? AND question_norm = ? LIMIT 1`
- `writeQa`: `INSERT INTO ai_research_qa_index (id, user_id, conversation_id, question, question_norm, answer_summary, sources, embedding, created_at) VALUES (?, ?, NULL, ?, ?, ?, '[]'::jsonb, ?, NOW())`
- `mirrorMemory` calls `mirrorUserMemory({ ...input, conversationId: null })` and returns its node id. On throw, `console.warn('[ai-research] chat import', { id: input.memoryId, status: 'mirror_failed' })` and return `null`. Do not include `content` in the warning.
- `mirrorQa` calls `mirrorQaTurn({ ...input, conversationId: null })` with the same catch.
- `linkLearnedFrom` inserts `knowledge_edges` with relationship `learned_from` and weight `1` when neither direction already exists. Copy the existence check from `edgeExists` in `src/lib/ai-research-memory-graph.ts`.
- `markApproved` runs `UPDATE chat_imports SET status = 'approved', draft = '{"facts":[],"qa":[]}'::jsonb, error = NULL, approve_result = ?::jsonb, updated_at = NOW() WHERE id = ? AND user_id = ?`
- `markChatOnly` runs `UPDATE chat_imports SET status = 'chat_only', draft = '{"facts":[],"qa":[]}'::jsonb, error = NULL, updated_at = NOW() WHERE id = ? AND user_id = ? AND status IN ('review', 'extract_failed')`

Export the SQL constants with `user_id = ?` in each statement named in the test.

`src/app/api/ai-research/imports/route.ts` follows `src/app/api/ai-research/memory/route.ts`: `requireFeature(request, 'ai-research')`, then `json({ error: auth.error }, auth.status)`. `GET` returns `{ imports: await listChatImports(auth.id, postgresChatImportDeps()) }`. `POST` reads `content-type`. JSON requires `{ source, text }` and calls `importPasteError` before `parseImportedChat` / `createChatImport`. Multipart reads fields `source` and `file`. Missing or unknown source returns 400 `Choose a source.` Wrong content type, unreadable JSON, or a missing file returns 400 `Send the chat as JSON or as a file.` When `file.size > IMPORT_FILE_BYTE_LIMIT`, return 413 `File is limited to 5 MB.` before `arrayBuffer()`. Otherwise decode with `decodeUtf8` and pass the result through `importFileError`. The filename is only an argument to `importFileError`. `createChatImport` receives the decoded text, never the filename.

`src/app/api/ai-research/imports/[id]/route.ts` uses `type RouteContext = { params: Promise<{ id: string }> }` like `src/app/api/internal-docs/[id]/route.ts`. `GET` loads `(await context.params).id` through `readChatImport(auth.id, id, postgresChatImportDeps())`. 404 when `ok` is false.

Map database rows with `readStoredDraft` for `draft`. `parser_fallback` becomes `parserFallback`. Do not put `role` on any import response.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test tests/chat-import.test.ts tests/chat-import-parse.test.ts tests/chat-import-extract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-import.ts src/app/api/ai-research/imports/route.ts src/app/api/ai-research/imports/\[id\]/route.ts tests/chat-import-deps.ts tests/chat-import.test.ts
git commit -m "Save and read a user's imported chat."
```

---

### Task 8: Approve and cancel

**Files:**
- Modify: `src/lib/chat-import.ts`
- Create: `src/app/api/ai-research/imports/[id]/approve/route.ts`
- Create: `src/app/api/ai-research/imports/[id]/cancel/route.ts`
- Modify: `tests/chat-import.test.ts`

**Interfaces:**
- Consumes: `ChatImportDeps`, `ChatImportRow`, `ApproveCounts`, `applyApproval`, `memoryContentHash`, `normalizeQuestion`, `planImportLearnedFromEdges`.
- Produces:

```ts
export function approveChatImport(userId: string, id: string, body: { facts?: unknown; qa?: unknown }, deps: ChatImportDeps): Promise<ChatImportResult>;
export function cancelChatImport(userId: string, id: string, deps: ChatImportDeps): Promise<ChatImportResult>;
export const APPROVE_CHAT_IMPORT_SQL: string;
export const CANCEL_CHAT_IMPORT_SQL: string;
```

Approve is allowed only from `review`. `extract_failed` and `chat_only` return 409 `Extract facts before approving.` `approved` returns 200 `{ status: 'approved', factsSaved, factsAlreadySaved, qaSaved, qaAlreadySaved, alreadyApproved: true }` from the stored `approveResult` and does not insert. A failed `applyApproval` returns 400 and does not call `writeMemory`, `bumpMemory`, `writeQa`, or `markApproved`. Included fact content uses `memoryContentHash(kind, content)`. An existing hash bumps `mention_count` and increments `factsAlreadySaved`. A new row inserts with `mention_count` 1, `source_conversation_id` null, and `confidence` `Math.max(0.8, fact.confidence)`, then increments `factsSaved`. Both call `mirrorMemory` and, when that returns a node id, link `learned_from` to `knowledgeEntryId`. An existing `question_norm` increments `qaAlreadySaved` and does not mirror or link. A new Q&A inserts with `conversation_id` null and `sources` `[]`, embeds the question, mirrors, and links. Then `markApproved` clears the draft. Cancel from `review` or `extract_failed` calls `markChatOnly` and does not remove the row. Cancel from `chat_only` returns 200 `{ status: 'chat_only' }` without a second write. Cancel from `approved` returns 409 `This import is already approved.`

- [ ] **Step 1: Write the failing test**

Append to `tests/chat-import.test.ts`. Use `createMemoryImportDeps`. Seed one `review` row for `user-a` with `knowledgeEntryId: 'node-1'` and a draft of one context fact `Works on Dupoin campaigns.` (`id: 'f1'`, confidence `0.4`) and one Q&A `Where is the brand guide?` / `Internal Docs.` (`id: 'q1'`).

```ts
test('approve inserts a fact and Q&A, mirrors both, and links learned_from', async () => {
  const harness = createMemoryImportDeps();
  harness.rows.push(reviewRow());
  const result = await approveChatImport('user-a', 'import-1', {
    facts: [{ id: 'f1', kind: 'context', content: 'Works on Dupoin campaigns.', included: true }],
    qa: [{ id: 'q1', question: 'Where is the brand guide?', answerSummary: 'Internal Docs.', included: true }],
  }, harness.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.body, {
    status: 'approved', factsSaved: 1, factsAlreadySaved: 0, qaSaved: 1, qaAlreadySaved: 0,
  });
  assert.equal(harness.memories[0].userId, 'user-a');
  assert.equal(harness.memories[0].confidence >= 0.8, true);
  assert.equal(harness.memories[0].mentionCount, 1);
  assert.equal(harness.qa[0].questionNorm.length > 0, true);
  assert.equal(harness.mirrors.length, 2);
  assert.equal(harness.edges.length, 2);
  assert.deepEqual(harness.edges.map(edge => edge.importNodeId), ['node-1', 'node-1']);
  assert.equal(harness.rows[0].status, 'approved');
  assert.deepEqual(harness.rows[0].draft, { facts: [], qa: [] });
});

test('an included sensitive row and an unknown fact id write nothing', async () => {
  for (const body of [
    { facts: [{ id: 'f1', kind: 'context', content: 'my password is hunter2', included: true }], qa: [] },
    { facts: [{ id: 'missing', kind: 'context', content: 'Works on Dupoin campaigns.', included: true }], qa: [] },
  ]) {
    const harness = createMemoryImportDeps();
    harness.rows.push(reviewRow());
    const result = await approveChatImport('user-a', 'import-1', body, harness.deps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
    assert.equal(harness.memories.length, 0);
    assert.equal(harness.rows[0].status, 'review');
  }
});

test('unchecked rows are omitted and an existing fact or question is not inserted twice', async () => {
  const harness = createMemoryImportDeps();
  harness.rows.push(reviewRow());
  const hash = memoryContentHash('context', 'Works on Dupoin campaigns.');
  harness.memories.push({ id: 'old-fact', userId: 'user-a', kind: 'context', content: 'Works on Dupoin campaigns.', contentHash: hash, mentionCount: 2, confidence: 0.9 });
  harness.qa.push({ id: 'old-qa', userId: 'user-a', questionNorm: normalizeQuestion('Where is the brand guide?') });
  const result = await approveChatImport('user-a', 'import-1', {
    facts: [{ id: 'f1', kind: 'context', content: 'Works on Dupoin campaigns.', included: true }],
    qa: [{ id: 'q1', question: 'Where is the brand guide?', answerSummary: 'Internal Docs.', included: false }],
  }, harness.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.body.factsSaved, 0);
  assert.equal(result.body.factsAlreadySaved, 1);
  assert.equal(result.body.qaSaved, 0);
  assert.equal(harness.memories.length, 1);
  assert.equal(harness.memories[0].mentionCount, 3);
  assert.equal(harness.qa.length, 1);
  assert.equal(harness.edges.length, 1);
});

test('a second approve does not insert and cancel keeps the chat', async () => {
  const harness = createMemoryImportDeps();
  harness.rows.push(reviewRow());
  await approveChatImport('user-a', 'import-1', { facts: [], qa: [] }, harness.deps);
  const again = await approveChatImport('user-a', 'import-1', {
    facts: [{ id: 'f1', kind: 'context', content: 'Works on Dupoin campaigns.', included: true }],
    qa: [],
  }, harness.deps);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.body.alreadyApproved, true);
  assert.equal(harness.memories.length, 0);

  const cancelHarness = createMemoryImportDeps();
  cancelHarness.rows.push({ ...reviewRow(), status: 'extract_failed', error: 'Fact extraction failed.' });
  const cancelled = await cancelChatImport('user-a', 'import-1', cancelHarness.deps);
  assert.equal(cancelled.ok, true);
  assert.equal(cancelHarness.rows[0].status, 'chat_only');
  assert.equal(cancelHarness.rows[0].error, null);
  assert.equal(cancelHarness.rows[0].knowledgeEntryId, 'node-1');
  const repeat = await cancelChatImport('user-a', 'import-1', cancelHarness.deps);
  assert.equal(repeat.ok, true);
  const approved = await cancelChatImport('user-a', 'import-1', harness.deps);
  assert.equal(approved.ok, false);
  if (!approved.ok) assert.equal(approved.body.error, 'This import is already approved.');
  const other = await approveChatImport('user-b', 'import-1', { facts: [], qa: [] }, harness.deps);
  assert.equal(other.ok, false);
  if (!other.ok) assert.equal(other.body.error, 'Import was not found.');
});

test('approve and cancel SQL bind user_id and do not call the live extractors', async () => {
  const lib = await readFile('src/lib/chat-import.ts', 'utf8');
  const approve = await readFile('src/app/api/ai-research/imports/[id]/approve/route.ts', 'utf8');
  const cancel = await readFile('src/app/api/ai-research/imports/[id]/cancel/route.ts', 'utf8');
  assert.match(lib, /APPROVE_CHAT_IMPORT_SQL[\s\S]{0,300}user_id = \?/);
  assert.match(lib, /CANCEL_CHAT_IMPORT_SQL[\s\S]{0,300}user_id = \?/);
  assert.match(lib, /mirrorUserMemory/);
  assert.match(lib, /mirrorQaTurn/);
  assert.doesNotMatch(lib, /extractUserMemories|indexQaTurn/);
  assert.match(approve, /requireFeature\(request, 'ai-research'\)/);
  assert.match(cancel, /requireFeature\(request, 'ai-research'\)/);
  assert.match(approve, /Extract facts before approving\./);
  assert.match(lib, /Extract facts before approving\./);
  assert.match(lib, /This import is already approved\./);
});
```

Import `memoryContentHash` and `normalizeQuestion` from `src/lib/ai-research-memory.ts`, and `ChatImportRow` from `src/lib/chat-import.ts`. Add this helper next to the tests:

```ts
function reviewRow(): ChatImportRow {
  return {
    id: 'import-1',
    userId: 'user-a',
    source: 'text',
    parser: 'text',
    parserFallback: false,
    title: 'Imported chat',
    transcript: 'user\nWorks on Dupoin campaigns.',
    contentHash: 'hash-1',
    status: 'review',
    draft: {
      facts: [{ id: 'f1', kind: 'context', content: 'Works on Dupoin campaigns.', confidence: 0.4, included: true }],
      qa: [{ id: 'q1', question: 'Where is the brand guide?', answerSummary: 'Internal Docs.', included: true }],
    },
    knowledgeEntryId: 'node-1',
    error: null,
    approveResult: null,
    createdAt: '2026-10-06T00:00:00.000Z',
  };
}
```

The test double's `findMemory` must match `contentHash`, and `findQa` must match `questionNorm`, as specified in Task 7.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/chat-import.test.ts`

Expected: FAIL with `approveChatImport` is not exported.

- [ ] **Step 3: Implement approve and cancel**

`approveChatImport` reads `findById`. Missing returns 404 `Import was not found.` Status `approved` returns the stored counts plus `alreadyApproved: true` and zeroes when `approveResult` is null. Status other than `review` returns 409 `Extract facts before approving.` `applyApproval` failure returns 400 with `selection.error` and performs no writes. Then walk facts and Q&A as the Interfaces section specifies. If `writeMemory` throws and `isUniqueViolation` is true, re-read `findMemory`, call `bumpMemory`, increment `factsAlreadySaved`, and do not increment `factsSaved`. Rethrow any other error. If `knowledgeEntryId` is null, skip `linkLearnedFrom` and still mark approved. `markApproved` persists the counts. `log(id, 'approved')`. Return 200 with the four counts and `status: 'approved'` and without `alreadyApproved`.

`cancelChatImport` returns 404 for a missing row, 409 `This import is already approved.` for `approved`, and 200 `{ status: 'chat_only', id, knowledgeEntryId }` for `chat_only` without calling `markChatOnly`. From `review` or `extract_failed`, call `markChatOnly`, `log(id, 'chat_only')`, and return that same 200 body.

Routes use `requireFeature`, `params: Promise<{ id: string }>`, and `postgresChatImportDeps()`. Approve parses JSON and passes `body.facts` and `body.qa`. Invalid JSON returns 400 `Send the chat as JSON or as a file.` Cancel has no body. Both return `json(result.body, result.status)`.

Export `APPROVE_CHAT_IMPORT_SQL` and `CANCEL_CHAT_IMPORT_SQL` as the statements used by `markApproved` and `markChatOnly`. Both include `user_id = ?`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test tests/chat-import.test.ts tests/ai-research-memory.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-import.ts src/app/api/ai-research/imports/\[id\]/approve/route.ts src/app/api/ai-research/imports/\[id\]/cancel/route.ts tests/chat-import.test.ts
git commit -m "Approve or cancel an imported chat draft."
```

---

### Task 9: Retry extract

**Files:**
- Modify: `src/lib/chat-import.ts`
- Create: `src/app/api/ai-research/imports/[id]/extract/route.ts`
- Modify: `tests/chat-import.test.ts`

**Interfaces:**
- Consumes: `ChatImportDeps`, `requestImportDraft`, `saveDraft`, `saveExtractFailure`.
- Produces:

```ts
export function retryChatImport(userId: string, id: string, deps: ChatImportDeps): Promise<ChatImportResult>;
export const EXTRACT_SUCCESS_SQL: string;
export const EXTRACT_FAILURE_SQL: string;
```

Retry is allowed from `extract_failed` and `chat_only`. `review` and `approved` return 409 `Nothing to extract.` Success replaces `draft` and sets `review`. Failure sets `extract_failed`, empty draft, and `Fact extraction failed.` again. Both outcomes return 200 and the import object without `transcript`. The route is `POST`.

- [ ] **Step 1: Write the failing test**

Append to `tests/chat-import.test.ts`:

```ts
test('a failed extract can be retried into review', async () => {
  const harness = createMemoryImportDeps();
  harness.deps.complete = async () => { throw new Error('down'); };
  const created = await createChatImport('user-a', 'text', 'Remember the Dupoin voice guide.', harness.deps);
  if (!created.ok) return;
  const id = (created.body.import as { id: string }).id;
  assert.equal(harness.rows[0].status, 'extract_failed');
  harness.deps.complete = async () => '{"facts":[{"kind":"style","content":"Prefers a direct voice.","confidence":0.8}],"qa":[]}';
  const retried = await retryChatImport('user-a', id, harness.deps);
  assert.equal(retried.ok, true);
  if (!retried.ok) return;
  assert.equal((retried.body.import as { status: string; transcript?: string }).status, 'review');
  assert.equal((retried.body.import as { transcript?: string }).transcript, undefined);
  assert.equal(harness.rows[0].draft.facts[0].content, 'Prefers a direct voice.');
  const blocked = await retryChatImport('user-a', id, harness.deps);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.body.error, 'Nothing to extract.');
  const stranger = await retryChatImport('user-b', id, harness.deps);
  assert.equal(stranger.ok, false);
  if (!stranger.ok) assert.equal(stranger.body.error, 'Import was not found.');
});

test('extract route SQL binds user_id', async () => {
  const lib = await readFile('src/lib/chat-import.ts', 'utf8');
  const route = await readFile('src/app/api/ai-research/imports/[id]/extract/route.ts', 'utf8');
  assert.match(lib, /EXTRACT_SUCCESS_SQL[\s\S]{0,240}user_id = \?/);
  assert.match(lib, /EXTRACT_FAILURE_SQL[\s\S]{0,240}user_id = \?/);
  assert.match(route, /requireFeature\(request, 'ai-research'\)/);
  assert.match(route, /retryChatImport\(auth\.id/);
  assert.match(lib, /Nothing to extract\./);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/chat-import.test.ts`

Expected: FAIL with `retryChatImport` is not exported.

- [ ] **Step 3: Implement retry**

`retryChatImport` returns 404 `Import was not found.` when `findById` misses. Status `review` or `approved` returns 409 `Nothing to extract.` Otherwise call `requestImportDraft` with `deps.complete`. Failure calls `saveExtractFailure` and returns 200 `{ import: presentImport(...) }` with `error: FACT_EXTRACTION_FAILED`. Success calls `saveDraft` and returns 200 with status `review`. `log` the id and the resulting status. `EXTRACT_SUCCESS_SQL` is the `saveDraft` update and allows status `extract_failed` or `chat_only`. `EXTRACT_FAILURE_SQL` is the `saveExtractFailure` update. Both contain `user_id = ?`.

The route matches the approve route's auth and params shape and calls `retryChatImport(auth.id, id, postgresChatImportDeps())`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test tests/chat-import.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-import.ts src/app/api/ai-research/imports/\[id\]/extract/route.ts tests/chat-import.test.ts
git commit -m "Retry fact extraction for a saved import."
```

---

### Task 10: Memory panel import modal

**Files:**
- Create: `src/lib/chat-import-ui.ts`
- Create: `src/components/AiResearchImportModal.tsx`
- Modify: `src/components/AiResearchMemoryPanel.tsx`
- Test: `tests/chat-import-ui.test.ts`

**Interfaces:**
- Consumes: `knowledgeGraphFocusUrl` from `src/lib/knowledge-pin.ts`. The import API does not return `role`. The modal reads it from `POST /api/auth` with `{ action: 'check' }`, the same call `src/app/dashboard/layout.tsx` uses, and treats `user.role === 'admin'` as admin.
- Produces:

```ts
export const IMPORT_SOURCE_LABEL: { codex: 'Codex / ChatGPT'; claude: 'Claude'; text: 'Plain text' };
export const IMPORT_STATUS_LABEL: { review: 'Review'; extract_failed: 'Extract failed'; chat_only: 'Chat only'; approved: 'Approved' };
export function importListActions(status: 'review' | 'extract_failed' | 'approved' | 'chat_only'): Array<'view' | 'review' | 'retry'>;
export function importDateLabel(value: string): string;
export const IMPORT_MEMORY_OFF_NOTE = 'Memory is off. This chat is still saved. Approved facts and answers are stored, and Dupoin AI will not use them until you turn memory on.';
export const IMPORT_CANCEL_NOTE = 'Draft discarded. The chat stays in your knowledge graph.';
export const IMPORT_SAVED_NOTE = 'Full chat saved to your knowledge graph.';
export const IMPORT_PLAIN_TEXT_NOTE = 'This chat was saved as plain text.';
export const IMPORT_EXTRACT_FAILED_NOTE = 'The chat was saved. Fact extraction failed.';
export const IMPORT_DUPLICATE_NOTE = 'This chat is already imported.';
```

`importListActions('review')` is `['view', 'review']`. `extract_failed` and `chat_only` are `['view', 'retry']`. `approved` is `['view']`. `importDateLabel` uses `Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })` and returns `''` for an invalid date.

The panel button **Import chat** sits directly under the memory on/off row. It stays enabled when the memory list is empty and when memory is off. Under it, the panel lists `GET /api/ai-research/imports`. The modal is a full-width bottom sheet on small screens and a centered dialog from `sm` up, using the same shell as `AiResearchPriorPreview` (`fixed inset-0 z-50`, `items-end sm:items-center`, `w-[min(100vw,40rem)]`, `rounded-t-2xl sm:rounded-2xl`). The panel stays mounted behind it.

- [ ] **Step 1: Write the failing test**

Create `tests/chat-import-ui.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  IMPORT_CANCEL_NOTE,
  IMPORT_DUPLICATE_NOTE,
  IMPORT_EXTRACT_FAILED_NOTE,
  IMPORT_MEMORY_OFF_NOTE,
  IMPORT_PLAIN_TEXT_NOTE,
  IMPORT_SAVED_NOTE,
  IMPORT_SOURCE_LABEL,
  importDateLabel,
  importListActions,
} from '../src/lib/chat-import-ui';

test('import list actions and copy match the Phase A flow', () => {
  assert.deepEqual(importListActions('review'), ['view', 'review']);
  assert.deepEqual(importListActions('extract_failed'), ['view', 'retry']);
  assert.deepEqual(importListActions('chat_only'), ['view', 'retry']);
  assert.deepEqual(importListActions('approved'), ['view']);
  assert.equal(IMPORT_SOURCE_LABEL.codex, 'Codex / ChatGPT');
  assert.equal(IMPORT_SOURCE_LABEL.claude, 'Claude');
  assert.equal(IMPORT_SOURCE_LABEL.text, 'Plain text');
  assert.match(importDateLabel('2026-10-06T12:00:00.000Z'), /Oct/);
  assert.equal(importDateLabel('not-a-date'), '');
  assert.equal(IMPORT_MEMORY_OFF_NOTE, 'Memory is off. This chat is still saved. Approved facts and answers are stored, and Dupoin AI will not use them until you turn memory on.');
  assert.equal(IMPORT_CANCEL_NOTE, 'Draft discarded. The chat stays in your knowledge graph.');
  assert.equal(IMPORT_SAVED_NOTE, 'Full chat saved to your knowledge graph.');
  assert.equal(IMPORT_PLAIN_TEXT_NOTE, 'This chat was saved as plain text.');
  assert.equal(IMPORT_EXTRACT_FAILED_NOTE, 'The chat was saved. Fact extraction failed.');
  assert.equal(IMPORT_DUPLICATE_NOTE, 'This chat is already imported.');
});

test('the memory panel can import when memory is empty or off', async () => {
  const panel = await readFile('src/components/AiResearchMemoryPanel.tsx', 'utf8');
  const modal = await readFile('src/components/AiResearchImportModal.tsx', 'utf8');
  assert.match(panel, /Import chat/);
  assert.match(panel, /data-testid="ai-research-import-open"/);
  assert.match(panel, /data-testid="ai-research-import-list"/);
  assert.match(panel, /\/api\/ai-research\/imports/);
  assert.doesNotMatch(panel, /ai-research-import-open"[\s\S]{0,120}disabled=\{!enabled\}/);
  assert.doesNotMatch(panel, /ai-research-import-open"[\s\S]{0,160}memories\.length === 0/);
  assert.match(modal, /data-testid="ai-research-import-modal"/);
  assert.match(modal, /IMPORT_SAVED_NOTE/);
  assert.match(modal, /IMPORT_CANCEL_NOTE/);
  assert.match(modal, /IMPORT_MEMORY_OFF_NOTE/);
  assert.match(modal, /IMPORT_PLAIN_TEXT_NOTE/);
  assert.match(modal, /IMPORT_EXTRACT_FAILED_NOTE/);
  assert.match(modal, /IMPORT_DUPLICATE_NOTE/);
  assert.match(modal, />Import</);
  assert.match(modal, />Paste</);
  assert.match(modal, />Upload</);
  assert.match(modal, />Approve</);
  assert.match(modal, />Cancel</);
  assert.match(modal, /View chat/);
  assert.match(modal, /Retry extract/);
  assert.match(modal, /Open in Knowledge Graph/);
  assert.match(modal, /knowledgeGraphFocusUrl/);
  assert.match(modal, /role === 'admin'/);
  assert.match(modal, /action: 'check'/);
  assert.match(modal, /maxLength=\{280\}/);
  assert.match(modal, /Role/);
  assert.match(modal, /Interests/);
  assert.match(modal, /Preferences/);
  assert.match(modal, /Style/);
  assert.match(modal, /Context/);
  assert.doesNotMatch(modal, /ai_research_conversations|extractUserMemories|indexQaTurn/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/chat-import-ui.test.ts`

Expected: FAIL with `Cannot find module '../src/lib/chat-import-ui'`.

- [ ] **Step 3: Implement the copy module, the modal, and the panel list**

Create `src/lib/chat-import-ui.ts` with the constants and functions in Interfaces. `importDateLabel` returns `''` when `Number.isNaN(date.getTime())`.

Create `src/components/AiResearchImportModal.tsx` as a client component. Props:

```ts
export function AiResearchImportModal({
  open,
  start,
  onClose,
  onChanged,
}: {
  open: boolean;
  start: { kind: 'new' } | { kind: 'existing'; id: string; intent: 'view' | 'review' | 'retry' };
  onClose: () => void;
  onChanged: () => void;
})
```

Behavior:

- When `open` is false, return `null`.
- Shell matches `AiResearchPriorPreview`: backdrop button, aside, `data-testid="ai-research-import-modal"`.
- New import: a `<select>` with the three `IMPORT_SOURCE_LABEL` options, tabs **Paste** and **Upload**, and submit **Import**. Paste posts JSON `{ source, text }` to `POST /api/ai-research/imports`. Upload posts `FormData` fields `source` and `file` with no `Content-Type` header so the browser sets the multipart boundary. Do not send the filename as a title field.
- 409 shows `IMPORT_DUPLICATE_NOTE`, **View chat** for `existingImportId`, and, only when the auth check says admin and `knowledgeEntryId` is present, an anchor **Open in Knowledge Graph** whose `href` is `knowledgeGraphFocusUrl(knowledgeEntryId)`.
- 200 with `review` shows the checklist. Confirmation line uses `IMPORT_SAVED_NOTE`. **View chat** fetches `GET /api/ai-research/imports/:id` and shows `transcript` in a read-only `whitespace-pre-wrap` block. Admin graph link uses that import's `knowledgeEntryId`. `parserFallback` shows `IMPORT_PLAIN_TEXT_NOTE`. `memoryEnabled === false` shows `IMPORT_MEMORY_OFF_NOTE`.
- Facts are grouped with labels Role, Interests, Preferences, Style, Context, in that order, skipping empty groups. Each row has a checkbox, a kind `<select>` of the five kinds, and a text input `maxLength={280}`. Q&A rows have a checkbox, a question input `maxLength={2000}`, and an answer input `maxLength={500}`.
- **Approve** posts the current rows to `POST /api/ai-research/imports/:id/approve`. On 200, call `onChanged()` and `onClose()`. On 400, show `payload.error` and leave the checklist up.
- **Cancel** posts `POST /api/ai-research/imports/:id/cancel`. On 200, show `IMPORT_CANCEL_NOTE` plus **Retry extract** and **Close**.
- `extract_failed` replaces the checklist with `IMPORT_EXTRACT_FAILED_NOTE`, **View chat**, and **Retry extract**. Do not render **Approve**.
- **Retry extract** posts `POST /api/ai-research/imports/:id/extract` and renders the returned import.
- Existing `intent: 'view'` loads the detail and shows the transcript. `intent: 'review'` loads the detail and opens the checklist when status is `review`. `intent: 'retry'` posts extract immediately.
- Kind labels in the fact group headings are Role, Interests, Preferences, Style, Context. The kind `<select>` uses the same five words.

In `AiResearchMemoryPanel`, add state for the import list and the modal start. When the panel opens, also `fetch('/api/ai-research/imports', { cache: 'no-store' })`. A failed import list sets the panel error and does not clear `memories`. Render the **Import chat** button as a `shrink-0` row immediately after the on/off row, with `data-testid="ai-research-import-open"`. Do not disable it from `enabled` or `memories.length`. Inside the scroll region, before the memory groups, render `data-testid="ai-research-import-list"` with title, `IMPORT_SOURCE_LABEL`, `IMPORT_STATUS_LABEL`, and `importDateLabel`. For each `importListActions(status)` entry, render **View chat**, **Review facts**, or **Retry extract**, opening the modal with that intent. Mount `AiResearchImportModal` while the panel is open so the panel stays behind it. `onChanged` reloads memories and imports.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test tests/chat-import-ui.test.ts tests/ai-research-memory.test.ts`

Expected: PASS. The existing memory panel test still finds Memory is on, Clear all, and the five kind labels.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-import-ui.ts src/components/AiResearchImportModal.tsx src/components/AiResearchMemoryPanel.tsx tests/chat-import-ui.test.ts
git commit -m "Add the Memory panel import chat flow."
```

---

### Task 11: Hide other users' imports on the admin graph

**Files:**
- Modify: `src/app/api/admin/knowledge-graph/route.ts`
- Modify: `src/app/dashboard/knowledge-graph/page.tsx`
- Create: `src/components/ImportedChatRecordActions.tsx`
- Modify: `tests/admin-knowledge-graph.test.ts`
- Modify: `tests/chat-import-ui.test.ts`

**Interfaces:**
- Consumes: `importListActions` and `AiResearchImportModal`.
- Produces: admin node JSON field `taskId: string | null`. It is the `knowledge_entries.task_id` only when `task_type` is `imported-chat`. Every other node sends `null`. The node query selects `ke.task_id`. `fact_text` stays `CASE WHEN ke.task_type = 'ai-research' THEN LEFT(ke.selected_output, 2000) ELSE NULL END`. The route does not mention `chat_imports` or `transcript`.

`ImportedChatRecordActions` fetches `GET /api/ai-research/imports`, finds `id === importId`, and renders the buttons from `importListActions`. It does not render a transcript. The graph page shows it only when `selected.taskType === 'imported-chat' && selected.taskId`, and opens `AiResearchImportModal` for those actions. Do not add a second legend component. Do not put `#E11D48` in the canvas; `knowledgeFeatureColor(node.taskType)` already paints it.

- [ ] **Step 1: Write the failing test**

Append to `tests/admin-knowledge-graph.test.ts`:

```ts
test('admin graph omits another user\'s imported chat from nodes, counts, and task types', async () => {
  const route = await readFile('src/app/api/admin/knowledge-graph/route.ts', 'utf8');
  const predicate = "task_type <> 'imported-chat' OR ke.user_id = ?";
  assert.match(route, new RegExp(predicate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(route, /source\.task_type <> 'imported-chat' OR source\.user_id = \?/);
  assert.match(route, /target\.task_type <> 'imported-chat' OR target\.user_id = \?/);
  assert.match(route, /ke\.task_id/);
  assert.match(route, /taskId:/);
  assert.match(route, /CASE WHEN ke\.task_type = 'ai-research' THEN LEFT\(ke\.selected_output, 2000\) ELSE NULL END AS fact_text/);
  assert.doesNotMatch(route, /WHERE ke\.user_id =/);
  assert.doesNotMatch(route, /chat_imports|transcript/);
  assert.match(route, /FROM tasks/);
  const page = await readFile('src/app/dashboard/knowledge-graph/page.tsx', 'utf8');
  const canvas = await readFile('src/app/dashboard/knowledge-graph/KnowledgeGraphCanvas.tsx', 'utf8');
  assert.match(page, /Filter by source feature/);
  assert.match(page, /knowledgeFeatureLabel\(item\.name\)/);
  assert.match(page, /selected\.taskType === 'imported-chat'/);
  assert.match(page, /selected\.taskId/);
  assert.match(page, /ImportedChatRecordActions/);
  assert.doesNotMatch(canvas, /#E11D48/);
  assert.match(canvas, /knowledgeFeatureColor\(node\.taskType\)/);
});
```

Append to `tests/chat-import-ui.test.ts`:

```ts
test('the selected-record actions do not render the transcript', async () => {
  const actions = await readFile('src/components/ImportedChatRecordActions.tsx', 'utf8');
  assert.match(actions, /importListActions/);
  assert.match(actions, /View chat/);
  assert.match(actions, /Review facts/);
  assert.match(actions, /Retry extract/);
  assert.doesNotMatch(actions, /transcript/);
  assert.match(actions, /\/api\/ai-research\/imports/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test tests/admin-knowledge-graph.test.ts tests/chat-import-ui.test.ts`

Expected: FAIL because the admin route does not contain the predicate and `ImportedChatRecordActions.tsx` does not exist. The existing admin test `doesNotMatch(route, /WHERE ke\.user_id =/)` must still pass after the edit.

- [ ] **Step 3: Filter the admin queries and add the record actions**

In `src/app/api/admin/knowledge-graph/route.ts`, after `requireAdmin`, use `admin.id`. Add the predicate to these queries and bind `admin.id` once per placeholder:

- Node list: `WHERE (ke.task_type <> 'imported-chat' OR ke.user_id = ?)` before `ORDER BY`, params `[admin.id, limit]`. Select `ke.task_id` in that SELECT.
- Department rollup: the same `WHERE` before `GROUP BY`, params `[admin.id]`.
- Task-type breakdown: alias the table as `ke`, add the same `WHERE`, `GROUP BY ke.task_type`, params `[admin.id]`.
- Edge list: `WHERE (source.task_type <> 'imported-chat' OR source.user_id = ?) AND (target.task_type <> 'imported-chat' OR target.user_id = ?)`, params `[admin.id, admin.id]`.
- Headline knowledge count, 30-day knowledge count, and distinct contributor count: the `ke` predicate. The 30-day query keeps `created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'`.
- Headline edge count: the same two-endpoint join and predicate as the edge list.
- Leave `SELECT COUNT(*)::INTEGER AS count FROM departments` unchanged.
- Leave both learning-health `FROM tasks` queries unchanged.

On each mapped node:

```ts
taskId: String(entry.task_type || '') === 'imported-chat' && entry.task_id ? String(entry.task_id) : null,
```

Create `src/components/ImportedChatRecordActions.tsx`. Props are `importId: string` and `onView`, `onReview`, `onRetry` callbacks. On mount, fetch `/api/ai-research/imports`. Find the row whose `id` equals `importId`. Render a button for each `importListActions(row.status)` value with the labels **View chat**, **Review facts**, and **Retry extract**. If the list has no such id, render `null`.

In `src/app/dashboard/knowledge-graph/page.tsx`, add `taskId: string | null` to `GraphNode`. Pass `taskId: node.taskId || null` if the payload includes it; the API now sends it. Under `KnowledgeEntryActions`, when `selected.taskType === 'imported-chat' && selected.taskId`, render `ImportedChatRecordActions`. Hold modal state `{ kind: 'existing'; id: string; intent: 'view' | 'review' | 'retry' } | null` and render `AiResearchImportModal` with `open={importStart !== null}`. `onChanged` calls `load(true)`. Do not print `selected.fact` for the transcript, and do not add a fetch of the transcript in the page.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test tests/admin-knowledge-graph.test.ts tests/chat-import-ui.test.ts tests/knowledge-graph-colors.test.ts tests/chat-import-graph.test.ts tests/chat-import-parse.test.ts tests/chat-import-extract.test.ts tests/chat-import.test.ts tests/canonical-migrations.test.ts tests/ai-research-memory.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/knowledge-graph/route.ts src/app/dashboard/knowledge-graph/page.tsx src/components/ImportedChatRecordActions.tsx tests/admin-knowledge-graph.test.ts tests/chat-import-ui.test.ts
git commit -m "Show only the admin's own imported chats on the graph."
```

---

### Task 12: Manual acceptance

**Files:**
- None.

**Interfaces:**
- Consumes the finished Phase A UI and API. No new exports.

This pass is manual. The automated tests do not start a browser.

- [ ] **Step 1: Apply the migration locally**

Run: `npx tsx scripts/migrate.ts`

Expected: `028_chat_imports.sql` applies once. A second run does not error.

- [ ] **Step 2: Paste one short Codex JSON**

Sign in as a user with AI Research. Open Memory. Choose **Import chat**, source **Codex / ChatGPT**, and paste one conversation object with a user turn and an assistant turn. Submit **Import**.

Expected: the checklist appears, the chat is in the Memory list before **Approve**, and the list shows the title, `Codex / ChatGPT`, and status `Review`.

- [ ] **Step 3: Approve one fact**

Leave one fact checked. Uncheck the others. Click **Approve**.

Expected: the modal closes, the fact appears in the Memory panel, and the import row status is `Approved`.

- [ ] **Step 4: Paste the same chat again**

Expected: `This chat is already imported.` and **View chat**. A non-admin does not see **Open in Knowledge Graph**. An admin does, and that link opens `/dashboard/knowledge-graph?focus=<their node id>`.

- [ ] **Step 5: Confirm admin isolation**

As that admin, the node is on the organization map with legend label `Imported Chat` and color `#E11D48`. The selected record offers **View chat**, and **Review facts** or **Retry extract** only when the status allows them. Sign in as another admin and confirm the first user's imported title is not in the node list or the source-feature filter.

- [ ] **Step 6: Commit only if a previous task left an uncommitted fix**

If this pass required a code change, add a failing test that reproduces it, fix it, rerun the Task 11 command, and commit that fix. If the pass only confirmed behavior, do not make an empty commit.
