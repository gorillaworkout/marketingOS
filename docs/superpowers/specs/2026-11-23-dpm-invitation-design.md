# DPM Invitation: design spec

- Date: 2026-11-23
- Status: Reviewed. Bayu answered the open questions on 2026-11-23 (section 14). Implementation plan: `docs/superpowers/plans/2026-11-23-dpm-invitation.md`.
- Scope: MarketingOS (gorillaworkout/marketingOS), new **DPM** sidebar section with one item, **Invitation**.
- Reference: Annual Dinner registration page (`annual-dinner/app/src/app/r/[token]/page.tsx`, `RegisterForm.tsx`, `styles/register.css`). This feature takes its layout and form styling and leaves out everything else.

## 1. Goal

DPM is a company in the group. For an event such as the DPM Gala Dinner in Vietnam, an admin or a DPM user creates an invitation, uploads the invitation artwork, and gets **one public link** to share with every employee. An employee opens the link with no login, sees the invitation image, and fills in a short form. DPM users then see who will attend and who has food allergies, and export the list.

### Decisions approved by Bayu

1. New sidebar section **DPM** with item **Invitation**.
2. Access comes only from a new **DPM** department that has a new Accounts feature, `dpm-invitation`. Admins always have access and can grant the feature to other departments in Accounts as usual.
3. An invitation event has a name, a slug and an uploaded background image. Each event has exactly one public link, `/i/<slug>`.
4. Admin can **Open** or **Close** registration and **copy the link**. An event can also have an optional automatic close date and time (`closes_at`), entered and shown in WIB.
5. The public page needs no login and is English-only. The invitation image fills the left panel and the form sits on the right. On mobile the image is on top and the form below. Styling follows Annual Dinner.
6. Form fields, in order:
   1. Full name (required).
   2. Email (required, validated).
   3. Will you attend? Yes/No (required).
   4. Only if attending is Yes: Do you have any food allergies? Yes/No (required).
   5. Only if allergy is Yes: What are you allergic to? (required, max 200 characters).

   If attending is No, nothing else is shown or stored, and the allergy fields are null.
7. Submitting again with the same email (case-insensitive) for the same event updates the earlier response. It never creates a duplicate.
8. After submit, a Thank you page is shown. No confirmation email is sent.
9. The admin page lists responses with counts (total, attending, not attending, with allergies), has search, and exports to Excel and CSV. Admins and DPM Invitation users can delete a response. Only admins can delete a whole event.
10. Basic abuse protection: rate limiting per IP, a honeypot field, and size limits on the image upload.
11. Privacy: email and allergy are personal data. Only the DPM department (holders of `dpm-invitation`) and admins can see them.

### Out of scope

Tickets, QR codes, check-in, doorprize/roulette, duplicate-name detection, per-guest tokens, guest import, confirmation or reminder emails, multiple languages, custom questions per event, a company field, email domain restrictions, redirects from old slugs, and archiving or hiding old events (v1 keeps every event in the list).

## 2. Existing patterns this design follows

Checked on `origin/main` at `948c005` (2026-11-20).

| Area | Current pattern | Use here |
|---|---|---|
| Sidebar | `src/app/dashboard/layout.tsx` builds sections such as `{ label: 'Paid Media', items: [{ href, label, icon, feature: 'google-ads' }] }`. Items are hidden by `isDashboardNavItemVisible`. | Add `{ label: 'DPM', items: [{ href: '/dashboard/dpm/invitation', label: 'Invitation', icon: 'event', feature: 'dpm-invitation' }] }` right after Paid Media. |
| Feature typing | `src/lib/authorization.ts`: `ACCOUNT_FEATURES` is a `const` tuple and `AccountFeature = typeof ACCOUNT_FEATURES[number]`. `ACCOUNT_FEATURE_LABELS` and `DASHBOARD_FEATURE_HREFS` are `Record<AccountFeature, …>`, so the compiler forces both to be filled in. `PREFIX_MATCHED_FEATURES` makes nested routes belong to the feature. | Add `DPM_INVITATION_FEATURE = 'dpm-invitation'`, append it to `ACCOUNT_FEATURES` and `PREFIX_MATCHED_FEATURES`, label `'DPM Invitation'`, href `'/dashboard/dpm/invitation'`. |
| DB feature list | `departments.permitted_features` has the CHECK `departments_permitted_features_valid`. Migration 066 drops and re-adds it with the full list, then inserts the Paid Media department `00000000-0000-0000-0000-000000000007`. | Migration 068 re-adds the CHECK with `'dpm-invitation'` and inserts the **DPM** department `00000000-0000-0000-0000-000000000008`. The ids `…001` to `…007` are taken. |
| API gating | No `middleware.ts` or `proxy.ts` exists. Every API route checks itself with `requireFeature(request, feature)` or `requireAdmin` from `src/lib/auth.ts`. Dashboard pages are blocked client-side by `shouldBlockDashboardGenerationPath`, and the API is the real gate. | Every `/api/dpm/**` route calls `requireFeature(request, 'dpm-invitation')`. |
| Public route | `src/app/share/ai-research/[token]/page.tsx` is public simply because it sits outside `/dashboard` and does not call auth. It sets `robots: { index: false, follow: false }`. | `/i/[slug]` follows the same pattern. See section 6. |
| Image storage | Uploads are written to gitignored folders under `data/` (for example `data/competitor-references/<uuid>.<ext>`, PNG/JPG/WebP only, 5 MB cap) and read back by a route handler. Generated images live in `public/outputs/images` and are served by `/api/generated-images/[filename]` with a filename allow-list. `scripts/deploy.sh` runs `git reset --hard` and never `git clean`, so `data/` survives deploys. | Store at `data/dpm-invitations/<uuid>.<ext>` and add it to `.gitignore`. Serve through a route handler (section 7). |
| Migrations | `scripts/migrate.ts` applies `db/migrations/*.sql` in sort order and records names in `schema_migrations`. The last file on main is `067_google_ads_alerts.sql`, and no open PR adds a 068. Rollbacks live in `db/rollbacks/NNN_*_down.sql`. | `068_dpm_invitation.sql` + `db/rollbacks/068_dpm_invitation_down.sql`. Renumber if another migration lands first. |
| Rate limit | `src/lib/rate-limit.ts` keeps one in-memory map keyed by IP (30/min) and **shares the counter across every caller**. | Add a named-bucket helper (section 9.2) so the public form has its own limits and does not use up anyone else's. |
| Export | `exceljs` is already a dependency. Google Ads export returns CSV with a BOM and `Cache-Control: no-store`. | Same headers. Offer `.xlsx` and `.csv`. |
| Tests | `node:test` files in `tests/*.test.ts`, run with `npx tsx --test tests/*.test.ts`. `*-pg.test.ts` files use real PostgreSQL in CI (`settlement-postgres.yml`). | Section 12. |

