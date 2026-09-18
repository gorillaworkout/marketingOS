# MarketingOS product + engineering audit

**Date:** 2026-09-18  
**Branch audited:** `main` @ `b267af0` (`fix: stop the model pasting a flat slab over the artwork`)  
**Live URL:** https://marketing-aws.gorillaworkout.id  
**Stack:** Next.js 16.2 + PostgreSQL + PM2 on AWS  
**Method:** Code + test reading only. No invented bugs. Recently shipped grounding/image/token work is treated as done unless the defect is still in tree.

This document is the primary deliverable. A tiny P1 follow-up is included on the same branch:

1. Brand Guidelines **Edit** now sends `id` in the JSON body (`src/app/dashboard/brand-guidelines/page.tsx`).
2. AI Research gather failures are logged (`src/app/api/ai-research/chat/route.ts`).
3. Demo credentials are hidden on production login builds (`src/app/page.tsx`).

Do not merge until Bayu reviews. This is an audit PR, not a feature drop.

---

## What recently shipped (do not re-open)

| Area | Evidence on `main` |
|------|--------------------|
| Serper free-tier unquoted person queries | PRs #18–#23; `.env.example` documents the 400-on-quotes rule |
| `PERSON_FACT` + `OTHER_PUBLIC_TRACE` | `src/lib/ai-research-grounding.ts` + PRs #20–#21 |
| Bappebti TLS / regulator browse | PRs #15–#16, #19 |
| Knowledge RAG (user-scoped) | PR #13; `fetchKnowledgeContext` / `fetchContextMemory` filter by `user_id` |
| Dupoin brand image prompts + real wordmark composite | PRs #10, plus `src/lib/dupoin-logo-composite.ts` |
| Antigravity image fallback + 502 capacity copy | PRs #7, #11; `src/lib/image-generation-fallback.ts` |
| `token_logs` for AI Research + all generation paths | PRs #8–#9; `src/lib/token-log.ts` |
| Feature-gated nav (Article Market News, AI Research, etc.) | PR #6; `src/lib/authorization.ts` + `src/app/dashboard/layout.tsx` |
| AI Research history wipe on image attach | PR #2 — **array JSONB path is fixed** (`coerceJsonArray` in `src/lib/ai-research.ts`) |

Bayu’s product rule for AI Research still stands as a **feature gap**, not a regression: grounded sources are injected into the model prompt, but the chat UI only shows `Sedang meneliti N sumber`. The user cannot inspect or choose among traces.

---

## Architecture snapshot (cite these first)

```
Login  → POST /api/auth action=login  → sessions row + httpOnly session_id cookie (24h)
API    → getSession() / requireFeature() / requireAdmin()  (no middleware.ts)
Nav    → isDashboardNavItemVisible() in dashboard/layout.tsx (client)
Dept   → departments.permitted_features → GENERATION_FEATURES
```

| Layer | Files |
|-------|-------|
| Auth | `src/lib/auth.ts`, `src/app/api/auth/route.ts` |
| Feature gating | `src/lib/authorization.ts`, `src/app/dashboard/layout.tsx` |
| AI Research | `src/lib/ai-research.ts`, `src/lib/ai-research-grounding.ts`, `src/app/api/ai-research/chat/route.ts`, `src/app/dashboard/ai-research/page.tsx` |
| Image gen | `src/app/api/generate-image/route.ts`, `src/lib/image-generation-fallback.ts`, `src/lib/image-models.ts` |
| Tokens | `src/lib/token-log.ts`, `src/lib/admin-usage.ts`, `src/app/dashboard/analytics/page.tsx` |
| Canonical schema | `db/migrations/` via `scripts/migrate.ts` — **not** the orphan `migrations/` folder |

There is **no** `middleware.ts`. Page shells are `'use client'`; dashboard auth is a `useEffect` check. Sensitive data still depends on per-route API enforcement, which is generally present.

---

## A) Bugs / debt (prioritized)

Severity: **P0** production-breaking or trivially exploitable on the live host · **P1** users hit it or it is a clear security/ops hole · **P2** real defect with limited blast radius · **P3** polish / test / docs.

