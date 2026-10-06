# Import Chat into AI Research Memory — Phase A Design

## Overview

Phase A lets a signed-in AI Research user bring one existing Codex, ChatGPT, or Claude chat into MarketingOS. The full chat is stored immediately on that user's knowledge graph. Facts and important Q&A are drafted by the existing memory model, reviewed in a checklist, and written only after the user approves them.

The import starts from the AI Research Memory panel (`AiResearchMemoryPanel`). It does not create an `ai_research_conversations` thread, and it does not change how live AI Research chats learn memory.

Phase A includes a `chat_imports` table. Approve, cancel, retry, and per-user duplicate detection need a durable import id, a status, the full transcript, and the extract draft. The table is part of this design.

Names already used in the product stay as they are:

| Concept | Existing name |
| --- | --- |
| Fact rows | `user_memories` |
| Fact kinds | `role`, `interest`, `preference`, `style`, `context` |
| Fact graph task type | `user-memory` |
| Q&A rows | `ai_research_qa_index` |
| Q&A graph task type | `ai-research-qa` |
| Graph edge from a learned item to its source | `learned_from` |
| Graph edge between similar Q&A | `similar_question` |
| Memory panel and routes | `AiResearchMemoryPanel`, `/api/ai-research/memory` |
| Feature gate | `requireFeature(request, 'ai-research')` |
| Extract model | `AI_RESEARCH_MEMORY_MODEL` (`ag/gemini-3-flash`) |
| Graph focus link | `knowledgeGraphFocusUrl(id)` → `/dashboard/knowledge-graph?focus=<id>` |

The new graph task type is `imported-chat`. Its legend label is `Imported Chat` and its color is `#E11D48`.

## User flow

1. The user opens AI Research and opens Memory.
2. The user chooses **Import chat**.
3. The user picks a source: **Codex / ChatGPT**, **Claude**, or **Plain text**.
4. The user either pastes text or uploads one `.md`, `.txt`, or `.json` file.
5. MarketingOS parses the chat. The full chat is saved at once as a private `imported-chat` knowledge-graph node. The checklist is not required for this save.
6. The same request asks the memory model for facts and important Q&A.
7. When extraction succeeds, the modal becomes a review checklist. Every fact and Q&A row is checked by default. The user can edit text, change a fact's kind, or uncheck a row. The full transcript is not part of the checklist.
8. **Approve** writes the checked rows to `user_memories` and `ai_research_qa_index`, then mirrors them into the knowledge graph the same way live memory does. Unchecked rows are discarded.
9. **Cancel** drops the extract draft and leaves the saved chat in place. The modal then says `Draft discarded. The chat stays in your knowledge graph.` and offers **Retry extract** and **Close**.
10. If extraction fails, the chat stays saved and the modal offers **Retry extract**. There is nothing to approve until a draft exists.
11. Pasting or uploading the same chat again is rejected. The error offers **View chat** for the existing import. An admin also gets **Open in Knowledge Graph**.
12. After the modal closes, the Memory panel lists that user's imported chats. From a row the user can view the transcript, reopen a review, or retry extraction. That list is how a non-admin gets back to the chat. The Knowledge Graph page is admin-only and redirects everyone else to `/dashboard`.

Approving with every row unchecked is allowed. The chat remains saved, no fact or Q&A rows are added, and the import is marked approved.

The Memory on/off switch does not block import or approve. The switch still controls whether saved facts and Q&A are read into later AI Research prompts. When the switch is off, the review screen says: `Memory is off. This chat is still saved. Approved facts and answers are stored, and Dupoin AI will not use them until you turn memory on.`

## Architecture

