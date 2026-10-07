# Codex Memory Sync — Phase C Design

## Overview

Phase C lets a signed-in AI Research user sync memory between MarketingOS and Codex on their laptop. The user creates a personal API token in Settings. A Codex skill on the laptop sends that token to a thin sync API. Pull reads that user's facts and recent Q&A. Push saves one chat through the Phase A import path. Facts and Q&A are written only when the user approves them in the existing Memory panel, unless that push explicitly sets `autoApprove` to true.

The browser session cookie is not a sync credential. Codex never receives the session cookie. The Memory panel remains the review surface. Phase A import, approve, cancel, and retry behavior stays as it is.

This design is architecture option 1: a personal API token, a thin sync API, and a laptop skill. An MCP server, and forwarding the browser cookie to Codex, are not this design.

## Existing names

Phase C uses the Phase A names. The Q&A table is `ai_research_qa_index`.

| Concept | Existing name |
| --- | --- |
| Fact rows | `user_memories` |
| Fact kinds | `role`, `interest`, `preference`, `style`, `context` |
| Q&A rows | `ai_research_qa_index` |
| Imported chat row | `chat_imports` |
| Import create | `createChatImport` |
| Import approve | `approveChatImport` |
| Memory panel | `AiResearchMemoryPanel` |
| Memory routes | `/api/ai-research/memory` |
| Import routes | `/api/ai-research/imports` |
| Feature gate | `requireFeature(request, 'ai-research')` |
| Public fact shape | `PublicMemory`: `id`, `kind`, `content`, `mentionCount`, `confidence`, `updatedAt` |
| Rate limit helper | `rateLimit` in `src/lib/rate-limit.ts` (30 requests per 60 seconds) |
| Admin usage page | `/dashboard/tokens`, label `Token usage` |

Phase C does not add a column to `chat_imports`, `user_memories`, or `ai_research_qa_index`.

## User flow

1. A user with AI Research access opens **API tokens** in the dashboard.
2. The user names a token and chooses **Create token**. MarketingOS shows the full `mos_` secret once. The user copies it into `MARKETINGOS_API_TOKEN` on the laptop and sets `MARKETINGOS_API_URL` to the MarketingOS origin.
3. In Codex, the user asks the skill to pull memory. The skill calls `GET /api/sync/memory` and shows facts and recent Q&A. When memory is off, the skill also says that Dupoin AI will not use those rows until memory is turned on.
4. The user asks the skill to push the current chat, or a Codex export file. The skill calls `POST /api/sync/import` with `autoApprove` false.
5. The chat is saved as that user's `chat_imports` row, the same way a paste import is saved. The skill tells the user to open AI Research → Memory and use **Review facts**. Approve, cancel, and retry stay on the Memory panel.
6. The user can instead tell the skill to approve without review. Only then does the skill send `autoApprove: true`. A successful extract is approved through `approveChatImport`. A failed extract is not approved. The Memory panel still lists the chat.
7. The user can rename an active token or revoke it. A revoked token stops working on the next sync call. Creating a replacement token does not revive the old secret.

## Architecture

```text
Settings page /dashboard/settings/api-tokens
  session cookie
  → /api/settings/tokens
       create, list, rename, revoke
       store sha256(token), return the secret once

Codex on the laptop
  skills file ~/.codex/skills/marketingos-memory/SKILL.md
  env MARKETINGOS_API_TOKEN, MARKETINGOS_API_URL
  → GET  /api/sync/memory?q=
       Authorization: Bearer mos_...
       user_memories + recent ai_research_qa_index
  → POST /api/sync/import
       Authorization: Bearer mos_...
       createChatImport (Phase A)
       autoApprove true → approveChatImport (Phase A)
       review stays in AiResearchMemoryPanel
```

Sync routes authenticate the bearer token and then call existing import and memory reads. They do not parse chats themselves and they do not insert `user_memories` or `ai_research_qa_index` except by calling `approveChatImport`.

Settings routes authenticate the session cookie only. A bearer token is not accepted there.

## Data model

Add `db/migrations/029_user_api_tokens.sql`. It is forward-only and idempotent, like `028_chat_imports.sql`.