### P1

#### P1-1. Brand Guidelines Edit always 400s (fixed on this branch)

| | |
|---|---|
| **Where** | `src/app/dashboard/brand-guidelines/page.tsx` `handleSave` vs `src/app/api/brand-guidelines/route.ts` `PUT` |
| **Verified** | UI sent PUT to `/api/brand-guidelines?id=…` with **no** `id` in JSON. API reads `id` from the body and returns `{ error: 'Guideline ID is required' }`. Failed saves showed nothing (no `!res.ok` path). Create (POST) still worked. |
| **Repro** | Admin → Library → Brand guidelines → Edit → Update. Network 400; list unchanged. |
| **Fix** | Send `{ id: editing.id, … }` in the JSON body; surface API errors. Test: `tests/brand-guidelines-edit.test.ts`. |

Generators already accept `brandGuidelineId` (`social-post` / `video-script` / `event-plan` generate routes) but **no dashboard page sends it**. Even after Edit works, guidelines stay an unused library.

#### P1-2. Generated images are world-readable

| | |
|---|---|
| **Where** | `src/app/api/generated-images/[filename]/route.ts` |
| **Verified** | Handler never calls `getSession`. Path traversal is blocked (`isSafeGeneratedImageFilename`), but a guessed or leaked filename returns the PNG. `Cache-Control: public, max-age=3600`. Filenames follow `DUPOIN_{Brief}_{Type}_V{n}_{date}.png` (`generateSOPFileName` in `src/app/api/generate-image/route.ts`). |
| **Repro** | `curl` the live host `/api/generated-images/<known-file>` with no cookie. |
| **Fix** | Require a session (same-origin `<img>` already sends the cookie) **or** signed/time-limited URLs. Drop `public` cache until auth is in place. |

This is not the same as the Image Gallery being org-wide. Gallery listing is an intentional product choice (commits `361b3cd`, `693c58e`). Unauthenticated **byte serving** is not.

#### P1-3. Canonical migrations never create AI Research conversations (or expand department features)

| | |
|---|---|
| **Where** | `scripts/migrate.ts` reads only `db/migrations/`. `ai_research_conversations` lives in **`migrations/003_ai_research_feature.sql`**, which is not applied. |
| **Verified** | `db/migrations/002_departments.sql` CHECKs `permitted_features` to `social-post`, `video-script`, `event-plan` only. Nothing in `db/migrations/` drops that CHECK. `db/migrations/011_retire_dead_gateway_models.sql` seeds an `ai-research` row in `feature_model_assignments` but does **not** create the conversations table. |
| **Repro** | Empty Postgres → `npm run db:migrate` → open AI Research or enable `ai-research` on a department. Expect `relation "ai_research_conversations" does not exist` and/or CHECK violation `departments_permitted_features_valid`. |
| **Fix** | Promote `migrations/003_ai_research_feature.sql` (current model IDs, not `pecut-free`) into `db/migrations/012_…sql`. Production likely already has the table from a one-off apply — this is **staging / DR / new env** risk, not a live-main outage hypothesis. |

#### P1-4. Canonical migrations never create `image_model_assignments`

| | |
|---|---|
| **Where** | Table used by `src/app/api/image-models/route.ts` and `src/app/api/admin/image-models/route.ts`. DDL only in `migrations/20260731_image_model_assignments.sql` (stale defaults `gpt-5.6-terra` / `gpt-image-2`). |
| **Verified** | `scripts/migrate.ts` never sees that file. Missing table → those two APIs 500. Social Post falls back to `AVAILABLE_IMAGE_MODELS` in client code, so generation can limp along; `/dashboard/models/image` cannot. |
| **Repro** | Fresh migrate → `GET /api/image-models`. |
| **Fix** | `db/migrations/013_image_model_assignments.sql` with current IDs from `src/lib/image-models.ts` (`cx/gpt-5.5-image`, `ag/nano-banana`, `ag/nano-banana-pro`, `ag/gemini-3.1-flash-image`). |

#### P1-5. Login advertises default credentials (UI hidden on this branch; seed remains)