**Accounts default to watch.** In `AccountsClient.tsx`, a newly created department starts with every feature except SEO OS (`NEW_DEPARTMENT_FEATURES`). Without a change, every new department would get `dpm-invitation` and could read employees' emails and allergies. This design makes `dpm-invitation` opt-in as well: exclude it from `NEW_DEPARTMENT_FEATURES` just like SEO OS.

## 3. Data model

All ids are `TEXT` (uuid v4 made in the app), matching existing tables. Timestamps are `TIMESTAMPTZ`.

### 3.1 `dpm_invitation_events`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | uuid |
| `name` | TEXT NOT NULL | 2–120 characters after trim, for example "DPM Gala Dinner 2027". Shown in the admin list, the browser tab title and the Thank you page. |
| `slug` | TEXT NOT NULL UNIQUE | `CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$')`, which means 3–60 characters, lowercase letters, digits and inner hyphens. Suggested from the name and editable. |
| `status` | TEXT NOT NULL DEFAULT 'open' | `CHECK (status IN ('open','closed'))`. The manual switch. |
| `closes_at` | TIMESTAMPTZ NULL | Optional automatic close time. NULL means no automatic close. Entered and shown in WIB (Asia/Jakarta, UTC+7, no daylight saving; Vietnam is also UTC+7). |
| `image_key` | TEXT NOT NULL | `<uuid>.<ext>` under `data/dpm-invitations/`. `CHECK (image_key ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$')`. |
| `image_mime` | TEXT NOT NULL | `image/jpeg`, `image/png` or `image/webp` |
| `image_width` | INTEGER NOT NULL | After re-encoding. Used for `<img width height>` so the layout does not shift. |
| `image_height` | INTEGER NOT NULL | |
| `created_by` | TEXT REFERENCES users(id) ON DELETE SET NULL | |
| `updated_by` | TEXT REFERENCES users(id) ON DELETE SET NULL | |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP | |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP | |

**When registration is open.** One shared function decides this everywhere (public page, Thank you page, submit route, admin badges):

```ts
isRegistrationOpen(event, now) = event.status === 'open' && (event.closesAt === null || now < event.closesAt)
```

The admin can still close by hand at any time with the Close button. Reopening by hand while `closes_at` has passed does not open the form. The admin page then shows "Closed automatically at <time> WIB. Clear or move the closing time to reopen." There is no background job: the check runs on every request, so nothing needs a cron (and nothing uses treg).

No event date, venue or text fields are stored. That information is part of the uploaded artwork, so it stays in one place.

### 3.2 `dpm_invitation_responses`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | uuid |
| `event_id` | TEXT NOT NULL REFERENCES dpm_invitation_events(id) ON DELETE CASCADE | |
| `full_name` | TEXT NOT NULL | 2–120 characters after NFKC and whitespace collapse. Any script is allowed (Vietnamese diacritics). |
| `email` | TEXT NOT NULL | As typed, trimmed. Max 254 characters. |
| `email_normalized` | TEXT NOT NULL | `lower(trim(email))`, used for the upsert key and search. |
| `attending` | BOOLEAN NOT NULL | |
| `has_allergy` | BOOLEAN NULL | NULL when not attending. |
| `allergy_notes` | TEXT NULL | Only when `has_allergy` is true, 1–200 characters. |
| `submission_count` | INTEGER NOT NULL DEFAULT 1 | Increased on every upsert, so admins can see that a row was changed. |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP | First submission. |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP | Last submission. |