```text
Memory panel
  → Import modal (source + Paste or Upload)
  → POST /api/ai-research/imports
       parse one chat
       reject a duplicate hash for this user
       save chat_imports + knowledge_entries task_type imported-chat
       LLM extract into chat_imports.draft
  → review checklist
       Approve → POST /api/ai-research/imports/:id/approve
            user_memories + ai_research_qa_index
            mirrorUserMemory / mirrorQaTurn
            learned_from edges to the imported-chat node
       Cancel → POST /api/ai-research/imports/:id/cancel
            delete draft, keep the graph node
       Retry  → POST /api/ai-research/imports/:id/extract
```

Parsing, hashing, and draft validation are pure functions. Route handlers authenticate, enforce limits, and call those functions. Graph writes go through the existing per-user memory graph store.

### Parsers

The selected source decides the parser. Phase A does not auto-detect a source the user did not pick.

Normalized message shape:

```text
role: user | assistant
content: string
```

System, tool, and empty messages are dropped. Title fallback, in order: export title, first user message trimmed to 80 characters, then `Imported chat`.

**Codex / ChatGPT (`codex`).** Accept a conversation object, a one-element array, or `{ conversations: [one] }`. Read `mapping` in parent/children order, starting at the node whose `parent` is null. When several nodes have a null parent, walk them in object key order and concatenate. Keep `user` and `assistant` turns. Read text from `message.content.parts` (strings only, joined with `\n`) or from a string `message.content` / `message.content.text`. Also accept a single object whose `messages` array already uses `role` and string `content`, for a hand-copied Codex transcript.

**Claude (`claude`).** Accept a conversation object, a one-element array, or `{ conversations: [one] }`. Read `chat_messages` in array order. `sender: human` becomes `user`. `sender: assistant` becomes `assistant`. Read `text`, or join `content` blocks whose `type` is `text` with `\n`. Title comes from `name`, then `title`.

**Plain text (`text`).** Do not parse JSON. If a line starts with `You:`, `User:`, `Human:`, `Assistant:`, `Claude:`, `ChatGPT:`, or `Codex:` (case-insensitive), start a new message and map the first three labels to `user` and the rest to `assistant`. Otherwise keep one `user` message containing the whole paste. This fallback is for prose transcripts, not for a failed export.

**Recognized export envelope.** When the source is `codex` or `claude` and the body is valid JSON, an array or `conversations` array whose length is not exactly 1 is a hard rejection. Nothing is saved. The error is `Import one chat at a time.` Bulk archive import is out of scope.

**Parser failure.** Any other failure to produce at least one `user` or `assistant` message falls through to the plain-text rules on the original text. The row records `parser = text` and `parser_fallback = true`. Extraction still runs. The modal says `This chat was saved as plain text.`

### What is stored where

The full canonical transcript lives in `chat_imports.transcript` (up to 200,000 characters).

The graph node is the stored handle:

- `task_type`: `imported-chat`
- `task_id`: `chat_imports.id`
- `brief`: title, at most 240 characters
- `selected_output`: canonical transcript prefix, at most 8,000 characters (the same cap `memoryGraphText` and `qaGraphText` use)
- `content_hash`: the transcript hash below. Do not copy the memory graph store's current habit of writing `task_id` into `content_hash`.
- `conversation_id`: null
- `quality_score`: 0.7
- `embedding`: local `getEmbedding` of title plus the stored prefix

`imported-chat` is not added to `AI_RESEARCH_RETRIEVAL_TASK_TYPES`. Later research answers learn from approved `user_memories` and `ai_research_qa_index` rows, not from the raw transcript. `knowledgeEmbeddingInput` treats `imported-chat` like `user-memory`: embed brief and selected output together so the node can sit near related memory, without putting the transcript into the research retrieval set.

### Who can see the graph node

The node is always stored under the importer's `user_id`.

`GET /api/knowledge/graph` already limits rows to the session user. An imported chat returned there is only the caller's own.

`/dashboard/knowledge-graph` loads `/api/admin/knowledge-graph` and is `adminOnly`. That admin query currently returns every user's `brief`. Phase A adds one predicate so another person's import is omitted:

```sql
AND (ke.task_type <> 'imported-chat' OR ke.user_id = ?)
```