| | |
|---|---|
| **Where** | `src/app/page.tsx`; seed in `scripts/migrate.ts` (`admin` / `bayu` / `rina` / `doni` / `sari`, password `marketing123`). |
| **Verified** | Production login previously rendered the pair in plaintext. Seed still hashes that password into empty databases. |
| **Repro** | Empty DB migrate → login `admin` / `marketing123`. |
| **Fix (remaining)** | Do not seed in production; force password rotation on first login; keep the UI hidden (done here for production builds). |

#### P1-6. No rate limit + username enumeration on login

| | |
|---|---|
| **Where** | `src/app/api/auth/route.ts` |
| **Verified** | Distinct 401s: `'User not found'` vs `'Invalid password'`. `rateLimit()` is used on generate routes (`src/lib/rate-limit.ts`) but **not** on login. |
| **Repro** | POST `{ action: 'login', username: 'nope', password: 'x' }` vs a real username. |
| **Fix** | Single `'Invalid username or password'` string; IP + username limiter. |

---

### P2

#### P2-1. AI Research gather failures were silent (logging added on this branch; UX still missing)

| | |
|---|---|
| **Where** | `src/app/api/ai-research/chat/route.ts` (~L144–153); UI `src/app/dashboard/ai-research/page.tsx` ~L702 |
| **Verified** | `gatherAiResearchContext` throw → `research = null` → SSE `{ type: 'research', sourceCount: 0 }`. Chat continues ungrounded. UI shows generic **“Sedang meneliti”** for both “hi” (no research) and a real gather failure. |
| **Repro** | Force `gatherAiResearchContext` to throw; compare with a trivial “hi”. |
| **Fix remaining** | SSE field `grounding: 'ok' \| 'empty' \| 'failed' \| 'skipped'`; Indonesian banner when research was expected. |

#### P2-2. Stale `conversationId` never INSERTs (messages vanish on refresh)

| | |
|---|---|
| **Where** | `persistConversation(..., exists: Boolean(conversationId))` in `src/app/api/ai-research/chat/route.ts` |
| **Verified** | `exists` means “client sent an id”, not “row found for this user”. Deleted / foreign / never-created UUID → history SELECT misses, then UPDATE hits 0 rows. UI keeps the turn locally. |
| **Repro** | Delete a thread, send another message with the same `activeConvoId` still in React state. |
| **Fix** | `exists = Boolean(history)`; if UPDATE rowCount is 0, INSERT. |

#### P2-3. Orphan user turns when the gateway errors

| | |
|---|---|
| **Where** | Same chat route: persist user turn **before** the stream; assistant persist only after success. |
| **Verified** | Gateway 502 / missing `GORILLAWORKOUT_API_KEY` → DB has a user bubble with no assistant. |
| **Fix** | Persist after success, or write a synthetic assistant error, or mark the conversation incomplete. |

#### P2-4. History cannot render current Social Post `options[]`

| | |
|---|---|
| **Where** | Writer: `src/app/api/social-post/generate/route.ts` stores `{ options, qcResults, … }`. Reader: `src/app/dashboard/history/page.tsx` ~L219 uses `data.captionData \|\| data`. |
| **Verified** | Current tasks have `options[]` and only a backward-compat comment about `captionData`. History shows an empty/wrong caption card instead of the three styles. Event Plan already reads `data.options?.[0]`. |
| **Repro** | Generate a social post → Admin History → open it. |
| **Fix** | Same `options` branch the Social Post page uses. |

#### P2-5. `GET /api/feedback` leaks other users’ `output_data`

| | |
|---|---|
| **Where** | `src/app/api/feedback/route.ts` GET |
| **Verified** | `WHERE type = ? AND rating >= 4` — no `user_id`. UI today only POSTs ratings; GET is still live. Same pattern is copied into generate prompts (`social-post` / `video-script` / `event-plan` “best examples” queries). |
| **Repro** | Authenticated member `GET /api/feedback?type=social-post`. |
| **Fix** | Scope examples to `user_id`, or make org-learning an explicit admin policy. |

#### P2-6. Gateway default URL split (health vs traffic)

