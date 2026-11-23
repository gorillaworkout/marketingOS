# DPM Invitation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DPM sidebar section with an Invitation tool. A DPM user creates an event with an uploaded invitation image and gets one public link (`/i/<slug>`). Employees open it without logging in and RSVP (name, email, attending, food allergy). DPM users see counts, search, export and delete responses.

**Architecture:** A new Accounts feature, `dpm-invitation`, gates the dashboard pages and `/api/dpm/**` routes, using the same pattern as `google-ads`. Pure rules (validation, slug, open/closed, WIB time) live in `src/lib/dpm-invitation/rules.ts`. Postgres access goes in `store.ts`, image handling (sharp, `data/dpm-invitations/`) in `image.ts`, and the public submit logic in `submit.ts` with injected dependencies so it can be unit-tested. Public pages live under `src/app/i/[slug]` and never import auth.

**Tech Stack:** Next.js 16 App Router, React 19, PostgreSQL via `pg` (`@/lib/database` with `?` placeholders), `sharp`, `exceljs`, `node:test` run with `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-23-dpm-invitation-design.md`

## Global Constraints

- Feature id `dpm-invitation`, Accounts label `DPM Invitation`, dashboard href `/dashboard/dpm/invitation`, sidebar section `DPM` with item `Invitation`.
- DPM department id `00000000-0000-0000-0000-000000000008`, name `DPM`.
- Migration `db/migrations/068_dpm_invitation.sql`, rollback `db/rollbacks/068_dpm_invitation_down.sql`. Renumber both if another 068 lands on main first.
- **No `?` character anywhere in a migration file, comments included.** `scripts/migrate.ts` runs files through `execute()`, which rewrites `?` into `$N`. The same applies to SQL strings in app code: `?` is only ever a parameter placeholder.
- `dpm-invitation` must NOT be in the new-department default feature set (`NEW_DEPARTMENT_FEATURES`).
- Public pages are English-only and need no login. They never import `@/lib/auth` and never read or return response data.
- Form order: Full name (required, 2–120) → Email (required, valid, max 254, any domain) → Will you attend? Yes/No → only if Yes: Do you have any food allergies? Yes/No → only if allergy Yes: What are you allergic to? (required, 1–200). Not attending means `has_allergy` and `allergy_notes` are NULL.
- Upsert key `(event_id, lower(trim(email)))`. Resubmitting updates the row and increases `submission_count`.
- Registration is open only when `status === 'open' && (closesAt === null || now < closesAt)`. `closes_at` is entered and shown in WIB (Asia/Jakarta, UTC+7).
- Rate limits: `dpm-inv-ip` 60 per 10 minutes per IP; `dpm-inv-email` 5 per hour per (event, normalized email); `dpm-inv-upload` 20 per hour per user. Client IP order: `cf-connecting-ip`, `x-real-ip`, first `x-forwarded-for`, `'unknown'`.
- Honeypot field `website`. If filled, return a normal success and store nothing.
- Image: JPEG/PNG/WebP decided by sharp, max 8 MB, short side ≥ 600 px, each side ≤ 8000 px, `limitInputPixels` 50,000,000. Output WebP q85, longest side ≤ 2400 px, metadata stripped. Stored at `data/dpm-invitations/<uuid>.webp` (gitignored).
- Delete a response: admins and `dpm-invitation` holders. Delete an event: admins only.
- Admin JSON and exports send `Cache-Control: no-store`. Logs never contain name, email or allergy notes.
- Out of scope: tickets, check-in, doorprize, duplicate-name detection, per-guest tokens, emails, domain restriction, slug redirects, archiving.
- No cron or scheduled job. Never use treg. Do not change the LLM provider mode.
- Merge only after Bayu's explicit OK, with a production `pg_dump` backup taken first.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/authorization.ts` (modify) | Feature id, label, href, prefix match |
| `src/app/dashboard/layout.tsx` (modify) | DPM sidebar section |
| `src/app/dashboard/accounts/AccountsClient.tsx` (modify) | Exclude from new-department defaults |
| `db/migrations/068_dpm_invitation.sql` (create) | Feature CHECK, DPM department, two tables |
| `db/rollbacks/068_dpm_invitation_down.sql` (create) | Undo 068 |
| `.gitignore` (modify) | `data/dpm-invitations/` |
| `src/lib/dpm-invitation/types.ts` (create) | Shared types |
| `src/lib/dpm-invitation/rules.ts` (create) | Pure validation, slug, open check, WIB helpers |
| `src/lib/rate-limit.ts` (modify) | `consumeRateLimit`, `clientIpFromHeaders` |
| `src/lib/dpm-invitation/image.ts` (create) | sharp processing and file storage |
| `src/lib/dpm-invitation/store.ts` (create) | All SQL |
| `src/lib/dpm-invitation/export.ts` (create) | CSV and XLSX |
| `src/lib/dpm-invitation/present.ts` (create) | API JSON shape, permission helper |
| `src/lib/dpm-invitation/submit.ts` (create) | Public submit flow with injected deps |
| `src/app/api/dpm/invitations/**` (create) | Admin API |
| `src/app/api/public/dpm-invitations/[slug]/responses/route.ts` (create) | Public submit |
| `src/app/i/invitation.css`, `src/app/i/[slug]/{page,InvitationForm,InvitationShell,not-found}.tsx`, `src/app/i/[slug]/thanks/page.tsx`, `src/app/i/[slug]/image/route.ts` (create) | Public pages |
| `src/app/dashboard/dpm/invitation/page.tsx`, `src/app/dashboard/dpm/invitation/[id]/page.tsx` (create) | Admin UI |
| `tests/dpm-invitation-*.test.ts` (create) | Tests |

---

### Task 0: Pre-coding checks (no code)

**Files:** none.

- [x] **Step 1: Client-IP header on the VPS (done 2026-11-23, read-only through Bayu's Mac, `ssh aws-marketing`).**
  - `marketing-aws.gorillaworkout.id` resolves to Cloudflare. `/etc/cloudflared/config.yml` routes it to `http://127.0.0.1:3021`, so production traffic **bypasses nginx** and Cloudflare's `CF-Connecting-IP` is the real client IP.
  - nginx `/etc/nginx/sites-enabled/marketingos` (port 80) only serves `marketingos.gorillaworkout.id` and `16.78.68.56`. It sets `X-Real-IP $remote_addr` and `X-Forwarded-For $proxy_add_x_forwarded_for`.
  - The app listens on `*:3021`.
  - Result: IP order `cf-connecting-ip` → `x-real-ip` → first `x-forwarded-for` → `'unknown'` (Task 3).
- [ ] **Step 2: Ask Bayu to look at the EC2 security group (AWS console, read-only).** Is inbound TCP 3021 or 80 open to `0.0.0.0/0`? If so, the IP headers can be faked by direct hits. That only weakens the IP limit, so it is not a blocker for this feature. Any change to the security group is separate work and needs Bayu's OK.
- [ ] **Step 3: Confirm the migration number.**

Run: `git fetch origin main && git ls-tree --name-only origin/main db/migrations/ | tail -3`
Expected: the last file is `db/migrations/067_google_ads_alerts.sql`. If a 068 exists, use the next free number in every task below.

- [ ] **Step 4: Create the feature branch from main.**

```bash
git checkout -b feat/dpm-invitation origin/main
```

---

### Task 1: Feature wiring (Accounts feature, sidebar, defaults)

**Files:**
- Modify: `src/lib/authorization.ts`
- Modify: `src/app/dashboard/layout.tsx` (sidebar sections, after the `Paid Media` section)
- Modify: `src/app/dashboard/accounts/AccountsClient.tsx:5-9`
- Modify: `tests/google-ads-access.test.ts:59`, `tests/partnership-access.test.ts:59`, `tests/seo-os.test.ts:69` and `:128-129` (older tests that list every feature)
- Test: `tests/dpm-invitation-access.test.ts`

**Interfaces:**
- Produces: `DPM_INVITATION_FEATURE = 'dpm-invitation'` exported from `@/lib/authorization`; `AccountFeature` now includes `'dpm-invitation'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/dpm-invitation-access.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACCOUNT_FEATURES, ACCOUNT_FEATURE_LABELS, DASHBOARD_FEATURE_HREFS, DPM_INVITATION_FEATURE,
  accountFeatureFromPath, canAccessFeature, isDashboardNavItemVisible, shouldBlockDashboardGenerationPath,
} from '../src/lib/authorization';

const read = (file: string) => readFileSync(file, 'utf8');

test('dpm-invitation is an Accounts feature, prefix-matched under /dashboard/dpm/invitation', () => {
  assert.equal(DPM_INVITATION_FEATURE, 'dpm-invitation');
  assert.ok(ACCOUNT_FEATURES.includes('dpm-invitation'));
  assert.equal(ACCOUNT_FEATURE_LABELS['dpm-invitation'], 'DPM Invitation');
  assert.equal(DASHBOARD_FEATURE_HREFS['dpm-invitation'], '/dashboard/dpm/invitation');
  assert.equal(accountFeatureFromPath('/dashboard/dpm/invitation'), 'dpm-invitation');
  assert.equal(accountFeatureFromPath('/dashboard/dpm/invitation/abc'), 'dpm-invitation');
});

test('only admins and holders can open DPM Invitation', () => {
  const member = { role: 'member', features: ['social-post'] };
  const holder = { role: 'member', features: ['dpm-invitation'] };
  const admin = { role: 'admin', features: [] };
  assert.equal(canAccessFeature(member, 'dpm-invitation'), false);
  assert.equal(canAccessFeature(holder, 'dpm-invitation'), true);
  assert.equal(canAccessFeature(admin, 'dpm-invitation'), true);
  assert.equal(shouldBlockDashboardGenerationPath(member, '/dashboard/dpm/invitation/x'), true);
  assert.equal(shouldBlockDashboardGenerationPath(holder, '/dashboard/dpm/invitation/x'), false);
  const item = { href: '/dashboard/dpm/invitation', feature: 'dpm-invitation' as const };
  assert.equal(isDashboardNavItemVisible(item, member), false);
  assert.equal(isDashboardNavItemVisible(item, holder), true);
});

test('sidebar has a DPM section with Invitation', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(layout, /label: 'DPM',\s*items: \[\s*\{ href: '\/dashboard\/dpm\/invitation', label: 'Invitation', icon: 'event', feature: 'dpm-invitation' \}/);
});

test('new departments do not get dpm-invitation by default (personal data)', () => {
  const accounts = read('src/app/dashboard/accounts/AccountsClient.tsx');
  assert.match(accounts, /NEW_DEPARTMENT_FEATURES[^\n]*feature !== SEO_FEATURE && feature !== DPM_INVITATION_FEATURE/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/dpm-invitation-access.test.ts`
Expected: FAIL. `DPM_INVITATION_FEATURE` is undefined, so the first equal assertion fails.

- [ ] **Step 3: Implement**

In `src/lib/authorization.ts`, after `GOOGLE_ADS_FEATURE`:

```ts
/**
 * DPM (company) tools: Invitation (one public RSVP link per event).
 * Holds employee emails and allergy notes, so it is opt-in per department.
 * Migration 068 creates a DPM department with it.
 */
export const DPM_INVITATION_FEATURE = 'dpm-invitation' as const;
```

Replace `ACCOUNT_FEATURES` and `PREFIX_MATCHED_FEATURES`:

```ts
export const ACCOUNT_FEATURES = [INTERNAL_DOCS_FEATURE, ...GENERATION_FEATURES, SEO_FEATURE, MONTHLY_REPORT_FEATURE, SETTLEMENT_REPORT_FEATURE, PARTNERSHIP_FEATURE, GOOGLE_ADS_FEATURE, DPM_INVITATION_FEATURE] as const;
```

```ts
const PREFIX_MATCHED_FEATURES = [INTERNAL_DOCS_FEATURE, SEO_FEATURE, MONTHLY_REPORT_FEATURE, SETTLEMENT_REPORT_FEATURE, PARTNERSHIP_FEATURE, GOOGLE_ADS_FEATURE, DPM_INVITATION_FEATURE] as const;
```

Add the entry `'dpm-invitation': 'DPM Invitation',` as the last line of `ACCOUNT_FEATURE_LABELS`, and `'dpm-invitation': '/dashboard/dpm/invitation',` as the last line of `DASHBOARD_FEATURE_HREFS`.

In `src/app/dashboard/layout.tsx`, directly after the `Paid Media` section object:

```tsx
    {
      label: 'DPM',
      items: [
        { href: '/dashboard/dpm/invitation', label: 'Invitation', icon: 'event', feature: 'dpm-invitation' },
      ],
    },
```

In `src/app/dashboard/accounts/AccountsClient.tsx`, replace the import and the two constants:

```tsx
import { ACCOUNT_FEATURES, ACCOUNT_FEATURE_LABELS, DPM_INVITATION_FEATURE, SEO_FEATURE, type AccountFeature } from '@/lib/authorization';

const ASSIGNABLE_FEATURES: readonly AccountFeature[] = ACCOUNT_FEATURES;
/** SEO OS and DPM Invitation (employee personal data) are opt-in: a new department starts with every other feature. */
const NEW_DEPARTMENT_FEATURES: readonly AccountFeature[] = ASSIGNABLE_FEATURES.filter(feature => feature !== SEO_FEATURE && feature !== DPM_INVITATION_FEATURE);
```

Older tests check that each earlier migration's CHECK lists every feature in `ACCOUNT_FEATURES`, and that the Accounts default excludes only SEO OS. Adding a feature breaks them (checked on a scratch copy of main: 1 failure in `google-ads-access`, 1 in `seo-os`). Update them the same way earlier features did:

`tests/google-ads-access.test.ts` line 59:

```ts
  // `dpm-invitation` was added later by migration 068.
  for (const feature of ACCOUNT_FEATURES.filter(f => f !== 'dpm-invitation')) assert.match(check, new RegExp(`'${feature}'`), feature);
```

`tests/partnership-access.test.ts` line 59:

```ts
  for (const feature of ACCOUNT_FEATURES.filter(f => f !== 'google-ads' && f !== 'dpm-invitation')) assert.match(check, new RegExp(`'${feature}'`), feature);
```

`tests/seo-os.test.ts` line 69:

```ts
  assert.match(accounts, /NEW_DEPARTMENT_FEATURES: readonly AccountFeature\[\] = ASSIGNABLE_FEATURES\.filter\(feature => feature !== SEO_FEATURE( && feature !== DPM_INVITATION_FEATURE)?\)/);
```

`tests/seo-os.test.ts` lines 128–129:

```ts
  // `monthly-report` was added later by migration 041; `settlement-report` by 046; `partnership` by 057; `google-ads` by 066; `dpm-invitation` by 068.
  for (const feature of ACCOUNT_FEATURES.filter(f => f !== 'monthly-report' && f !== 'settlement-report' && f !== 'partnership' && f !== 'google-ads' && f !== 'dpm-invitation')) assert.match(check, new RegExp(`'${feature}'`), feature);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test tests/dpm-invitation-access.test.ts tests/google-ads-access.test.ts tests/partnership-access.test.ts tests/seo-os.test.ts tests/department-authorization.test.ts && npx tsc --noEmit 2>&1 | rg '^(src/|tests/dpm-invitation)'`
Expected: tests PASS and the `rg` prints nothing. (`tsc` on main already reports TS5097 in older test files; only `src/` and the new test files matter.) A missing key in `ACCOUNT_FEATURE_LABELS` or `DASHBOARD_FEATURE_HREFS` is reported by the compiler.

- [ ] **Step 5: Commit**

```bash
git add src/lib/authorization.ts src/app/dashboard/layout.tsx src/app/dashboard/accounts/AccountsClient.tsx tests/dpm-invitation-access.test.ts tests/google-ads-access.test.ts tests/partnership-access.test.ts tests/seo-os.test.ts
git commit -m "feat(dpm): add DPM Invitation feature, sidebar section and opt-in default"
```

---

### Task 2: Migration 068 and rollback

**Files:**
- Create: `db/migrations/068_dpm_invitation.sql`
- Create: `db/rollbacks/068_dpm_invitation_down.sql`
- Modify: `.gitignore`
- Test: `tests/dpm-invitation-migration-pg.test.ts`

**Interfaces:**
- Produces: tables `dpm_invitation_events(id, name, slug, status, closes_at, image_key, image_mime, image_width, image_height, created_by, updated_by, created_at, updated_at)` and `dpm_invitation_responses(id, event_id, full_name, email, email_normalized, attending, has_allergy, allergy_notes, submission_count, created_at, updated_at)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/dpm-invitation-migration-pg.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';
const UP = 'db/migrations/068_dpm_invitation.sql';
const DOWN = 'db/rollbacks/068_dpm_invitation_down.sql';

test('068 files contain no question mark (migrate.ts rewrites it into $N)', () => {
  assert.equal(readFileSync(UP, 'utf8').includes('?'), false);
  assert.equal(readFileSync(DOWN, 'utf8').includes('?'), false);
});

test('migration 068 on PostgreSQL: idempotent, constraints, rollback', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `dpm_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member');
      CREATE TABLE departments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, permitted_features TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT departments_permitted_features_valid CHECK (permitted_features <@ ARRAY['social-post','google-ads']::TEXT[])
      );
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id, username, name, password_hash, role) VALUES ('u1', 'admin', 'Admin', 'hash', 'admin');
    `);
    const up = readFileSync(UP, 'utf8');
    await client.query(up);
    await client.query(up);
    const dept = await client.query(`SELECT id, permitted_features FROM departments WHERE name = 'DPM'`);
    assert.equal(dept.rowCount, 1);
    assert.equal(dept.rows[0].id, '00000000-0000-0000-0000-000000000008');
    assert.deepEqual(dept.rows[0].permitted_features, ['dpm-invitation']);
    await assert.rejects(client.query(`UPDATE departments SET permitted_features = ARRAY['nope'] WHERE name = 'DPM'`));

    const key = '11111111-1111-4111-8111-111111111111.webp';
    await client.query(`INSERT INTO dpm_invitation_events (id, name, slug, image_key, image_mime, image_width, image_height, created_by)
      VALUES ('e1', 'Gala', 'gala-2027', '${key}', 'image/webp', 1024, 1536, 'u1')`);
    await assert.rejects(client.query(`INSERT INTO dpm_invitation_events (id, name, slug, image_key, image_mime, image_width, image_height)
      VALUES ('e2', 'Bad', '-bad-', '${key}', 'image/webp', 1, 1)`), 'slug pattern');
    await assert.rejects(client.query(`INSERT INTO dpm_invitation_events (id, name, slug, image_key, image_mime, image_width, image_height)
      VALUES ('e3', 'Dup', 'gala-2027', '${key}', 'image/webp', 1, 1)`), 'slug unique');

    const insert = (id: string, attending: boolean, hasAllergy: boolean | null, notes: string | null, email = `${id}@x.com`) =>
      client.query(`INSERT INTO dpm_invitation_responses (id, event_id, full_name, email, email_normalized, attending, has_allergy, allergy_notes)
        VALUES ($1, 'e1', 'Nguyen Van A', $2, lower(btrim($2)), $3, $4, $5)`, [id, email, attending, hasAllergy, notes]);
    await insert('r1', true, false, null);
    await insert('r2', true, true, 'peanuts');
    await insert('r3', false, null, null);
    await assert.rejects(insert('r4', false, true, 'x'), 'not attending cannot carry allergy');
    await assert.rejects(insert('r5', true, true, null), 'allergy yes needs notes');
    await assert.rejects(insert('r6', true, false, 'x'), 'allergy no cannot carry notes');
    await assert.rejects(insert('r7', true, null, null), 'attending needs an allergy answer');
    await assert.rejects(insert('r8', true, false, null, 'R1@X.com'), 'same normalized email is unique per event');

    await client.query(`DELETE FROM dpm_invitation_events WHERE id = 'e1'`);
    assert.equal((await client.query(`SELECT 1 FROM dpm_invitation_responses`)).rowCount, 0, 'cascade');

    await client.query(readFileSync(DOWN, 'utf8'));
    assert.equal((await client.query(`SELECT to_regclass('dpm_invitation_events') AS t`)).rows[0].t, null);
    assert.equal((await client.query(`SELECT 1 FROM departments WHERE name = 'DPM'`)).rowCount, 1, 'department row kept');
    assert.deepEqual((await client.query(`SELECT permitted_features FROM departments WHERE name = 'DPM'`)).rows[0].permitted_features, []);
    await client.query(up);
  } finally {
    await client.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
    await client.end();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/dpm-invitation-migration-pg.test.ts`