Constraints:

- `UNIQUE (event_id, email_normalized)`, which is the upsert key.
- `CHECK (email_normalized = lower(btrim(email)))`
- `CHECK (char_length(full_name) BETWEEN 2 AND 120)`, `CHECK (char_length(email) BETWEEN 3 AND 254)`
- Consistency of the answers, so the database itself rules out stray allergy data for non-attendees:

```sql
CHECK (
  (attending = FALSE AND has_allergy IS NULL AND allergy_notes IS NULL)
  OR (attending = TRUE AND has_allergy IS FALSE AND allergy_notes IS NULL)
  OR (attending = TRUE AND has_allergy IS TRUE AND allergy_notes IS NOT NULL AND char_length(allergy_notes) BETWEEN 1 AND 200)
)
```

Indexes: `(event_id, updated_at DESC)` for the list. The unique index covers lookup by email.

**Not stored**, to keep personal data to a minimum: IP address, user agent, and any free text other than the allergy note. Rate limiting is in memory only (section 9.2).

## 4. Migration and rollback

### 4.1 `db/migrations/068_dpm_invitation.sql`

Additive and idempotent, inside `BEGIN; … COMMIT;`, in the same style as 066:

1. `ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_permitted_features_valid;` then re-add it with the 067 list plus `'dpm-invitation'`: `social-post, video-script, event-plan, article-market-news, market-research, ai-research, internal-docs, seo, monthly-report, settlement-report, partnership, google-ads, dpm-invitation`.
2. Insert the department `('00000000-0000-0000-0000-000000000008', 'DPM', ARRAY['dpm-invitation'])` `WHERE NOT EXISTS` a row with that name or id.
3. `UPDATE departments SET permitted_features = permitted_features || ARRAY['dpm-invitation'] … WHERE name = 'DPM' AND NOT (permitted_features @> ARRAY['dpm-invitation'])`.
4. `CREATE TABLE IF NOT EXISTS dpm_invitation_events …` and `dpm_invitation_responses …` with the constraints above, plus `CREATE INDEX IF NOT EXISTS …`.

**No `?` anywhere in the migration file, comments included.** `scripts/migrate.ts` runs each file through `execute()`, which turns every `?` into a `$N` placeholder. That is why the slug regex above is written without `(?:…)`.

No existing row is changed except the CHECK constraint. No user is moved into DPM. Bayu creates or assigns DPM users in Accounts.

### 4.2 `db/rollbacks/068_dpm_invitation_down.sql`

1. `DROP TABLE IF EXISTS dpm_invitation_responses; DROP TABLE IF EXISTS dpm_invitation_events;`
2. `UPDATE departments SET permitted_features = array_remove(permitted_features, 'dpm-invitation') WHERE 'dpm-invitation' = ANY(permitted_features);`
3. Re-add the CHECK with the 067 list (without `dpm-invitation`).
4. Keep the DPM department row, because users may already be assigned to it. This matches 066.
5. `DELETE FROM schema_migrations WHERE name = '068_dpm_invitation.sql';` so the migration can be re-applied. Several rollbacks (051, 055, 057, 061, 062) already do this.

Image files in `data/dpm-invitations/` are not removed by SQL. The rollback file's header says to archive or delete that folder by hand after a backup.

Before merge: `pg_dump` backup of the production database, as for every MarketingOS merge.

## 5. Routes

### 5.1 Dashboard pages (signed in, `dpm-invitation`)

| Path | Purpose |
|---|---|
| `/dashboard/dpm/invitation` | List of invitation events: name, public link, status badge (Open, Closed, or Closed automatically when `closes_at` has passed), closing time in WIB if set, response counts, last response time. **New invitation** button opens a create panel with name, slug (pre-filled from the name, editable, live check `/i/<slug>`), optional closing date and time (a `datetime-local` input labelled "Closes at (WIB)"), and image upload with preview. |
| `/dashboard/dpm/invitation/[id]` | One event. Header shows the name, public link with **Copy link** and **Open page** buttons, and an **Open/Close registration** toggle. A settings panel edits the name, slug, closing time (WIB, with a Clear button) and image. Below that are KPI cards (Total, Attending, Not attending, With allergies) and the responses table. |

The responses table has the columns Full name, Email, Attending, Allergy (No / Yes / blank when not attending), Allergy notes, Last updated, and Changes (`submission_count` > 1 shows "edited ×N"). It has a search box (name or email, case-insensitive, debounced), filter chips (All / Attending / Not attending / With allergies), **Export Excel** and **Export CSV** buttons, and a **Delete** row action with a confirm dialog that names the row. The list is ordered by last updated, newest first. It loads all rows with no paging, since one event is expected to have at most a few hundred responses. Paging can be added later if needed.