| | |
|---|---|
| **Where** | `src/lib/model-health.ts` defaults to `https://llmdupoin.gorillaworkout.id/v1`. `src/lib/openai.ts`, `src/app/api/ai-research/chat/route.ts`, `src/app/api/generate-image/route.ts`, `src/app/api/models/route.ts` default to `https://llm.gorillaworkout.id/v1`. |
| **Verified** | Unset `GORILLAWORKOUT_API_BASE` → AI Research “Check” probes a different host than chat/image. |
| **Fix** | One `src/lib/gateway-config.ts`; document the production value in `.env.example`. |

#### P2-7. Image job store is in-process memory

| | |
|---|---|
| **Where** | `src/lib/image-job-status.ts` (`globalThis.__marketingOsImageJobs`) |
| **Verified** | POST `/api/generate-image` → 202 + `jobId`. PM2 restart or a second Node process → GET `?jobId=` → 404. |
| **Fix** | Persist jobs in Postgres if you ever run >1 process; until then document single-instance. |

#### P2-8. Gallery “linked” metadata misses `imageUrl` / `fileName` array entries

| | |
|---|---|
| **Where** | Writer `recordImageOnTask` uses `imageUrl` / `fileName`. Reader `src/app/api/images/route.ts` only maps `img.url` inside `images[]` (top-level `imageUrl` is handled). |
| **Repro** | Generate 2+ images on one social-post task. Earlier files show as Standalone. |
| **Fix** | Also resolve `imageUrl` and `fileName`. |

#### P2-9. Empty/error/loading is inconsistent (library pages are the worst)

Verified matrix:

| Surface | Loading | Empty | Error |
|---------|---------|-------|-------|
| Social Post | Progress + inline | `EmptyState` | Inline + sidebar error — **best** |
| History / Knowledge Graph / Accounts | `LoadingState` | `EmptyState` | Banner / toast |
| Dashboard overview | `LoadingState` | `EmptyState` | **No** `res.ok` / `.catch` (`src/app/dashboard/page.tsx`) |
| Analytics | Metrics show `—` | “No usage data” | **Silent return** if any admin API ≠ ok (`analytics/page.tsx` L37) |
| Knowledge | Custom spinner | Mixed ID/EN | `console.error` only |
| Calendar | **None** | Day panel only | Mutations ignore `res.ok` |
| Templates | **None** | `EmptyState` | `handleSave` closes modal even on failure; `saveMessage` unused |
| Brand guidelines | **None** | `EmptyState` | Was silent; errors now shown |
| AI Research conversation list | — | — | `loadConversations` `catch {}` (`page.tsx` L202) |
| Video Script recent list | — | `EmptyState` | `catch {}` |
| Image Gallery | `LoadingState` | Empty list | Fetch errors swallowed |
| Layout auth | Raw spinner, not `LoadingState` | — | Redirect only |

#### P2-10. Dashboard “Team members” is hardcoded `5`

| | |
|---|---|
| **Where** | `src/app/dashboard/page.tsx` `<MetricCard label="Team members" value="5" />` |
| **Verified** | Not from `/api/dashboard/stats` or `/api/admin/users`. Matches the five seed users, not live headcount. |

#### P2-11. Quick actions miss Article / Market Research / AI Research

| | |
|---|---|
| **Where** | `src/app/dashboard/page.tsx` `quickActions` |
| **Verified** | Filter uses `href.split('/').pop()` so `/dashboard/sop` would never match `article-market-news` even if added. Only social / video / event cards exist. |

#### P2-12. Chat rate limit is IP-keyed; health is user-keyed

| | |
|---|---|
| **Where** | `POST /api/ai-research/chat` → `rateLimit(request)`. Health → `rateLimit(request, \`ai-research-health:${auth.id}\`)`. Market research already uses a user key. |
| **Fix** | `rateLimit(request, \`ai-research-chat:${auth.id}\`)` after auth. |

#### P2-13. No `/api/health` for PM2 / ALB

| | |
|---|---|
| **Verified** | Only `src/app/api/ai-research/health/route.ts` (auth + `ai-research` feature). Docs in `docs/superpowers/plans/…` mention `/api/health`; it does not exist. |
| **Fix** | Unauthenticated `{ ok, db, timestamp }` — no secrets. |

