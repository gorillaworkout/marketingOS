# Generator History and Recovery Design

## Goal

Make every MarketingOS generation workflow recoverable from its own page and from one central History page. Preserve all existing production records. Fix malformed Video Script output rendering and make expired sessions visible through a modal instead of an off-screen error.

## Scope

Workflows:

1. Social Post
2. Video Script
3. Event Plan
4. Article Market News
5. Market Research
6. AI Research

Existing PostgreSQL records remain authoritative. No destructive migration, data rewrite, or backfill is required.

## Existing State

The five document-style generators already persist successful results in `tasks.output_data`. Production currently contains records for every type. The central History page can display all five types, but generator pages do not consistently expose or restore their own previous results.

AI Research persists conversations in `ai_research_conversations`, not `tasks`. Its sidebar already acts as conversation history. This separate storage model remains unchanged.

Video Script currently calls `JSON.parse()` directly on model output. A gateway response wrapped in reasoning markers such as `<think></think>{...}` fails parsing. The fallback then assigns the entire raw JSON response to `fullScript`, producing escaped, unusable output.

Image generation runs asynchronously. A session may expire while the detached server job continues. The next status poll returns HTTP 401, leaving the image completed but presenting the user with a generic error away from their current viewport.

## Architecture

### Shared recent-history API

Extend the authenticated history read path to accept a validated type filter and limit:

```text
GET /api/dashboard/history?type=<task-type>&limit=10
```

Rules:

- Scope records to the authenticated user.
- Accept only the five task-backed generator types.
- Default limit 10; enforce a small server-side maximum.
- Sort by `created_at DESC`.
- Return explicit non-2xx errors; clients must not silently convert failures to empty history.
- Keep the existing central all-task response compatible.

AI Research continues using:

```text
GET /api/ai-research/chat
GET /api/ai-research/chat?id=<conversation-id>
```

The central History page may request this endpoint separately when its AI Research tab is active. It must not copy chat messages into `tasks`.

### Shared Recent Generated component

Create one small reusable component for task-backed generators. It receives already-fetched rows and callbacks rather than owning generator-specific parsing.

Responsibilities:

- Render loading, error, empty, and populated states.
- Show title, creation date, status, and model when available.
- Expose a selection callback.
- Link to `/dashboard/history?type=<task-type>`.
- Remain usable on desktop and mobile.

Generator pages own their type-specific restore adapters because their output schemas differ.

### Generator restore behavior

#### Social Post

Restore:

- Brief and form context available in the task.
- Caption options and selected output.
- Image prompt.
- QC/research data.
- Generated-image history and latest image URL.

#### Video Script

Restore:

- Brief.
- Style and style label.
- Hook/context/highlight/brand tie-in/CTA.
- Preview options when present.
- Clean full script.

Old malformed records are normalized at read time. They are not rewritten in PostgreSQL.

#### Event Plan

Restore:

- Event brief and available form context.
- All generated options.
- Selected option defaults to the first available option.
- Research/source state.
- Existing DOC/JSON download behavior.

#### Article Market News

Restore:

- Effective input snapshot.
- Article title, meta description, body, word count, sources, and model.
- Manual fact-review confirmation resets to false whenever a historical article is opened.
- Existing DOCX gate remains enforced.

#### Market Research

Restore:

- Brief and research date.
- Report items, candidate counts, group/source status, evidence, and model.
- Manual full-article review confirmation resets to false whenever a historical report is opened.
- Existing DOCX gate remains enforced.

### AI Research history

Keep the existing conversation sidebar as the primary history UX. Improve it by:

- Labeling it clearly as conversation history.
- Showing explicit load/list errors rather than swallowing them.
- Keeping new/open/delete behavior unchanged.
- Adding an AI Research tab to central History that lists user-owned conversations and opens their message transcript.

No chat deletion behavior is changed.

### Central History page

The History page will:

- Parse and validate `?type=` on first load.
- Select the corresponding tab automatically.
- Support Social Post, Video Script, Event Plan, Article Market News, Market Research, and AI Research.
- Render type-specific details rather than raw JSON.
- Preserve download/review gates.
- Show API failures explicitly.

## Video Script output contract

### Parsing

Add a pure normalizer that:

1. Removes leading/trailing markdown fences.
2. Removes reasoning wrappers such as `<think>...</think>` and empty `<think></think>`.
3. Extracts the outermost valid JSON object when prose surrounds it.
4. Parses nested JSON accidentally stored inside `fullScript`.
5. Returns a typed script object or a clear validation failure.

### Full-script validation

A generated full script is accepted only when:

- `fullScript` is plain readable text, not serialized JSON.
- It contains at least three chronological scene blocks.
- Every scene contains `[TIMESTAMP]`, `[VISUAL]`, `[SFX]`, `[MUSIC]`, and `[VO]` or `[DIALOGUE]`.
- Timestamps do not overlap or move backward.
- The final timestamp approximately matches the requested duration.
- No `<think>` tag or JSON wrapper remains.

If initial output is structurally invalid, perform one repair generation using the same content and model. The repair prompt changes formatting only; it must not invent new campaign facts. If repair still fails, return a visible error and do not persist a broken completed task.

### Prompt format

Require one deterministic scene template:

```text
[00:00-00:05]
[VISUAL: ...]
[SFX: ...]
[MUSIC: ...]
[VO: ...]
```

The prompt must require production-ready Indonesian copy, concrete visual direction, complete spoken narration, chronological timing, and no JSON embedded inside `fullScript`.

## Session-expired modal

Create a shared client-side error modal pattern for generator pages.

When any active generation or polling request returns HTTP 401:

1. Stop polling/timers immediately.
2. Preserve any server-side job; do not cancel it.
3. Show a centered modal:
   - Title: `Session Expired`
   - Message: `Your login session expired while MarketingOS was working. Your generation may still complete safely on the server. Sign in again to continue and recover it from History.`
   - Primary action: `Sign In Again`
4. Store the current dashboard URL as a validated same-origin return path.
5. Redirect only after the user clicks the action.

Other generation failures use the same visible modal shell with the sanitized server message and a dismiss/retry action where safe. Browser-extension message-port errors are not treated as MarketingOS failures.

## Data Safety

- No `DELETE`, `DROP`, reset, or bulk rewrite.
- Existing task and conversation rows remain untouched.
- Old malformed Video Script records are repaired only in presentation memory, not in storage.
- Before production deployment, take a PostgreSQL dump and record its checksum.
- Compare task counts by type and AI conversation count before and after deployment.

## Error Handling

- Every history fetch checks `response.ok`.
- Empty history and failed history are distinct UI states.
- Malformed individual historical records show an item-level recovery message without breaking the whole panel.
- Session expiration always stops intervals to prevent repeated 401 requests.
- History links and return paths are allowlisted to same-origin dashboard paths.

## Testing

Use TDD.

### Unit tests

- Video Script parser removes reasoning wrappers and markdown fences.
- Parser extracts a JSON object surrounded by prose.
- Nested serialized full-script JSON is normalized.
- Scene validator accepts production-ready structure.
- Scene validator rejects missing fields, backward timestamps, raw JSON, and `<think>` markers.
- History type/limit validation rejects unsupported values.
- Restore adapters map representative persisted data for each generator.
- Session-expired response classification produces the modal action and stops polling.

### Component/integration checks

- Recent Generated renders loading/error/empty/list states.
- Selecting a history item restores the complete result for each generator.
- `View all history` opens the correct filtered tab.
- AI Research history loads, opens, and reports failures visibly.
- Review checkboxes reset when Article or Market Research history selection changes.

### Production acceptance

After backup, build, deploy, and PM2 restart:

1. Authenticate as admin.
2. Open each generator and verify its Recent Generated panel.
3. Restore one existing record for all five task-backed generators.
4. Open central History through each generator link and verify the active filter.
5. Open one AI Research conversation in its sidebar and central History.
6. Generate one Video Script and verify clean scene formatting plus persistence.
7. Simulate an expired cookie during polling and verify the modal, stopped polling, and return-to-page login flow.
8. Confirm task counts by type and AI conversation count did not decrease.

## Rollout

One coordinated deployment prevents schema/UI drift:

1. Preserve current unrelated local and server work.
2. Implement through isolated files/commits without overwriting existing uncommitted changes.
3. Run focused tests and production build locally.
4. Back up PostgreSQL and hash the dump.
5. Deploy to AWS with a clean Next.js build.
6. Restart PM2.
7. Run authenticated production acceptance.
8. Roll back application code only if needed; database rollback is unnecessary because this design adds no migration.