```sql
CREATE TABLE IF NOT EXISTS user_api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_api_tokens_user
  ON user_api_tokens (user_id, created_at DESC);
```

Column meanings:

| Column | Locked field | Meaning |
| --- | --- | --- |
| `token_hash` | hash | Lowercase hex SHA-256 of the full token string. The secret is not stored. |
| `token_prefix` | prefix `mos_` | First 12 characters of the token, which always start with `mos_`. Shown in Settings so the user can tell tokens apart. |
| `name` | name | User-chosen label, 1–40 characters after trim. |
| `last_used_at` | last_used | Set when a sync call authenticates. Null until the first successful sync. |
| `revoked_at` | revoked | Null while the token works. A timestamp means revoked. Revoked rows stay in the table. |

`id` is a UUID. `user_id` is the owner. Deleting the user deletes the tokens.

A token is active when `revoked_at` is null. Each user may have at most 5 active tokens. Revoked tokens do not count toward that cap. Names are not unique.

## Token lifecycle

Generate the secret with 32 cryptographically random bytes, encoded as base64url without padding, then prefix `mos_`. The full token is `mos_` plus 43 characters (47 characters total).

Store `sha256` of the UTF-8 token as 64 lowercase hex characters in `token_hash`. Store characters 1–12 in `token_prefix`. Return the full token in the create response only. Later reads return the prefix, never the secret and never the hash.

Lookup uses `WHERE token_hash = ? AND revoked_at IS NULL` and binds the hash as a parameter. Do not add a salt or a second hash algorithm. The 32 random bytes are the secret.

Rename changes `name` on an active token owned by the session user. Rename does not change the secret. Revoke sets `revoked_at` to the current time. There is no unrevoke. A new laptop credential is a new token.

The create count and insert run in one transaction. If that user already has 5 active rows, the transaction writes nothing.

## APIs

### Who can call what

| Route | Credential | Gate |
| --- | --- | --- |
| `/api/settings/tokens` | Session cookie, via `requireFeature(request, 'ai-research')` | `ai-research` |
| `/api/sync/memory` and `/api/sync/import` | `Authorization: Bearer <token>` | Active token, then `ai-research` for that token's user |

A session cookie on a sync route is ignored. Missing, malformed, unknown, or revoked bearer tokens all return 401 `{ "error": "Unauthorized" }`. A bearer token on a settings route is ignored. Settings without a session return the existing unauthorized response from `getAuthorizedUser`.

Sync authentication does not call `requireFeature(request)` or `getAuthorizedUser(request)`, because those read the session cookie. After the token row matches, load that `user_id` from `users` and call `canAccessFeature` for `ai-research`. A user whose department cannot use AI Research receives 403 `Forbidden: your department does not allow AI Research`. A missing user row returns 401 `{ "error": "Unauthorized" }`.

On a successful sync authentication, set `last_used_at` for that token id and user id. If that update fails, the sync request still proceeds. A failed authentication does not change `last_used_at`.

### `GET /api/settings/tokens`

Owner-only list, newest `created_at` first. Each item:

```json
{
  "id": "uuid",
  "name": "Laptop Codex",
  "tokenPrefix": "mos_a1b2c3d4",
  "createdAt": "2026-10-06T00:00:00.000Z",
  "lastUsedAt": null,
  "revokedAt": null
}
```

The response is `{ "tokens": [ ... ] }`. It includes revoked rows. It does not include `token_hash` or the secret.

### `POST /api/settings/tokens`

Body: `{ "name": "Laptop Codex" }`.

Trim `name`. Empty after trim returns 400 `Name the token.` Longer than 40 characters returns 400 `Use 40 characters or fewer.` A code point below U+0020, or U+007F, returns 400 `Use a plain name.` A sixth active token returns 409 `You can have 5 active tokens. Revoke one to create another.`

Success returns 201:

```json
{
  "token": "mos_…",
  "apiToken": {
    "id": "uuid",
    "name": "Laptop Codex",
    "tokenPrefix": "mos_a1b2c3d4",
    "createdAt": "2026-10-06T00:00:00.000Z",
    "lastUsedAt": null,
    "revokedAt": null
  }
}
```

`token` is the only field that ever contains the secret.

### `PATCH /api/settings/tokens/:id`