Expected: FAIL with `ENOENT ... db/migrations/068_dpm_invitation.sql`.

- [ ] **Step 3: Write the migration, rollback and gitignore entry**

```sql
-- db/migrations/068_dpm_invitation.sql
-- DPM (company) Invitation: one public RSVP link per event.
-- Adds the dpm-invitation Accounts feature, a DPM department that has it,
-- invitation events and their responses. Responses hold employee emails and
-- allergy notes, so access is only through the DPM department or admins.
-- Additive and idempotent. No existing rows are changed or removed.
-- Do not put a question mark anywhere in this file: scripts/migrate.ts
-- rewrites that character into a numbered placeholder.
-- Rollback: db/rollbacks/068_dpm_invitation_down.sql

BEGIN;

ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_permitted_features_valid;
ALTER TABLE departments ADD CONSTRAINT departments_permitted_features_valid CHECK (
  permitted_features <@ ARRAY[
    'social-post',
    'video-script',
    'event-plan',
    'article-market-news',
    'market-research',
    'ai-research',
    'internal-docs',
    'seo',
    'monthly-report',
    'settlement-report',
    'partnership',
    'google-ads',
    'dpm-invitation'
  ]::text[]
);

INSERT INTO departments (id, name, permitted_features)
SELECT '00000000-0000-0000-0000-000000000008', 'DPM', ARRAY['dpm-invitation']::TEXT[]
WHERE NOT EXISTS (
  SELECT 1 FROM departments
  WHERE name = 'DPM' OR id = '00000000-0000-0000-0000-000000000008'
);

UPDATE departments
SET permitted_features = permitted_features || ARRAY['dpm-invitation']::TEXT[],
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'DPM'
  AND NOT (permitted_features @> ARRAY['dpm-invitation']::TEXT[]);

-- One row per invitation event. status is the manual switch; closes_at is an
-- optional automatic close (entered in WIB in the app, stored as timestamptz).
CREATE TABLE IF NOT EXISTS dpm_invitation_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$' AND position('--' in slug) = 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closes_at TIMESTAMPTZ,
  image_key TEXT NOT NULL CHECK (image_key ~ '^[0-9a-f-]{36}[.](jpg|png|webp)$'),
  image_mime TEXT NOT NULL CHECK (image_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  image_width INTEGER NOT NULL CHECK (image_width > 0),
  image_height INTEGER NOT NULL CHECK (image_height > 0),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per (event, email). Not attending: no allergy data at all.
CREATE TABLE IF NOT EXISTS dpm_invitation_responses (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES dpm_invitation_events(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  email_normalized TEXT NOT NULL,
  attending BOOLEAN NOT NULL,
  has_allergy BOOLEAN,
  allergy_notes TEXT,
  submission_count INTEGER NOT NULL DEFAULT 1 CHECK (submission_count >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT dpm_invitation_responses_email_key UNIQUE (event_id, email_normalized),
  CONSTRAINT dpm_invitation_responses_email_normalized CHECK (email_normalized = lower(btrim(email))),
  CONSTRAINT dpm_invitation_responses_answers CHECK (
    (attending = FALSE AND has_allergy IS NULL AND allergy_notes IS NULL)
    OR (attending = TRUE AND has_allergy IS FALSE AND allergy_notes IS NULL)
    OR (attending = TRUE AND has_allergy IS TRUE AND allergy_notes IS NOT NULL AND char_length(allergy_notes) BETWEEN 1 AND 200)
  )
);

CREATE INDEX IF NOT EXISTS idx_dpm_invitation_responses_event_updated
  ON dpm_invitation_responses (event_id, updated_at DESC);

COMMIT;
```

```sql
-- db/rollbacks/068_dpm_invitation_down.sql
-- Remove DPM Invitation added by 068.
-- The DPM department row is kept (users may already be assigned to it);
-- only the dpm-invitation feature is removed from every department.
-- Image files in data/dpm-invitations/ are not touched by SQL: back them up,
-- then archive or delete that folder by hand.
-- Do not put a question mark anywhere in this file.
BEGIN;

DROP TABLE IF EXISTS dpm_invitation_responses;
DROP TABLE IF EXISTS dpm_invitation_events;

UPDATE departments
SET permitted_features = array_remove(permitted_features, 'dpm-invitation'),
    updated_at = CURRENT_TIMESTAMP
WHERE 'dpm-invitation' = ANY(permitted_features);

ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_permitted_features_valid;
ALTER TABLE departments ADD CONSTRAINT departments_permitted_features_valid CHECK (
  permitted_features <@ ARRAY[
    'social-post',
    'video-script',
    'event-plan',
    'article-market-news',
    'market-research',
    'ai-research',
    'internal-docs',
    'seo',
    'monthly-report',
    'settlement-report',
    'partnership',
    'google-ads'
  ]::text[]
);

DELETE FROM schema_migrations WHERE name = '068_dpm_invitation.sql';

COMMIT;
```

In `.gitignore`, under `# Database`, after `data/generated-image-meta/`, add:

```
data/dpm-invitations/
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `SETTLEMENT_TEST_DATABASE_URL=postgres://settlement:settlement@127.0.0.1:5432/settlement_phase2 npx tsx --test tests/dpm-invitation-migration-pg.test.ts` against a local Postgres 16. Without a local DB, run it without the variable: the question-mark test passes and the PG test is skipped. CI (`settlement-postgres.yml`) runs it.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/068_dpm_invitation.sql db/rollbacks/068_dpm_invitation_down.sql .gitignore tests/dpm-invitation-migration-pg.test.ts
git commit -m "feat(dpm): migration 068 for DPM Invitation events and responses"
```

---

### Task 3: Pure rules (types, validation, slug, open check, WIB) and rate-limit helper

**Files:**
- Create: `src/lib/dpm-invitation/types.ts`
- Create: `src/lib/dpm-invitation/rules.ts`
- Modify: `src/lib/rate-limit.ts` (append only; the existing `rateLimit()` stays unchanged)
- Test: `tests/dpm-invitation-rules.test.ts`

**Interfaces:**
- Produces (types.ts): `InvitationStatus`, `InvitationEvent`, `InvitationResponse`, `ResponseCounts`, `ResponseFilter`, `ParsedResponse`, `ResponseFieldErrors`.
- Produces (rules.ts): `Result<T>`; `cleanText(raw: unknown): string`; `slugIssue(slug: string): string | null`; `suggestSlug(name: string): string`; `parseEventName(raw: unknown): Result<string>`; `isRegistrationOpen(e: Pick<InvitationEvent, 'status' | 'closesAt'>, now: Date): boolean`; `parseClosesAtWib(raw: unknown, now: Date): Result<Date | null>`; `toWibInputValue(d: Date | null): string`; `formatWib(d: Date): string`; `isValidEmail(email: string): boolean`; `isResponseFilter(v: string): v is ResponseFilter`; `parseResponseInput(input: Record<string, unknown>): { ok: true; value: ParsedResponse } | { ok: false; fieldErrors: ResponseFieldErrors }`; constants `NAME_MAX = 120`, `EMAIL_MAX = 254`, `ALLERGY_NOTES_MAX = 200`, `RESERVED_SLUGS`.
- Produces (rate-limit.ts): `consumeRateLimit(bucket: string, key: string, limit: number, windowMs: number, now?: number): { allowed: boolean; retryAfterSeconds: number }`; `resetRateLimitBuckets(): void`; `clientIpFromHeaders(headers: Headers): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/dpm-invitation-rules.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatWib, isRegistrationOpen, isValidEmail, parseClosesAtWib, parseEventName, parseResponseInput, slugIssue, suggestSlug, toWibInputValue,
} from '../src/lib/dpm-invitation/rules';
import { clientIpFromHeaders, consumeRateLimit, resetRateLimitBuckets } from '../src/lib/rate-limit';

const now = new Date('2026-11-23T05:00:00.000Z'); // 12:00 WIB

test('isRegistrationOpen: status open and closes_at null or in the future', () => {
  assert.equal(isRegistrationOpen({ status: 'open', closesAt: null }, now), true);
  assert.equal(isRegistrationOpen({ status: 'open', closesAt: new Date('2026-11-23T05:01:00Z') }, now), true);
  assert.equal(isRegistrationOpen({ status: 'open', closesAt: new Date('2026-11-23T05:00:00Z') }, now), false);
  assert.equal(isRegistrationOpen({ status: 'open', closesAt: new Date('2026-11-22T00:00:00Z') }, now), false);
  assert.equal(isRegistrationOpen({ status: 'closed', closesAt: null }, now), false);
  assert.equal(isRegistrationOpen({ status: 'closed', closesAt: new Date('2027-01-01T00:00:00Z') }, now), false);
});

test('closing time is read as WIB and shown as WIB', () => {
  assert.deepEqual(parseClosesAtWib('2026-12-20T18:00', now), { ok: true, value: new Date('2026-12-20T11:00:00.000Z') });
  assert.deepEqual(parseClosesAtWib('', now), { ok: true, value: null });
  assert.deepEqual(parseClosesAtWib(null, now), { ok: true, value: null });
  assert.deepEqual(parseClosesAtWib('2026-02-30T10:00', now), { ok: false, error: 'Enter a valid closing date and time.' });
  assert.deepEqual(parseClosesAtWib('tomorrow', now), { ok: false, error: 'Enter a valid closing date and time.' });
  assert.deepEqual(parseClosesAtWib('2026-11-23T11:59', now), { ok: false, error: 'Closing time must be in the future.' });
  assert.equal(toWibInputValue(new Date('2026-12-20T11:00:00.000Z')), '2026-12-20T18:00');
  assert.equal(toWibInputValue(null), '');
  assert.equal(formatWib(new Date('2026-12-20T11:05:00.000Z')), '20 Dec 2026, 18:05 WIB');
});

test('slug rules', () => {
  const shape = 'Use 3–60 lowercase letters, numbers and hyphens.';
  assert.equal(slugIssue('gala-dinner-2027'), null);
  for (const bad of ['ab', '-gala', 'gala-', 'Gala', 'gala--2027', 'a'.repeat(61)]) assert.equal(slugIssue(bad), shape, bad);
  assert.equal(slugIssue('thanks'), 'That word is reserved. Choose another link.');
  assert.equal(suggestSlug('Gala Dinner 2027 — Hà Nội!'), 'gala-dinner-2027-ha-noi');
  assert.equal(suggestSlug('  '), '');
});

test('event name', () => {
  assert.deepEqual(parseEventName('  DPM   Gala Dinner 2027 '), { ok: true, value: 'DPM Gala Dinner 2027' });
  assert.deepEqual(parseEventName('x'), { ok: false, error: 'Enter a name of 2–120 characters.' });
});

test('email check is practical, any domain', () => {
  for (const ok of ['a@b.co', 'nguyen.van.a@dpm.vn', 'x+y@gmail.com']) assert.equal(isValidEmail(ok), true, ok);
  for (const bad of ['', 'a@b', 'a b@c.d', '@c.d', 'a@@c.d', `${'a'.repeat(250)}@c.de`]) assert.equal(isValidEmail(bad), false, bad);
});

test('response parsing follows the form order and drops hidden answers', () => {
  assert.deepEqual(parseResponseInput({ fullName: ' Nguyễn  Văn A ', email: ' A@Dpm.VN ', attending: 'yes', hasAllergy: 'yes', allergyNotes: ' peanuts ' }), {
    ok: true, value: { fullName: 'Nguyễn Văn A', email: 'A@Dpm.VN', emailNormalized: 'a@dpm.vn', attending: true, hasAllergy: true, allergyNotes: 'peanuts' },
  });
  assert.deepEqual(parseResponseInput({ fullName: 'Tran B', email: 'b@x.vn', attending: 'yes', hasAllergy: 'no', allergyNotes: 'ignored' }), {
    ok: true, value: { fullName: 'Tran B', email: 'b@x.vn', emailNormalized: 'b@x.vn', attending: true, hasAllergy: false, allergyNotes: null },
  });
  assert.deepEqual(parseResponseInput({ fullName: 'Le C', email: 'c@x.vn', attending: 'no', hasAllergy: 'yes', allergyNotes: 'shellfish' }), {
    ok: true, value: { fullName: 'Le C', email: 'c@x.vn', emailNormalized: 'c@x.vn', attending: false, hasAllergy: null, allergyNotes: null },
  });
  assert.deepEqual(parseResponseInput({ fullName: 'x', email: 'nope', attending: 'maybe' }), {
    ok: false, fieldErrors: { fullName: 'Please enter your full name.', email: 'Please enter a valid email address.', attending: 'Please choose Yes or No.' },
  });
  assert.deepEqual(parseResponseInput({ fullName: 'Pham D', email: 'd@x.vn', attending: 'yes' }), { ok: false, fieldErrors: { hasAllergy: 'Please choose Yes or No.' } });
  assert.deepEqual(parseResponseInput({ fullName: 'Pham D', email: 'd@x.vn', attending: 'yes', hasAllergy: 'yes', allergyNotes: '  ' }), { ok: false, fieldErrors: { allergyNotes: 'Please tell us what you are allergic to.' } });
  assert.deepEqual(parseResponseInput({ fullName: 'Pham D', email: 'd@x.vn', attending: 'yes', hasAllergy: 'yes', allergyNotes: 'x'.repeat(201) }), { ok: false, fieldErrors: { allergyNotes: 'Please use at most 200 characters.' } });
  assert.deepEqual(parseResponseInput({ fullName: 'y'.repeat(121), email: 'd@x.vn', attending: 'no' }), { ok: false, fieldErrors: { fullName: 'Please use at most 120 characters.' } });
  assert.deepEqual(parseResponseInput({ fullName: 'Bad\u0007Name', email: 'd@x.vn', attending: 'no' }), { ok: false, fieldErrors: { fullName: 'Please enter your full name.' } });
});

test('named rate-limit buckets are independent and windowed', () => {
  resetRateLimitBuckets();
  const t = 1_000_000;
  for (let i = 0; i < 60; i++) assert.equal(consumeRateLimit('dpm-inv-ip', '1.1.1.1', 60, 600_000, t).allowed, true);
  const blocked = consumeRateLimit('dpm-inv-ip', '1.1.1.1', 60, 600_000, t + 1000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 599);
  assert.equal(consumeRateLimit('dpm-inv-email', '1.1.1.1', 5, 3_600_000, t).allowed, true, 'other bucket unaffected');
  assert.equal(consumeRateLimit('dpm-inv-ip', '2.2.2.2', 60, 600_000, t).allowed, true, 'other key unaffected');
  assert.equal(consumeRateLimit('dpm-inv-ip', '1.1.1.1', 60, 600_000, t + 600_000).allowed, true, 'window reset');
});