UI text is English, and components come from `@/components/ui/dashboard` (`PageHeader`, `MetricCard`, `DataTableFrame`, `Button`, `StatusBadge`, `EmptyState`), like the other dashboard pages.

### 5.2 Admin API (all call `requireFeature(request, 'dpm-invitation')`)

| Method and path | Body / query | Result |
|---|---|---|
| `GET /api/dpm/invitations` | none | `{ events: [{ id, name, slug, status, closesAt, isOpen, publicPath, imageUrl, counts: { total, attending, notAttending, withAllergies }, lastResponseAt, createdAt }] }` |
| `POST /api/dpm/invitations` | `multipart/form-data`: `name`, `slug`, `image`, optional `closesAt` | `201 { event }`. `409` if the slug is taken. |
| `GET /api/dpm/invitations/[id]` | none | `{ event }` with counts |
| `PATCH /api/dpm/invitations/[id]` | JSON: any of `name`, `slug`, `status` (`open` or `closed`), `closesAt` (WIB local string or `null` to clear) | `{ event }`. A slug change returns `409` if taken. |
| `PUT /api/dpm/invitations/[id]/image` | `multipart/form-data`: `image` | `{ event }`. The new file is written first, the row is updated, then the old file is removed. |
| `DELETE /api/dpm/invitations/[id]` | JSON `{ confirm: '<slug>' }` | `204`. **Admin only** (`role === 'admin'`), deletes all responses and the image file. |
| `GET /api/dpm/invitations/[id]/responses` | `?q=&filter=all|attending|not-attending|allergy` | `{ counts, responses: [...] }`. Counts always cover the whole event, not just the filtered rows. |
| `DELETE /api/dpm/invitations/[id]/responses/[responseId]` | none | `204`. Admins and `dpm-invitation` holders. |
| `GET /api/dpm/invitations/[id]/export` | `?format=xlsx|csv&q=&filter=` | File download, `Cache-Control: no-store`, name `dpm-invitation-<slug>-<YYYYMMDD>.xlsx|csv` using the Asia/Jakarta date. |
| `GET /api/dpm/invitations/[id]/image` | none | Signed-in preview of the image, even when the event is closed. Uses the same file reader as the public route. |

All responses send `Cache-Control: no-store`, because they contain personal data. Every handler checks that `[id]` exists and returns `404 { error: 'Invitation not found.' }` if not.

Who can do what:

| Action | `dpm-invitation` holder | Admin |
|---|---|---|
| Create event, edit name/slug/image, open/close, view responses, export | Yes | Yes |
| Delete a response | Yes | Yes |
| Delete an event | No | Yes |

Deleting events stays admin-only, and nothing else in this spec conflicts with that. A DPM user who wants to stop an event uses Close; deleting an event removes every response at once, so it is kept for admins.

### 5.3 Public pages (no login)

| Path | Purpose |
|---|---|
| `/i/[slug]` | Invitation image plus the form. When closed, the image plus "Registration is closed." When the slug is unknown, a plain "This invitation link is not valid." page with HTTP 404. |
| `/i/[slug]/thanks` | Thank you page. |
| `/i/[slug]/image` | Route handler that returns the image bytes (section 7). |

The form posts to a public route handler, `POST /api/public/dpm-invitations/[slug]/responses`, with a JSON body `{ fullName, email, attending, hasAllergy?, allergyNotes?, website }`. On success it returns `200 { ok: true }` and the client navigates to `/i/<slug>/thanks`. On a validation error it returns `422 { fieldErrors }`. Other errors return `{ error }` with 400 (body is not a JSON object), 403, 404, 413, 429 or 500.

Annual Dinner uses a server action here. MarketingOS has **no server actions anywhere** today: every write is an API route, and `rateLimit()` takes a `NextRequest`. So this design uses a route handler to stay with the MarketingOS pattern. The form is a client component anyway, because of the conditional questions. The route does not call `getSession`, and `/api/public/` is not in `ADMIN_ONLY_API_PREFIXES`.

## 6. Public route and the "middleware allowance"

MarketingOS has **no** `middleware.ts` or `proxy.ts`, and `next.config.ts` has no matcher. Pages outside `/dashboard` are not gated by any global layer, and API routes check auth one by one. That means `/i/*` needs **no middleware change**. It is public because:

- it lives at `src/app/i/...`, outside `/dashboard`, so the dashboard layout and its client-side feature check never run;
- its page, image handler and the submit route `src/app/api/public/dpm-invitations/[slug]/responses/route.ts` never call `getSession` or `requireFeature`;
- it reads only the event's `name`, `slug`, `status`, `closes_at` and image, and never reads or returns any response data.

`/share/ai-research/[token]` is the existing precedent. Guard rails:

- `export const dynamic = 'force-dynamic'` so the open/closed state is never cached.
- `metadata`: `robots: { index: false, follow: false }`, `referrer: 'no-referrer'`, and title = event name.
- No MarketingOS chrome or links into the dashboard, and no session-dependent content.
- A test asserts that the files under `src/app/i/` and `src/app/api/public/dpm-invitations/` do not import `@/lib/auth`, so a later change cannot accidentally gate or leak through them.
- If a `middleware.ts` or `proxy.ts` is ever added, it must allow `/i/` explicitly. This note goes in a comment at the top of `src/app/i/[slug]/page.tsx`.

`/i` is a short top-level segment. No route `src/app/i` exists today. The reserved-slug list (section 9.1) prevents slugs like `thanks` or `image` that would be confusing.

## 7. Image upload, storage and serving

**Upload limits** (checked in the browser and again in the API):

- Types: JPEG, PNG or WebP. The type is decided by `sharp` reading the bytes, not by the file name or the browser's MIME type.
- Size: max **8 MB** per file. `next.config.ts` already allows large bodies for FAQ uploads, so no change is needed there. The route reads `file.size` before buffering.
- Dimensions: at least 600 px on the short side and at most 8000 px on each side, to reject tiny images and decompression bombs. `sharp`'s `limitInputPixels` is set to 50 megapixels.
- One image per event.

**Processing** with `sharp` (already a dependency): auto-rotate from EXIF, then **strip all metadata** (GPS and camera data must not reach the public), resize so the longest side is at most **2400 px** without upscaling, and re-encode to **WebP quality 85**. Store as `data/dpm-invitations/<uuid>.webp` with `image_mime = 'image/webp'` and the output width and height. Re-encoding also removes anything hidden in the original file. Bayu's sample is 1024×1536 portrait and would be stored at the same size.

**Storage:** `path.join(process.cwd(), 'data', 'dpm-invitations')`, created with `mkdir -p` on first upload. Add `data/dpm-invitations/` to `.gitignore`. The folder survives deploys because `deploy.sh` never runs `git clean`. It is **not** inside `public/`, so files are only served through the handler.

**Serving** from `GET /i/[slug]/image`:

- Look up the event by slug, open **or** closed (the closed page still shows the artwork). Unknown slug returns 404.
- Validate `image_key` against `^[0-9a-f-]{36}\.(jpg|png|webp)$` before building a path, so path traversal is impossible.
- Headers: `Content-Type` from the row, `Cache-Control: public, max-age=86400`, `X-Content-Type-Options: nosniff`.
- The page requests `/i/<slug>/image?v=<image_key without extension>` so a replaced image is fetched fresh without lowering the cache time.

Deleting an event or replacing the image removes the old file after the DB change succeeds. If removing it fails, that is logged and not fatal.

## 8. Public page design

The page copies the structure and CSS of Annual Dinner's `register.css`, scoped under `.pg-dpm-inv` in a new `src/app/i/invitation.css` (MarketingOS has no `src/styles` folder). The design tokens it uses (`--dp-black`, `--dp-ink`, `--dp-muted`, `--dp-blue`, `--n-300`, `--r-2`, `--danger`, `--focus`, and the `.field/.label/.input/.help/.err/.notice/.btn` primitives) are copied into that file with the same values as `annual-dinner/app/src/styles/tokens.css`. That way it does not depend on the MarketingOS dashboard theme, and no other page changes.

**Layout**

- Mobile (below 1024 px): one column. The image comes first at full width, natural aspect ratio (`width:100%; height:auto`), then the form.
- Desktop (1024 px and up): `grid-template-columns: minmax(440px, 5fr) 7fr` as in Annual Dinner. The left panel is `position: sticky; top: 0; height: 100vh` on `--dp-black`. The image uses `object-fit: contain` and is centred, so a portrait invitation is never cropped. Any space around it stays black, which matches the dark artwork. The right side is the form, vertically centred, `max-width: 640px`.
- The image has `alt` = event name, plus `width` and `height` from the row.

**Form column** (top to bottom)

- Eyebrow: "RSVP". Heading: "Confirm your attendance". Subline: event name.
- **Full name**: text input, `autoComplete="name"`, `maxLength=120`, required. Help: "As you would like it to appear on the guest list."
- **Email**: `type="email"`, `autoComplete="email"`, `inputMode="email"`, `maxLength=254`, required. Help: "If you submit again with the same email, we will update your answer."
- **Will you attend?**: segmented control `Yes | No`, using the same `.choice` radiogroup markup and CSS as Annual Dinner's allergy question, required.
- Only when attending is Yes: **Do you have any food allergies?** `No | Yes` segmented control, required. Help: "Shared with the event organisers and catering only."
- Only when allergy is Yes: **What are you allergic to?** Text input, `maxLength=200`, placeholder "e.g. peanuts, shellfish, gluten", required, help "Up to 200 characters."
- Honeypot (section 9.3).
- **Submit** button: full width on mobile, "Submit" or "Submitting…" while pending.
- Fine print: "Your answers are only visible to the DPM event team."