The bound value is the signed-in admin's id. Use it on every admin graph query that lists or counts `knowledge_entries`: the node list, department rollups, task-type breakdown, and headline entry, edge, and contributor counts. An edge is included only when both endpoints pass the predicate. Learning-health queries read `tasks` and stay unchanged. `user-memory` and `ai-research-qa` visibility is unchanged. The admin node payload adds `taskId` for the caller's own `imported-chat` rows so the selected-record panel can call the import API. It still does not add the transcript.

A signed-in admin therefore sees their own `imported-chat` nodes, colored `#E11D48` and labeled `Imported Chat`. They do not see another user's imported title, excerpt, or transcript. A non-admin never reaches this page. Their saved chat is listed in the Memory panel.

Style learning ignores the new type. `shouldUpdateStylePreferences` returns false for `imported-chat`, and the style-sample query excludes it next to `user-memory` and `ai-research-qa`.

### Extraction

One synchronous model call uses `AI_RESEARCH_MEMORY_MODEL`, `temperature` 0.1, `maxTokens` 2000, `responseFormat: { type: 'json_object' }`, `jsonRepairAttempts` 0, and `taskType: 'ai-research'` so token logs stay on the current feature. The call does not go through `extractUserMemories` or `indexQaTurn`. Those paths no-op while memory is off and the live fact parser keeps at most 4 facts per turn. Import has its own parser and its own caps.

The prompt asks for JSON:

```json
{
  "facts": [{ "kind": "role", "content": "string", "confidence": 0.8 }],
  "qa": [{ "question": "string", "answerSummary": "string" }]
}
```

`kind` must be one of the five memory kinds. A fact is a durable statement about the user. A Q&A pair is kept only when the answer states a reusable fact, decision, preference, or procedure. Greetings and acknowledgements are dropped.

Server limits after the model returns:

- At most 12 facts, matching `PROFILE_MEMORY_LIMIT`.
- At most 8 Q&A pairs.
- Fact content is 3–280 characters, the same bounds as `validateMemoryContent`.
- Question is 3–2,000 characters. Answer summary is 1–500 characters, matching `summarizeAnswer`.
- A fact, question, or answer summary that matches `isSensitiveMemory` is removed before the draft is stored.
- Each remaining row gets a UUID and `included: true`.
- Fact confidence is clamped to 0–1. Missing or non-numeric confidence becomes 0.5.

Input to the model is the canonical transcript. When that transcript is longer than 24,000 characters, send the first 12,000, a line `...[middle omitted]...`, and the last 12,000. The stored transcript is still complete. Facts that appear only in the omitted middle are not extracted; the user cannot type a new checklist row that the server did not draft.

A model error, timeout, empty body, or unparseable JSON sets status `extract_failed`, stores the sanitized message `Fact extraction failed.`, and leaves `draft` as empty arrays. The chat row and graph node stay.

### Content hash

```text
canonical = messages mapped to `${role}\n${content}` joined by `\n---\n`
content_hash = sha256 hex of canonical
```

Each message content is NFKC-normalized, `\r\n` becomes `\n`, trailing spaces on a line are removed, and leading and trailing blank lines of that message are removed. Content is not lowercased, so two chats that differ only by case stay distinct. Export metadata, timestamps, and titles are not part of the hash, so a second export of the same messages collides.

The unique key is `(user_id, content_hash)`. The same transcript may exist for two different users. Insert is one transaction: knowledge node first, then `chat_imports` with status `extract_failed`, an empty draft, and a null error. That status is not approvable. The request then runs extraction. Success updates the row to `review` and stores the draft. Failure sets `error` to `Fact extraction failed.` and leaves `extract_failed`. A crash after the commit and before that update leaves a retryable chat, not an empty draft the user could approve. A unique-constraint violation rolls the transaction back and returns the same 409 as a duplicate found beforehand, after re-reading the existing row for this user.

### Approve writes