Body: `{ "name": "Office laptop" }`. The same name rules as create. The row must belong to the session user and have `revoked_at` null. A missing row and another user's row both return 404 `Token was not found.` A revoked row returns 409 `This token is revoked.` Success returns 200 `{ "apiToken": { ... } }` with the list fields.

### `DELETE /api/settings/tokens/:id`

Revoke. Set `revoked_at` when it is null. Return 200 `{ "revoked": true, "alreadyRevoked": false }`. A second revoke returns 200 `{ "revoked": true, "alreadyRevoked": true }` and does not change `revoked_at`. A missing row and another user's row both return 404 `Token was not found.` The row is not deleted.

### `GET /api/sync/memory`

Returns the token user's facts and recent Q&A.

Optional query parameter `q`. Trim it. Absent, or empty after trim, means no search. Longer than 200 characters returns 400 `Search is limited to 200 characters.`

Search is a case-insensitive substring. Escape `\`, `%`, and `_` in `q` before binding, then match with `ILIKE` and a bound pattern. Facts match `user_memories.content`. Q&A match `ai_research_qa_index.question` or `answer_summary`. This is not an embedding search.

Facts use the same cap and order as the memory list query: `user_id = ?`, `ORDER BY updated_at DESC`, `LIMIT 80`. Each fact uses the `PublicMemory` fields. Q&A uses `user_id = ?`, `ORDER BY created_at DESC`, `LIMIT 20`. Each Q&A item is `{ "id", "question", "answerSummary", "createdAt" }`.

```json
{
  "memoryEnabled": true,
  "facts": [
    {
      "id": "uuid",
      "kind": "context",
      "content": "Works on Dupoin campaigns.",
      "mentionCount": 1,
      "confidence": 0.8,
      "updatedAt": "2026-10-06T00:00:00.000Z"
    }
  ],
  "qa": [
    {
      "id": "uuid",
      "question": "Where is the brand guide?",
      "answerSummary": "Internal Docs, Dupoin brand guideline.",
      "createdAt": "2026-10-06T00:00:00.000Z"
    }
  ]
}
```

`memoryEnabled` is that user's `ai_memory_enabled` value, true when the column is not false. Pull still returns stored rows when memory is off. Pull does not call `touchMemories` and does not change fact `last_used_at`.

The response omits embeddings, hashes, `user_id`, conversation ids, sources, transcripts, and import drafts.

### `POST /api/sync/import`

JSON only. `Content-Type` must include `application/json`. Any other content type returns 400 `Send the chat as JSON.`

Body:

```json
{
  "source": "codex",
  "text": "string",
  "autoApprove": false
}
```

`source` is required and must be `codex`, `claude`, or `text`. Otherwise return 400 `Choose a source.` `text` must be a string. A missing or non-string `text` returns 400 `Add a chat to import.` Invalid JSON returns 400 `Send the chat as JSON.` Paste limits and parser errors are the Phase A paste rules, enforced by calling `createChatImport(userId, source, text, postgresChatImportDeps())`:

- Empty text after trim returns 400 `Add a chat to import.`
- Over 200,000 characters returns 413 `Paste is limited to 200,000 characters.`
- A recognized multi-chat envelope returns 400 `Import one chat at a time.`
- A duplicate `(user_id, content_hash)` returns 409 with Phase A's body: `error`, `existingImportId`, `knowledgeEntryId`.

`autoApprove` may be omitted. Omitted means false. A present value that is not a boolean returns 400 `autoApprove must be true or false.` The body has no facts array and no Q&A array. Extra fields are ignored.

When `createChatImport` returns a failure status, return that status and body unchanged. Do not call `approveChatImport`. A duplicate push does not approve the existing import.

When create succeeds and `autoApprove` is false, return 200 `{ "import": <Phase A create import>, "autoApproved": false }`. `import` is that Phase A object, including `id`, `source`, `parser`, `parserFallback`, `title`, `status`, `knowledgeEntryId`, `memoryEnabled`, `draft`, and `error`. It omits the transcript. `status` is `review` or `extract_failed`.

When create succeeds and `autoApprove` is true:

- If `import.status` is not `review`, return 200 with that same `import` and `autoApproved: false`. Do not approve an `extract_failed` chat.
- If `import.status` is `review`, call `approveChatImport` with the stored draft. Every draft fact and Q&A id is sent with `included: true` and the draft's own text and kind. The client does not supply replacement text.
- Approve then follows Phase A: checked rows write `user_memories` and `ai_research_qa_index`, duplicates bump or count as already saved, and graph mirrors run inside `approveChatImport`.
- On approve success, re-read the import for this user and return 200 `{ "import", "autoApproved": true, "factsSaved", "factsAlreadySaved", "qaSaved", "qaAlreadySaved" }`. The re-read status is `approved` and the draft is empty. The transcript is still omitted.
- On approve failure, return that failure status and body. The chat remains in `review` when Phase A leaves it there. `autoApproved` is omitted.

`autoApprove: true` on an empty draft still calls approve. Phase A already allows approving zero rows.

## Codex skill

Ship the skill in this repo at `codex/skills/marketingos-memory/SKILL.md`. The user installs it by copying that directory to `~/.codex/skills/marketingos-memory/`. MarketingOS does not invoke Codex and does not install the skill.

The skill reads two environment variables:

| Variable | Value |
| --- | --- |
| `MARKETINGOS_API_TOKEN` | The full `mos_` secret from Settings |
| `MARKETINGOS_API_URL` | Origin only, such as `https://marketingos.example.com` |