Switching attending from Yes to No hides the allergy questions. Their inputs are **removed from the DOM**, not just hidden, so they are not posted, and the server ignores them in any case. Switching back to Yes brings back the values typed before in the same session. The client keeps them in state but does not send them while attending is No.

**Closed state** (status closed, or `closes_at` passed): same layout. The right side shows the heading and a notice: "Registration for this event is closed. If you need help, please contact the DPM event team." There is no form.

**Thank you page** (`/i/[slug]/thanks`): same left panel. The right side shows "Thank you" and "Your response has been recorded. You can submit again with the same email to change it." It has a link back to the form ("Change my answer"). The text is the **same for a new and an updated response**, and it shows no name or email. This way nobody can find out whether an email had already responded. The page shows the closed notice instead if the event has since closed, and 404 for an unknown slug.

No logo or other artwork is drawn by the app. All visuals come from the uploaded image.

## 9. Validation and abuse protection

### 9.1 Event (admin)

- `name`: trim, collapse whitespace, 2–120 characters.
- `slug`: lowercase, trim, regex `^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$`, no `--`, not in the reserved list `['new', 'admin', 'api', 'image', 'thanks', 'edit']`, unique (DB constraint, mapped to `409 'That link is already used by another invitation.'`).
- Changing the slug **breaks the link already shared**. The settings panel shows a warning when the event already has responses: "The old link /i/<old> will stop working." It needs a second click to confirm. Old slugs are not redirected (decided, section 14).
- `status`: `open` or `closed`. New events start **open**.
- `closesAt`: optional. The admin form sends the `datetime-local` value (`YYYY-MM-DDTHH:mm`), which is read as WIB: the server stores `new Date(value + ':00+07:00')`. An empty value or `null` clears it. A value that does not parse gives "Enter a valid closing date and time." A time in the past when set or changed gives "Closing time must be in the future." To close now, use Close. The API returns `closesAt` as ISO UTC, and the UI shows it as `DD MMM YYYY, HH:mm WIB` using `Asia/Jakarta`.

### 9.2 Response (public)

A shared pure function `parseDpmInvitationResponse(form)` in `src/lib/dpm-invitation/validation.ts` runs on the server and is also used to show inline errors on the client.

| Field | Rule | Error text |
|---|---|---|
| `fullName` | NFKC, collapse whitespace, trim, 2–120 characters, no control characters | "Please enter your full name." / "Please use at most 120 characters." |
| `email` | Trim, max 254, one `@`, a non-empty local part, a domain with at least one dot, no spaces (a practical check, no DNS lookup). Stored as typed, keyed by lowercase. | "Please enter a valid email address." |
| `attending` | `yes` or `no` | "Please choose Yes or No." |
| `hasAllergy` | Only read when attending = yes. `yes` or `no`. | "Please choose Yes or No." |
| `allergyNotes` | Only read when hasAllergy = yes. NFKC, collapse whitespace, trim, 1–200 characters. | "Please tell us what you are allergic to." / "Please use at most 200 characters." |

When attending = no, `hasAllergy` and `allergyNotes` are **discarded** whatever was posted, and stored as NULL. When hasAllergy = no, `allergyNotes` is discarded. The DB CHECK in section 3.2 backs this up.

Field errors come back to the form with the typed values kept, as in Annual Dinner's `RegisterState`.

**Upsert** (one statement):

```sql
INSERT INTO dpm_invitation_responses (id, event_id, full_name, email, email_normalized, attending, has_allergy, allergy_notes)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (event_id, email_normalized) DO UPDATE SET
  full_name = EXCLUDED.full_name, email = EXCLUDED.email, attending = EXCLUDED.attending,
  has_allergy = EXCLUDED.has_allergy, allergy_notes = EXCLUDED.allergy_notes,
  submission_count = dpm_invitation_responses.submission_count + 1,
  updated_at = CURRENT_TIMESTAMP
```

The route re-reads the event inside the same request and rejects it if `isRegistrationOpen(event, new Date())` is false (`403 "Registration has closed."`). The client then goes to `/i/<slug>/thanks`.

### 9.3 Abuse protection

- **Rate limit** with a new helper `consumeRateLimit(bucket, key, limit, windowMs)` in `src/lib/rate-limit.ts`, which keeps a separate in-memory map per bucket. That is enough because production runs one pm2 process. The existing `rateLimit()` stays as it is.
  - `dpm-inv-ip`: **60 submissions per 10 minutes per IP** across all events. That leaves room for many employees on one office Wi-Fi.
  - `dpm-inv-email`: **5 submissions per hour per (event, normalized email)**, which limits rapid overwrites of one person's row.
  - `dpm-inv-upload`: 20 image uploads per hour per signed-in user.
  - Client IP, in this order: `cf-connecting-ip`, then `x-real-ip`, then the first `x-forwarded-for` value, then `'unknown'`. Why, from a read-only check of the VPS on 2026-11-23:
    - `marketing-aws.gorillaworkout.id` resolves to Cloudflare, and the cloudflared tunnel config (`/etc/cloudflared/config.yml`) sends it straight to `http://127.0.0.1:3021`. **Production traffic does not pass through nginx**, so `X-Real-IP` is not set on that path. Cloudflare sets `CF-Connecting-IP` to the visitor's IP.
    - nginx (`/etc/nginx/sites-enabled/marketingos`, port 80) only serves `marketingos.gorillaworkout.id` and the bare IP `16.78.68.56`, and sets `X-Real-IP $remote_addr` and `X-Forwarded-For $proxy_add_x_forwarded_for`.
    - The app listens on `*:3021`, not just localhost. If the AWS security group lets the internet reach port 3021 or 80 directly, a client could fake these headers. That would only let it dodge the IP limit; the per-email limit still applies. Checking the security group is a pre-coding task in the plan.
  - When limited, the form shows "Too many attempts. Please wait a few minutes and try again." The page itself (GET) is not rate-limited.