---

### P3

#### P3-1. `sourceCount` counts official seeds with empty snippets

`officialSeedUrls` are pushed with `snippet: ''` (`ai-research-grounding.ts` ~L2214). `isUsableResearchSource` treats official hosts as usable anyway. UI: “Sedang meneliti N sumber” can overstate useful excerpts. Related to Bayu’s “show all grounded data” rule — count is a proxy, not the traces.

#### P3-2. Non-array JSONB still looks like an empty thread

`parseStoredMessages` → `coerceJsonArray` → `[]` if `messages` is a JSON object. The **array** wipe from PR #2 is fixed and tested (`tests/ai-research-vision.test.ts`). Object-shaped corruption still silently empties the thread. Per-message validation fallback also drops `images` / `files` without a log (`src/lib/ai-research.ts` L441–456).

#### P3-3. Token analytics: cost is always `$0`; image models unlabeled; provider inference stale

- `AVAILABLE_MODELS` in `src/lib/openai.ts` has `input: 0, output: 0` for every id → `usageCost` is 0.
- `src/app/api/dashboard/tokens/route.ts` `inferProvider()` maps unknown prefixes to `'openrouter'` (Codex/OpenRouter are gone).
- `src/lib/admin-usage.ts` labels only `AVAILABLE_MODELS`, not `AVAILABLE_IMAGE_MODELS` → `cx/gpt-5.5-image` shows as a raw id.
- `logAiResearchUsage` skips empty `outputText` (failed/empty streams never log).
- `logTokenUsage` swallows DB errors (`src/lib/token-log.ts`).

#### P3-4. `/dashboard/models/image` is implemented but undiscoverable

Full admin UI in `src/app/dashboard/models/image/page.tsx`. No nav item in `layout.tsx`, no link from `src/app/dashboard/models/page.tsx`.

#### P3-5. Models page still recommends retired **Pecut Free**

`src/app/dashboard/models/page.tsx` ~L128. Catalog comments in `openai.ts` say `pecut-free` was removed (upstream 400).

#### P3-6. Login a11y / SEO / language

- Root `src/app/layout.tsx`: `lang="en"`, title `"MarketingOS"`, no `robots: { index: false }`, no per-route titles.
- Login has no show-password toggle (`passwordInputType` exists and is used on Accounts).
- Calendar `min-w-[680px]` + `toLocaleString('default')` / `en-US` dates vs Indonesian-facing product.
- Recent-task sidebars use `<div onClick>` (Social Post, History). Templates modal has no `role="dialog"`.

#### P3-7. Env / docs drift

`.env.example` and `README.md` still list `JWT_SECRET`, `OPENROUTER_API_KEY`, `FAL_KEY`, Codex CLI. Auth is session cookies, not JWT. Runtime is GorillaWorkout gateway. README “10 dashboard pages / 19 API routes” is stale. `docs/API.md` and `docs/USER-GUIDE.md` are referenced and **missing**. `start.sh` cds to `~/marketingos`, probes port 3001, uses macOS `open`.

#### P3-8. Image-model `JSON.parse` is not JSONB-safe

`src/app/api/image-models/route.ts` L25 and admin twin. Column is TEXT today (orphan migration), so production is fine. If the column becomes JSONB, `node-pg` returns an array and `JSON.parse` throws — the exact class of bug as the old history wipe. `parseAllowedModels` in `src/lib/model-routing.ts` already handles both.

#### P3-9. Hardcoded local path

`src/app/api/generate-image/route.ts`: `const cwd = process.cwd() || '/Users/bayudarmawan/marketingos';`

#### P3-10. Sessions survive password change; weak password policy

`src/app/api/admin/users/route.ts` PUT updates the hash, does not `DELETE FROM sessions WHERE user_id = ?`. POST requires a password but no minimum length (UI says “Min 6”).

#### P3-11. `getSession` admin path list is incomplete (defense in depth)