Approve reads the stored draft, not a client-invented list. A client id that is not in the draft, or a kind outside the five memory kinds, fails the request and writes nothing. A draft id the client omits is treated as unchecked and is discarded.

For each included fact that passes `validateMemoryContent`:

- Recompute `memoryContentHash(kind, content)`.
- If this user already has that hash, use the existing upsert and let `mention_count` increase. Do not insert a second fact.
- Otherwise insert a `user_memories` row with `source_conversation_id` null, `mention_count` 1, and confidence at least 0.8 so an approved interest passes `isPromotedMemory` on its own.
- Call `mirrorUserMemory`.

For each included Q&A pair:

- Normalize the question with `normalizeQuestion`.
- If this user already has that `question_norm`, skip the insert and count it as already saved.
- Otherwise insert `ai_research_qa_index` with `conversation_id` null, `sources` `[]`, and a local embedding of the question.
- Call `mirrorQaTurn`.

Then add one `learned_from` edge from each new or updated memory graph node, and from each newly inserted Q&A graph node, to this import's `imported-chat` node. Weight is 1. This is one edge per approved row, not the live-chat cap of 8, because there is exactly one source node. `similar_question` edges among Q&A still use `planSimilarQaEdges` (score at least 0.6, at most 8). `mirrorUserMemory` will not invent those import edges by itself: its conversation matcher only links `ai-research` and `ai-research-qa` nodes that share a `conversation_id`, and the import node has none.

After a successful approve, `draft` is cleared, status becomes `approved`, and `approve_result` stores `{ "factsSaved", "factsAlreadySaved", "qaSaved", "qaAlreadySaved" }`. A second approve returns those stored counts with `alreadyApproved: true` and does not insert again.

## Data model

Add `db/migrations/028_chat_imports.sql`. It is forward-only and idempotent, like `026_ai_research_memory.sql`.

```sql
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
```

Status meanings:

| Status | Meaning |
| --- | --- |
| `review` | Chat is saved and a draft is waiting. |
| `extract_failed` | Chat is saved, draft is empty, retry is available. |
| `chat_only` | The user cancelled. Draft is empty. Retry is available. |
| `approved` | The user approved, including an approval of zero rows. Draft is empty. |

Draft shape:

```json
{
  "facts": [
    { "id": "uuid", "kind": "context", "content": "Works on Dupoin campaigns.", "confidence": 0.8, "included": true }
  ],
  "qa": [
    { "id": "uuid", "question": "Where is the brand guide?", "answerSummary": "Internal Docs, Dupoin brand guideline.", "included": true }
  ]
}
```

`knowledge_entries` gains no new columns. Register `imported-chat` on `KNOWLEDGE_TASK_TYPES` after `ai-research-qa`, and add it to `KNOWLEDGE_FEATURE_COLORS` and the legend label map:

- Color `#E11D48`
- Label `Imported Chat`

`#E11D48` is unused. Its RGB distance to every current legend color is at least 70, which is the existing uniqueness rule in `tests/knowledge-graph-colors.test.ts`. The label matches `/^[A-Za-z0-9 &]+$/`.

No `task_model_preferences` check change is required. Import always uses `AI_RESEARCH_MEMORY_MODEL` and logs the call as `ai-research`.

## APIs

All routes use `requireFeature(request, 'ai-research')`. Every read and write includes `user_id = auth.id`. A missing row and another user's row both return 404 `Import was not found.`

### `POST /api/ai-research/imports`

Paste and upload share this path.

Paste: `Content-Type: application/json` with `{ "source": "codex" | "claude" | "text", "text": "string" }`.

Upload: `multipart/form-data` with fields `source` and `file`. The filename extension must be `.md`, `.txt`, or `.json` (case-insensitive). The body must be valid UTF-8.

Limits, checked before parse:

- Paste `text` uses JavaScript string length. Over 200,000 characters returns 413 `Paste is limited to 200,000 characters.`
- File bytes over `5 * 1024 * 1024` return 413 `File is limited to 5 MB.`
- Decoded file text over 200,000 characters returns 413 `Chat is limited to 200,000 characters.`
- Empty text after trim returns 400 `Add a chat to import.`
- A missing or unknown source, the wrong content type, a disallowed extension, or invalid UTF-8 returns 400 with one of these sentences: `Choose a source.`, `Send the chat as JSON or as a file.`, `Use a .md, .txt, or .json file.`, or `That file is not valid UTF-8 text.`

A recognized multi-chat envelope returns 400 `Import one chat at a time.` and writes nothing.

A duplicate `(user_id, content_hash)` returns 409:

```json
{
  "error": "This chat is already imported.",
  "existingImportId": "uuid",
  "knowledgeEntryId": "uuid"
}
```

`knowledgeEntryId` is the owner's graph node. It is not a promise that a non-admin can open the admin graph page.

Success returns 200. The chat is committed before extraction. Extraction failure is still 200, with `status: "extract_failed"`.

```json
{
  "import": {
    "id": "uuid",
    "source": "codex",
    "parser": "codex",
    "parserFallback": false,
    "title": "Campaign voice",
    "status": "review",
    "knowledgeEntryId": "uuid",
    "memoryEnabled": true,
    "draft": { "facts": [], "qa": [] },
    "error": null
  }
}
```

The response does not include the transcript.

### `GET /api/ai-research/imports`

Owner-only list for the Memory panel. Returns every import for this user, newest `created_at` first. Each row has `id`, `title`, `status`, `source`, `parserFallback`, `createdAt`, and `knowledgeEntryId`. It does not include `transcript` or `draft`.

### `GET /api/ai-research/imports/:id`

Owner-only. Returns the same import object as create, plus `transcript`. This is the only read that returns the full chat. The graph list payloads keep returning `brief` only.

### `POST /api/ai-research/imports/:id/approve`

Body:

```json
{
  "facts": [{ "id": "uuid", "kind": "context", "content": "edited text", "included": true }],
  "qa": [{ "id": "uuid", "question": "edited question", "answerSummary": "edited summary", "included": false }]
}
```

Allowed only from `review`. `extract_failed` and `chat_only` return 409 `Extract facts before approving.` An already `approved` import returns 200 with the previous counts and `alreadyApproved: true`.

If any included row fails validation, return 400 and leave status `review`. Unchecked rows are not an error.

```json
{
  "status": "approved",
  "factsSaved": 2,
  "factsAlreadySaved": 1,
  "qaSaved": 1,
  "qaAlreadySaved": 0
}
```

### `POST /api/ai-research/imports/:id/cancel`

From `review` or `extract_failed`, set status `chat_only`, set `draft` to empty arrays, clear `error`, and keep the graph node. From `chat_only`, return 200 with no further change. From `approved`, return 409 `This import is already approved.`

### `POST /api/ai-research/imports/:id/extract`

Retry from `extract_failed` or `chat_only`. On success, replace `draft` and set status `review`. On failure, set `extract_failed` again. `review` and `approved` return 409 `Nothing to extract.`

## UI

English only. No new locale files and no translated strings.

The Memory panel gains one button, **Import chat**, directly under the memory on/off row. It is available when the memory list is empty and when memory is off. Under the button, the panel lists this user's imported chats from `GET /api/ai-research/imports`. Each row shows the title, source label (`Codex / ChatGPT`, `Claude`, or `Plain text`), status, and date. Actions on a row:

- **View chat** on every status. Loads `GET /api/ai-research/imports/:id` and shows the transcript read-only in the modal.
- **Review facts** when status is `review`. Reopens the checklist.
- **Retry extract** when status is `extract_failed` or `chat_only`.

The panel stays open behind the modal.

The modal matches the existing prior-answer preview: full-width bottom sheet on small screens, centered dialog from `sm` up, stacked above the panel. Paste and Upload are tabs. Source is a three-way select shown on both tabs. Submit label is **Import**.