test('client IP prefers Cloudflare, then nginx headers', () => {
  assert.equal(clientIpFromHeaders(new Headers({ 'cf-connecting-ip': '9.9.9.9', 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '7.7.7.7, 1.1.1.1' })), '9.9.9.9');
  assert.equal(clientIpFromHeaders(new Headers({ 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '7.7.7.7' })), '8.8.8.8');
  assert.equal(clientIpFromHeaders(new Headers({ 'x-forwarded-for': ' 7.7.7.7 , 1.1.1.1' })), '7.7.7.7');
  assert.equal(clientIpFromHeaders(new Headers()), 'unknown');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/dpm-invitation-rules.test.ts`
Expected: FAIL with `Cannot find module '../src/lib/dpm-invitation/rules'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/dpm-invitation/types.ts
export type InvitationStatus = 'open' | 'closed';

export interface InvitationEvent {
  id: string;
  name: string;
  slug: string;
  status: InvitationStatus;
  closesAt: Date | null;
  imageKey: string;
  imageMime: string;
  imageWidth: number;
  imageHeight: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResponseCounts {
  total: number;
  attending: number;
  notAttending: number;
  withAllergies: number;
}

export interface InvitationResponse {
  id: string;
  eventId: string;
  fullName: string;
  email: string;
  attending: boolean;
  hasAllergy: boolean | null;
  allergyNotes: string | null;
  submissionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ResponseFilter = 'all' | 'attending' | 'not-attending' | 'allergy';

export interface ParsedResponse {
  fullName: string;
  email: string;
  emailNormalized: string;
  attending: boolean;
  hasAllergy: boolean | null;
  allergyNotes: string | null;
}

export type ResponseFieldErrors = Partial<Record<'fullName' | 'email' | 'attending' | 'hasAllergy' | 'allergyNotes', string>>;
```

```ts
// src/lib/dpm-invitation/rules.ts
import type { InvitationEvent, ParsedResponse, ResponseFieldErrors, ResponseFilter } from './types';

export const NAME_MAX = 120;
export const EMAIL_MAX = 254;
export const ALLERGY_NOTES_MAX = 200;
export const RESERVED_SLUGS = ['new', 'admin', 'api', 'image', 'thanks', 'edit'] as const;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const WIB_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** NFKC, collapse ordinary whitespace, trim. Other control characters are kept so CONTROL_CHARS can reject them. */
export function cleanText(raw: unknown): string {
  return String(raw ?? '').normalize('NFKC').replace(/[ \t\n\r\f\v\u00a0\u2028\u2029]+/g, ' ').trim();
}

export function slugIssue(slug: string): string | null {
  if (!SLUG_PATTERN.test(slug) || slug.includes('--')) return 'Use 3–60 lowercase letters, numbers and hyphens.';
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) return 'That word is reserved. Choose another link.';
  return null;
}

export function suggestSlug(name: string): string {
  return name
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
}

export function parseEventName(raw: unknown): Result<string> {
  const value = cleanText(raw);
  if (value.length < 2 || value.length > NAME_MAX || CONTROL_CHARS.test(value)) return { ok: false, error: 'Enter a name of 2–120 characters.' };
  return { ok: true, value };
}

export function isRegistrationOpen(event: Pick<InvitationEvent, 'status' | 'closesAt'>, now: Date): boolean {
  return event.status === 'open' && (event.closesAt === null || now.getTime() < event.closesAt.getTime());
}

export function toWibInputValue(date: Date | null): string {
  if (!date) return '';
  return new Date(date.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 16);
}

/** Reads a datetime-local value (YYYY-MM-DDTHH:mm) as WIB. Empty or null clears it. */
export function parseClosesAtWib(raw: unknown, now: Date): Result<Date | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const value = String(raw).trim();
  if (!value) return { ok: true, value: null };
  const invalid = { ok: false as const, error: 'Enter a valid closing date and time.' };
  if (!WIB_INPUT.test(value)) return invalid;
  const date = new Date(`${value}:00+07:00`);
  // The round trip rejects dates JS would roll over, such as 30 February.
  if (Number.isNaN(date.getTime()) || toWibInputValue(date) !== value) return invalid;
  if (date.getTime() <= now.getTime()) return { ok: false, error: 'Closing time must be in the future.' };
  return { ok: true, value: date };
}

/** "20 Dec 2026, 18:05 WIB". Built by hand so the output does not depend on ICU data. */
export function formatWib(date: Date): string {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(wib.getUTCDate())} ${MONTHS[wib.getUTCMonth()]} ${wib.getUTCFullYear()}, ${pad(wib.getUTCHours())}:${pad(wib.getUTCMinutes())} WIB`;
}

export function isValidEmail(email: string): boolean {
  return email.length <= EMAIL_MAX && EMAIL_PATTERN.test(email);
}

export function isResponseFilter(value: string): value is ResponseFilter {
  return value === 'all' || value === 'attending' || value === 'not-attending' || value === 'allergy';
}

function yesNo(raw: unknown): boolean | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

export function parseResponseInput(input: Record<string, unknown>): { ok: true; value: ParsedResponse } | { ok: false; fieldErrors: ResponseFieldErrors } {
  const errors: ResponseFieldErrors = {};
  const fullName = cleanText(input.fullName);
  if (fullName.length < 2 || CONTROL_CHARS.test(fullName)) errors.fullName = 'Please enter your full name.';
  else if (fullName.length > NAME_MAX) errors.fullName = 'Please use at most 120 characters.';

  const email = String(input.email ?? '').trim();
  if (!isValidEmail(email)) errors.email = 'Please enter a valid email address.';

  const attending = yesNo(input.attending);
  if (attending === null) errors.attending = 'Please choose Yes or No.';

  // Only read the allergy answers when they were shown: attending Yes, then allergy Yes.
  let hasAllergy: boolean | null = null;
  let allergyNotes: string | null = null;
  if (attending === true) {
    hasAllergy = yesNo(input.hasAllergy);
    if (hasAllergy === null) errors.hasAllergy = 'Please choose Yes or No.';
    if (hasAllergy === true) {
      const notes = cleanText(input.allergyNotes);
      if (!notes || CONTROL_CHARS.test(notes)) errors.allergyNotes = 'Please tell us what you are allergic to.';
      else if (notes.length > ALLERGY_NOTES_MAX) errors.allergyNotes = 'Please use at most 200 characters.';
      else allergyNotes = notes;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    value: { fullName, email, emailNormalized: email.toLowerCase(), attending: attending as boolean, hasAllergy, allergyNotes },
  };
}
```

Append to `src/lib/rate-limit.ts`:

```ts
// Named buckets: each caller gets its own counters, unlike rateLimit() above,
// which shares one counter per IP across every route. Production runs one pm2
// process, so in-memory is enough.
const buckets = new Map<string, Map<string, RateLimitEntry>>();

export function consumeRateLimit(bucket: string, key: string, limit: number, windowMs: number, now: number = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  let entries = buckets.get(bucket);
  if (!entries) {
    entries = new Map();
    buckets.set(bucket, entries);
  }
  if (entries.size > 5000) {
    for (const [k, entry] of entries) if (now >= entry.resetTime) entries.delete(k);
  }
  const entry = entries.get(key);
  if (!entry || now >= entry.resetTime) {
    entries.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (entry.count >= limit) return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetTime - now) / 1000) };
  entry.count++;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test helper. */
export function resetRateLimitBuckets(): void {
  buckets.clear();
}

/**
 * Visitor IP. Production (marketing-aws) comes through the Cloudflare tunnel
 * straight to :3021, so CF-Connecting-IP is the real one. nginx (port 80,
 * marketingos.gorillaworkout.id) sets X-Real-IP and X-Forwarded-For.
 */
export function clientIpFromHeaders(headers: Headers): string {
  return headers.get('cf-connecting-ip')?.trim()
    || headers.get('x-real-ip')?.trim()
    || headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test tests/dpm-invitation-rules.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dpm-invitation/types.ts src/lib/dpm-invitation/rules.ts src/lib/rate-limit.ts tests/dpm-invitation-rules.test.ts
git commit -m "feat(dpm): invitation rules, WIB closing time and named rate-limit buckets"
```

---

### Task 4: Image processing and storage

**Files:**
- Create: `src/lib/dpm-invitation/image.ts`
- Test: `tests/dpm-invitation-image.test.ts`

**Interfaces:**
- Produces: `IMAGE_MAX_BYTES = 8 * 1024 * 1024`; `class ImageInputError extends Error`; `processInvitationImage(bytes: Buffer): Promise<{ data: Buffer; width: number; height: number }>`; `isSafeImageKey(key: string): boolean`; `saveInvitationImage(bytes: Buffer): Promise<{ key: string; mime: 'image/webp'; width: number; height: number }>`; `readInvitationImage(key: string): Promise<Buffer | null>`; `removeInvitationImage(key: string): Promise<void>`. Storage folder: `process.env.DPM_INVITATION_IMAGE_DIR || path.join(process.cwd(), 'data', 'dpm-invitations')`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/dpm-invitation-image.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

process.env.DPM_INVITATION_IMAGE_DIR = mkdtempSync(path.join(tmpdir(), 'dpm-inv-'));
const load = () => import('../src/lib/dpm-invitation/image');

const make = (width: number, height: number, format: 'jpeg' | 'png' | 'gif' = 'jpeg') =>
  sharp({ create: { width, height, channels: 3, background: { r: 20, g: 30, b: 40 } } }).toFormat(format).toBuffer();

test('portrait JPEG is re-encoded to WebP, metadata removed, size kept', async () => {
  const img = await load();
  const withExif = await sharp(await make(1024, 1536)).withExif({ IFD0: { Copyright: 'stand-in for GPS data' } }).jpeg().toBuffer();
  assert.ok((await sharp(withExif).metadata()).exif, 'fixture has EXIF');
  const out = await img.processInvitationImage(withExif);
  const meta = await sharp(out.data).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.exif, undefined);
  assert.deepEqual([out.width, out.height], [1024, 1536]);
});

test('large image is scaled so the longest side is 2400', async () => {
  const img = await load();
  const out = await img.processInvitationImage(await make(3000, 4500, 'png'));
  assert.deepEqual([out.width, out.height], [1600, 2400]);
});

test('rejects small, unsupported, oversized and non-image input', async () => {
  const img = await load();
  await assert.rejects(img.processInvitationImage(await make(300, 300)), { message: 'Image is too small (minimum 600 px on the short side).' });
  await assert.rejects(img.processInvitationImage(await make(800, 800, 'gif')), { message: 'Use a JPG, PNG or WebP image.' });
  await assert.rejects(img.processInvitationImage(Buffer.from('not an image')), { message: 'Could not read this image.' });
  await assert.rejects(img.processInvitationImage(Buffer.alloc(img.IMAGE_MAX_BYTES + 1)), { message: 'Image must be 8 MB or smaller.' });
});

test('save, read and remove by safe key only', async () => {
  const img = await load();
  const saved = await img.saveInvitationImage(await make(800, 1200));
  assert.match(saved.key, /^[0-9a-f-]{36}\.webp$/);
  assert.ok(existsSync(path.join(process.env.DPM_INVITATION_IMAGE_DIR!, saved.key)));
  assert.ok((await img.readInvitationImage(saved.key))!.length > 0);
  assert.equal(await img.readInvitationImage('../etc/passwd'), null);
  assert.equal(img.isSafeImageKey('../x.webp'), false);
  await img.removeInvitationImage(saved.key);
  assert.equal(await img.readInvitationImage(saved.key), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/dpm-invitation-image.test.ts`
Expected: FAIL with `Cannot find module '../src/lib/dpm-invitation/image'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/dpm-invitation/image.ts
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const MIN_SHORT_SIDE = 600;
const MAX_INPUT_SIDE = 8000;
const OUTPUT_MAX_SIDE = 2400;
const PIXEL_LIMIT = 50_000_000;
const IMAGE_KEY = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

export class ImageInputError extends Error {}

function imageDir(): string {
  return process.env.DPM_INVITATION_IMAGE_DIR || path.join(process.cwd(), 'data', 'dpm-invitations');
}

export function isSafeImageKey(key: string): boolean {
  return IMAGE_KEY.test(key);
}

/** Checks the real content, auto-rotates, strips metadata, resizes and re-encodes to WebP. */
export async function processInvitationImage(bytes: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  if (bytes.length === 0) throw new ImageInputError('Could not read this image.');
  if (bytes.length > IMAGE_MAX_BYTES) throw new ImageInputError('Image must be 8 MB or smaller.');
  let meta: sharp.Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: PIXEL_LIMIT }).metadata();
  } catch {
    throw new ImageInputError('Could not read this image.');
  }
  if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw new ImageInputError('Use a JPG, PNG or WebP image.');
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (Math.min(width, height) < MIN_SHORT_SIDE) throw new ImageInputError('Image is too small (minimum 600 px on the short side).');
  if (Math.max(width, height) > MAX_INPUT_SIDE) throw new ImageInputError('Image is too large (maximum 8000 px on each side).');
  try {
    // sharp drops EXIF, ICC and XMP unless withMetadata()/withExif() is called, so nothing leaks to the public page.
    const { data, info } = await sharp(bytes, { limitInputPixels: PIXEL_LIMIT })
      .rotate()
      .resize({ width: OUTPUT_MAX_SIDE, height: OUTPUT_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new ImageInputError('Could not read this image.');
  }
}

export async function saveInvitationImage(bytes: Buffer): Promise<{ key: string; mime: 'image/webp'; width: number; height: number }> {
  const processed = await processInvitationImage(bytes);
  const key = `${randomUUID()}.webp`;
  await mkdir(imageDir(), { recursive: true });
  await writeFile(path.join(imageDir(), key), processed.data);
  return { key, mime: 'image/webp', width: processed.width, height: processed.height };
}

export async function readInvitationImage(key: string): Promise<Buffer | null> {
  if (!isSafeImageKey(key)) return null;
  try {
    return await readFile(path.join(imageDir(), key));
  } catch {
    return null;
  }
}

export async function removeInvitationImage(key: string): Promise<void> {
  if (!isSafeImageKey(key)) return;
  try {
    await unlink(path.join(imageDir(), key));
  } catch (error) {
    console.error('DPM invitation image remove failed', (error as NodeJS.ErrnoException).code ?? 'unknown');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test tests/dpm-invitation-image.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dpm-invitation/image.ts tests/dpm-invitation-image.test.ts
git commit -m "feat(dpm): invitation image validation, WebP re-encode and storage"
```

---

### Task 5: Store (SQL) with PostgreSQL tests

**Files:**
- Create: `src/lib/dpm-invitation/store.ts`
- Test: `tests/dpm-invitation-store-pg.test.ts`

**Interfaces:**
- Consumes: types from Task 3; `queryOne`, `queryAll`, `execute` from `@/lib/database` (`?` placeholders).
- Produces:
  - `class SlugTakenError extends Error`
  - `listEvents(): Promise<Array<{ event: InvitationEvent; counts: ResponseCounts; lastResponseAt: Date | null }>>`
  - `getEvent(id: string): Promise<InvitationEvent | null>`
  - `getEventBySlug(slug: string): Promise<InvitationEvent | null>`
  - `createEvent(input: { id: string; name: string; slug: string; closesAt: Date | null; image: ImageInput; userId: string }): Promise<InvitationEvent>`
  - `updateEvent(id: string, patch: { name?: string; slug?: string; status?: InvitationStatus; closesAt?: Date | null }, userId: string): Promise<InvitationEvent | null>`
  - `replaceEventImage(id: string, image: ImageInput, userId: string): Promise<{ event: InvitationEvent; oldKey: string } | null>`
  - `deleteEvent(id: string): Promise<string | null>` (returns the removed image key)
  - `countResponses(eventId: string): Promise<ResponseCounts>`
  - `listResponses(eventId: string, options: { q?: string; filter?: ResponseFilter }): Promise<InvitationResponse[]>`
  - `upsertResponse(eventId: string, value: ParsedResponse): Promise<void>`
  - `deleteResponse(eventId: string, responseId: string): Promise<boolean>`
  - where `type ImageInput = { key: string; mime: string; width: number; height: number }` (exported).

- [ ] **Step 1: Write the failing test**

```ts
// tests/dpm-invitation-store-pg.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';

test('DPM invitation store on PostgreSQL: events, upsert by email, counts, search, delete', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `dpmstore_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member');
      CREATE TABLE departments (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, permitted_features TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id, username, name, password_hash, role) VALUES ('u1', 'admin', 'Admin', 'hash', 'admin');
    `);
    await client.query(readFileSync('db/migrations/068_dpm_invitation.sql', 'utf8'));

    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    const store = await import('../src/lib/dpm-invitation/store');
    const { closeDb } = await import('../src/lib/database');
    try {
      const image = { key: '11111111-1111-4111-8111-111111111111.webp', mime: 'image/webp', width: 1024, height: 1536 };
      const event = await store.createEvent({ id: 'e1', name: 'DPM Gala Dinner 2027', slug: 'gala-2027', closesAt: null, image, userId: 'u1' });
      assert.equal(event.status, 'open');
      await assert.rejects(store.createEvent({ id: 'e2', name: 'Dup', slug: 'gala-2027', closesAt: null, image, userId: 'u1' }), store.SlugTakenError);
      const other = await store.createEvent({ id: 'e3', name: 'Other', slug: 'other-2027', closesAt: null, image, userId: 'u1' });
      assert.equal((await store.getEventBySlug('gala-2027'))!.id, 'e1');

      const base = { fullName: 'Nguyen Van A', email: 'A@dpm.vn', emailNormalized: 'a@dpm.vn', attending: true, hasAllergy: false, allergyNotes: null };
      await store.upsertResponse('e1', base);
      const first = (await store.listResponses('e1', {}))[0];
      await store.upsertResponse('e1', { ...base, email: 'a@DPM.vn', hasAllergy: true, allergyNotes: 'peanuts' });
      const rows = await store.listResponses('e1', {});
      assert.equal(rows.length, 1);
      assert.equal(rows[0].submissionCount, 2);
      assert.equal(rows[0].allergyNotes, 'peanuts');
      assert.equal(rows[0].createdAt.getTime(), first.createdAt.getTime());
      await store.upsertResponse('e3', base);
      assert.equal((await store.listResponses('e3', {})).length, 1, 'same email in another event is a separate row');

      await store.upsertResponse('e1', { fullName: 'Tran Thi B', email: 'b@x.vn', emailNormalized: 'b@x.vn', attending: false, hasAllergy: null, allergyNotes: null });
      await store.upsertResponse('e1', { fullName: 'Le Van C_100%', email: 'c@x.vn', emailNormalized: 'c@x.vn', attending: true, hasAllergy: false, allergyNotes: null });
      assert.deepEqual(await store.countResponses('e1'), { total: 3, attending: 2, notAttending: 1, withAllergies: 1 });
      assert.deepEqual((await store.listResponses('e1', { q: 'TRAN' })).map(r => r.fullName), ['Tran Thi B']);
      assert.deepEqual((await store.listResponses('e1', { q: 'c@x' })).map(r => r.email), ['c@x.vn']);
      assert.deepEqual((await store.listResponses('e1', { q: '_100%' })).map(r => r.email), ['c@x.vn']);
      assert.equal((await store.listResponses('e1', { q: 'Tran%B' })).length, 0, 'LIKE wildcards are escaped');
      assert.deepEqual((await store.listResponses('e1', { filter: 'allergy' })).map(r => r.email), ['a@DPM.vn']);
      assert.deepEqual((await store.listResponses('e1', { filter: 'not-attending' })).map(r => r.email), ['b@x.vn']);

      const closesAt = new Date('2027-01-10T11:00:00Z');
      const updated = await store.updateEvent('e1', { status: 'closed', closesAt, name: 'Gala 2027' }, 'u1');
      assert.equal(updated!.status, 'closed');
      assert.equal(updated!.closesAt!.toISOString(), closesAt.toISOString());
      assert.equal((await store.updateEvent('e1', { closesAt: null }, 'u1'))!.closesAt, null);
      await assert.rejects(store.updateEvent('e1', { slug: 'other-2027' }, 'u1'), store.SlugTakenError);

      const replaced = await store.replaceEventImage('e1', { ...image, key: '22222222-2222-4222-8222-222222222222.webp' }, 'u1');
      assert.equal(replaced!.oldKey, image.key);

      const target = rows[0].id;
      assert.equal(await store.deleteResponse('e3', target), false, 'cannot delete through another event');
      assert.equal(await store.deleteResponse('e1', target), true);
      assert.equal((await store.countResponses('e1')).total, 2);

      assert.equal(await store.deleteEvent(other.id), image.key);
      assert.equal(await store.getEvent(other.id), null);
      assert.equal((await store.listEvents()).length, 1);
    } finally {
      await closeDb();
    }
  } finally {
    await client.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
    await client.end();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `SETTLEMENT_TEST_DATABASE_URL=postgres://settlement:settlement@127.0.0.1:5432/settlement_phase2 npx tsx --test tests/dpm-invitation-store-pg.test.ts`
Expected: FAIL with `Cannot find module '../src/lib/dpm-invitation/store'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/dpm-invitation/store.ts
import { randomUUID } from 'node:crypto';
import { execute, queryAll, queryOne } from '@/lib/database';
import type { InvitationEvent, InvitationResponse, InvitationStatus, ParsedResponse, ResponseCounts, ResponseFilter } from './types';

export class SlugTakenError extends Error {
  constructor() { super('That link is already used by another invitation.'); }
}

export type ImageInput = { key: string; mime: string; width: number; height: number };

type EventRow = {
  id: string; name: string; slug: string; status: InvitationStatus; closes_at: Date | null;
  image_key: string; image_mime: string; image_width: number; image_height: number; created_at: Date; updated_at: Date;
};
type ResponseRow = {
  id: string; event_id: string; full_name: string; email: string; attending: boolean; has_allergy: boolean | null;
  allergy_notes: string | null; submission_count: number; created_at: Date; updated_at: Date;
};
type CountRow = { total: number; attending: number; not_attending: number; with_allergies: number };

const EVENT_COLUMNS = 'id, name, slug, status, closes_at, image_key, image_mime, image_width, image_height, created_at, updated_at';
const COUNT_COLUMNS = `
  COUNT(r.id)::int AS total,
  COUNT(r.id) FILTER (WHERE r.attending)::int AS attending,
  COUNT(r.id) FILTER (WHERE NOT r.attending)::int AS not_attending,
  COUNT(r.id) FILTER (WHERE r.has_allergy)::int AS with_allergies`;

function toEvent(row: EventRow): InvitationEvent {
  return {
    id: row.id, name: row.name, slug: row.slug, status: row.status, closesAt: row.closes_at,
    imageKey: row.image_key, imageMime: row.image_mime, imageWidth: row.image_width, imageHeight: row.image_height,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function toResponse(row: ResponseRow): InvitationResponse {
  return {
    id: row.id, eventId: row.event_id, fullName: row.full_name, email: row.email, attending: row.attending,
    hasAllergy: row.has_allergy, allergyNotes: row.allergy_notes, submissionCount: row.submission_count,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function toCounts(row: CountRow | undefined): ResponseCounts {
  return { total: row?.total ?? 0, attending: row?.attending ?? 0, notAttending: row?.not_attending ?? 0, withAllergies: row?.with_allergies ?? 0 };
}

/** Postgres names the UNIQUE on slug `dpm_invitation_events_slug_key`. */
function isSlugConflict(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string };
  return e.code === '23505' && (e.constraint ?? '').includes('slug');
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, char => `\\${char}`);
}

export async function listEvents(): Promise<Array<{ event: InvitationEvent; counts: ResponseCounts; lastResponseAt: Date | null }>> {
  const rows = await queryAll<EventRow & CountRow & { last_response_at: Date | null }>(`
    SELECT e.id, e.name, e.slug, e.status, e.closes_at, e.image_key, e.image_mime, e.image_width, e.image_height, e.created_at, e.updated_at,
      ${COUNT_COLUMNS}, MAX(r.updated_at) AS last_response_at
    FROM dpm_invitation_events e
    LEFT JOIN dpm_invitation_responses r ON r.event_id = e.id
    GROUP BY e.id
    ORDER BY e.created_at DESC`);
  return rows.map(row => ({ event: toEvent(row), counts: toCounts(row), lastResponseAt: row.last_response_at }));
}

export async function getEvent(id: string): Promise<InvitationEvent | null> {
  const row = await queryOne<EventRow>(`SELECT ${EVENT_COLUMNS} FROM dpm_invitation_events WHERE id = ?`, [id]);
  return row ? toEvent(row) : null;
}

export async function getEventBySlug(slug: string): Promise<InvitationEvent | null> {
  const row = await queryOne<EventRow>(`SELECT ${EVENT_COLUMNS} FROM dpm_invitation_events WHERE slug = ?`, [slug]);
  return row ? toEvent(row) : null;
}

export async function createEvent(input: { id: string; name: string; slug: string; closesAt: Date | null; image: ImageInput; userId: string }): Promise<InvitationEvent> {
  try {
    const row = await queryOne<EventRow>(`
      INSERT INTO dpm_invitation_events (id, name, slug, closes_at, image_key, image_mime, image_width, image_height, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING ${EVENT_COLUMNS}`,
    [input.id, input.name, input.slug, input.closesAt, input.image.key, input.image.mime, input.image.width, input.image.height, input.userId, input.userId]);
    return toEvent(row!);
  } catch (error) {
    if (isSlugConflict(error)) throw new SlugTakenError();
    throw error;
  }
}

export async function updateEvent(id: string, patch: { name?: string; slug?: string; status?: InvitationStatus; closesAt?: Date | null }, userId: string): Promise<InvitationEvent | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) { sets.push('name = ?'); values.push(patch.name); }
  if (patch.slug !== undefined) { sets.push('slug = ?'); values.push(patch.slug); }
  if (patch.status !== undefined) { sets.push('status = ?'); values.push(patch.status); }
  if (patch.closesAt !== undefined) { sets.push('closes_at = ?'); values.push(patch.closesAt); }
  sets.push('updated_by = ?', 'updated_at = CURRENT_TIMESTAMP');
  values.push(userId, id);
  try {
    const row = await queryOne<EventRow>(`UPDATE dpm_invitation_events SET ${sets.join(', ')} WHERE id = ? RETURNING ${EVENT_COLUMNS}`, values);
    return row ? toEvent(row) : null;
  } catch (error) {
    if (isSlugConflict(error)) throw new SlugTakenError();
    throw error;
  }
}

export async function replaceEventImage(id: string, image: ImageInput, userId: string): Promise<{ event: InvitationEvent; oldKey: string } | null> {
  const old = await queryOne<{ image_key: string }>('SELECT image_key FROM dpm_invitation_events WHERE id = ?', [id]);
  if (!old) return null;
  const row = await queryOne<EventRow>(`
    UPDATE dpm_invitation_events
    SET image_key = ?, image_mime = ?, image_width = ?, image_height = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? RETURNING ${EVENT_COLUMNS}`, [image.key, image.mime, image.width, image.height, userId, id]);
  return row ? { event: toEvent(row), oldKey: old.image_key } : null;
}

export async function deleteEvent(id: string): Promise<string | null> {
  const row = await queryOne<{ image_key: string }>('DELETE FROM dpm_invitation_events WHERE id = ? RETURNING image_key', [id]);
  return row?.image_key ?? null;
}

export async function countResponses(eventId: string): Promise<ResponseCounts> {
  return toCounts(await queryOne<CountRow>(`SELECT ${COUNT_COLUMNS} FROM dpm_invitation_responses r WHERE r.event_id = ?`, [eventId]));
}

export async function listResponses(eventId: string, options: { q?: string; filter?: ResponseFilter }): Promise<InvitationResponse[]> {
  const where = ['event_id = ?'];
  const values: unknown[] = [eventId];
  const q = (options.q ?? '').trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(`(full_name ILIKE ? ESCAPE '\\' OR email_normalized LIKE ? ESCAPE '\\')`);
    values.push(like, like.toLowerCase());
  }
  if (options.filter === 'attending') where.push('attending');
  if (options.filter === 'not-attending') where.push('NOT attending');
  if (options.filter === 'allergy') where.push('has_allergy');
  const rows = await queryAll<ResponseRow>(`
    SELECT id, event_id, full_name, email, attending, has_allergy, allergy_notes, submission_count, created_at, updated_at
    FROM dpm_invitation_responses WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id`, values);
  return rows.map(toResponse);
}

export async function upsertResponse(eventId: string, value: ParsedResponse): Promise<void> {
  await execute(`
    INSERT INTO dpm_invitation_responses (id, event_id, full_name, email, email_normalized, attending, has_allergy, allergy_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (event_id, email_normalized) DO UPDATE SET
      full_name = EXCLUDED.full_name, email = EXCLUDED.email, attending = EXCLUDED.attending,
      has_allergy = EXCLUDED.has_allergy, allergy_notes = EXCLUDED.allergy_notes,
      submission_count = dpm_invitation_responses.submission_count + 1,
      updated_at = CURRENT_TIMESTAMP`,
  [randomUUID(), eventId, value.fullName, value.email, value.emailNormalized, value.attending, value.hasAllergy, value.allergyNotes]);
}

export async function deleteResponse(eventId: string, responseId: string): Promise<boolean> {
  return (await execute('DELETE FROM dpm_invitation_responses WHERE id = ? AND event_id = ?', [responseId, eventId])) > 0;
}
```

The `email` column keeps the latest spelling. `email_normalized` stays the same, so the CHECK still holds.

- [ ] **Step 4: Run the test to verify it passes**

Run: `SETTLEMENT_TEST_DATABASE_URL=postgres://settlement:settlement@127.0.0.1:5432/settlement_phase2 npx tsx --test tests/dpm-invitation-store-pg.test.ts`
Expected: PASS. Without a DB the test is skipped and CI runs it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dpm-invitation/store.ts tests/dpm-invitation-store-pg.test.ts
git commit -m "feat(dpm): invitation store with email upsert, counts and search"
```

---

### Task 6: Export, presentation and the public submit flow

**Files:**
- Create: `src/lib/dpm-invitation/export.ts`
- Create: `src/lib/dpm-invitation/present.ts`
- Create: `src/lib/dpm-invitation/submit.ts`
- Test: `tests/dpm-invitation-submit.test.ts`

**Interfaces:**
- Consumes: Task 3 (`parseResponseInput`, `isRegistrationOpen`, `formatWib`, `toWibInputValue`, `consumeRateLimit`), Task 3 types.
- Produces (export.ts): `responsesCsv(rows: InvitationResponse[]): string` (starts with a BOM); `responsesXlsx(rows: InvitationResponse[], sheetName: string): Promise<Buffer>`; `exportFilename(slug: string, format: 'csv' | 'xlsx', now: Date): string`.
- Produces (present.ts): `interface PresentedEvent`, `interface PresentedResponse`, `presentEvent(event: InvitationEvent, now: Date, extra?: { counts?: ResponseCounts; lastResponseAt?: Date | null }): PresentedEvent`, `presentResponse(row: InvitationResponse): PresentedResponse`, `canDeleteInvitation(user: { role: string }): boolean`, `imageVersion(key: string): string`.
- Produces (submit.ts): `SUBMIT_BODY_MAX = 16_384`; `interface SubmitDeps { getEventBySlug(slug: string): Promise<InvitationEvent | null>; upsertResponse(eventId: string, value: ParsedResponse): Promise<void>; now(): Date }`; `submitInvitationResponse(slug: string, rawBody: string, ip: string, deps: SubmitDeps): Promise<{ status: number; body: Record<string, unknown> }>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/dpm-invitation-submit.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { exportFilename, responsesCsv, responsesXlsx } from '../src/lib/dpm-invitation/export';
import { canDeleteInvitation, presentEvent } from '../src/lib/dpm-invitation/present';
import { submitInvitationResponse, type SubmitDeps } from '../src/lib/dpm-invitation/submit';
import { resetRateLimitBuckets } from '../src/lib/rate-limit';
import type { InvitationEvent, InvitationResponse, ParsedResponse } from '../src/lib/dpm-invitation/types';

const now = new Date('2026-11-23T05:00:00Z'); // 12:00 WIB
const event: InvitationEvent = {
  id: 'e1', name: 'Gala', slug: 'gala-2027', status: 'open', closesAt: null, imageKey: '11111111-1111-4111-8111-111111111111.webp',
  imageMime: 'image/webp', imageWidth: 1024, imageHeight: 1536, createdAt: now, updatedAt: now,
};

function deps(overrides: Partial<InvitationEvent> = {}) {
  const saved: ParsedResponse[] = [];
  const d: SubmitDeps = {
    getEventBySlug: async slug => (slug === 'gala-2027' ? { ...event, ...overrides } : null),
    upsertResponse: async (_id, value) => { saved.push(value); },
    now: () => now,
  };
  return { d, saved };
}
const body = (extra: Record<string, unknown> = {}) => JSON.stringify({ fullName: 'Nguyen Van A', email: 'a@dpm.vn', attending: 'no', website: '', ...extra });

test('submit: success, 404, closed by status and by closes_at, 422, honeypot, 413, 400', async () => {
  resetRateLimitBuckets();
  let { d, saved } = deps();
  assert.deepEqual(await submitInvitationResponse('gala-2027', body(), '1.1.1.1', d), { status: 200, body: { ok: true } });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].hasAllergy, null);

  assert.equal((await submitInvitationResponse('nope', body(), '1.1.1.1', d)).status, 404);
  ({ d } = deps({ status: 'closed' }));
  assert.deepEqual(await submitInvitationResponse('gala-2027', body(), '1.1.1.1', d), { status: 403, body: { error: 'Registration has closed.' } });
  ({ d } = deps({ closesAt: new Date('2026-11-23T04:59:00Z') }));
  assert.equal((await submitInvitationResponse('gala-2027', body(), '1.1.1.1', d)).status, 403);

  ({ d, saved } = deps());
  const invalid = await submitInvitationResponse('gala-2027', body({ email: 'x' }), '1.1.1.1', d);
  assert.deepEqual(invalid, { status: 422, body: { fieldErrors: { email: 'Please enter a valid email address.' } } });

  assert.deepEqual(await submitInvitationResponse('gala-2027', body({ website: 'http://spam' }), '1.1.1.1', d), { status: 200, body: { ok: true } });
  assert.equal(saved.length, 0, 'honeypot stores nothing');

  assert.equal((await submitInvitationResponse('gala-2027', 'x'.repeat(16_385), '1.1.1.1', d)).status, 413);
  assert.equal((await submitInvitationResponse('gala-2027', '{not json', '1.1.1.1', d)).status, 400);
});

test('submit: 60 per 10 minutes per IP, 5 per hour per event and email', async () => {
  resetRateLimitBuckets();
  const { d } = deps();
  for (let i = 0; i < 60; i++) assert.equal((await submitInvitationResponse('gala-2027', body({ email: `p${i}@dpm.vn` }), '3.3.3.3', d)).status, 200);
  assert.deepEqual(await submitInvitationResponse('gala-2027', body({ email: 'late@dpm.vn' }), '3.3.3.3', d), {
    status: 429, body: { error: 'Too many attempts. Please wait a few minutes and try again.' },
  });

  resetRateLimitBuckets();
  for (let i = 0; i < 5; i++) assert.equal((await submitInvitationResponse('gala-2027', body({ email: 'Same@dpm.vn' }), `4.4.4.${i}`, d)).status, 200);
  assert.equal((await submitInvitationResponse('gala-2027', body({ email: 'same@DPM.vn' }), '4.4.4.9', d)).status, 429);
});

const rows: InvitationResponse[] = [
  { id: 'r1', eventId: 'e1', fullName: '=HYPERLINK("x")', email: 'a@dpm.vn', attending: true, hasAllergy: true, allergyNotes: 'Đậu phộng, "peanuts"', submissionCount: 2, createdAt: now, updatedAt: now },
  { id: 'r2', eventId: 'e1', fullName: 'Tran B', email: 'b@x.vn', attending: false, hasAllergy: null, allergyNotes: null, submissionCount: 1, createdAt: now, updatedAt: now },
];

test('export: headers, Yes/No/blank, formula guard, BOM, WIB dates, filename', async () => {
  const csv = responsesCsv(rows);
  assert.ok(csv.startsWith('\uFEFFFull name,Email,Attending,Food allergy,Allergy notes,Submissions,First submitted (WIB),Last updated (WIB)\r\n'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")",a@dpm.vn,Yes,Yes,"Đậu phộng, ""peanuts""",2,"23 Nov 2026, 12:00 WIB","23 Nov 2026, 12:00 WIB"\r\n`));
  assert.ok(csv.includes('Tran B,b@x.vn,No,,,1,"23 Nov 2026, 12:00 WIB"'));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await responsesXlsx(rows, 'gala-2027')) as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet('gala-2027')!;
  assert.equal(sheet.getCell('A2').value, `'=HYPERLINK("x")`);
  assert.equal(sheet.getCell('C3').value, 'No');
  assert.ok(!sheet.getCell('D3').value, 'blank allergy for not attending');
  assert.equal(exportFilename('gala-2027', 'xlsx', new Date('2026-11-23T18:00:00Z')), 'dpm-invitation-gala-2027-20261124.xlsx');
});

test('present: open state, WIB label, public path; only admins delete events', () => {
  const p = presentEvent({ ...event, closesAt: new Date('2026-12-20T11:00:00Z') }, now);
  assert.equal(p.isOpen, true);
  assert.equal(p.closesAtWib, '20 Dec 2026, 18:00 WIB');
  assert.equal(p.closesAtInput, '2026-12-20T18:00');
  assert.equal(p.publicPath, '/i/gala-2027');
  assert.equal(p.imageUrl, '/api/dpm/invitations/e1/image?v=11111111-1111-4111-8111-111111111111');
  assert.equal(p.closedReason, null);
  assert.equal(presentEvent({ ...event, closesAt: new Date('2026-11-01T00:00:00Z') }, now).closedReason, 'auto');
  assert.equal(presentEvent({ ...event, status: 'closed' }, now).closedReason, 'manual');
  assert.equal(canDeleteInvitation({ role: 'admin' }), true);
  assert.equal(canDeleteInvitation({ role: 'member' }), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/dpm-invitation-submit.test.ts`
Expected: FAIL with `Cannot find module '../src/lib/dpm-invitation/export'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/dpm-invitation/export.ts
import ExcelJS from 'exceljs';
import { formatWib } from './rules';
import type { InvitationResponse } from './types';

const HEADERS = ['Full name', 'Email', 'Attending', 'Food allergy', 'Allergy notes', 'Submissions', 'First submitted (WIB)', 'Last updated (WIB)'];
const WIDTHS = [28, 32, 11, 13, 40, 12, 24, 24];

/** Spreadsheet formula-injection guard for text cells. */
function guard(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function cells(row: InvitationResponse): Array<string | number> {
  return [
    guard(row.fullName), guard(row.email), row.attending ? 'Yes' : 'No',
    row.hasAllergy === null ? '' : row.hasAllergy ? 'Yes' : 'No',
    guard(row.allergyNotes ?? ''), row.submissionCount, formatWib(row.createdAt), formatWib(row.updatedAt),
  ];
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function responsesCsv(rows: InvitationResponse[]): string {
  return '\uFEFF' + [HEADERS, ...rows.map(cells)].map(line => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export async function responsesXlsx(rows: InvitationResponse[], sheetName: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addRow(HEADERS).font = { bold: true };
  for (const row of rows) sheet.addRow(cells(row));
  WIDTHS.forEach((width, i) => { sheet.getColumn(i + 1).width = width; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Date part is the WIB calendar day. */
export function exportFilename(slug: string, format: 'csv' | 'xlsx', now: Date): string {
  const day = new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  return `dpm-invitation-${slug}-${day}.${format}`;
}
```

```ts
// src/lib/dpm-invitation/present.ts
import { formatWib, isRegistrationOpen, toWibInputValue } from './rules';
import type { InvitationEvent, InvitationResponse, ResponseCounts } from './types';

export interface PresentedEvent {
  id: string; name: string; slug: string; status: 'open' | 'closed';
  closesAt: string | null; closesAtWib: string | null; closesAtInput: string;
  isOpen: boolean; closedReason: 'manual' | 'auto' | null;
  publicPath: string; imageUrl: string; imageWidth: number; imageHeight: number;
  counts?: ResponseCounts; lastResponseAt?: string | null; createdAt: string;
}

export interface PresentedResponse {
  id: string; fullName: string; email: string; attending: boolean; hasAllergy: boolean | null;
  allergyNotes: string | null; submissionCount: number; createdAt: string; updatedAt: string; updatedAtWib: string;
}

export function imageVersion(key: string): string {
  return key.replace(/\.[a-z]+$/, '');
}

export function presentEvent(event: InvitationEvent, now: Date, extra: { counts?: ResponseCounts; lastResponseAt?: Date | null } = {}): PresentedEvent {
  const isOpen = isRegistrationOpen(event, now);
  return {
    id: event.id, name: event.name, slug: event.slug, status: event.status,
    closesAt: event.closesAt ? event.closesAt.toISOString() : null,
    closesAtWib: event.closesAt ? formatWib(event.closesAt) : null,
    closesAtInput: toWibInputValue(event.closesAt),
    isOpen, closedReason: isOpen ? null : event.status === 'closed' ? 'manual' : 'auto',
    publicPath: `/i/${event.slug}`,
    imageUrl: `/api/dpm/invitations/${event.id}/image?v=${imageVersion(event.imageKey)}`,
    imageWidth: event.imageWidth, imageHeight: event.imageHeight,
    ...(extra.counts ? { counts: extra.counts } : {}),
    ...(extra.lastResponseAt !== undefined ? { lastResponseAt: extra.lastResponseAt ? extra.lastResponseAt.toISOString() : null } : {}),
    createdAt: event.createdAt.toISOString(),
  };
}

export function presentResponse(row: InvitationResponse): PresentedResponse {
  return {
    id: row.id, fullName: row.fullName, email: row.email, attending: row.attending, hasAllergy: row.hasAllergy,
    allergyNotes: row.allergyNotes, submissionCount: row.submissionCount,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), updatedAtWib: formatWib(row.updatedAt),
  };
}

/** Deleting a whole invitation (every response and the image) is admin-only. Any feature holder may delete single responses. */
export function canDeleteInvitation(user: { role: string }): boolean {
  return user.role === 'admin';
}
```

```ts
// src/lib/dpm-invitation/submit.ts
import { consumeRateLimit } from '@/lib/rate-limit';
import { isRegistrationOpen, parseResponseInput } from './rules';
import type { InvitationEvent, ParsedResponse } from './types';

export const SUBMIT_BODY_MAX = 16_384;
const IP_LIMIT = 60;
const IP_WINDOW_MS = 10 * 60_000;
const EMAIL_LIMIT = 5;
const EMAIL_WINDOW_MS = 60 * 60_000;
const TOO_MANY = { error: 'Too many attempts. Please wait a few minutes and try again.' };
const GENERIC = { error: 'Something went wrong. Please try again in a minute.' };

export interface SubmitDeps {
  getEventBySlug(slug: string): Promise<InvitationEvent | null>;
  upsertResponse(eventId: string, value: ParsedResponse): Promise<void>;
  now(): Date;
}

export async function submitInvitationResponse(slug: string, rawBody: string, ip: string, deps: SubmitDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  if (rawBody.length > SUBMIT_BODY_MAX) return { status: 413, body: { error: 'Request is too large.' } };
  let input: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 400, body: GENERIC };
    input = parsed as Record<string, unknown>;
  } catch {
    return { status: 400, body: GENERIC };
  }
  const now = deps.now();
  if (!consumeRateLimit('dpm-inv-ip', ip, IP_LIMIT, IP_WINDOW_MS, now.getTime()).allowed) return { status: 429, body: TOO_MANY };

  const event = await deps.getEventBySlug(slug);
  if (!event) return { status: 404, body: { error: 'This invitation link is not valid.' } };
  if (!isRegistrationOpen(event, now)) return { status: 403, body: { error: 'Registration has closed.' } };
  // Honeypot: look like a success, store nothing.
  if (String(input.website ?? '').trim() !== '') return { status: 200, body: { ok: true } };

  const result = parseResponseInput(input);
  if (!result.ok) return { status: 422, body: { fieldErrors: result.fieldErrors } };
  const emailKey = `${event.id}:${result.value.emailNormalized}`;
  if (!consumeRateLimit('dpm-inv-email', emailKey, EMAIL_LIMIT, EMAIL_WINDOW_MS, now.getTime()).allowed) return { status: 429, body: TOO_MANY };

  try {
    await deps.upsertResponse(event.id, result.value);
  } catch (error) {
    console.error('DPM invitation submit failed', event.id, (error as { code?: string }).code ?? 'unknown');
    return { status: 500, body: GENERIC };
  }
  return { status: 200, body: { ok: true } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test tests/dpm-invitation-submit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dpm-invitation/export.ts src/lib/dpm-invitation/present.ts src/lib/dpm-invitation/submit.ts tests/dpm-invitation-submit.test.ts
git commit -m "feat(dpm): invitation export, presenter and public submit flow"
```

---

### Task 7: Admin API routes

**Files:**
- Create: `src/app/api/dpm/invitations/route.ts` (GET list, POST create)
- Create: `src/app/api/dpm/invitations/[id]/route.ts` (GET, PATCH, DELETE)
- Create: `src/app/api/dpm/invitations/[id]/image/route.ts` (GET preview, PUT replace)
- Create: `src/app/api/dpm/invitations/[id]/responses/route.ts` (GET)
- Create: `src/app/api/dpm/invitations/[id]/responses/[responseId]/route.ts` (DELETE)
- Create: `src/app/api/dpm/invitations/[id]/export/route.ts` (GET)
- Test: `tests/dpm-invitation-api.test.ts`

**Interfaces:**
- Consumes: `requireFeature` from `@/lib/auth` (returns `AuthorizedUser | AuthError`); Tasks 3–6.
- Produces: the HTTP API from spec section 5.2. JSON shapes: `{ events: PresentedEvent[] }`, `{ event: PresentedEvent }`, `{ counts: ResponseCounts, responses: PresentedResponse[] }`, errors `{ error: string, field?: string }`.

- [ ] **Step 1: Write the failing test** (static wiring check; behaviour is covered by Tasks 3–6 and the manual checks in Task 11)

```ts
// tests/dpm-invitation-api.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = 'src/app/api/dpm/invitations';
const routes: Record<string, string[]> = {
  [`${base}/route.ts`]: ['GET', 'POST'],
  [`${base}/[id]/route.ts`]: ['GET', 'PATCH', 'DELETE'],
  [`${base}/[id]/image/route.ts`]: ['GET', 'PUT'],
  [`${base}/[id]/responses/route.ts`]: ['GET'],
  [`${base}/[id]/responses/[responseId]/route.ts`]: ['DELETE'],
  [`${base}/[id]/export/route.ts`]: ['GET'],
};

test('every admin route checks the dpm-invitation feature in every handler and sends no-store', () => {
  for (const [file, methods] of Object.entries(routes)) {
    const source = readFileSync(file, 'utf8');
    for (const method of methods) {
      const handler = source.split(`export async function ${method}(`)[1];
      assert.ok(handler, `${file} exports ${method}`);
      assert.match(handler.split('export async function')[0], /requireFeature\(request, 'dpm-invitation'\)/, `${file} ${method}`);
    }
    assert.match(source, /no-store/, `${file} sends no-store`);
  }
});

test('event delete is admin-only, response delete is open to feature holders', () => {
  assert.match(readFileSync(`${base}/[id]/route.ts`, 'utf8'), /canDeleteInvitation\(auth\)/);
  assert.doesNotMatch(readFileSync(`${base}/[id]/responses/[responseId]/route.ts`, 'utf8'), /canDeleteInvitation|role === 'admin'/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/dpm-invitation-api.test.ts`
Expected: FAIL with `ENOENT ... src/app/api/dpm/invitations/route.ts`.

- [ ] **Step 3: Implement**

```ts
// src/app/api/dpm/invitations/route.ts
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { consumeRateLimit } from '@/lib/rate-limit';
import { ImageInputError, IMAGE_MAX_BYTES, removeInvitationImage, saveInvitationImage } from '@/lib/dpm-invitation/image';
import { presentEvent } from '@/lib/dpm-invitation/present';
import { parseClosesAtWib, parseEventName, slugIssue } from '@/lib/dpm-invitation/rules';
import { SlugTakenError, createEvent, listEvents } from '@/lib/dpm-invitation/store';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const ZERO = { total: 0, attending: 0, notAttending: 0, withAllergies: 0 };

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  const now = new Date();
  const rows = await listEvents();
  return json({ events: rows.map(row => presentEvent(row.event, now, { counts: row.counts, lastResponseAt: row.lastResponseAt })) });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  if (!consumeRateLimit('dpm-inv-upload', auth.id, 20, 60 * 60_000).allowed) return json({ error: 'Too many uploads. Try again later.' }, 429);
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: 'Send the form as multipart/form-data.' }, 400);
  const name = parseEventName(form.get('name'));
  if (!name.ok) return json({ error: name.error, field: 'name' }, 400);
  const slug = String(form.get('slug') ?? '').trim().toLowerCase();
  const issue = slugIssue(slug);
  if (issue) return json({ error: issue, field: 'slug' }, 400);
  const closesAt = parseClosesAtWib(form.get('closesAt'), new Date());
  if (!closesAt.ok) return json({ error: closesAt.error, field: 'closesAt' }, 400);
  const file = form.get('image');
  if (!(file instanceof File)) return json({ error: 'Choose an invitation image.', field: 'image' }, 400);
  if (file.size > IMAGE_MAX_BYTES) return json({ error: 'Image must be 8 MB or smaller.', field: 'image' }, 400);

  let image;
  try {
    image = await saveInvitationImage(Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof ImageInputError) return json({ error: error.message, field: 'image' }, 400);
    throw error;
  }
  try {
    const event = await createEvent({ id: randomUUID(), name: name.value, slug, closesAt: closesAt.value, image, userId: auth.id });
    return json({ event: presentEvent(event, new Date(), { counts: ZERO, lastResponseAt: null }) }, 201);
  } catch (error) {
    await removeInvitationImage(image.key);
    if (error instanceof SlugTakenError) return json({ error: error.message, field: 'slug' }, 409);
    console.error('DPM invitation create failed', (error as { code?: string }).code ?? 'unknown');
    return json({ error: 'Could not create the invitation.' }, 500);
  }
}
```

```ts
// src/app/api/dpm/invitations/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { removeInvitationImage } from '@/lib/dpm-invitation/image';
import { canDeleteInvitation, presentEvent } from '@/lib/dpm-invitation/present';
import { parseClosesAtWib, parseEventName, slugIssue } from '@/lib/dpm-invitation/rules';
import { SlugTakenError, countResponses, deleteEvent, getEvent, updateEvent } from '@/lib/dpm-invitation/store';
import type { InvitationStatus } from '@/lib/dpm-invitation/types';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const NOT_FOUND = { error: 'Invitation not found.' };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  const { id } = await context.params;
  const event = await getEvent(id);
  if (!event) return json(NOT_FOUND, 404);
  return json({ event: presentEvent(event, new Date(), { counts: await countResponses(id) }) });
}

/** JSON: any of name, slug, status ('open' | 'closed'), closesAt (WIB 'YYYY-MM-DDTHH:mm', '' or null clears). */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  const { id } = await context.params;
  if (!(await getEvent(id))) return json(NOT_FOUND, 404);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: { name?: string; slug?: string; status?: InvitationStatus; closesAt?: Date | null } = {};
  if ('name' in body) {
    const name = parseEventName(body.name);
    if (!name.ok) return json({ error: name.error, field: 'name' }, 400);
    patch.name = name.value;
  }
  if ('slug' in body) {
    const slug = String(body.slug ?? '').trim().toLowerCase();
    const issue = slugIssue(slug);
    if (issue) return json({ error: issue, field: 'slug' }, 400);
    patch.slug = slug;
  }
  if ('status' in body) {
    if (body.status !== 'open' && body.status !== 'closed') return json({ error: 'status must be open or closed.', field: 'status' }, 400);
    patch.status = body.status;
  }
  if ('closesAt' in body) {
    const closesAt = parseClosesAtWib(body.closesAt, new Date());
    if (!closesAt.ok) return json({ error: closesAt.error, field: 'closesAt' }, 400);
    patch.closesAt = closesAt.value;
  }
  try {
    const event = await updateEvent(id, patch, auth.id);
    if (!event) return json(NOT_FOUND, 404);
    return json({ event: presentEvent(event, new Date(), { counts: await countResponses(id) }) });
  } catch (error) {
    if (error instanceof SlugTakenError) return json({ error: error.message, field: 'slug' }, 409);
    console.error('DPM invitation update failed', (error as { code?: string }).code ?? 'unknown');
    return json({ error: 'Could not update the invitation.' }, 500);
  }
}

/** Admin only. JSON { confirm: '<slug>' }. Deletes every response and the image file. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  if (!canDeleteInvitation(auth)) return json({ error: 'Only admins can delete an invitation.' }, 403);
  const { id } = await context.params;
  const event = await getEvent(id);
  if (!event) return json(NOT_FOUND, 404);
  const body = (await request.json().catch(() => ({}))) as { confirm?: unknown };
  if (body.confirm !== event.slug) return json({ error: 'Type the link name to confirm.' }, 400);
  const key = await deleteEvent(id);
  if (key) await removeInvitationImage(key);
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
```

```ts
// src/app/api/dpm/invitations/[id]/image/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { consumeRateLimit } from '@/lib/rate-limit';
import { ImageInputError, IMAGE_MAX_BYTES, readInvitationImage, removeInvitationImage, saveInvitationImage } from '@/lib/dpm-invitation/image';
import { presentEvent } from '@/lib/dpm-invitation/present';
import { countResponses, getEvent, replaceEventImage } from '@/lib/dpm-invitation/store';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/** Signed-in preview, also when the event is closed. */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  const { id } = await context.params;
  const event = await getEvent(id);
  const bytes = event ? await readInvitationImage(event.imageKey) : null;
  if (!event || !bytes) return new NextResponse('Not found', { status: 404, headers: NO_STORE });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { 'Content-Type': event.imageMime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** multipart image. Writes the new file, updates the row, then removes the old file. */
export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  if (!consumeRateLimit('dpm-inv-upload', auth.id, 20, 60 * 60_000).allowed) return json({ error: 'Too many uploads. Try again later.' }, 429);
  const { id } = await context.params;
  if (!(await getEvent(id))) return json({ error: 'Invitation not found.' }, 404);
  const form = await request.formData().catch(() => null);
  const file = form?.get('image');
  if (!(file instanceof File)) return json({ error: 'Choose an invitation image.', field: 'image' }, 400);
  if (file.size > IMAGE_MAX_BYTES) return json({ error: 'Image must be 8 MB or smaller.', field: 'image' }, 400);
  let image;
  try {
    image = await saveInvitationImage(Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof ImageInputError) return json({ error: error.message, field: 'image' }, 400);
    throw error;
  }
  const result = await replaceEventImage(id, image, auth.id);
  if (!result) {
    await removeInvitationImage(image.key);
    return json({ error: 'Invitation not found.' }, 404);
  }
  await removeInvitationImage(result.oldKey);
  return json({ event: presentEvent(result.event, new Date(), { counts: await countResponses(id) }) });
}
```

```ts
// src/app/api/dpm/invitations/[id]/responses/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { presentResponse } from '@/lib/dpm-invitation/present';
import { isResponseFilter } from '@/lib/dpm-invitation/rules';
import { countResponses, getEvent, listResponses } from '@/lib/dpm-invitation/store';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };
const NO_STORE = { 'Cache-Control': 'no-store' };

/** GET ?q=&filter=all|attending|not-attending|allergy. Counts always cover the whole event. */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  const { id } = await context.params;
  if (!(await getEvent(id))) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404, headers: NO_STORE });
  const params = request.nextUrl.searchParams;
  const filterParam = params.get('filter') ?? 'all';
  const filter = isResponseFilter(filterParam) ? filterParam : 'all';
  const q = (params.get('q') ?? '').slice(0, 120);
  const [counts, rows] = await Promise.all([countResponses(id), listResponses(id, { q, filter })]);
  return NextResponse.json({ counts, responses: rows.map(presentResponse) }, { headers: NO_STORE });
}
```

```ts
// src/app/api/dpm/invitations/[id]/responses/[responseId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { deleteResponse } from '@/lib/dpm-invitation/store';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string; responseId: string }> };
const NO_STORE = { 'Cache-Control': 'no-store' };

/** Admins and DPM Invitation holders may delete a single response. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  const { id, responseId } = await context.params;
  if (!(await deleteResponse(id, responseId))) return NextResponse.json({ error: 'Response not found.' }, { status: 404, headers: NO_STORE });
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
```

```ts
// src/app/api/dpm/invitations/[id]/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { exportFilename, responsesCsv, responsesXlsx } from '@/lib/dpm-invitation/export';
import { isResponseFilter } from '@/lib/dpm-invitation/rules';
import { getEvent, listResponses } from '@/lib/dpm-invitation/store';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };
const NO_STORE = { 'Cache-Control': 'no-store' };

/** GET ?format=xlsx|csv&q=&filter= -> file download. Built in memory, never written to disk. */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'dpm-invitation');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  const { id } = await context.params;
  const event = await getEvent(id);
  if (!event) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404, headers: NO_STORE });
  const params = request.nextUrl.searchParams;
  const format = params.get('format') === 'csv' ? 'csv' : 'xlsx';
  const filterParam = params.get('filter') ?? 'all';
  const rows = await listResponses(id, { q: (params.get('q') ?? '').slice(0, 120), filter: isResponseFilter(filterParam) ? filterParam : 'all' });
  const headers = { ...NO_STORE, 'Content-Disposition': `attachment; filename="${exportFilename(event.slug, format, new Date())}"` };
  if (format === 'csv') return new NextResponse(responsesCsv(rows), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' } });
  const xlsx = await responsesXlsx(rows, event.slug);
  return new NextResponse(new Uint8Array(xlsx), { headers: { ...headers, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test tests/dpm-invitation-api.test.ts && npx tsc --noEmit 2>&1 | rg '^(src/|tests/dpm-invitation)'`
Expected: tests PASS and the `rg` prints nothing (older test files already report TS5097 on main; ignore those).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/dpm tests/dpm-invitation-api.test.ts
git commit -m "feat(dpm): admin API for invitations, responses and export"
```

---

### Task 8: Public submit route and public image route

**Files:**
- Create: `src/app/api/public/dpm-invitations/[slug]/responses/route.ts`
- Create: `src/app/i/[slug]/image/route.ts`
- Modify: `tests/feature-route-gates.test.ts` (allow-list the public submit route in `PUBLIC_ROUTES`)
- Test: `tests/dpm-invitation-public-guard.test.ts`

**Interfaces:**
- Consumes: `submitInvitationResponse`, `SUBMIT_BODY_MAX` (Task 6); `getEventBySlug`, `upsertResponse` (Task 5); `readInvitationImage` (Task 4); `clientIpFromHeaders` (Task 3).
- Produces: `POST /api/public/dpm-invitations/<slug>/responses` and `GET /i/<slug>/image`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/dpm-invitation-public-guard.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

test('public DPM invitation files never import auth and say so at the top', () => {
  const all = ['src/app/i', 'src/app/api/public/dpm-invitations'].flatMap(files).filter(f => /\.(ts|tsx)$/.test(f));
  assert.ok(all.length >= 2, 'public files exist');
  for (const file of all) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /@\/lib\/auth['"]/, file);
    assert.match(source, /Never import @\/lib\/auth/, file);
  }
});

test('public submit route uses the shared flow and the Cloudflare-aware IP', () => {
  const route = readFileSync('src/app/api/public/dpm-invitations/[slug]/responses/route.ts', 'utf8');
  assert.match(route, /submitInvitationResponse\(/);
  assert.match(route, /clientIpFromHeaders\(request\.headers\)/);
  assert.match(route, /SUBMIT_BODY_MAX/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/dpm-invitation-public-guard.test.ts`
Expected: FAIL with `ENOENT ... src/app/i`.

- [ ] **Step 3: Implement**

```ts
// src/app/api/public/dpm-invitations/[slug]/responses/route.ts
// PUBLIC route: no login. Never import @/lib/auth here, and never return stored response data.
import { NextRequest, NextResponse } from 'next/server';
import { clientIpFromHeaders } from '@/lib/rate-limit';
import { SUBMIT_BODY_MAX, submitInvitationResponse } from '@/lib/dpm-invitation/submit';
import { getEventBySlug, upsertResponse } from '@/lib/dpm-invitation/store';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ slug: string }> };
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest, context: RouteContext) {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > SUBMIT_BODY_MAX) return NextResponse.json({ error: 'Request is too large.' }, { status: 413, headers: NO_STORE });
  const { slug } = await context.params;
  const raw = await request.text();
  const result = await submitInvitationResponse(slug.toLowerCase(), raw, clientIpFromHeaders(request.headers), {
    getEventBySlug, upsertResponse, now: () => new Date(),
  });
  return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}
```

```ts
// src/app/i/[slug]/image/route.ts
// PUBLIC route: serves only the invitation artwork. Never import @/lib/auth here.
import { NextResponse } from 'next/server';
import { readInvitationImage } from '@/lib/dpm-invitation/image';
import { getEventBySlug } from '@/lib/dpm-invitation/store';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const event = await getEventBySlug(slug.toLowerCase());
  if (!event) return new NextResponse('Not found', { status: 404 });
  const bytes = await readInvitationImage(event.imageKey);
  if (!bytes) {
    console.error('DPM invitation image missing', event.id);
    return new NextResponse('Unable to read image', { status: 500 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: { 'Content-Type': event.imageMime, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
  });
}
```

Then allow-list the new public API route in the existing guard test, `tests/feature-route-gates.test.ts`, which fails for any API route without an auth gate:

```ts
/** Routes that are public on purpose: login, health, a signed share token, and the DPM invitation submit (rate-limited, writes only). */
const PUBLIC_ROUTES = new Set([
  'src/app/api/auth/route.ts',
  'src/app/api/health/route.ts',
  'src/app/api/ai-research/share/route.ts',
  'src/app/api/public/dpm-invitations/[slug]/responses/route.ts',
]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test tests/dpm-invitation-public-guard.test.ts tests/feature-route-gates.test.ts && npx tsc --noEmit 2>&1 | rg '^(src/|tests/dpm-invitation)'`
Expected: tests PASS and the `rg` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/public/dpm-invitations" "src/app/i/[slug]/image" tests/dpm-invitation-public-guard.test.ts tests/feature-route-gates.test.ts
git commit -m "feat(dpm): public submit and image routes for invitations"
```

---

### Task 9: Public invitation page, form and Thank you page

**Files:**
- Create: `src/app/i/invitation.css`
- Create: `src/app/i/[slug]/InvitationShell.tsx`
- Create: `src/app/i/[slug]/page.tsx`
- Create: `src/app/i/[slug]/InvitationForm.tsx`
- Create: `src/app/i/[slug]/thanks/page.tsx`
- Create: `src/app/i/[slug]/not-found.tsx`
- Test: `tests/dpm-invitation-public.test.ts` (and the Task 8 guard test, which now covers these files)

**Interfaces:**
- Consumes: `getEventBySlug` (Task 5); `isRegistrationOpen`, `ALLERGY_NOTES_MAX`, `NAME_MAX`, `EMAIL_MAX` (Task 3); `imageVersion` (Task 6); the submit route (Task 8).
- Produces: `InvitationShell({ event, children })`, `ClosedNotice()`, `InvitationForm({ slug })`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/dpm-invitation-public.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(file, 'utf8');

test('public pages are dynamic, noindex, no-referrer and use the shared open check', () => {
  for (const file of ['src/app/i/[slug]/page.tsx', 'src/app/i/[slug]/thanks/page.tsx']) {
    const source = read(file);
    assert.match(source, /export const dynamic = 'force-dynamic'/, file);
    assert.match(source, /robots: \{ index: false, follow: false \}/, file);
    assert.match(source, /referrer: 'no-referrer'/, file);
    assert.match(source, /isRegistrationOpen\(/, file);
  }
});

test('form follows the approved order and shows allergy questions only when attending', () => {
  const form = read('src/app/i/[slug]/InvitationForm.tsx');
  const order = ['htmlFor="fullName">Full name<', 'htmlFor="email">Email<', 'label="Will you attend?"', 'label="Do you have any food allergies?"', 'htmlFor="allergyNotes">What are you allergic to?<']
    .map(label => form.indexOf(label));
  assert.ok(order.every(i => i > 0), 'all labels present');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'labels in order');
  assert.match(form, /\{attending === 'yes' && \(/);
  assert.match(form, /hasAllergy === 'yes' && \(/);
  assert.match(form, /if \(attending === 'yes'\) \{/, 'hidden answers are not sent');
  assert.match(form, /name="website"/);
});

test('thank you text is the same for new and updated answers and shows no personal data', () => {
  const thanks = read('src/app/i/[slug]/thanks/page.tsx');
  assert.match(thanks, /Your response has been recorded\. You can submit again with the same email to change it\./);
  assert.doesNotMatch(thanks, /updated=|fullName|\.email\b|searchParams/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/dpm-invitation-public.test.ts`
Expected: FAIL with `ENOENT ... src/app/i/[slug]/page.tsx`.

- [ ] **Step 3: Implement**

```css
/* src/app/i/invitation.css
   Ported from annual-dinner/app/src/styles/{tokens,register}.css, scoped to .pg-dpm-inv.
   Tokens are copied with the same values so the dashboard theme is not involved.
   Never import @/lib/auth (public page). */
.pg-dpm-inv{
  --dp-blue:#2EB5C4;--dp-teal-dark:#1A8A96;--dp-black:#0A0A0A;--dp-ink:#1A1F24;--dp-muted:#5B6B73;
  --n-200:#DDE3E6;--n-300:#C3CCD0;--danger:#B42318;--danger-bg:#FDECEA;--r-2:4px;--focus:0 0 0 3px rgba(46,181,196,.45);
  --font-sans:var(--font-geist-sans),Arial,sans-serif;
  background:#fff;color:var(--dp-ink);font-family:var(--font-sans);font-size:16px;line-height:1.5;min-height:100vh;width:100%
}
.pg-dpm-inv *{box-sizing:border-box}
.pg-dpm-inv .shell{min-height:100vh;display:grid;grid-template-columns:1fr}
.pg-dpm-inv .panel{background:var(--dp-black);display:flex;align-items:center;justify-content:center}
.pg-dpm-inv .panel img{display:block;width:100%;height:auto}
.pg-dpm-inv main{padding:28px 20px 32px}
.pg-dpm-inv .eyebrow{margin:0;font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:var(--dp-muted)}
.pg-dpm-inv main h1{font-size:26px;line-height:1.15;margin:8px 0 0;font-weight:700}
.pg-dpm-inv .to{font-size:14px;color:var(--dp-muted);margin:8px 0 0}
.pg-dpm-inv form{margin-top:28px;display:grid;gap:22px}
.pg-dpm-inv .field{display:flex;flex-direction:column;gap:6px}
.pg-dpm-inv .label{font-size:14px;font-weight:700;color:var(--dp-ink)}
.pg-dpm-inv .input{height:48px;width:100%;padding:0 14px;border:1px solid var(--n-300);border-radius:var(--r-2);background:#fff;font:400 16px var(--font-sans);color:var(--dp-ink)}
.pg-dpm-inv .input::placeholder{color:#66737A}
.pg-dpm-inv .input:focus{outline:none;border-color:var(--dp-blue);box-shadow:var(--focus)}
.pg-dpm-inv .input.is-error{border-color:var(--danger)}
.pg-dpm-inv .help{font-size:13px;color:var(--dp-muted)}
.pg-dpm-inv .err{font-size:13px;color:var(--danger)}
.pg-dpm-inv .notice{border:1px solid var(--n-200);border-left:3px solid var(--dp-blue);background:#fff;padding:14px 16px;font-size:14px;border-radius:var(--r-2)}
.pg-dpm-inv .notice.danger{border-left-color:var(--danger);background:var(--danger-bg)}
.pg-dpm-inv .choice-set{border:0;padding:0;margin:0;min-width:0}
.pg-dpm-inv .choice-set legend.label{padding:0;float:none;margin-bottom:6px}
.pg-dpm-inv .choice{display:grid;grid-template-columns:1fr 1fr;height:48px;border:1px solid var(--n-300);border-radius:var(--r-2);overflow:hidden;background:#fff}
.pg-dpm-inv .choice.is-error{border-color:var(--danger)}
.pg-dpm-inv .choice label{display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;cursor:pointer;border-left:1px solid var(--n-300);color:var(--dp-ink)}
.pg-dpm-inv .choice label:first-child{border-left:0}
.pg-dpm-inv .choice label.on{background:var(--dp-ink);color:#fff}
.pg-dpm-inv .choice input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.pg-dpm-inv .choice label:focus-within{box-shadow:var(--focus);position:relative;z-index:1}
.pg-dpm-inv .hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.pg-dpm-inv .btn{display:inline-flex;align-items:center;justify-content:center;height:52px;width:100%;padding:0 24px;border-radius:var(--r-2);font:700 16px/1 var(--font-sans);letter-spacing:.04em;border:1px solid transparent;cursor:pointer;background:var(--dp-blue);color:var(--dp-black)}
.pg-dpm-inv .btn:hover{background:var(--dp-teal-dark)}
.pg-dpm-inv .btn:focus-visible{outline:none;box-shadow:var(--focus)}
.pg-dpm-inv .btn[disabled]{opacity:.55;cursor:not-allowed}
.pg-dpm-inv .fine{font-size:13px;color:var(--dp-muted);margin:14px 0 0;line-height:1.5}
.pg-dpm-inv .link{color:var(--dp-ink);text-decoration:underline;text-decoration-color:var(--dp-blue);text-decoration-thickness:2px;text-underline-offset:3px}
@media (min-width:1024px){
  .pg-dpm-inv .shell{grid-template-columns:minmax(440px,5fr) 7fr}
  .pg-dpm-inv .panel{position:sticky;top:0;height:100vh}
  .pg-dpm-inv .panel img{width:100%;height:100%;object-fit:contain}
  .pg-dpm-inv main{padding:0 72px;max-width:640px;align-self:center}
  .pg-dpm-inv main h1{font-size:40px}
  .pg-dpm-inv form{margin-top:40px;gap:26px}
  .pg-dpm-inv .btn{width:auto;min-width:220px}
}
```

```tsx
// src/app/i/[slug]/InvitationShell.tsx
// PUBLIC. Never import @/lib/auth. If a middleware.ts or proxy.ts is ever added, it must allow /i/.
import type { ReactNode } from 'react';
import '../invitation.css';
import { imageVersion } from '@/lib/dpm-invitation/present';
import type { InvitationEvent } from '@/lib/dpm-invitation/types';

export function InvitationShell({ event, children }: { event: InvitationEvent; children: ReactNode }) {
  return (
    <div className="pg-dpm-inv">
      <div className="shell">
        <aside className="panel">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/i/${event.slug}/image?v=${imageVersion(event.imageKey)}`} alt={event.name} width={event.imageWidth} height={event.imageHeight} />
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}

export function ClosedNotice() {
  return <div className="notice" style={{ marginTop: 32 }}>Registration for this event is closed. If you need help, please contact the DPM event team.</div>;
}
```

```tsx
// src/app/i/[slug]/page.tsx
// PUBLIC page (no login). Never import @/lib/auth. If a middleware.ts or proxy.ts is ever added, it must allow /i/.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isRegistrationOpen } from '@/lib/dpm-invitation/rules';
import { getEventBySlug } from '@/lib/dpm-invitation/store';
import { ClosedNotice, InvitationShell } from './InvitationShell';
import { InvitationForm } from './InvitationForm';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await getEventBySlug((await params).slug.toLowerCase());
  return { title: event ? event.name : 'Invitation', robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function InvitationPage({ params }: Props) {
  const event = await getEventBySlug((await params).slug.toLowerCase());
  if (!event) notFound();
  const open = isRegistrationOpen(event, new Date());
  return (
    <InvitationShell event={event}>
      <p className="eyebrow">RSVP</p>
      <h1>Confirm your attendance</h1>
      <p className="to">{event.name}</p>
      {open ? (
        <>
          <InvitationForm slug={event.slug} />
          <p className="fine">Your answers are only visible to the DPM event team.</p>
        </>
      ) : <ClosedNotice />}
    </InvitationShell>
  );
}
```

```tsx
// src/app/i/[slug]/InvitationForm.tsx
'use client';
// PUBLIC form. Never import @/lib/auth.
import { useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ALLERGY_NOTES_MAX, EMAIL_MAX, NAME_MAX } from '@/lib/dpm-invitation/rules';
import type { ResponseFieldErrors } from '@/lib/dpm-invitation/types';

type YesNo = '' | 'yes' | 'no';
const GENERIC = 'Something went wrong. Please try again in a minute.';

function Choice({ name, label, help, value, onChange, error, options }: {
  name: 'attending' | 'hasAllergy'; label: string; help: string; value: YesNo; onChange: (v: YesNo) => void; error?: string; options: Array<[YesNo, string]>;
}) {
  const legendId = useId();
  const helpId = `${name}-help`;
  return (
    <fieldset className="field choice-set">
      <legend className="label" id={legendId}>{label}</legend>
      <div className={`choice${error ? ' is-error' : ''}`} role="radiogroup" aria-labelledby={legendId} aria-describedby={helpId}>
        {options.map(([v, text]) => (
          <label key={v} className={value === v ? 'on' : undefined}>
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
            {text}
          </label>
        ))}
      </div>
      {error ? <span className="err" id={helpId}>{error}</span> : <span className="help" id={helpId}>{help}</span>}
    </fieldset>
  );
}

export function InvitationForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [attending, setAttending] = useState<YesNo>('');
  const [hasAllergy, setHasAllergy] = useState<YesNo>('');
  const [allergyNotes, setAllergyNotes] = useState('');
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<ResponseFieldErrors>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setFormError('');
    setErrors({});
    // Hidden answers are never sent: not attending sends no allergy fields at all.
    const body: Record<string, string> = { fullName, email, attending, website };
    if (attending === 'yes') {
      body.hasAllergy = hasAllergy;
      if (hasAllergy === 'yes') body.allergyNotes = allergyNotes;
    }
    try {
      const response = await fetch(`/api/public/dpm-invitations/${encodeURIComponent(slug)}/responses`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; fieldErrors?: ResponseFieldErrors; error?: string };
      if (response.ok && data.ok) {
        router.push(`/i/${slug}/thanks`);
        return;
      }
      if (data.fieldErrors) {
        setErrors(data.fieldErrors);
        const first = Object.keys(data.fieldErrors)[0];
        requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus());
      } else {
        setFormError(data.error || GENERIC);
      }
    } catch {
      setFormError(GENERIC);
    }
    setPending(false);
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate>
      {formError && <div className="notice danger" role="alert">{formError}</div>}
      <div className="field">
        <label className="label" htmlFor="fullName">Full name</label>
        <input className={`input${errors.fullName ? ' is-error' : ''}`} id="fullName" name="fullName" value={fullName} onChange={e => setFullName(e.target.value)}
          autoComplete="name" maxLength={NAME_MAX} required aria-invalid={!!errors.fullName} aria-describedby="fullName-help" />
        {errors.fullName ? <span className="err" id="fullName-help">{errors.fullName}</span> : <span className="help" id="fullName-help">As you would like it to appear on the guest list.</span>}
      </div>
      <div className="field">
        <label className="label" htmlFor="email">Email</label>
        <input className={`input${errors.email ? ' is-error' : ''}`} id="email" name="email" type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)}
          autoComplete="email" maxLength={EMAIL_MAX} required aria-invalid={!!errors.email} aria-describedby="email-help" />
        {errors.email ? <span className="err" id="email-help">{errors.email}</span> : <span className="help" id="email-help">If you submit again with the same email, we will update your answer.</span>}
      </div>
      <Choice name="attending" label="Will you attend?" help="Required." value={attending} onChange={setAttending} error={errors.attending} options={[['yes', 'Yes'], ['no', 'No']]} />
      {attending === 'yes' && (
        <Choice name="hasAllergy" label="Do you have any food allergies?" help="Shared with the event organisers and catering only." value={hasAllergy} onChange={setHasAllergy} error={errors.hasAllergy} options={[['no', 'No'], ['yes', 'Yes']]} />
      )}
      {attending === 'yes' && hasAllergy === 'yes' && (
        <div className="field">
          <label className="label" htmlFor="allergyNotes">What are you allergic to?</label>
          <input className={`input${errors.allergyNotes ? ' is-error' : ''}`} id="allergyNotes" name="allergyNotes" value={allergyNotes} onChange={e => setAllergyNotes(e.target.value)}
            maxLength={ALLERGY_NOTES_MAX} placeholder="e.g. peanuts, shellfish, gluten" autoComplete="off" required aria-invalid={!!errors.allergyNotes} aria-describedby="allergyNotes-help" />
          {errors.allergyNotes ? <span className="err" id="allergyNotes-help">{errors.allergyNotes}</span> : <span className="help" id="allergyNotes-help">Up to {ALLERGY_NOTES_MAX} characters.</span>}
        </div>
      )}
      <div className="hp" aria-hidden="true">
        <label htmlFor="website">Leave this field empty</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
      </div>
      <div><button className="btn" type="submit" disabled={pending}>{pending ? 'Submitting…' : 'Submit'}</button></div>
    </form>
  );
}
```

```tsx
// src/app/i/[slug]/thanks/page.tsx
// PUBLIC page (no login). Never import @/lib/auth. Same text for new and updated answers, no personal data.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isRegistrationOpen } from '@/lib/dpm-invitation/rules';
import { getEventBySlug } from '@/lib/dpm-invitation/store';
import { ClosedNotice, InvitationShell } from '../InvitationShell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Thank you', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function ThanksPage({ params }: { params: Promise<{ slug: string }> }) {
  const event = await getEventBySlug((await params).slug.toLowerCase());
  if (!event) notFound();
  const open = isRegistrationOpen(event, new Date());
  return (
    <InvitationShell event={event}>
      <p className="eyebrow">{event.name}</p>
      <h1>Thank you</h1>
      {open ? (
        <>
          <p className="to">Your response has been recorded. You can submit again with the same email to change it.</p>
          <p className="fine"><Link className="link" href={`/i/${event.slug}`}>Change my answer</Link></p>
        </>
      ) : <ClosedNotice />}
    </InvitationShell>
  );
}
```

```tsx
// src/app/i/[slug]/not-found.tsx
// PUBLIC. Never import @/lib/auth.
import '../invitation.css';

export default function InvitationNotFound() {
  return (
    <div className="pg-dpm-inv">
      <main style={{ maxWidth: 560, margin: '0 auto', padding: '96px 20px' }}>
        <p className="eyebrow">Invitation</p>
        <h1>This invitation link is not valid.</h1>
        <p className="to">Please check the link you were sent, or contact the DPM event team.</p>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test tests/dpm-invitation-public.test.ts tests/dpm-invitation-public-guard.test.ts && npx tsc --noEmit 2>&1 | rg '^(src/|tests/dpm-invitation)'; npm run lint`
Expected: tests PASS, the `rg` prints nothing, lint passes.

- [ ] **Step 5: Commit**

```bash
git add src/app/i tests/dpm-invitation-public.test.ts
git commit -m "feat(dpm): public invitation page, RSVP form and thank you page"
```

---
### Task 10: Admin pages (event list, create form, event detail)

**Files:**
- Create: `src/app/dashboard/dpm/invitation/shared.tsx`
- Create: `src/app/dashboard/dpm/invitation/page.tsx`
- Create: `src/app/dashboard/dpm/invitation/[id]/page.tsx`
- Test: `tests/dpm-invitation-admin-ui.test.ts`

**Interfaces:**
- Consumes: the admin API from Task 7 (`/api/dpm/invitations…`); `PresentedEvent`, `PresentedResponse` (Task 6); `suggestSlug`, `slugIssue`, `formatWib` (Task 3); `POST /api/auth { action: 'check' }` for the role (same as `src/app/dashboard/models/page.tsx`); the dashboard UI kit.
- Produces: `InvitationStatusBadge({ event })`, `readJson(response)`, `ACCEPT_IMAGES`, and the two pages.

- [ ] **Step 1: Write the failing test**

```ts
// tests/dpm-invitation-admin-ui.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const list = readFileSync('src/app/dashboard/dpm/invitation/page.tsx', 'utf8');
const detail = readFileSync('src/app/dashboard/dpm/invitation/[id]/page.tsx', 'utf8');
const shared = readFileSync('src/app/dashboard/dpm/invitation/shared.tsx', 'utf8');

test('list page creates invitations with a WIB closing time and only accepted image types', () => {
  assert.match(list, /'use client'/);
  for (const text of ['New invitation', 'Closes at (WIB)', 'type="datetime-local"', 'accept={ACCEPT_IMAGES}', 'suggestSlug(']) assert.ok(list.includes(text), text);
  assert.match(shared, /ACCEPT_IMAGES = 'image\/jpeg,image\/png,image\/webp'/);
});

test('status badge covers open, closed by hand and closed automatically', () => {
  for (const text of ["'Open'", "'Closed automatically'", "'Closed'"]) assert.ok(shared.includes(text), text);
});

test('detail page offers the approved actions', () => {
  for (const text of ['Copy link', 'Close registration', 'Open registration', 'Export Excel', 'Export CSV', 'Replace image',
    'The old link /i/', 'will stop working', 'Delete invitation', 'Delete this response?']) assert.ok(detail.includes(text), text);
});

test('only admins see Delete invitation; every holder may delete responses', () => {
  assert.match(detail, /\{isAdmin && \(/);
  assert.match(detail, /action: 'check'/);
  assert.match(detail, /method: 'DELETE'/);
  assert.match(detail, /confirm: confirmSlug/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/dpm-invitation-admin-ui.test.ts`
Expected: FAIL with `ENOENT ... src/app/dashboard/dpm/invitation/page.tsx`.

- [ ] **Step 3: Implement**

```tsx
// src/app/dashboard/dpm/invitation/shared.tsx
'use client';
import { StatusBadge } from '@/components/ui/dashboard';
import type { PresentedEvent } from '@/lib/dpm-invitation/present';

export const ACCEPT_IMAGES = 'image/jpeg,image/png,image/webp';

export function InvitationStatusBadge({ event }: { event: Pick<PresentedEvent, 'isOpen' | 'closedReason'> }) {
  if (event.isOpen) return <StatusBadge tone="success" dot>{'Open'}</StatusBadge>;
  if (event.closedReason === 'auto') return <StatusBadge tone="warning" dot>{'Closed automatically'}</StatusBadge>;
  return <StatusBadge tone="neutral" dot>{'Closed'}</StatusBadge>;
}

export async function readJson<T>(response: Response): Promise<T & { error?: string; field?: string }> {
  return (await response.json().catch(() => ({}))) as T & { error?: string; field?: string };
}
```

```tsx
// src/app/dashboard/dpm/invitation/page.tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, DataTableFrame, EmptyState, FormField, LoadingState, PageHeader, PageStack, Panel, TextInput } from '@/components/ui/dashboard';
import type { PresentedEvent } from '@/lib/dpm-invitation/present';
import { formatWib, slugIssue, suggestSlug } from '@/lib/dpm-invitation/rules';
import { ACCEPT_IMAGES, InvitationStatusBadge, readJson } from './shared';

type FieldErrors = Partial<Record<'name' | 'slug' | 'closesAt' | 'image', string>>;

export default function DpmInvitationListPage() {
  const router = useRouter();
  const [events, setEvents] = useState<PresentedEvent[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [closesAt, setClosesAt] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/dpm/invitations', { cache: 'no-store', signal: controller.signal })
      .then(async response => ({ ok: response.ok, data: await readJson<{ events?: PresentedEvent[] }>(response) }))
      .then(({ ok, data }) => {
        if (!ok) setError(data.error || 'Could not load invitations.');
        setEvents(data.events || []);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setError('Could not load invitations.');
        setEvents([]);
      });
    return () => controller.abort();
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = 'Enter an event name.';
    const issue = slugIssue(slug);
    if (issue) errors.slug = issue;
    if (!image) errors.image = 'Choose an invitation image.';
    setFieldErrors(errors);
    if (Object.keys(errors).length || !image) return;
    setSaving(true);
    setError('');
    const form = new FormData();
    form.set('name', name);
    form.set('slug', slug);
    form.set('closesAt', closesAt);
    form.set('image', image);
    const response = await fetch('/api/dpm/invitations', { method: 'POST', body: form });
    const data = await readJson<{ event?: PresentedEvent }>(response);
    setSaving(false);
    if (response.ok && data.event) { router.push(`/dashboard/dpm/invitation/${data.event.id}`); return; }
    if (data.field) setFieldErrors({ [data.field]: data.error });
    else setError(data.error || 'Could not create the invitation.');
  }

  if (!events) return <LoadingState label="Loading invitations" />;

  return (
    <PageStack>
      <PageHeader eyebrow="DPM" title="Invitation" description="Invitation pages for DPM events. Guests answer without logging in."
        actions={<Button variant="primary" onClick={() => setCreating(value => !value)}>{creating ? 'Cancel' : 'New invitation'}</Button>} />
      {error && <Panel padding="compact" className="text-sm text-red-300">{error}</Panel>}

      {creating && (
        <Panel>
          <form onSubmit={create} className="grid gap-4 md:grid-cols-2" noValidate>
            <FormField label="Event name" required error={fieldErrors.name}>
              <TextInput value={name} maxLength={120} placeholder="DPM Gala Dinner 2027" onChange={e => {
                setName(e.target.value);
                if (!slugTouched) setSlug(suggestSlug(e.target.value));
              }} />
            </FormField>
            <FormField label="Link name" hint={`/i/${slug || 'your-link'}`} required error={fieldErrors.slug}>
              <TextInput value={slug} maxLength={60} onChange={e => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }} />
            </FormField>
            <FormField label="Closes at (WIB)" hint="Optional" error={fieldErrors.closesAt}>
              <TextInput type="datetime-local" value={closesAt} onChange={e => setClosesAt(e.target.value)} />
            </FormField>
            <FormField label="Invitation image" hint="JPG, PNG or WebP, up to 8 MB" required error={fieldErrors.image}>
              <input type="file" accept={ACCEPT_IMAGES} className="block w-full text-sm text-[var(--mos-text-secondary)]" onChange={e => setImage(e.target.files?.[0] ?? null)} />
            </FormField>
            <div className="md:col-span-2">
              <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create invitation'}</Button>
            </div>
          </form>
        </Panel>
      )}

      <DataTableFrame title="Invitations">
        {events.length === 0 ? (
          <EmptyState title="No invitations yet" description="Create one, then share its link with employees."
            action={<Button variant="primary" onClick={() => setCreating(true)}>New invitation</Button>} />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] text-[var(--mos-text-muted)]">
              <tr>{['Event', 'Link', 'Status', 'Responses', 'Attending', 'Allergies', 'Closes at', 'Last response'].map(h => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {events.map(event => (
                <tr key={event.id} className="border-t border-[var(--mos-border-subtle)]">
                  <td className="px-5 py-3"><Link className="font-medium text-[var(--mos-text)] hover:underline" href={`/dashboard/dpm/invitation/${event.id}`}>{event.name}</Link></td>
                  <td className="px-5 py-3 text-[var(--mos-text-muted)]">{event.publicPath}</td>
                  <td className="px-5 py-3"><InvitationStatusBadge event={event} /></td>
                  <td className="px-5 py-3">{event.counts?.total ?? 0}</td>
                  <td className="px-5 py-3">{event.counts?.attending ?? 0}</td>
                  <td className="px-5 py-3">{event.counts?.withAllergies ?? 0}</td>
                  <td className="px-5 py-3 text-[var(--mos-text-muted)]">{event.closesAtWib ?? '—'}</td>
                  <td className="px-5 py-3 text-[var(--mos-text-muted)]">{event.lastResponseAt ? formatWib(new Date(event.lastResponseAt)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataTableFrame>
    </PageStack>
  );
}
```

```tsx
// src/app/dashboard/dpm/invitation/[id]/page.tsx
'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  Button, DataTableFrame, EmptyState, FilterGroup, FormField, LoadingState, MetricCard, PageHeader, PageStack, Panel, Select, TextInput, Toolbar,
} from '@/components/ui/dashboard';
import type { PresentedEvent, PresentedResponse } from '@/lib/dpm-invitation/present';
import type { ResponseCounts, ResponseFilter } from '@/lib/dpm-invitation/types';
import { ACCEPT_IMAGES, InvitationStatusBadge, readJson } from '../shared';

const FILTERS: Array<[ResponseFilter, string]> = [['all', 'All'], ['attending', 'Attending'], ['not-attending', 'Not attending'], ['allergy', 'Has allergies']];

export default function DpmInvitationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<PresentedEvent | null>(null);
  const [counts, setCounts] = useState<ResponseCounts | null>(null);
  const [responses, setResponses] = useState<PresentedResponse[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [filter, setFilter] = useState<ResponseFilter>('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [confirmSlug, setConfirmSlug] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const applyEvent = useCallback((next: PresentedEvent) => {
    setEvent(next);
    setName(next.name);
    setSlug(next.slug);
    setClosesAt(next.closesAtInput);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/dpm/invitations/${id}`, { cache: 'no-store', signal: controller.signal }).then(r => readJson<{ event?: PresentedEvent }>(r).then(d => ({ ok: r.ok, d }))),
      fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check' }), signal: controller.signal }).then(r => r.json()),
    ]).then(([result, auth]) => {
      if (controller.signal.aborted) return;
      if (!result.ok || !result.d.event) { setError(result.d.error || 'Invitation not found.'); return; }
      applyEvent(result.d.event);
      setIsAdmin(auth.user?.role === 'admin');
    }).catch(() => { if (!controller.signal.aborted) setError('Could not load the invitation.'); });
    return () => controller.abort();
  }, [id, applyEvent]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const query = new URLSearchParams({ q: debouncedQ, filter }).toString();
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/dpm/invitations/${id}/responses?${query}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => ({ ok: response.ok, data: await readJson<{ counts?: ResponseCounts; responses?: PresentedResponse[] }>(response) }))
      .then(({ ok, data }) => {
        if (!ok) { setError(data.error || 'Could not load responses.'); return; }
        setCounts(data.counts || null);
        setResponses(data.responses || []);
      })
      .catch(() => { if (!controller.signal.aborted) setError('Could not load responses.'); });
    return () => controller.abort();
  }, [id, query, reloadKey]);

  async function patch(body: Record<string, unknown>, done: string) {
    setBusy(true); setError(''); setNotice('');
    const response = await fetch(`/api/dpm/invitations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await readJson<{ event?: PresentedEvent }>(response);
    setBusy(false);
    if (!response.ok || !data.event) { setError(data.error || 'Could not save.'); return; }
    applyEvent(data.event);
    setNotice(done);
  }

  async function replaceImage(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(''); setNotice('');
    const form = new FormData();
    form.set('image', file);
    const response = await fetch(`/api/dpm/invitations/${id}/image`, { method: 'PUT', body: form });
    const data = await readJson<{ event?: PresentedEvent }>(response);
    setBusy(false);
    if (!response.ok || !data.event) { setError(data.error || 'Could not replace the image.'); return; }
    applyEvent(data.event);
    setNotice('Image replaced.');
  }

  async function deleteOne(row: PresentedResponse) {
    if (!window.confirm(`Delete this response? ${row.fullName} (${row.email}) will be removed.`)) return;
    const response = await fetch(`/api/dpm/invitations/${id}/responses/${row.id}`, { method: 'DELETE' });
    if (!response.ok) { setError((await readJson(response)).error || 'Could not delete the response.'); return; }
    setNotice('Response deleted.');
    setReloadKey(key => key + 1);
  }

  async function deleteInvitation() {
    if (!event || confirmSlug !== event.slug) return;
    const response = await fetch(`/api/dpm/invitations/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: confirmSlug }) });
    if (!response.ok) { setError((await readJson(response)).error || 'Could not delete the invitation.'); return; }
    router.push('/dashboard/dpm/invitation');
  }

  async function copyLink() {
    if (!event) return;
    await navigator.clipboard.writeText(`${window.location.origin}${event.publicPath}`);
    setNotice('Link copied.');
  }

  if (!event) return error ? <PageStack><EmptyState title={error} action={<Link href="/dashboard/dpm/invitation">Back to invitations</Link>} /></PageStack> : <LoadingState label="Loading invitation" />;

  const slugChanged = slug.trim().toLowerCase() !== event.slug;
  const exportHref = (format: 'xlsx' | 'csv') => `/api/dpm/invitations/${id}/export?format=${format}&${query}`;

  return (
    <PageStack>
      <PageHeader eyebrow="DPM Invitation" title={event.name} description={event.publicPath}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <InvitationStatusBadge event={event} />
            <Button size="sm" onClick={copyLink}>Copy link</Button>
            <a href={event.publicPath} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost">Open page</Button></a>
            {event.status === 'open'
              ? <Button size="sm" disabled={busy} onClick={() => patch({ status: 'closed' }, 'Registration closed.')}>Close registration</Button>
              : <Button size="sm" variant="primary" disabled={busy} onClick={() => patch({ status: 'open' }, 'Registration opened.')}>Open registration</Button>}
          </div>
        )} />
      {error && <Panel padding="compact" className="text-sm text-red-300">{error}</Panel>}
      {notice && <Panel padding="compact" className="text-sm text-emerald-300">{notice}</Panel>}
      {event.status === 'open' && event.closedReason === 'auto' && (
        <Panel padding="compact" className="text-sm text-amber-200">The closing time has passed. Clear or move “Closes at (WIB)” to accept answers again.</Panel>
      )}

      <Panel padding="none" className="grid grid-cols-2 md:grid-cols-4">
        <MetricCard label="Responses" value={counts?.total ?? 0} />
        <MetricCard label="Attending" value={counts?.attending ?? 0} />
        <MetricCard label="Not attending" value={counts?.notAttending ?? 0} />
        <MetricCard label="With allergies" value={counts?.withAllergies ?? 0} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <Panel>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Event name"><TextInput value={name} maxLength={120} onChange={e => setName(e.target.value)} /></FormField>
            <FormField label="Link name" hint={`/i/${slug}`}
              error={slugChanged ? `The old link /i/${event.slug} will stop working. Anyone with it will see “This invitation link is not valid.”` : undefined}>
              <TextInput value={slug} maxLength={60} onChange={e => setSlug(e.target.value.toLowerCase())} />
            </FormField>
            <FormField label="Closes at (WIB)" hint={event.closesAtWib ?? 'No closing time'}>
              <TextInput type="datetime-local" value={closesAt} onChange={e => setClosesAt(e.target.value)} />
            </FormField>
            <div className="flex items-end gap-2">
              <Button variant="primary" disabled={busy} onClick={() => patch({ name, slug, closesAt }, 'Saved.')}>Save changes</Button>
              {closesAt && <Button variant="ghost" disabled={busy} onClick={() => patch({ closesAt: '' }, 'Closing time cleared.')}>Clear closing time</Button>}
            </div>
          </div>
        </Panel>
        <Panel padding="none" className="p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={event.imageUrl} alt={event.name} width={event.imageWidth} height={event.imageHeight} className="h-auto w-full rounded" />
          <label className="mt-3 block text-xs text-[var(--mos-text-secondary)]">
            Replace image
            <input type="file" accept={ACCEPT_IMAGES} disabled={busy} className="mt-2 block w-full text-xs" onChange={e => void replaceImage(e.target.files?.[0])} />
          </label>
        </Panel>
      </div>

      <Toolbar>
        <FilterGroup>
          <TextInput className="max-w-xs" placeholder="Search name or email" value={q} onChange={e => setQ(e.target.value)} />
          <Select value={filter} onChange={e => setFilter(e.target.value as ResponseFilter)}>
            {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </FilterGroup>
        <div className="flex gap-2">
          <a href={exportHref('xlsx')}><Button size="sm">Export Excel</Button></a>
          <a href={exportHref('csv')}><Button size="sm" variant="ghost">Export CSV</Button></a>
        </div>
      </Toolbar>

      <DataTableFrame title="Responses" description={`${responses.length} shown`}>
        {responses.length === 0 ? (
          <EmptyState title={debouncedQ || filter !== 'all' ? 'No responses match' : 'No responses yet'} description="Share the link to collect answers." />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] text-[var(--mos-text-muted)]">
              <tr>{['Full name', 'Email', 'Attending', 'Allergy', 'Allergy notes', 'Updated', 'Submissions', ''].map(h => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {responses.map(row => (
                <tr key={row.id} className="border-t border-[var(--mos-border-subtle)]">
                  <td className="px-5 py-3 text-[var(--mos-text)]">{row.fullName}</td>
                  <td className="px-5 py-3 text-[var(--mos-text-muted)]">{row.email}</td>
                  <td className="px-5 py-3">{row.attending ? 'Yes' : 'No'}</td>
                  <td className="px-5 py-3">{row.hasAllergy === null ? '—' : row.hasAllergy ? 'Yes' : 'No'}</td>
                  <td className="px-5 py-3 text-[var(--mos-text-muted)]">{row.allergyNotes ?? '—'}</td>
                  <td className="px-5 py-3 text-[var(--mos-text-muted)]">{row.updatedAtWib}</td>
                  <td className="px-5 py-3">{row.submissionCount}</td>
                  <td className="px-5 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => void deleteOne(row)}>Delete</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataTableFrame>

      {isAdmin && (
        <Panel className="border-red-400/20">
          <p className="text-sm font-medium text-red-300">Delete invitation</p>
          <p className="mt-1 text-xs text-[var(--mos-text-muted)]">Deletes the page, the image and all {counts?.total ?? 0} responses. This cannot be undone. Type <strong>{event.slug}</strong> to confirm.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <TextInput className="max-w-xs" value={confirmSlug} onChange={e => setConfirmSlug(e.target.value)} placeholder={event.slug} />
            <Button variant="danger" disabled={confirmSlug !== event.slug} onClick={() => void deleteInvitation()}>Delete invitation</Button>
          </div>
        </Panel>
      )}
    </PageStack>
  );
}
```

- [ ] **Step 4: Run the tests and type check**

Run: `npx tsx --test tests/dpm-invitation-admin-ui.test.ts && npx tsc --noEmit 2>&1 | rg '^(src/|tests/dpm-invitation)'; npm run lint`
Expected: tests PASS, the `rg` prints nothing, lint passes.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/dpm tests/dpm-invitation-admin-ui.test.ts
git commit -m "feat(dpm): admin pages for invitations and responses"
```

---
### Task 11: Full verification, draft PR and release (release needs Bayu's OK)

**Files:** none new.

- [ ] **Step 1: Run the full test suite with PostgreSQL**

Run: `SETTLEMENT_TEST_DATABASE_URL=postgres://settlement:settlement@127.0.0.1:5432/settlement_phase2 npx tsx --test tests/*.test.ts`
Expected: every test passes and the two `-pg` DPM files run (not skipped). Use a freshly created throwaway local database, never production. A database reused across runs can fail the older `model-tiers-pg` migration 051 test for reasons that have nothing to do with this feature; drop and recreate it before the run.

- [ ] **Step 2: Type check, lint and build**

Run: `npx tsc --noEmit 2>&1 | rg '^(src/|tests/dpm-invitation)'; npm run lint && npm run build`
Note: on main `948c005`, `npm run build` already fails before reaching DPM code, because `src/app/api/generate-image/route.ts` and `src/app/api/generated-images/[filename]/route.ts` export helpers (`explainQuotaFailure`, `explainImageFailure`, `respondGeneratedImage`) that Next does not allow in a route file. That is not part of this feature: if main is still broken, report it to Bayu and do not fix it in this PR. The DPM route and page files export only `dynamic`, HTTP handlers, `metadata`, `generateMetadata` and `default`.
Expected (once main builds): the `rg` prints nothing, lint passes, and the build lists `/i/[slug]`, `/i/[slug]/thanks`, `/i/[slug]/image`, `/api/public/dpm-invitations/[slug]/responses`, `/dashboard/dpm/invitation` and `/dashboard/dpm/invitation/[id]`.

- [ ] **Step 3: Manual checks on a local run (`npm run db:migrate && npm run dev`)**

- [ ] As admin: Accounts shows "DPM Invitation"; a new department does not get it by default; the sidebar shows DPM → Invitation only for holders.
- [ ] Create an invitation with the sample portrait image (keep the image outside the repo). The list shows it as Open.
- [ ] In a private window, open `/i/<slug>`: no login, the image is on the left on desktop and on top on mobile, and the allergy questions appear only after "Yes" and "Yes".
- [ ] Submit "No": the stored row has empty allergy fields. Submit again with the same email in other letter case: one row, Submissions = 2.
- [ ] Set "Closes at (WIB)" two minutes ahead; after it passes, the public page shows the closed notice and the admin badge reads "Closed automatically". Clearing the time reopens it.
- [ ] Close registration by hand: the public POST returns 403.
- [ ] Changing the link name shows the warning; the old `/i/<old>` shows "This invitation link is not valid."
- [ ] Search, filters and Export Excel/CSV give the same rows; the CSV opens in Excel with the names intact.
- [ ] A non-admin holder can delete a response but sees no Delete invitation panel; a DELETE on the event as that user returns 403.
- [ ] View source of the public page: `noindex` and `no-referrer` are present, and no response data appears.

- [ ] **Step 4: Push and open a draft PR**

```bash
git push -u origin feat/dpm-invitation
gh pr create --repo gorillaworkout/marketingOS --draft --base main --head feat/dpm-invitation \
  --title "feat: DPM Invitation" --body "Implements docs/superpowers/specs/2026-11-23-dpm-invitation-design.md. Migration 068. Waiting for Bayu's review."
```

- [ ] **Step 5: Release (only after Bayu's explicit OK in his own words)**

1. Take a production database backup with `pg_dump` on the VPS into the usual backup folder, and confirm the file is not empty. Never print `DATABASE_URL`.
2. Merge the PR (Bayu's OK covers this step only).
3. Deploy as usual, then run `npm run db:migrate` on the VPS and check that `schema_migrations` lists `068_dpm_invitation.sql`.
4. Confirm `data/dpm-invitations/` exists and is writable by the app user, and `pm2 restart marketingos`.
5. Smoke test on https://marketing-aws.gorillaworkout.id: open the dashboard page, create a test invitation, submit once from a phone, then delete the test invitation.
6. Rollback if needed: run `db/rollbacks/068_dpm_invitation_down.sql` and restore the backup if data was touched.

---

## Self-review

- **Spec coverage:** feature wiring and the Accounts label (Task 1); schema, the DPM department and rollback (Task 2); validation, slug rules, `closes_at` in WIB, the open check and rate limits with the Cloudflare-aware IP (Task 3); image rules (Task 4); upsert by normalized email, search with escaped wildcards, scoped response delete (Task 5); exports with the formula guard, the admin-only event delete and the submit order (Task 6); every admin endpoint with no-store (Task 7); the public routes with no auth import (Task 8); the public page, conditional form, honeypot, closed notice and Thank you text (Task 9); the admin list and detail with the slug warning, automatic-close badge and role-gated delete (Task 10); release with backup (Task 11). The pre-coding IP check is done (Task 0); the security group check stays with Bayu.
- **Verified on a scratch copy of main (2026-11-23):** Tasks 1–10 were extracted from this plan and run: all 34 DPM tests passed, including both PostgreSQL tests against a local PostgreSQL 17; `tsc` reported nothing for `src/` or the new tests; ESLint passed on every new file. PostgreSQL caught a bug that is fixed above: in the response CHECK, `has_allergy = TRUE` and `char_length(NULL)` are NULL, which a CHECK treats as passing, so the constraint uses `IS TRUE` / `IS FALSE` and `allergy_notes IS NOT NULL`.
- **Older tests:** Task 1 updates `google-ads-access`, `partnership-access` and `seo-os` tests, which pin the feature list and the department filter. Task 8 adds the public submit route to `PUBLIC_ROUTES` in `feature-route-gates`.
- **Type names:** `PresentedEvent`, `PresentedResponse`, `ResponseCounts`, `ResponseFilter`, `ResponseFieldErrors`, `ImageInput` and `SubmitDeps` are used with the same names and fields in every task.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-23-dpm-invitation.md`. Two ways to run it:

1. **Subagent-driven (recommended):** a fresh subagent for each task, with a review between tasks. Uses superpowers:subagent-driven-development.
2. **Inline:** run the tasks in one session with checkpoints. Uses superpowers:executing-plans.

Either way, nothing is merged or deployed without Bayu's explicit OK and a production backup.