Lists `/api/admin/users` and `/api/admin/departments` but not `/api/admin/ai-research`, usage, image-models, model-assignments, knowledge-graph. Those routes **do** call `requireAdmin()` today — not exploitable, but a new `/api/admin/*` file would only be as safe as its author.

#### P3-12. Two tests are stale (not flaky)

No `npm test` script. Documented runner: `npx tsx --test tests/*.test.ts`.

| Test | Why it fails |
|------|----------------|
| `tests/department-authorization.test.ts` | Expects admin features `['social-post','video-script','event-plan']`; code has 6 (`src/lib/authorization.ts`). |
| `tests/dashboard-design-system.test.ts` | Reads `src/app/dashboard/accounts/page.tsx`, a server wrapper; `PageHeader` is in `AccountsClient.tsx`. |

#### P3-13. Admin AI Research log strips spreadsheet `files`

`publicMessages` in `src/app/api/admin/ai-research/route.ts` copies `role`, `content`, `images` only.

#### P3-14. SSE disconnect leaves a frozen streaming bubble

`src/app/dashboard/ai-research/page.tsx` ~L363–399: if the stream ends without `done`/`error`, `streaming` is not cleared.

#### P3-15. `kanban_tasks` is schema-only

Created in `db/migrations/001_initial.sql`; only referenced when deleting a user. Dead table.

---

### Not bugs (checked, left closed)

| Concern | Finding |
|---------|---------|
| Image Gallery shows every user’s images | **By design** (`feat: open Image Gallery to all users`). Governance topic, not an IDOR regression. `userId` in `/api/images` is unused — that is the design. |
| History wipe of JSONB **arrays** | Fixed in PR #2; `coerceJsonArray` + tests. |
| Markdown XSS in AI Research | Custom parser, no `dangerouslySetInnerHTML`; `sanitizeHref` blocks `javascript:`; covered by `tests/ai-research-dupoin.test.ts`. |
| Admin API role leaks | All 13 files under `src/app/api/admin/**` call `requireAdmin()`. |
| AI Research user isolation | Chat queries use `WHERE id = ? AND user_id = ?`. |
| Feature gating of generate APIs | `requireFeature` on all six generators + AI Research chat/health. |
| Antigravity fallback messaging | Implemented + tested (`tests/image-generation-fallback.test.ts`). |
| TODO / FIXME / @ts-ignore in `src/` | None. |
| CORS wildcard | None; same-origin + `SameSite=lax`. |

---

## B) Professionalism features (roadmap)

Effort: **S** ≤ ~1 focused PR · **M** a vertical slice · **L** new subsystem. Kill/keep vs this repo, not a generic SaaS list.

### Trust & polish

| # | Feature | Why it looks professional | Effort | Depends on | Verdict |
|---|---------|---------------------------|--------|------------|---------|
| F1 | **Shared empty / error / loading contract** | Calendar, Templates, Brand, Analytics, Knowledge currently look unfinished next to Social Post / History. | S | `LoadingState` / `EmptyState` already in `src/components/ui/dashboard.tsx` | **Keep — do first** |
| F2 | **Indonesian shell** (`lang="id"`, nav, calendar months, login) | README and generators are ID-first; chrome is English. Dupoin marketing will trust ID copy more than a bilingual toggle. | M | `layout.tsx`, nav labels, calendar | **Keep ID shell; kill full i18n toggle** |
| F3 | **Internal SEO / tab chrome** | Bookmarks all say “MarketingOS”. Add `robots: noindex`, per-page titles (“AI Research · MarketingOS”). | S | `src/app/layout.tsx` + section layouts | **Keep** |
| F4 | **Login hardening UX** | Rate limit, one error string, password reveal (already in Accounts), no demo strip. Feels like an office tool, not a student demo. | S | `src/app/api/auth/route.ts`, `password-visibility.ts` | **Keep** |
| F5 | Dark/light brand toggle | App is already a dark Dupoin shell. A light theme is a second design system. | L | globals.css | **Kill** |

### Collaboration