Review state:

- Confirmation line: `Full chat saved to your knowledge graph.` **View chat** loads `GET /api/ai-research/imports/:id` and shows the transcript. When the dashboard session role is `admin`, also show `Open in Knowledge Graph`, using `knowledgeGraphFocusUrl`. Non-admins do not see that link. The import API does not return the role.
- Facts grouped with the existing labels Role, Interests, Preferences, Style, Context. Each row has a checkbox, a kind select, and a text field of at most 280 characters.
- Q&A rows have a checkbox, a question field, and an answer field.
- Primary action **Approve**. Secondary action **Cancel**.
- Parser-fallback banner when `parserFallback` is true: `This chat was saved as plain text.`
- Memory-off note, when `memoryEnabled` is false, uses the sentence in User flow.

Extract-failed state replaces the checklist with `The chat was saved. Fact extraction failed.`, **View chat**, and **Retry extract**. Approve is not shown.

Duplicate 409 replaces the form error area with `This chat is already imported.` plus **View chat**. Admins also get **Open in Knowledge Graph**. Nothing new is saved.

The knowledge graph legend and the existing **Filter by source feature** control pick up `Imported Chat` from the palette when the signed-in admin's own import nodes are in the map. No separate legend component is added. Node color comes from `knowledgeFeatureColor('imported-chat')`. The selected-record panel uses that node's `taskId` as the import id and offers the same **View chat**, **Review facts**, and **Retry extract** actions as the Memory list. It does not render another user's import, because the admin query omitted it.

The admin knowledge-graph query already returns `brief` for every entry and returns `selected_output` only for `ai-research`. Import keeps the transcript out of `brief`. Do not extend that admin query to return `chat_imports.transcript` or `imported-chat` selected output.

## Errors and security

| Case | Result |
| --- | --- |
| Unauthenticated or no AI Research access | Existing `requireFeature` status and message |
| Over paste or decoded-file character limit | 413, nothing saved |
| Over 5 MB | 413, nothing saved |
| Empty input, bad source, bad file type, bad UTF-8 | 400, nothing saved |
| Multi-chat export | 400, nothing saved |
| Parser cannot find a conversation | Raw-text save, then best-effort extract |
| Extract fails | Chat kept, status `extract_failed`, retry available |
| Duplicate hash for this user | 409 with the existing graph id |
| Approve or cancel for another user | 404 |
| Included row fails memory validation | 400, draft unchanged |

Sensitive fact and Q&A text is removed with `isSensitiveMemory` before a draft is shown, and `validateMemoryContent` rejects it again on approve.

Isolation rules:

- Import queries are parameterized and always bind the session user id.
- `GET` list and `GET` transcript are owner-only.
- `GET /api/knowledge/graph` stays filtered to the session user's `knowledge_entries`.
- `/api/admin/knowledge-graph` returns an `imported-chat` node only when `user_id` is the signed-in admin.
- Edges are created only between nodes returned for that same user id.
- Approve never calls `indexQaTurn` or `extractUserMemories`, so a memory switch that is off cannot silently skip an explicit approve, and it also cannot start a second live-chat extract.
- The full transcript is not written to logs. Log the import id and status only.
- Uploaded filenames are not used as titles or as storage keys.

Cancel and a failed extract do not delete the graph node. Phase A has no delete route.

## Testing

Use the repo's `node:test` style. Cover behavior with unit tests around pure parsers, hash, draft filtering, and route SQL strings, following `tests/ai-research-memory.test.ts` and `tests/knowledge-graph-colors.test.ts`.

Parsers and hash:

- Codex `mapping` order follows parent to children and drops tool turns.
- A one-element Codex or Claude array imports that conversation.
- An array of two conversations returns the multi-chat error and does not hash as one blob.
- Claude `human` / `assistant` and `content` text blocks map to the normalized roles.
- Plain text splits on the listed speaker labels and otherwise stays one user message.
- Invalid JSON for source `codex` sets parser fallback and still produces a transcript.
- The hash ignores title and timestamps and changes when message text changes.
- The same hash for a second user is not a duplicate. The same hash for the same user is a duplicate, including when the unique constraint fires on a concurrent insert.