- **Honeypot:** a text input `name="website"` inside a wrapper that is visually hidden (`position:absolute; left:-10000px`, `aria-hidden="true"`, `tabIndex={-1}`, `autoComplete="off"`), labelled "Leave this field empty". If it has any value, the route stores nothing and returns the normal `200 { ok: true }`, so a bot cannot tell.
- **Size limits:** the submit route rejects a body over 16 KB (`content-length` check, then a length check on the text read) with `413` before parsing JSON. Each field has its `maxLength`, checked again on the server. The image upload limits are in section 7.
- **No data comes back:** the public side never returns or pre-fills any stored response, so a guessed email shows nothing.

## 10. Error handling

| Case | Behaviour |
|---|---|
| Unknown slug | `/i/<slug>` and `/thanks` return an HTTP 404 page "This invitation link is not valid." `/image` returns 404. |
| Event closed | Page shows the closed notice. The submit route returns `403 "Registration has closed."` without writing, and the form shows it. |
| Field errors | Inline per field, values kept, focus goes to the first field with an error. |
| Rate limited | Form-level notice (above). Nothing written. |
| DB error on submit | Logged server-side without the personal data (event id and error code only). The user sees "Something went wrong. Please try again in a minute." and their values are kept. |
| Image read error | 500 from `/image`, logged. The page still renders the form, with `alt` text where the image would be. |
| Admin upload errors | `400` with a clear message: "Use a JPG, PNG or WebP image.", "Image must be 8 MB or smaller.", "Image is too small (minimum 600 px on the short side).", "Could not read this image." |
| Slug taken | `409`, the message is shown next to the slug field. |
| No access | `401` / `403` from `requireFeature`. The dashboard page is hidden from the sidebar and blocked by the existing client-side check. |
| Deleting an event without admin role | `403 'Only admins can delete an invitation.'` |

Logs never contain the email, name or allergy note.

## 11. Privacy

- Responses are visible only through `/api/dpm/**`, which needs `dpm-invitation` or admin. The public side never reads responses.
- `dpm-invitation` is **not** in the default feature set for new departments in Accounts (section 2).
- Exports are generated on request and never written to disk on the server. Cells starting with `=`, `+`, `-`, `@`, tab or CR get a leading `'` in both CSV and XLSX, to stop formula injection when opened in Excel.
- Admins and DPM Invitation users can delete single responses. Only admins can delete an event, which deletes all of its responses and its image.
- No IP address, user agent or email delivery is involved.
- The public page carries a one-line notice of who sees the answers (section 8).

## 12. Testing plan

Unit tests (`node:test`, `tests/dpm-invitation*.test.ts`):

1. **Access wiring** (like `google-ads-access.test.ts`): `ACCOUNT_FEATURES` has `dpm-invitation`, the label and href are set, `accountFeatureFromPath('/dashboard/dpm/invitation/abc')` returns `dpm-invitation`, a member without it is blocked and an admin is not, the sidebar has a `DPM` section with `Invitation`, and `dpm-invitation` is excluded from the new-department defaults.
2. **Open check and closing time**: `isRegistrationOpen` for open+null, open+future, open+past, closed+future; `parseClosesAtWib('2026-12-20T18:00')` equals `2026-12-20T11:00:00.000Z`; invalid and past values rejected; WIB display formatting.
3. **Validation** with `parseDpmInvitationResponse`: valid attending/no-allergy; valid attending/allergy with notes; not attending with posted allergy fields, which come back null; missing name, bad emails (`a@b`, `a b@c.d`, empty), 121-character name, 201-character notes, notes required when allergy is Yes, invalid choice values, Vietnamese names with diacritics kept, NFKC and whitespace collapse.
4. **Slug rules**: valid examples, uppercase folded, reserved words, leading or trailing hyphen, `--`, too short or too long.
5. **Rate-limit helper**: buckets do not share counters, the window resets, and the limit is exact.
6. **Honeypot**: a filled `website` leads to no write and a normal `200 { ok: true }`.
7. **CSV/XLSX export**: header row, `Yes/No/blank` mapping, formula-injection escaping, BOM on CSV.
8. **Public files do not import auth**: static check of `src/app/i/**` and `src/app/api/public/dpm-invitations/**`.

