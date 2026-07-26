# MarketingOS — Enterprise Multi-Department Expansion Plan

> **For Hermes:** Use subagent-driven-development to implement this plan task-by-task.
>
> **Goal:** Transform MarketingOS from a single-team content tool into an enterprise-grade multi-department platform with per-user token accounting, provider cost attribution, department budgets, and admin oversight.

**Architecture:** Extend existing token_logs schema with provider/source metadata, add department-budget and user-level spending limits in a new `usage_policies` table, build admin analytics dashboard, and create department-admin role with scoped management.

**Tech Stack:** Next.js 16.2, PostgreSQL (existing), sql.js (dev), Tailwind, existing auth/department system.

---

## Phase 0: Audit Current State

### What Exists Now

| Area | Status |
|------|--------|
| **Auth** | Session-based, role=admin/member, department_id on users |
| **Departments** | Marketing/Settlement/Finance, each has `permitted_features` |
| **Token Logs** | Tracks user_id, model, input/output tokens, cost, task_id |
| **Token Page** | Per-user: total tokens, total cost, task count, last 50 logs |
| **Model Provider** | openrouter, codex, claude-code — **not logged** in token_logs |
| **No Budgets** | No spending caps, no department quotas, no alerts |
| **No Admin Analytics** | Admin cannot see cross-user/cross-department usage |
| **No Provider Cost Attribution** | Codex/Claude costs logged as $0 (included in subscription) |

### What's Missing

1. `provider` column in token_logs
2. `account_id` or `source` to distinguish personal vs office billing
3. Department-level spending view
4. Per-user/per-department budget/limit system
5. Admin analytics dashboard (who uses most, which model, which provider)
6. Alerts/thresholds (user exceeds N tokens/month)
7. Department admin role (can see own dept only)
8. Exportable usage reports

---

## Phase 1: Token Log Enrichment

### Task 1.1: Add provider & source columns to token_logs

**Objective:** Every token log records which provider and account source was used.

**Files:**
- Create: `db/migrations/005_token_log_provider.sql`
- Modify: `src/lib/openai.ts` (all `INSERT INTO token_logs` calls ~4 locations)

**Step 1: Write migration**

```sql
-- 005_token_log_provider.sql
ALTER TABLE token_logs ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'openrouter';
ALTER TABLE token_logs ADD COLUMN IF NOT EXISTS account_source TEXT NOT NULL DEFAULT 'office';
ALTER TABLE token_logs ADD COLUMN IF NOT EXISTS department_id TEXT REFERENCES departments(id);
ALTER TABLE token_logs ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT '';

-- Index for admin analytics queries
CREATE INDEX IF NOT EXISTS idx_token_logs_provider ON token_logs(provider);
CREATE INDEX IF NOT EXISTS idx_token_logs_department ON token_logs(department_id);
CREATE INDEX IF NOT EXISTS idx_token_logs_created_at ON token_logs(created_at);

UPDATE token_logs
SET department_id = (SELECT department_id FROM users WHERE users.id = token_logs.user_id)
WHERE department_id IS NULL;

UPDATE token_logs
SET task_type = (SELECT type FROM tasks WHERE tasks.id = token_logs.task_id)
WHERE task_id IS NOT NULL AND task_type = '';
```

**Step 2: Update all INSERT INTO token_logs calls**

In `src/lib/openai.ts`, find every `INSERT INTO token_logs` and add `provider`, `account_source`, `department_id`, `task_type`. There are approximately 4 locations (lines ~458, ~584, plus 2 in the image generation / video script providers).

The provider value comes from `getModelProvider(model)` — a function that already exists.

