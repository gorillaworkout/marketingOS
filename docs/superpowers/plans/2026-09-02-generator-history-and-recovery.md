# Generator History and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recoverable history to every MarketingOS generator, normalize production-ready Video Script output, and show a blocking session-expired modal when authenticated generation requests return 401.

**Architecture:** Keep `tasks` as the source of truth for five document generators and `ai_research_conversations` as the source of truth for AI Research. Add pure history/restore contracts plus one shared Recent Generated component; generator pages retain type-specific state mapping. Add pure Video Script parsing/validation before persistence, then one bounded format-repair attempt. Add one shared client error-modal contract used by image polling and generator requests.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, PostgreSQL, Node `node:test` through `tsx`, PM2, Cloudflare Tunnel.

**Spec:** `docs/superpowers/specs/2026-09-02-generator-history-and-recovery-design.md`

## Global Constraints

- Never delete, rewrite, reset, or backfill existing `tasks` or `ai_research_conversations` rows.
- No PostgreSQL schema migration is required.
- Preserve the unrelated working-tree changes already present in `src/app/api/ai-research/chat/route.ts`, `src/lib/ai-research.ts`, and `tests/ai-research.test.ts`; inspect and integrate them, never overwrite them wholesale.
- UI and generated user-facing copy remain English except generated Indonesian marketing content.
- Recent Generated shows at most 10 authenticated-user records; central History retains the existing 50-record ceiling.
- Article and Market Research manual-review gates reset to false whenever a historical record is selected.
- A 401 during generation/polling stops timers immediately and never cancels the detached server image job.
- Old malformed Video Script records are normalized only in memory; production rows remain unchanged.
- Before deploy, create and checksum a PostgreSQL dump; compare row counts before/after.
- Use targeted patches on large page files. Never overwrite an entire page using truncated `read_file` output.

## File Structure

**Create**

- `src/lib/task-history.ts` — validated task types, query-limit parsing, persisted task contract, safe JSON parsing, per-generator restore adapters.
- `src/components/RecentGenerated.tsx` — shared loading/error/empty/list panel.
- `src/lib/video-script-output.ts` — reasoning-marker cleanup, JSON extraction, nested normalization, scene validation, repair prompt.
- `src/lib/generator-errors.ts` — response classification and safe same-origin return path.
- `src/components/GeneratorErrorModal.tsx` — visible session/general generation error modal.
- `tests/task-history.test.ts` — API parameter and restore-adapter tests.
- `tests/recent-generated.test.ts` — shared panel and per-page integration contract checks.
- `tests/video-script-output.test.ts` — parser/validator/repair tests.
- `tests/generator-errors.test.ts` — 401 and return-path tests.
- `tests/history-page.test.ts` — central task/AI History filtering contracts.

**Modify**

- `src/app/api/dashboard/history/route.ts` — validated `type` and `limit`.
- `src/app/dashboard/social-post/page.tsx` — use shared recent panel/restore adapter; 401 modal in generation/image polling.
- `src/app/dashboard/video-script/page.tsx` — recent panel, historical restore, modal.
- `src/app/dashboard/event-plan/page.tsx` — recent panel, restore all options/form context, modal.
- `src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx` — recent panel, restore article/input, review reset, modal.
- `src/app/dashboard/market-research/page.tsx` — recent panel, restore report/input, review reset, modal.
- `src/app/dashboard/history/page.tsx` — query-param filter, explicit fetch errors, AI Research tab/transcript.
- `src/app/dashboard/ai-research/page.tsx` — explicit conversation-history label and errors.
- `src/app/api/video-script/generate/route.ts` — normalize, validate, repair once, persist only valid output.
- Existing related tests where a focused assertion belongs: `tests/image-job-status.test.ts`, `tests/ai-research.test.ts`, `tests/event-plan-history.test.ts`.

---

### Task 1: Safe History Contracts and API Validation

**Files:**
- Create: `src/lib/task-history.ts`
- Create: `tests/task-history.test.ts`
- Modify: `src/app/api/dashboard/history/route.ts:1-21`

**Interfaces:**
- Produces: `TASK_HISTORY_TYPES`, `TaskHistoryType`, `HistoryTask`, `parseHistoryQuery(searchParams)`, `parseTaskOutput(task)`.
- `parseHistoryQuery(searchParams: URLSearchParams): { type?: TaskHistoryType; limit: number }` throws `HistoryQueryError` for unsupported types or invalid limits.
- Later tasks consume `HistoryTask` and `parseTaskOutput`.