PostgreSQL tests (`tests/dpm-invitation-pg.test.ts`, run in the existing Postgres CI job):

9. Migration 068 applies on a database at 067, applies again with no changes, and the rollback then re-apply works. The CHECK accepts `dpm-invitation` and rejects an unknown feature. The DPM department exists exactly once.
10. Upsert: the same email with different case updates one row, `submission_count` becomes 2, and `created_at` stays. Different events with the same email give two rows.
11. The table CHECK rejects `attending=false` with `has_allergy` set, and `has_allergy=true` with empty notes.
12. Counts: total, attending, not attending, with allergies are correct on a mixed set. Search by name and email substring is case-insensitive.
13. Cascade: deleting an event removes its responses.

Route tests (handler functions called directly, as other `tests/*` do):

14. `/api/dpm/**` returns 401 without a session and 403 for a member without the feature. Deleting a response works for a holder; deleting an event returns 403 for a non-admin holder.
15. Upload: rejects a `.gif`, a text file renamed to `.jpg`, a 9 MB file, a 300×300 image. Accepts the portrait sample size and stores WebP with metadata removed (an EXIF GPS tag on input is gone in the output).
16. `/i/[slug]/image`: 404 for an unknown slug and for a bad `image_key`, correct headers for a valid one.
17. Submit route: 404 unknown slug, 403 closed, 422 field errors, 413 oversized body, 429 after the IP limit, 200 and one row on success.

Manual check on a branch preview or locally before merge:

18. Phone width (375 px) and desktop (1440 px) with a portrait image: the image is not cropped, and the form is usable with the keyboard alone. Switching Attending to No hides the allergy questions, and they are not posted (checked in the network panel).
19. Open, then close, then submit from a tab that was opened earlier: the closed message is shown. Same with a closing time two minutes ahead: after it passes, the page and the submit both show closed.
20. Resubmit with the same email in upper case: still one row, "edited ×2".
21. Export opens in Excel with Vietnamese characters intact.

Release: `npm run build`, `npx tsx --test tests/*.test.ts`, Postgres CI green, DB backup, then merge after Bayu's OK. After deploy, check that migration 068 is in `schema_migrations`, open `/i/<test-slug>` signed out, and remove the test event.

## 13. Files expected to change (for the plan, not code)

- `db/migrations/068_dpm_invitation.sql`, `db/rollbacks/068_dpm_invitation_down.sql`
- `src/lib/authorization.ts` (feature, label, href, prefix match)
- `src/app/dashboard/layout.tsx` (DPM section)
- `src/app/dashboard/accounts/AccountsClient.tsx` (exclude from new-department defaults)
- `src/lib/rate-limit.ts` (named-bucket helper)
- `src/lib/dpm-invitation/` (validation, store/queries, image processing, export)
- `src/app/api/dpm/invitations/**` (admin API)
- `src/app/dashboard/dpm/invitation/page.tsx`, `src/app/dashboard/dpm/invitation/[id]/page.tsx`
- `src/app/i/[slug]/page.tsx`, `InvitationForm.tsx`, `thanks/page.tsx`, `image/route.ts`
- `src/app/api/public/dpm-invitations/[slug]/responses/route.ts` (public submit)
- `src/app/i/invitation.css` (MarketingOS has no `src/styles` folder)
- `.gitignore` (`data/dpm-invitations/`)
- `tests/dpm-invitation*.test.ts`

Bayu's sample image is not committed. Tests generate their own images with `sharp`.

## 14. Decisions on the open questions (2026-11-23)

All questions are decided. Nothing is open.

1. **Feature label:** stays "DPM Invitation" in Accounts. Decided by Bayu.
2. **Changing the slug:** warning only, the old link does not redirect. Decided (default).
3. **Rate limit per IP:** 60 submissions per 10 minutes. The per-event-plus-email limit (5 per hour) stays. Decided by Bayu.
4. **Who can delete:** admins and DPM Invitation users can delete responses. Deleting an event stays admin-only (no conflict found, see section 5.2). Decided by Bayu.
5. **Overwrite by a known email:** acceptable for an internal event. `submission_count` still shows edited rows. Decided (default).
6. **Email domain:** any domain, no restriction. Decided by Bayu.
7. **Automatic close:** optional `closes_at` per event, entered and shown in WIB. Open only when status is open and `closes_at` is null or still in the future. Manual Close still works. Decided by Bayu.
8. **Archiving old events:** out of scope for v1. Decided (default).

## 15. Pre-coding checks

- **Client-IP header:** checked read-only on 2026-11-23 through Bayu's Mac (`aws-marketing`). The result is in section 9.3: production goes through the Cloudflare tunnel, so use `cf-connecting-ip` first.
- **Still to check (Bayu, AWS console, read-only):** whether the EC2 security group allows inbound 3021 or 80 from the internet. If it does, consider closing 3021 to the public. That is a separate infrastructure change and is not part of this feature.