| # | Feature | Why it looks professional | Effort | Depends on | Verdict |
|---|---------|---------------------------|--------|------------|---------|
| F6 | **Real approval queue** | Social Post “draft → review → approved → published” is **self-click** (`PUT /api/social-post/status`). Knowledge Graph already charts approval rate. A queue with assignee + comment is what legal/compliance expects. | L | status API, Accounts/departments, new `/dashboard/approvals` | **Keep (phase 2)** |
| F7 | Notification center | No event bus, no email sender, no in-app events table. | L | new infra | **Kill until F6 exists** |
| F8 | Activity feed | Overlaps History + AI Research admin log. | M | history APIs | **Kill; extend History instead** |
| F9 | SSO | No IdP hooks; session model is custom cookies. Worth it only if Dupoin IT demands Google/Microsoft. | L | auth rewrite | **Defer** |

### Content ops

| # | Feature | Why it looks professional | Effort | Depends on | Verdict |
|---|---------|---------------------------|--------|------------|---------|
| F10 | **Generator history recovery** (already designed) | `docs/superpowers/specs/2026-09-02-generator-history-and-recovery-design.md` — `RecentGenerated`, 401 modal, Event Plan sidebar, History AI Research tab. Spec is written; components are absent. | M | `/api/dashboard/history`, five generator pages | **Keep — highest ROI content-ops** |
| F11 | **History renders 3-option social posts** | Archive is how a team looks “serious”. Today it lies. | S | `history/page.tsx` | **Keep (bugfix-shaped feature)** |
| F12 | Calendar: mobile agenda + save feedback + status sync | Current grid `min-w-[680px]`, silent mutations, no link from social-post `published`. | M | `calendar/page.tsx`, status API | **Keep** |
| F13 | Templates for article / market-research + a11y modal | TYPES stop at three generators; “Use template” already deep-links social/video/event. | S | `templates/page.tsx`, `api/templates` CHECK | **Keep** |
| F14 | Export PDF / Word | Article + Market Research already gate **DOCX**. Event Plan has `.doc`. Social/video JSON. **Zero PDF** in `src/`. A third format is not what makes this feel real. | L | `docx` package | **Kill PDF; label DOCX as “official export”** |

### AI Research

| # | Feature | Why it looks professional | Effort | Depends on | Verdict |
|---|---------|---------------------------|--------|------------|---------|
| F15 | **Grounding inspector (Bayu’s rule)** | SSE today sends only `sourceCount`. Traces (`PERSON_FACT`, `OTHER_PUBLIC_TRACE`, Serper, Bappebti) stay in the prompt. Show URL + snippet + origin chips; let the user pin/unpin before/while answering. | M | `gatherAiResearchContext` already returns `sources[]`; chat route + `page.tsx` | **Keep — flagship** |
| F16 | Conversation robustness | Stale id INSERT, orphan turns, disconnect banner, gather `failed` state. | S | chat route + page | **Keep (with F15)** |
| F17 | Prompt / version history | Threads already persist in `ai_research_conversations`. A “regenerate / fork from this turn” is enough; a full prompt CMS is not. | M | same table | **Keep small; kill a separate CMS** |

### Admin / governance