- [ ] **Step 1: Write failing query-contract tests**

Create `tests/task-history.test.ts` with these exact cases:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHistoryQuery, parseTaskOutput } from '../src/lib/task-history';

test('accepts supported task type and bounded limit', () => {
  assert.deepEqual(parseHistoryQuery(new URLSearchParams('type=event-plan&limit=10')), {
    type: 'event-plan', limit: 10,
  });
});

test('defaults to central-history limit and caps recent history', () => {
  assert.deepEqual(parseHistoryQuery(new URLSearchParams()), { limit: 50 });
  assert.throws(() => parseHistoryQuery(new URLSearchParams('limit=51')), /limit/i);
});

test('rejects unknown task types', () => {
  assert.throws(() => parseHistoryQuery(new URLSearchParams('type=ai-research')), /type/i);
});

test('parses persisted output without mutating the task', () => {
  const task = { id: '1', type: 'event-plan', title: 'Event', status: 'completed', created_at: '2026-09-02T00:00:00Z', output_data: '{"options":[]}' } as const;
  assert.deepEqual(parseTaskOutput(task), { options: [] });
  assert.equal(task.output_data, '{"options":[]}');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx tsx --test tests/task-history.test.ts
```

Expected: FAIL with `Cannot find module '../src/lib/task-history'`.

- [ ] **Step 3: Implement minimum contracts**

Implement:

```ts
export const TASK_HISTORY_TYPES = ['social-post', 'video-script', 'event-plan', 'article-market-news', 'market-research'] as const;
export type TaskHistoryType = typeof TASK_HISTORY_TYPES[number];

export interface HistoryTask {
  id: string;
  type: TaskHistoryType;
  title: string;
  brief?: string;
  status: string;
  output_data?: string;
  created_at: string;
}

export class HistoryQueryError extends Error {}

export function parseHistoryQuery(params: URLSearchParams): { type?: TaskHistoryType; limit: number } {
  const rawType = params.get('type');
  const rawLimit = params.get('limit');
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new HistoryQueryError('History limit must be between 1 and 50.');
  if (rawType && !TASK_HISTORY_TYPES.includes(rawType as TaskHistoryType)) throw new HistoryQueryError('Unsupported history type.');
  return { ...(rawType ? { type: rawType as TaskHistoryType } : {}), limit };
}

export function parseTaskOutput(task: Pick<HistoryTask, 'output_data'>): Record<string, unknown> {
  if (!task.output_data) return {};
  const parsed = JSON.parse(task.output_data);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Historical output is not an object.');
  return parsed as Record<string, unknown>;
}
```

Patch the API route to call `parseHistoryQuery(request.nextUrl.searchParams)`, return HTTP 400 for `HistoryQueryError`, interpolate only the numeric validated `limit` into SQL, and keep `type` parameterized.

- [ ] **Step 4: Run focused tests and route lint**

```bash
npx tsx --test tests/task-history.test.ts
npx eslint src/lib/task-history.ts src/app/api/dashboard/history/route.ts tests/task-history.test.ts
```

Expected: all tests PASS; ESLint exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/task-history.ts src/app/api/dashboard/history/route.ts tests/task-history.test.ts
git commit -m "feat: validate generator history queries"
```

---

### Task 2: Restore Adapters for Five Generator Schemas

**Files:**
- Modify: `src/lib/task-history.ts`
- Modify: `tests/task-history.test.ts`

**Interfaces:**
- Produces:
  - `restoreSocialPost(task): SocialPostRestore`
  - `restoreVideoScript(task): VideoScriptRestore`
  - `restoreEventPlan(task): EventPlanRestore`
  - `restoreArticle(task): ArticleRestore`
  - `restoreMarketResearch(task): MarketResearchRestore`
- Each function throws an item-level `HistoryRecordError` with a user-readable message on malformed data.

- [ ] **Step 1: Add failing representative-record tests**

Add one persisted fixture per type. Assert exact core mappings:

```ts
assert.deepEqual(restoreEventPlan(eventTask), {
  eventName: 'Dupoin Anniversary',
  options: [{ style: 'premium', concept: 'Five years forward' }],
  selectedOption: 0,
});

const article = restoreArticle(articleTask);
assert.equal(article.result.title, 'Harga Emas Menguat');
assert.equal(article.input.keyword, 'harga emas');
assert.equal(article.factReviewConfirmed, false);

const research = restoreMarketResearch(researchTask);
assert.equal(research.result.items.length, 1);
assert.equal(research.reviewConfirmed, false);
```

Include old Social Post single-output plus new `options[]`; include malformed Video Script `fullScript` as raw string for now—the clean normalization is added in Task 7.

- [ ] **Step 2: Run and verify RED**

```bash
npx tsx --test tests/task-history.test.ts
```

Expected: FAIL because restore functions are not exported.

- [ ] **Step 3: Implement narrow adapters**

Use runtime checks at the persisted JSON boundary. Do not introduce a schema library. Preserve unknown auxiliary fields in a `raw` property only where existing pages need them. Never silently return an empty successful result when required fields are missing.

For Event Plan, derive `eventName` from `task.brief`; restore `options`; set `selectedOption: 0`. For Article, read `{ article, input, model }`. For Market Research, map `{ report.items, input, model, groupsSearched, groupCandidateCounts, sourceStatus, candidateCount }`. For Social Post, normalize old/new output. For Video Script, pick `options[0]` or `scriptData` while retaining raw `fullScript`.

- [ ] **Step 4: Run tests and lint**

```bash
npx tsx --test tests/task-history.test.ts
npx eslint src/lib/task-history.ts tests/task-history.test.ts
```

Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/task-history.ts tests/task-history.test.ts
git commit -m "feat: restore persisted generator outputs"
```

---

### Task 3: Shared Recent Generated Panel

**Files:**
- Create: `src/components/RecentGenerated.tsx`
- Create: `tests/recent-generated.test.ts`

**Interfaces:**
- Consumes: `HistoryTask`, `TaskHistoryType` from `src/lib/task-history.ts`.
- Produces:

```ts
interface RecentGeneratedProps {
  type: TaskHistoryType;
  tasks: HistoryTask[];
  loading: boolean;
  error: string;
  selectedId?: string | null;
  onSelect(task: HistoryTask): void;
}
```

- [ ] **Step 1: Write failing component-contract test**

The repository has no DOM test runner. Use the established source-contract style:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('Recent Generated distinguishes loading, error, empty, list, and filtered history link', async () => {
  const source = await readFile(resolve('src/components/RecentGenerated.tsx'), 'utf8');
  assert.match(source, /Recent Generated/);
  assert.match(source, /Loading/);
  assert.match(source, /Unable to load history/);
  assert.match(source, /Nothing generated yet/);
  assert.match(source, /\/dashboard\/history\?type=/);
  assert.match(source, /onSelect\(task\)/);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx tsx --test tests/recent-generated.test.ts
```

Expected: FAIL with ENOENT.

- [ ] **Step 3: Implement component**

Use existing `Panel`, `SectionHeader`, `StatusBadge`, `EmptyState`, and `LoadingState`. Render at most the supplied tasks; no internal fetch. Use buttons for selectable rows, `aria-pressed` for the selected row, dates via `toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' })`, and the exact filtered URL:

```tsx
<Link href={`/dashboard/history?type=${encodeURIComponent(type)}`}>View all history</Link>
```

If `error` is non-empty, show the error state—not an empty state.

- [ ] **Step 4: Run tests and lint**

```bash
npx tsx --test tests/recent-generated.test.ts
npx eslint src/components/RecentGenerated.tsx tests/recent-generated.test.ts
```

Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/RecentGenerated.tsx tests/recent-generated.test.ts
git commit -m "feat: add shared recent generation panel"
```

---

### Task 4: Integrate Recent History into Five Generator Pages

**Files:**
- Modify: `src/app/dashboard/social-post/page.tsx`
- Modify: `src/app/dashboard/video-script/page.tsx`
- Modify: `src/app/dashboard/event-plan/page.tsx`
- Modify: `src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx`
- Modify: `src/app/dashboard/market-research/page.tsx`
- Modify: `tests/recent-generated.test.ts`
- Modify: `tests/event-plan-history.test.ts`

**Interfaces:**
- Consumes `RecentGenerated` and five restore adapters.
- Every page owns `historyTasks`, `historyLoading`, `historyError`, `selectedHistoryId`, and `refreshHistory()`.

- [ ] **Step 1: Add failing page-integration assertions**

Assert every page imports `RecentGenerated`, fetches `/api/dashboard/history?type=<type>&limit=10`, checks `response.ok`, calls its restore adapter, and refreshes after successful generation. Add explicit assertions that Article and Market Research call `setFactReviewConfirmed(false)` / `setReviewConfirmed(false)` inside historical selection.

- [ ] **Step 2: Run and verify RED**

```bash
npx tsx --test tests/recent-generated.test.ts tests/event-plan-history.test.ts
```

Expected: FAIL on missing imports/history URLs.

- [ ] **Step 3: Integrate Social Post and Video Script**

Social Post already has `fetchPosts()` and `viewPost()`. Replace its custom recent-list presentation with `RecentGenerated`; keep `fetchPosts()` and `viewPost()` behavior, change URL to `type=social-post&limit=10`, and make loading/error explicit.

Video Script: add `refreshHistory`, call `restoreVideoScript`, set brief/style/result/options/full script, reset transient generation state, and select the historical task. Do not write the repaired old script back to DB.

- [ ] **Step 4: Integrate Event Plan, Article, and Market Research**

Event Plan selection restores event name, options, first selection, and available form metadata. Article restores input/result then resets fact review. Market Research restores input/result then resets article review. After each successful SSE `done`, call `refreshHistory()` once.

Use targeted `patch` edits; these page files are large.

- [ ] **Step 5: Run focused tests and lint changed pages**

```bash
npx tsx --test tests/task-history.test.ts tests/recent-generated.test.ts tests/event-plan-history.test.ts tests/article-market-news-generator.test.ts tests/market-research.test.ts
npx eslint src/app/dashboard/social-post/page.tsx src/app/dashboard/video-script/page.tsx src/app/dashboard/event-plan/page.tsx src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx src/app/dashboard/market-research/page.tsx tests/recent-generated.test.ts
```

Expected: focused tests PASS. Fix only newly introduced lint errors; record pre-existing page warnings separately.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/social-post/page.tsx src/app/dashboard/video-script/page.tsx src/app/dashboard/event-plan/page.tsx src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx src/app/dashboard/market-research/page.tsx tests/recent-generated.test.ts tests/event-plan-history.test.ts
git commit -m "feat: restore recent output in every generator"
```

---

### Task 5: Central History Filtering and AI Research Transcript

**Files:**
- Create: `tests/history-page.test.ts`
- Modify: `src/app/dashboard/history/page.tsx`
- Modify: `src/app/dashboard/ai-research/page.tsx`
- Carefully modify existing uncommitted: `src/app/api/ai-research/chat/route.ts`
- Carefully modify existing uncommitted: `src/lib/ai-research.ts`
- Carefully modify existing uncommitted: `tests/ai-research.test.ts`

**Interfaces:**
- Consumes existing AI endpoints: list `{ conversations }`; detail `{ id, messages, model }`.
- Produces central filter type `CentralHistoryType = TaskHistoryType | 'ai-research' | 'all'`.

- [ ] **Step 1: Preserve and inspect existing AI Research work**

```bash
git diff -- src/app/api/ai-research/chat/route.ts
git diff --no-index /dev/null src/lib/ai-research.ts || true
git diff --no-index /dev/null tests/ai-research.test.ts || true
```

Save output to `/tmp/marketingos-ai-research-pre-history.patch`. Do not use `git checkout`, `git restore`, or overwrite these files.

- [ ] **Step 2: Write failing history-page tests**

Assert:

- `useSearchParams()` reads `type`.
- Unsupported type falls back to `all`.
- `ai-research` is a visible tab.
- Active AI tab fetches `/api/ai-research/chat`.
- Selecting conversation fetches `/api/ai-research/chat?id=`.
- Failed task/conversation requests show explicit errors.
- AI sidebar contains label `Conversation history` and no empty catch.

- [ ] **Step 3: Run and verify RED**

```bash
npx tsx --test tests/history-page.test.ts tests/ai-research.test.ts
```

Expected: history-page assertions fail; existing AI tests remain green.

- [ ] **Step 4: Implement central filter and transcript**

Wrap query-param usage in a client component compatible with Next.js 16 suspense requirements if build demands it. Validate against:

```ts
const CENTRAL_TYPES = ['all', ...TASK_HISTORY_TYPES, 'ai-research'] as const;
```

For task tabs, keep the existing renderer/download gates. For AI Research, request list only while active; select a conversation and render role-labelled messages plus model/date. Never expose delete in central History.

- [ ] **Step 5: Make AI sidebar errors explicit**

Replace silent `catch {}` in `loadConversations` with `setError('Failed to load conversation history.')`. Check `response.ok` for list/detail/delete. Add visible `Conversation history` heading. Preserve new/open/delete semantics and existing search/normalization changes.

- [ ] **Step 6: Run tests, lint, build checkpoint**

```bash
npx tsx --test tests/history-page.test.ts tests/ai-research.test.ts tests/event-plan-history.test.ts
npx eslint src/app/dashboard/history/page.tsx src/app/dashboard/ai-research/page.tsx src/app/api/ai-research/chat/route.ts src/lib/ai-research.ts tests/history-page.test.ts tests/ai-research.test.ts
npm run build
```

Expected: tests PASS, lint exit 0 for these files, production build exit 0.

- [ ] **Step 7: Commit without absorbing unrelated AI changes accidentally**

Review `git diff --stat` and `git diff`. If pre-existing AI changes are logically required and tested, commit them explicitly with this task; otherwise stage only history hunks using `git add -p`.

```bash
git add -p src/app/api/ai-research/chat/route.ts src/lib/ai-research.ts tests/ai-research.test.ts
git add src/app/dashboard/history/page.tsx src/app/dashboard/ai-research/page.tsx tests/history-page.test.ts
git commit -m "feat: unify task and AI research history"
```

---

### Task 6: Generator Error Contract and Session-Expired Modal

**Files:**
- Create: `src/lib/generator-errors.ts`
- Create: `src/components/GeneratorErrorModal.tsx`
- Create: `tests/generator-errors.test.ts`

**Interfaces:**
- Produces:

```ts
export type GeneratorErrorState = {
  kind: 'session-expired' | 'generation-error';
  title: string;
  message: string;
  returnTo?: string;
};
export function classifyGeneratorResponse(status: number, serverMessage?: string, pathname?: string): GeneratorErrorState;
export function safeDashboardReturnPath(value: string): string;
```

- [ ] **Step 1: Write failing pure tests**

Test exact 401 state/copy, sanitized 500 message, and path allowlisting:

```ts
assert.equal(safeDashboardReturnPath('/dashboard/social-post?tab=create'), '/dashboard/social-post?tab=create');
assert.equal(safeDashboardReturnPath('https://evil.example'), '/dashboard');
assert.equal(safeDashboardReturnPath('//evil.example'), '/dashboard');
const expired = classifyGeneratorResponse(401, 'Unauthorized', '/dashboard/social-post');
assert.equal(expired.kind, 'session-expired');
assert.equal(expired.title, 'Session Expired');
```

- [ ] **Step 2: Run and verify RED**

```bash
npx tsx --test tests/generator-errors.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement pure contract and modal**

Modal requirements:

- `role="alertdialog"`, `aria-modal="true"`, labelled title/description.
- Session action text `Sign In Again`.
- Action writes safe return path to `sessionStorage.setItem('marketingos:returnTo', returnTo)` and sets `window.location.href = '/login'`.
- General error action text `Close`.
- No auto-redirect.

Exact expired message:

```text
Your login session expired while MarketingOS was working. Your generation may still complete safely on the server. Sign in again to continue and recover it from History.
```

- [ ] **Step 4: Run tests and lint**

```bash
npx tsx --test tests/generator-errors.test.ts
npx eslint src/lib/generator-errors.ts src/components/GeneratorErrorModal.tsx tests/generator-errors.test.ts
```

Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/generator-errors.ts src/components/GeneratorErrorModal.tsx tests/generator-errors.test.ts
git commit -m "feat: add visible generator error modal"
```

---

### Task 7: Stop Polling and Show Modal on 401

**Files:**
- Modify: `src/app/dashboard/social-post/page.tsx`
- Modify: `src/app/dashboard/video-script/page.tsx`
- Modify: `src/app/dashboard/event-plan/page.tsx`
- Modify: `src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx`
- Modify: `src/app/dashboard/market-research/page.tsx`
- Modify: `tests/image-job-status.test.ts`
- Modify: `tests/generator-errors.test.ts`

**Interfaces:**
- Consumes `classifyGeneratorResponse` and `GeneratorErrorModal`.
- Each page keeps `generatorError: GeneratorErrorState | null`.

- [ ] **Step 1: Add failing source-contract assertions**

For Social Post assert both image POST and poll GET branch on `response.status === 401`, call `stopImageTracking()`, increment `imageRunRef`, set `generatingImage` false, and render `GeneratorErrorModal`. For four SSE generators assert initial non-OK 401 opens the modal. Assert no interval is created after a terminal 401.

- [ ] **Step 2: Run and verify RED**

```bash
npx tsx --test tests/image-job-status.test.ts tests/generator-errors.test.ts
```

Expected: new source assertions fail.

- [ ] **Step 3: Integrate Social Post polling**

Before generic errors:

```ts
if (statusResponse.status === 401) {
  imageRunRef.current += 1;
  stopImageTracking();
  setGeneratingImage(false);
  setImageProgress(null);
  setGeneratorError(classifyGeneratorResponse(401, status.error, window.location.pathname + window.location.search));
  return true;
}
```

Apply equivalent handling to image-job startup and social-post generation. Do not call an image cancellation endpoint.

- [ ] **Step 4: Integrate four other generators**

On initial response 401, set modal state before trying to consume SSE. General server errors also use modal while preserving inline validation errors for form-level user mistakes.

- [ ] **Step 5: Run focused tests and build**

```bash
npx tsx --test tests/generator-errors.test.ts tests/image-job-status.test.ts tests/recent-generated.test.ts
npx eslint src/app/dashboard/social-post/page.tsx src/app/dashboard/video-script/page.tsx src/app/dashboard/event-plan/page.tsx src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx src/app/dashboard/market-research/page.tsx
npm run build
```

Expected: tests PASS and build exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/social-post/page.tsx src/app/dashboard/video-script/page.tsx src/app/dashboard/event-plan/page.tsx src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx src/app/dashboard/market-research/page.tsx tests/image-job-status.test.ts tests/generator-errors.test.ts
git commit -m "fix: surface expired generator sessions"
```

---

### Task 8: Normalize and Validate Video Script Output

**Files:**
- Create: `src/lib/video-script-output.ts`
- Create: `tests/video-script-output.test.ts`
- Modify: `src/app/api/video-script/generate/route.ts:378-463`
- Modify: `src/lib/task-history.ts`
- Modify: `tests/task-history.test.ts`

**Interfaces:**
- Produces:

```ts
export interface VideoScriptOutput { hook: string; hookOptions: string[]; context: string; highlight: string; brandTieIn: string; cta: string; fullScript: string; }
export function normalizeVideoScriptOutput(raw: string | Record<string, unknown>): VideoScriptOutput;
export function validateFullScript(fullScript: string, requestedDuration: string): { valid: boolean; errors: string[] };
export function buildVideoScriptRepairPrompt(output: VideoScriptOutput, duration: string): string;
```

- [ ] **Step 1: Write failing parser tests using the real production failure shape**

Fixture starts with:

```ts
const malformed = '<think></think>{"hook":"5 TAHUN?!","hookOptions":[],"context":"...","highlight":"...","brandTieIn":"...","cta":"...","fullScript":"[00:00-00:05]\\n[VISUAL: ...]\\n[SFX: ...]\\n[MUSIC: ...]\\n[VO: Kalimat satu. Kalimat dua. Kalimat tiga.]\\n\\n[00:05-00:15]..."}';
```

Assert marker removal, JSON extraction around prose/fences, nested JSON recovery, and no raw JSON in `fullScript`.

- [ ] **Step 2: Write failing scene-validator tests**

Accept at least three chronological scenes containing timestamp/visual/SFX/music/VO or dialogue. Reject missing tags, overlapping/backward timestamps, `<think>`, raw JSON, fewer than three scenes, and a final timestamp outside a ±5-second tolerance from parsed requested duration.

- [ ] **Step 3: Run and verify RED**

```bash
npx tsx --test tests/video-script-output.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 4: Implement parser and validator**

Use standard library only. Extract JSON by scanning balanced braces while respecting quoted strings/escapes; do not use a greedy regex. Parse durations such as `30-45 seconds` as an allowed range; accept final timestamp within the range plus 5 seconds. Parse scene timestamps with `/\[(\d{2}):(\d{2})-(\d{2}):(\d{2})\]/g`.

- [ ] **Step 5: Patch full-generation route with one repair attempt**

Flow:

```ts
let scriptData = normalizeVideoScriptOutput(result.content);
let validation = validateFullScript(scriptData.fullScript, duration || '30-45 seconds');
if (!validation.valid) {
  const repaired = await generateContent(smartSystem, buildVideoScriptRepairPrompt(scriptData, duration || '30-45 seconds'), userId, taskId, { ...sameOptions, temperature: 0.2 });
  scriptData = normalizeVideoScriptOutput(repaired.content);
  validation = validateFullScript(scriptData.fullScript, duration || '30-45 seconds');
}
if (!validation.valid) throw new Error(`Video script formatting failed: ${validation.errors.join(' ')}`);
```

Persist only after valid output. Keep campaign facts from selected preview. Update prompt to require deterministic scene blocks and prohibit JSON text inside `fullScript`.

- [ ] **Step 6: Normalize old history at read time**

Have `restoreVideoScript` call `normalizeVideoScriptOutput` when `fullScript` itself contains serialized JSON/reasoning wrappers. Catch item-level failures as `HistoryRecordError`. Do not update DB.

- [ ] **Step 7: Run tests, lint, build**

```bash
npx tsx --test tests/video-script-output.test.ts tests/task-history.test.ts
npx eslint src/lib/video-script-output.ts src/app/api/video-script/generate/route.ts src/lib/task-history.ts tests/video-script-output.test.ts tests/task-history.test.ts
npm run build
```

Expected: tests PASS; build exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/video-script-output.ts src/app/api/video-script/generate/route.ts src/lib/task-history.ts tests/video-script-output.test.ts tests/task-history.test.ts
git commit -m "fix: enforce production-ready video scripts"
```

---

### Task 9: Full Verification and Independent Review

**Files:**
- Review all changed files; no expected new production files.

**Interfaces:**
- Confirms the complete spec before deployment.

- [ ] **Step 1: Run all targeted tests together**

```bash
npx tsx --test \
  tests/task-history.test.ts \
  tests/recent-generated.test.ts \
  tests/history-page.test.ts \
  tests/ai-research.test.ts \
  tests/event-plan-history.test.ts \
  tests/article-market-news-generator.test.ts \
  tests/market-research.test.ts \
  tests/video-script-output.test.ts \
  tests/generator-errors.test.ts \
  tests/image-job-status.test.ts
```

Expected: zero failures.

- [ ] **Step 2: Run repository verification**

```bash
npm run lint
npm run build
git diff --check
git status --short
git log --oneline -10
```

Expected: build exit 0, diff check clean. If global lint has pre-existing failures, prove changed-file lint is clean and list exact unrelated failures; do not claim global lint passed.

- [ ] **Step 3: Review data-safety and code diff**

```bash
git diff a310995..HEAD --stat
git diff a310995..HEAD -- src migrations scripts
```

Confirm no `DELETE FROM tasks`, `DELETE FROM ai_research_conversations`, `DROP`, data rewrite, migration, credential, `.env`, or generated output entered the diff.

- [ ] **Step 4: Dispatch independent code review**

Use `superpowers:requesting-code-review`. Reviewer must compare HEAD against `a310995`, specifically checking authentication scope, polling shutdown, old-record parsing, download review gates, AI history ownership, and accidental absorption of pre-existing AI changes.

- [ ] **Step 5: Fix findings through TDD, rerun verification, commit**

Any functional fix starts with a failing regression test. Commit only after all focused tests/build pass:

```bash
git commit -am "fix: address generator history review"
```

Skip this commit if review finds nothing.

---

### Task 10: PostgreSQL Backup, AWS Deployment, and Production Acceptance

**Files:**
- No source additions expected.
- Backup output: `/home/ubuntu/backups/marketingos-pre-history-<timestamp>.sql.gz`
- Local verification copy: `~/Backups/marketingos/marketingos-pre-history-<timestamp>.sql.gz`

**Interfaces:**
- Deploys verified HEAD to `/home/ubuntu/apps/marketingos` and PM2 app `marketingos` on AWS `16.78.68.56:3021`.

- [ ] **Step 1: Capture production baseline without exposing secrets**

```bash
ssh -i ~/.ssh/dpf_agent_server ubuntu@16.78.68.56 '
  cd /home/ubuntu/apps/marketingos
  printf "COMMIT="; git rev-parse HEAD
  pm2 describe marketingos | grep -iE "status|exec cwd"
  DB_URL=$(grep ^DATABASE_URL .env | cut -d= -f2-)
  psql "$DB_URL" -Atc "SELECT type, COUNT(*) FROM tasks GROUP BY type ORDER BY type; SELECT '\''ai-research'\'', COUNT(*) FROM ai_research_conversations;"
'
```

Save counts to `/tmp/marketingos-history-counts-before.txt` locally.

- [ ] **Step 2: Create and verify PostgreSQL backup**

On AWS:

```bash
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p /home/ubuntu/backups
DB_URL=$(grep ^DATABASE_URL /home/ubuntu/apps/marketingos/.env | cut -d= -f2-)
pg_dump "$DB_URL" | gzip -9 > "/home/ubuntu/backups/marketingos-pre-history-$stamp.sql.gz"
gzip -t "/home/ubuntu/backups/marketingos-pre-history-$stamp.sql.gz"
sha256sum "/home/ubuntu/backups/marketingos-pre-history-$stamp.sql.gz"
```

Copy to `~/Backups/marketingos/`, run `gzip -t` and `shasum -a 256`, and confirm hashes match.

- [ ] **Step 3: Push verified commits**

```bash
git status --short
git push origin main
```

Expected: only known pre-existing working-tree files remain, or tree is clean; remote main equals local HEAD.

- [ ] **Step 4: Deploy carefully on AWS**

Before pulling, inspect server diff and create source tar backup. Never overwrite server-local changes:

```bash
ssh -i ~/.ssh/dpf_agent_server ubuntu@16.78.68.56 '
  set -e
  cd /home/ubuntu/apps/marketingos
  git status --short
  tar czf ~/backups/marketingos-source-pre-history-$(date +%Y%m%d-%H%M%S).tgz --exclude=node_modules --exclude=.next --exclude=.git .
  git pull --ff-only origin main
  npm ci
  rm -rf .next
  npm run build
  pm2 restart marketingos --update-env
  pm2 describe marketingos | grep -i status
'
```

If server `git status` is non-clean, stop. Reconcile each known server change explicitly; do not reset.

- [ ] **Step 5: Verify readiness before browser acceptance**

```bash
ssh -i ~/.ssh/dpf_agent_server ubuntu@16.78.68.56 'curl -fsS http://127.0.0.1:3021/api/health && pm2 logs marketingos --lines 40 --nostream'
curl -fsS -o /dev/null -w '%{http_code}\n' https://marketing-aws.gorillaworkout.id/login
```

Expected: local health success, public HTTP 200, no startup errors.

- [ ] **Step 6: Authenticated production acceptance**

Use the browser with admin credentials already provided. Verify:

1. Social Post, Video Script, Event Plan, Article Market News, and Market Research each show Recent Generated.
2. Open one existing record in each page; confirm complete output, not raw JSON.
3. Each `View all history` URL selects the correct central tab.
4. AI Research sidebar says `Conversation history`; open an existing conversation.
5. Central AI Research tab opens the same transcript.
6. Existing malformed September 2 Video Script displays as clean scenes without changing DB.
7. Generate one short Video Script; inspect clean chronological scene blocks and verify a new task row.
8. Start an image job, invalidate only the browser session cookie, wait for poll, verify centered Session Expired modal and no repeated polling requests; re-login and recover image from History.

- [ ] **Step 7: Compare production counts and source hashes**

Run the same count query from Step 1. Required result:

- No type count decreases.
- AI Research conversation count does not decrease.
- Video Script may increase by exactly the smoke-test task.

Verify local/server commit and hashes:

```bash
LOCAL=$(git rev-parse HEAD)
REMOTE=$(ssh -i ~/.ssh/dpf_agent_server ubuntu@16.78.68.56 'cd /home/ubuntu/apps/marketingos && git rev-parse HEAD')
test "$LOCAL" = "$REMOTE"
```

- [ ] **Step 8: Final report**

Report exact commit, backup paths/checksums, before/after counts, test/build output, PM2/public health, six history acceptance results, Video Script validation result, and session-modal result. Never say complete if any acceptance check failed.