The account_source logic:
- `openrouter` → `'personal'` (Bayu's personal OpenRouter account)
- `codex` → `'office'` (ChatGPT Plus office subscription)
- `claude-code` → `'office'` (Claude Team office subscription)

**Step 3: Run migration & test**

```bash
# Apply migration to local dev
psql $DATABASE_URL -f db/migrations/005_token_log_provider.sql

# Run existing tests to ensure no regression
npx --no-install tsx --test tests/*.test.ts
```

**Step 4: Commit**

```bash
git add db/migrations/005_token_log_provider.sql src/lib/openai.ts
git commit -m "feat: enrich token_logs with provider, source, department"
```

---

### Task 1.2: Backfill historical logs

**Objective:** Fill provider/source/department for existing token logs.

**Files:**
- Create: `db/migrations/006_token_log_backfill.sql`

```sql
-- 006_token_log_backfill.sql
-- Set provider based on model prefix
UPDATE token_logs SET provider = 'codex'
WHERE model IN ('gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna')
  AND provider = 'openrouter';

UPDATE token_logs SET provider = 'claude-code'
WHERE model IN ('haiku', 'sonnet', 'opus')
  AND provider = 'openrouter';

-- Set account source based on provider
UPDATE token_logs SET account_source = 'office'
WHERE provider IN ('codex', 'claude-code');

UPDATE token_logs SET account_source = 'personal'
WHERE provider = 'openrouter';

-- Refresh department_id from users table
UPDATE token_logs t
SET department_id = (SELECT u.department_id FROM users u WHERE u.id = t.user_id)
WHERE t.department_id IS NULL;

-- Fill task_type from tasks
UPDATE token_logs t
SET task_type = (SELECT tk.type FROM tasks tk WHERE tk.id = t.task_id)
WHERE t.task_id IS NOT NULL AND t.task_type = '';
```

---

## Phase 2: Token Usage Admin Dashboard

### Task 2.1: Create admin usage analytics API

**Objective:** Admin-only API returning aggregated usage data across users, departments, providers.

**Files:**
- Modify: `src/app/api/dashboard/tokens/route.ts` (extend with admin aggregation queries)
- Or Create: `src/app/api/admin/usage/route.ts` (separate endpoint, cleaner)

**API Endpoints:**

```
GET /api/admin/usage/summary
→ { totalTokens, totalCost, activeUsers, avgTokensPerUser, topProvider, periodStart, periodEnd }

GET /api/admin/usage/by-user?period=month&limit=10
→ [{ userId, username, department, totalTokens, totalCost, taskCount, topModel }]

GET /api/admin/usage/by-department?period=month
→ [{ department, totalTokens, totalCost, userCount, taskCount }]

GET /api/admin/usage/by-provider?period=month
→ [{ provider, accountSource, totalTokens, totalCost, modelBreakdown: [{model, tokens, cost}] }]

GET /api/admin/usage/top-users?sort=cost&limit=5
→ [{ userId, username, department, totalCost, totalTokens }]

GET /api/admin/usage/export?period=last3months&format=csv
→ CSV file download
```

**Authorization:** All endpoints guarded by `role === 'admin'`.

**Step 1: Write failing tests**
Create `tests/admin-usage-api.test.ts` with cases:
- Non-admin gets 403
- Admin gets summary
- by-user returns sorted data
- by-provider shows cost attribution

**Step 2: Implement endpoints**

```typescript
// src/app/api/admin/usage/summary/route.ts
// src/app/api/admin/usage/by-user/route.ts
// src/app/api/admin/usage/by-department/route.ts
// src/app/api/admin/usage/by-provider/route.ts
// src/app/api/admin/usage/top-users/route.ts
// src/app/api/admin/usage/export/route.ts
```

**Step 3: Run tests & build**

```bash
npx --no-install tsx --test tests/admin-usage-api.test.ts
npm run build
```

---

### Task 2.2: Create Usage Analytics page

**Objective:** Full admin analytics page with charts and tables.

**Files:**
- Create: `src/app/dashboard/analytics/page.tsx`

**UI Sections:**

1. **Summary Cards** (4 across)
   - Total tokens consumed (month)
   - Total cost (month)
   - Active users
   - Avg tokens per user

2. **Top Spenders** (table, sortable by cost/tokens)
   - Rank, Username, Department, Tokens, Cost, Top Model, Tasks

3. **Department Usage** (table)
   - Department, Users, Tokens, Cost, % of total

4. **Provider Attribution** (table)
   - Provider, Source (personal/office), Tokens, Cost, Model breakdown

5. **Usage Over Time** (simple — last 6 months)
   - Month, Tokens, Cost

6. **Export button** — downloads CSV

**Sidebar:** Add to Admin section in `src/app/dashboard/layout.tsx`

```typescript
// In adminItems array
{ href: '/dashboard/analytics', label: 'Usage Analytics', icon: '📊' },
```

---

### Task 2.3: Department admin role

**Objective:** Department-level admins who can see their own department's usage but not other departments'.

**Files:**
- Modify: `src/lib/authorization.ts` (add `department_admin` role check)
- Modify: `src/app/api/admin/usage/*/route.ts` (filter by department for dept admins)
- Modify: `src/app/api/admin/departments/route.ts` (dept admin can manage own dept members)

**Database change:** Add `role` options:
- Current: `admin`, `member`
- New: `admin`, `department_admin`, `member`

**Authorization logic:**
```typescript
// department_admin can see own department's data only
if (user.role === 'department_admin' && user.department_id) {
  // Filter queries to this department
  WHERE department_id = ?
}
```

---

## Phase 3: Budget & Quota System

### Task 3.1: Create usage_policies table

**Objective:** Per-user and per-department spending limits with notification thresholds.

**Files:**
- Create: `db/migrations/007_usage_policies.sql`

```sql
CREATE TABLE IF NOT EXISTS usage_policies (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('user', 'department')),
  scope_id TEXT NOT NULL,  -- user_id or department_id
  monthly_token_limit BIGINT NOT NULL DEFAULT -1,  -- -1 = unlimited
  monthly_cost_limit DOUBLE PRECISION NOT NULL DEFAULT -1,
  warn_at_percent INTEGER NOT NULL DEFAULT 80,  -- warn when 80% of limit reached
  hard_block BOOLEAN NOT NULL DEFAULT FALSE,  -- block generation when exceeded
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scope, scope_id)
);

-- Allow provider-specific overrides per user
CREATE TABLE IF NOT EXISTS user_provider_limits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK(provider IN ('openrouter', 'codex', 'claude-code')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  monthly_cost_limit DOUBLE PRECISION NOT NULL DEFAULT -1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, provider)
);
```

### Task 3.2: Budget enforcement middleware

**Objective:** Check limits before every generation, block or warn as configured.

**Files:**
- Create: `src/lib/usage-checks.ts`
- Modify: All generation endpoints to call `checkGenerationAllowed(userId)`

**Implementation:**
```typescript
// src/lib/usage-checks.ts

interface UsageCheckResult {
  allowed: boolean;
  reason?: string;
  current: { tokens: number; cost: number };
  limit: { tokens: number; cost: number };
  percentUsed: number;
}

async function checkGenerationAllowed(
  userId: string,
  provider?: string
): Promise<UsageCheckResult> {
  // 1. Get user's department
  // 2. Get user's usage this month
  // 3. Get usage_policies for user and department
  // 4. Check thresholds
  // 5. If hard_block && exceeded → blocked
  // 6. If warn_at_percent → return warning
  // 7. Check user_provider_limits if provider specified
  // 8. Return { allowed: true/false, ... }
}
```

### Task 3.3: Budget management UI

**Objective:** Admin can set budgets per user and department.

**Files:**
- Modify: `src/app/dashboard/accounts/page.tsx` (add budget fields)
- Create: sub-section for usage policies

**UI Elements:**
- Per user: token limit, cost limit, enabled providers toggle
- Per department: shared budget, allocation across members
- Visual: progress bar showing current month usage vs limit

---

## Phase 4: Provider Account Management

### Task 4.1: Multi-account provider support

**Objective:** Support multiple API keys/accounts per provider and attribute costs to the right account.

**Files:**
- Create: `src/lib/provider-accounts.ts`
- Modify: `db/migrations/008_provider_accounts.sql`

```sql
CREATE TABLE IF NOT EXISTS provider_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('openrouter', 'openai', 'anthropic')),
  label TEXT NOT NULL,  -- e.g. "Bayu Personal", "Office ChatGPT", "Claude Team"
  account_type TEXT NOT NULL CHECK(account_type IN ('personal', 'office')),
  api_key_encrypted TEXT,  -- encrypted storage, never plaintext
  priority INTEGER NOT NULL DEFAULT 0,  -- lower = tried first
  monthly_budget DOUBLE PRECISION,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

This is a stretch goal — requires secure key storage infrastructure and careful credential management. Skip for MVP.

---

## Phase 5: Alerts & Notifications

### Task 5.1: Monthly usage summary email

**Objective:** Auto-generated monthly report sent to admin with:
- Total consumption, cost, trends
- Top spenders
- Department breakdown
- Anomalies (sudden spike)

**Files:**
- Create: `src/lib/usage-reports.ts`
- Create: cron endpoint or scheduled task

### Task 5.2: Real-time alerts

**Objective:** Notify admin when:
- A user exceeds 80% of monthly budget
- A department hits its limit
- Token usage spikes >200% compared to previous month

**Files:**
- Modify: `src/lib/usage-checks.ts` (add alert dispatch)
- Create: `src/app/api/admin/usage/alerts/route.ts`

---

## Phase 6: Multi-Department Extensions

### Task 6.1: Department-specific model defaults

**Objective:** Each department can set default model/provider for generators.

**Files:**
- Modify: `db/migrations/009_department_preferences.sql`

```sql
CREATE TABLE IF NOT EXISTS department_preferences (
  department_id TEXT PRIMARY KEY REFERENCES departments(id),
  default_model TEXT,
  default_provider TEXT,
  allowed_providers TEXT[] NOT NULL DEFAULT ARRAY['openrouter', 'codex', 'claude-code'],
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Task 6.2: Department-specific brand guidelines

**Objective:** Each department maintains its own brand guidelines, tone, and templates.

**Files:**
- Modify: `db/migrations/010_department_brand.sql`
- Modify: `src/app/api/brand-guidelines/route.ts` (add department filter)
- Modify: `src/lib/openai.ts` (load department-specific guidelines during generation)

### Task 6.3: Cross-department content approval flow

**Objective:** Content generated by Department A needs approval from Department B before publishing (e.g., Legal/Compliance).

**Files:**
- Create: `db/migrations/011_content_approval.sql`
- Create: `src/app/api/approvals/route.ts`
- Create: `src/app/dashboard/approvals/page.tsx`

---

## Implementation Priority

| Priority | Phase | Effort | Value |
|----------|-------|--------|-------|
| 🔴 P0 | Phase 1 — Token Log Enrichment | Small | Enables everything else |
| 🔴 P0 | Phase 2 — Admin Analytics | Medium | See who's using what |
| 🟡 P1 | Phase 3 — Budget System | Medium | Control costs |
| 🟡 P1 | Phase 2.3 — Dept Admin Role | Small | Department autonomy |
| 🟢 P2 | Phase 6.1 — Dept Model Defaults | Small | Department customization |
| 🟢 P2 | Phase 5 — Alerts | Medium | Proactive monitoring |
| 🔵 P3 | Phase 4 — Multi-Account | Large | Advanced cost attribution |
| 🔵 P3 | Phase 6.2+6.3 — Dept Brand/Approval | Large | Full enterprise workflow |

---

## Key Design Decisions

1. **Provider logged at generation time** — not inferred from model later. Every `INSERT INTO token_logs` must include explicit `provider` value from `getModelProvider()`.

2. **account_source = 'personal' | 'office'** — simple binary that maps to Bayu's billing reality: OpenRouter = personal wallet, Codex/Claude = office subscription.

3. **Budgets stored per-month, checked per-request** — simple threshold check before each generation is fast (<5ms query). No need for real-time streaming aggregation.

4. **Department admin does NOT replace main admin** — department_admin sees only own department's usage/users. Main admin sees everything.

5. **No encryption for API keys in MVP** — Phase 4 (multi-account) uses env vars only. Encrypted key storage is a later concern.

---

## Risks & Open Questions

- **Q:** Should `account_source` be configurable per-user? E.g., a Marketing team member could use either personal OpenRouter or office Codex.
- **Q:** Codex/Claude logged as $0 cost — how to attribute "value" for subscription-based providers? Estimated token equivalent cost?
- **Q:** Hard-block vs soft-warn — when a user exceeds budget, should they still be able to generate with their own OpenRouter key?
- **Q:** Migration to production — needs `psql` access on AWS to run SQL files. Ensure migration scripts are idempotent.
- **Risk:** Backfilling 1000s of existing token_logs rows may lock the table briefly. Run during low-usage period.
- **Risk:** Adding columns to a large `token_logs` table is cheap in PostgreSQL (metadata-only), but the backfill UPDATE queries need careful testing.

---

## Verification Plan

```bash
# Each phase
npx --no-install tsx --test tests/*.test.ts    # All tests pass
npm run build                                    # Build succeeds
git diff --check                                 # No whitespace issues
git commit -m "phase: ..."                       # Atomic commits
```

Production deployment (from office IP):
```bash
cd /home/ubuntu/apps/marketingos
git pull --ff-only origin main
psql $DATABASE_URL -f db/migrations/005_token_log_provider.sql
# ... repeat for each migration
npm ci && npm run build && pm2 restart marketingos
```