If either variable is missing, the skill stops and tells the user to create a token at `/dashboard/settings/api-tokens` and set both variables. It does not guess an origin.

The skill strips one trailing slash from the URL. It calls the API only when the URL is `https`, or `http://localhost`, or `http://127.0.0.1`, with an optional port. Any other scheme or host is refused before a request is sent.

The skill has two commands.

**pull.** Optional words after pull become `q`, trimmed and cut at 200 characters. Call `GET ${MARKETINGOS_API_URL}/api/sync/memory` with header `Authorization: Bearer ${MARKETINGOS_API_TOKEN}`. Add `?q=` only when the user supplied a query. Print each fact's kind and content, then each question and answer summary. When `memoryEnabled` is false, also print: `Memory is off. Dupoin AI will not use these until you turn memory on in AI Research.`

**push.** Push either the current Codex thread or one file path the user names.

- A file whose first non-whitespace character is `{` or `[`, and that `JSON.parse` accepts, is sent unchanged with `source: "codex"`.
- Any other file is sent unchanged with `source: "text"`. The skill does not relabel a file.
- The current thread, when the user does not name a file, is plain text. Each user turn is one block starting `User: ` and each assistant turn is one block starting `Assistant: `. `source` is `text`.
- One push is one chat. The skill does not split an archive into several requests. A multi-chat JSON file is still one request; the API returns 400 `Import one chat at a time.` and the skill shows that sentence.
- If the text is longer than 200,000 characters, the skill does not call the API. It says the chat is over the import limit.

`autoApprove` is false unless the user explicitly asks to approve without review. The skill then sends `autoApprove: true`. The skill does not call `/api/ai-research/imports/:id/approve`. It has no session cookie.

After `autoApproved: false` and status `review`, the skill says to open AI Research → Memory, find that import title, and choose **Review facts**. After `extract_failed`, it says to open Memory and choose **Retry extract**. After `autoApproved: true`, it reports the four approve counts. After 409, it says the chat is already imported and to open it from Memory. It does not send the chat again.

The skill must not print the token, write it to a file, or include it in `text`. Before push, drop any line whose trimmed value equals `MARKETINGOS_API_TOKEN`. Do not print a shell command that already contains the expanded secret.

## Settings UI

English only. No new locale files.

Add a dashboard page at `/dashboard/settings/api-tokens`. In the **AI workspace** nav section, add **API tokens** with the existing `tokens` icon and `feature: 'ai-research'`. It is not admin-only. Do not add this path to `adminOnlyPages`. Leave `/dashboard/tokens` labeled **Token usage** and admin-only.

The page lists tokens from `GET /api/settings/tokens`. Each row shows the name, prefix, created time, last used time (or `Never`), and a **Revoked** badge when `revokedAt` is set. Active rows offer **Rename** and **Revoke**. Revoked rows have no actions.

Empty state: `No API tokens yet. Create one to sync memory with Codex on your laptop.`