Approve, cancel, retry:

- Approve of a checked fact and Q&A inserts `user_memories` and `ai_research_qa_index` with the session user id, mirrors both task types, and adds `learned_from` to the import node.
- An included sensitive row returns 400 and does not write.
- A client fact id that was not in the draft returns 400 and does not write.
- Unchecked rows are omitted.
- A fact whose `content_hash` already exists increments the existing memory instead of inserting.
- A Q&A whose `question_norm` already exists is counted as already saved.
- A second approve does not insert again.
- Cancel clears `draft`, sets `chat_only`, and leaves the `imported-chat` row.
- Extract failure persists the chat and a later extract success moves status to `review`.

Limits, color, and isolation:

- 200,001 characters and `5 * 1024 * 1024 + 1` bytes are rejected before insert.
- `knowledgeFeatureLabel('imported-chat')` is `Imported Chat` and the palette still has unique colors at least 70 RGB apart.
- `AI_RESEARCH_RETRIEVAL_TASK_TYPES` does not contain `imported-chat`.
- `shouldUpdateStylePreferences('imported-chat', 'approve')` is false.
- Route SQL for import list, read, approve, cancel, and extract includes `user_id = ?`.
- The admin graph SQL keeps another user's `imported-chat` row out of the node list and the task-type breakdown.

No browser harness is required for this document. Implementation acceptance is those tests plus one manual pass: paste a short Codex JSON, see the chat in the Memory list before approve, approve one fact, confirm that fact in the Memory panel, and confirm a second paste offers **View chat**. An admin also confirms their own node appears on the organization map with the Imported Chat color, and that another user's import does not.

## Out of scope

Phase C, automatic Codex ↔ MarketingOS sync, is not in this work. No webhooks, no background poll, no shared credentials, and no continuous two-way conversation sync.

Also out of scope:

- Importing a multi-conversation export in one action, or a picker of chats inside an archive.
- Deleting an imported chat, its graph node, or approved facts from the import modal. Approved facts are removed later only through the existing memory and graph delete controls. A duplicate import opens the existing chat instead of creating another one.
- Adding a checklist row the model did not return.
- Editing the stored transcript after import.
- Creating an AI Research conversation from the import.
- Sharing an import, or showing the transcript on the admin knowledge graph.
- Non-English UI copy.
- Changing the live-chat extractor, its 4-fact cap, or `ai_memory_enabled` prompt gating.
- A new embedding provider. Embeddings stay on local `getEmbedding`.
- A job queue. Extract runs inside the import request and can be retried with the extract route.

## Success criteria

Phase A is complete when all of the following are true:

1. From the Memory panel, a user with AI Research access can paste or upload one `.md`, `.txt`, or `.json` chat from Codex/ChatGPT, Claude, or plain text.
2. A chat within 200,000 characters and 5 MB is saved immediately as that user's `imported-chat` graph node. The legend color is `#E11D48` and the label is `Imported Chat`. On the admin organization map, only the signed-in admin's own imported chats appear. A non-admin sees the saved chat in the Memory panel list and can open the transcript there.
3. The user reviews only facts and Q&A. Approve writes those rows to `user_memories` and `ai_research_qa_index` and mirrors them like existing memory, with `learned_from` edges to the imported chat.
4. Cancel drops the draft and keeps the chat. Extract failure keeps the chat. Retry extract works from the failed modal, from the cancel confirmation, and later from the Memory list.
5. The same canonical transcript for the same user returns 409 and **View chat** for the existing import. A different user can import that same transcript.
6. No import query returns another user's transcript, draft, or row.
7. Live AI Research memory extraction and Phase C sync are unchanged.