| # | Feature | Why it looks professional | Effort | Depends on | Verdict |
|---|---------|---------------------------|--------|------------|---------|
| F18 | **Audit log UI** | Accounts can create/delete users and flip department features with no trail. AI Research admin log (`/dashboard/ai-research/admin`, PR #4) is the pattern to copy for auth + department changes. | M | new `audit_events` table, Accounts + auth | **Keep** |
| F19 | Honest token analytics | Analytics exist (`/dashboard/analytics`, CSV export) but cost is $0 and failures look like “no data”. Pricing **or** an explicit “cost unavailable” state. | S–M | `token_logs`, `AVAILABLE_MODELS`, analytics page | **Keep** |
| F20 | `/api/health` + fold orphan migrations | Ops professionalism: PM2/ALB and a single migrate path. | S | `scripts/migrate.ts`, `db/migrations/` | **Keep** |
| F21 | Role-based dashboards / department-admin | `.hermes` Phase 6. Members already get feature-gated Create nav. A third role is a new authorization model. | L | `users.role` CHECK, every API | **Defer; departments already gate features** |
| F22 | Budgets / quotas | Planned in `.hermes`; analytics exist, `usage_policies` does not. Useful after F19 is honest. | L | token_logs | **Defer** |

### Brand consistency

| # | Feature | Why it looks professional | Effort | Depends on | Verdict |
|---|---------|---------------------------|--------|------------|---------|
| F23 | **Workspace Brand Guidelines + picker on generators** | CRUD is per-`user_id` and admin-only. Generate APIs already load a guideline by id. Image prompts already lock Dupoin brand (`dupoin-image-prompt.ts`). Connecting the two is the missing “OS” behavior. | M | `brand_guidelines`, three generate routes, Social Post UI | **Keep — flagship #2** |
| F24 | Discover Image Model policy | Page exists; link it from Models. | S | `layout.tsx` | **Keep** |
| F25 | Onboarding checklist | First login lands on an English dashboard with hardcoded “5 team members” and no “what to do today”. A 4-step Dupoin checklist (set department features, add brand, generate one post, review History) would change first impression more than SSO. | S | dashboard overview | **Keep** |

**12 to actually put on the board:** F1, F2, F3, F4, F10, F11, F15, F16, F18, F19, F20, F23.  
**Killed or deferred:** F5, F7, F8, F9, F14, F21, F22.

---

## C) Top 5 next actions

Mix of remaining P1 fixes and two flagship features. Ordered for Dupoin internal use, not for a public SaaS launch.

1. **Ops + security week (P1, S–M)**  
   Auth on `/api/generated-images`; login rate limit + unified error; fold `migrations/003_ai_research_feature.sql` and `image_model_assignments` into `db/migrations/` with live model IDs; expand `departments_permitted_features_valid`; add `/api/health`.  
   *Unblocks staging clones and stops the live host from serving campaign art without a session.*

2. **Flagship — AI Research grounding inspector (F15 + F16, M)**  
   SSE the actual `sources[]` (title, url, origin, snippet). UI: Indonesian “Sumber yang dipakai” panel; user can pin/unpin. Surface gather `failed` vs `skipped`. Fix stale `conversationId` INSERT.  
   *This is Bayu’s stated product rule and the difference between “chatbot with a spinner” and “research OS”.*

3. **Content archive that tells the truth (F10 + F11, M)**  
   Implement the already-written history/recovery spec: History `options[]` renderer, Event Plan recent sidebar, 401 modal, AI Research tab on History.  
   *Marketing leads judge the product by whether last week’s caption is still findable.*

4. **Flagship — one Dupoin brand, used by generators (F23 + P1-1 follow-through, M)**  
   Promote guidelines from per-user notes to a workspace/department record. Add a picker on Social Post (and video/event).  
   *Logo compositing already ran; voice rules currently do not reach the model unless someone hand-passes an id the UI never sends.*

5. **Polish pass that members feel (F1 + F2 + F19 + F25, S–M)**  
   Shared error banners on Calendar / Templates / Analytics / Knowledge; `lang="id"` shell; honest token cost (“tidak tersedia” if $0); dashboard onboarding checklist; drop hardcoded team size.  
   *This is how the app stops looking like a prototype without waiting on SSO or PDF.*

---

## Suggested sequencing vs existing plans

| Existing plan | Use it? |
|---------------|---------|
| `docs/superpowers/specs/2026-09-02-generator-history-and-recovery-design.md` | **Yes — action 3.** Do not rewrite. |
| `.hermes/plans/2026-07-26_003000-marketingos-enterprise-expansion.md` | Partial: token enrichment and analytics **done**. Skip budgets / dept-admin / SSO until 1–5 above exist. |

---

## This PR’s code changes (keep small)

| Change | Why it is in an audit PR |
|--------|--------------------------|
| Brand Guidelines PUT body includes `id` + error banner | Clear P1; users cannot edit the library at all |
| `console.error` on gather failure | Requested hunt item; zero behavior change for successful chats |
| Hide demo credentials when `NODE_ENV === 'production'` | Login is the first thing Bayu’s team sees on the live URL |

No other production behavior was changed. Do not merge unless those three edits are wanted with the report.