**Create token** asks for a name and posts it. On 201, a dialog shows the secret once, a **Copy** button, and the sentence `This token is shown once. Store it as MARKETINGOS_API_TOKEN.` Closing the dialog removes the secret from the page. The list then shows the prefix.

**Revoke** asks: `Revoke this token? Codex on your laptop will stop syncing until you create a new one.` Confirm calls `DELETE`.

The Memory panel gains no sync button and no token control. A chat created by `POST /api/sync/import` is an ordinary `chat_imports` row, so the existing Memory list, **Review facts**, **View chat**, and **Retry extract** actions apply without a new panel control.

## Errors and security

HTTPS is required for `/api/settings/tokens` and `/api/sync/*`. If `x-forwarded-proto` is present, its first value must be `https`, or the response is 400 `{ "error": "Use HTTPS." }`. If that header is absent, allow the request only when the host is `localhost`, `127.0.0.1`, or `[::1]`, with an optional port. Every other cleartext host returns 400 `Use HTTPS.`

Rate limits use the existing `rateLimit` helper, 30 requests per 60 seconds, 429 `{ "error": "Too many requests. Please try again later." }` and `Retry-After`.

Request order for `/api/sync/*`:

1. If the `Authorization` header is longer than 256 characters, count `rateLimit(request)` on the client IP and return 401 `{ "error": "Unauthorized" }`. Do not hash that header.
2. Count `rateLimit(request)` on the client IP. A changed bearer token does not get a new IP budget.
3. If the header value is `Bearer ` plus a token matching `mos_` and 43 characters from `A-Za-z0-9_-`, also count `rateLimit(request, 'sync:' + sha256Hex(token))`. Either 429 stops the request. Do not use the raw token as the key.
4. Apply the HTTPS check.
5. A header that failed the `mos_` pattern in step 3 returns 401 `{ "error": "Unauthorized" }`.
6. Look up SHA-256 of that token. Continue only for an active row.

Settings routes count `rateLimit(request)` on the client IP before the session lookup. After the session user is known, also count `settings-tokens:<user id>`. Either 429 stops the request.

| Case | Result |
| --- | --- |
| Settings without a session | Existing unauthorized status and message |
| Settings user lacks AI Research | Existing forbidden message, 403 |
| Sync without a usable bearer token | 401 `Unauthorized` |
| Revoked, unknown, or wrong-length token | 401 `Unauthorized` |
| Token user lacks AI Research | Existing forbidden message, 403 |
| Cleartext host other than loopback | 400 `Use HTTPS.` |
| Over the rate limit | 429 |
| Sixth active token | 409, nothing inserted |
| Bad token name | 400, nothing inserted |
| Rename or revoke another user's token | 404 |
| Sync `q` over 200 characters | 400, no rows returned |
| Sync import over 200,000 characters | 413, nothing saved |
| Duplicate transcript for this user | 409, existing import not approved |
| `autoApprove: true` while extract failed | 200, `autoApproved: false`, chat stays `extract_failed` |

Isolation rules:

- Token queries bind the session user id. Sync reads and import writes bind the token's user id.
- A token cannot read or import another user's `user_memories`, `ai_research_qa_index`, or `chat_imports`.
- Sync list SQL includes `user_id = ?`.
- The secret and `token_hash` are absent from list, rename, revoke, and sync responses.
- Settings logs are `console.info('[settings] api token', { tokenId, status })` with status `created`, `renamed`, or `revoked`. Sync logs are `console.info('[sync]', { id, status })`, where `id` is the token id for a memory read and the import id for an import. Failures log the same shape with status `failed`. Logs do not include the bearer token, the `Authorization` header, `token_hash`, `q`, the pushed transcript, or the user id.
- SHA-256 is the stored form. Do not log the preimage while hashing.
- Revoking a token takes effect on the next request because every sync lookup requires `revoked_at IS NULL`.

## Testing

Use the repo's `node:test` style. Add a `029` assertion next to the `028` case in `tests/canonical-migrations.test.ts`. Cover token hashing, route SQL, and the sync decision to call Phase A, the same way `tests/chat-import.test.ts` covers import.

Migration and tokens:

- `029_user_api_tokens.sql` creates `user_api_tokens` with `token_hash`, `token_prefix`, `name`, `last_used_at`, and `revoked_at`, unique `token_hash`, and `idx_user_api_tokens_user`.
- A created token starts with `mos_`, is 47 characters, and is not stored. The stored hash is lowercase hex SHA-256 of that string. The stored prefix is the first 12 characters.
- The create response contains the secret once. The list response does not.
- The sixth active token returns 409. A revoked token does not count toward the five.
- Revoke sets `revoked_at`. A second revoke returns `alreadyRevoked: true`. A revoked token receives 401 on sync.
- Rename and revoke SQL include `user_id = ?`. Another user's id returns 404.

Sync:

- `GET /api/sync/memory` SQL reads `user_memories` and `ai_research_qa_index` with `user_id = ?`.
- Without `q`, facts are capped at 80 and Q&A at 20.
- `q` filters fact content and Q&A question or answer summary, and binds the escaped pattern.
- Pull does not call `touchMemories`.
- `memoryEnabled: false` still returns the stored rows.
- `POST /api/sync/import` with `autoApprove` omitted calls `createChatImport` and does not call `approveChatImport`. The response has `autoApproved: false`.
- `autoApprove: true` on a `review` import calls `approveChatImport` with the stored draft ids included.
- `autoApprove: true` on `extract_failed` does not call `approveChatImport`.
- A duplicate 409 does not call `approveChatImport`.
- A non-boolean `autoApprove` returns 400 before create.
- Sync route SQL and token lookup SQL do not read the session cookie.
- Settings route handlers do not accept the bearer token as the user id.
- Logged sync lines do not contain the token string.
- The 31st sync call for one token hash in the same window returns 429.
- The 31st sync call from one IP in the same window returns 429 when each call uses a different bearer token.
- A non-loopback request with `x-forwarded-proto: http` returns 400 before lookup.

No browser harness is required for this document. Implementation acceptance is those tests plus one manual pass: create a token, confirm the secret disappears after the dialog closes, pull with the skill against a local HTTPS or localhost origin, push one short chat with review left on, and confirm that chat appears in the Memory panel for **Review facts**. Then revoke the token and confirm the next pull returns 401.

## Out of scope

- An MCP server, and any tool host other than the Codex skill in this design.
- Authenticating `/api/sync/*` with the browser session cookie.
- A Claude skill. This phase ships the Codex skill only. The token is not tied to Codex, so another client can send the same secret in a later phase.
- Changes to Phase A parsers, hash rules, draft caps, approve rules, graph visibility, or the Memory panel review controls. Sync may call `createChatImport` and `approveChatImport`. It does not change them.
- Multipart upload on `/api/sync/import`. File paste limits stay on `/api/ai-research/imports`.
- Returning a transcript, draft editing, or a direct fact write that skips `approveChatImport`.
- Webhooks, background poll, shared credentials, or continuous two-way conversation sync.
- Token scopes narrower than AI Research memory read plus one-chat import.
- Unrevoke, secret rotation in place, or showing the secret again.
- OAuth, PATs for users who lack AI Research, and admin management of another user's tokens.
- Deleting `chat_imports` or approved facts from the skill. Existing Memory and graph delete controls stay as they are.
- Non-English UI copy.
- A new rate-limit store. The existing in-memory `rateLimit` helper is the limit.

## Success criteria

Phase C is complete when all of the following are true:

1. A user with AI Research access can create, list, rename, and revoke personal API tokens at `/dashboard/settings/api-tokens`. The full secret is shown once, always starts with `mos_`, and only its SHA-256 hash is stored.
2. Codex on the laptop, using `MARKETINGOS_API_TOKEN` and `MARKETINGOS_API_URL`, can pull up to 80 facts and up to 20 Q&A rows, newest first, with an optional `q` substring filter.
3. Push saves one chat through `createChatImport`. With the default `autoApprove` false, the user reviews facts in the Memory panel. With an explicit `autoApprove` true, a `review` draft is approved through `approveChatImport`.
4. A revoked token, a token for another user, and a session cookie alone cannot read or import memory. Requests are rate limited, require HTTPS outside loopback, and logs do not contain the token.
5. Phase A import behavior and the admin Token usage page stay as they are.
