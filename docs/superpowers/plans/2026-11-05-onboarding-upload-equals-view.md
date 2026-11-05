# Onboarding Reports view = upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone who can open Onboarding Reports (admin, department feature `monthly-report`, or personal grant) can also upload; Access page drops the separate Upload toggle.

**Architecture:** Collapse upload gate onto the existing view predicate in `canUploadMonthlyReport`. Keep DB column `can_upload` but always write `true` on personal grants; ignore it in auth checks. Simplify Access UI to one Personal access control.

**Tech Stack:** Next.js (App Router), TypeScript, node:test, Postgres (`monthly_report_access`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-05-onboarding-upload-equals-view-design.md`
- No migration to drop `can_upload`.
- Scope: Onboarding Reports access only — do not change FTD parsing/KPI/rejection logic beyond the shared upload gate.
- UI copy in English; commit messages concise.
- Branch: `feat/onboarding-upload-equals-view` (already exists with the design spec commit). Open a PR to `main` when done.
- Squash-merge only after Bayu OK (coordinator handles merge).

## File map

| File | Role |
|------|------|
| `src/lib/monthly-report/access.ts` | View/upload predicates |
| `tests/monthly-report-access.test.ts` | Unit tests for those predicates |
| `tests/monthly-report-ftd-daily.test.ts` | Permissions assertions that currently require `monthlyReportUpload` |
| `src/app/dashboard/monthly-report/access/page.tsx` | Access admin UI |
| `src/app/api/monthly-report/access/route.ts` | Admin PUT/GET for grants |
| `src/lib/monthly-report/store.ts` | `setUserAccess` / `listAccessUsers` |

---

### Task 1: Upload gate = view gate (TDD)

**Files:**
- Modify: `src/lib/monthly-report/access.ts`
- Modify: `tests/monthly-report-access.test.ts`
- Modify: `tests/monthly-report-ftd-daily.test.ts` (permissions test only)

**Interfaces:**
- Consumes: `canViewMonthlyReport`, `MonthlyReportPrincipal`
- Produces: `canUploadMonthlyReport(principal)` returns true whenever `canViewMonthlyReport(principal)` is true (admin path already via role or features)

- [ ] **Step 1: Update failing expectations in `tests/monthly-report-access.test.ts`**

Replace the test named `view: admin, department feature or personal grant; upload: admin or upload grant only` with:

```ts
test('view and upload: admin, department feature, or personal grant (same predicate)', () => {
  const admin = { role: 'admin', features: [...ACCOUNT_FEATURES], monthlyReportUpload: false };
  const viaDepartment = { role: 'member', features: ['monthly-report'], monthlyReportUpload: false };
  const personalGrant = { role: 'member', features: ['monthly-report'], monthlyReportUpload: true };
  const outsider = { role: 'member', features: ['seo'], monthlyReportUpload: false };
  const staleUploadFlag = { role: 'member', features: [], monthlyReportUpload: true };

  assert.equal(monthlyReportPageAccess(null), 'login');
  assert.equal(monthlyReportPageAccess(viaDepartment), 'allowed');
  assert.equal(monthlyReportPageAccess(outsider), 'forbidden');
  assert.equal(monthlyReportPageAccess(viaDepartment, { upload: true }), 'allowed');
  assert.equal(monthlyReportPageAccess(personalGrant, { upload: true }), 'allowed');
  assert.equal(monthlyReportPageAccess(personalGrant, { adminOnly: true }), 'forbidden');
  assert.equal(monthlyReportPageAccess(admin, { adminOnly: true }), 'allowed');
  assert.equal(monthlyReportPageAccess(admin, { upload: true }), 'allowed');

  assert.equal(canUploadMonthlyReport(admin), true);
  assert.equal(canUploadMonthlyReport(viaDepartment), true);
  assert.equal(canUploadMonthlyReport(personalGrant), true);
  assert.equal(canUploadMonthlyReport(outsider), false);
  // Stale upload flag without view still never allows upload.
  assert.equal(canUploadMonthlyReport(staleUploadFlag), false);

  assert.deepEqual(monthlyReportApiAccess(outsider), { error: 'Forbidden: you do not have access to Onboarding Reports', status: 403 });
  assert.equal(monthlyReportApiAccess(viaDepartment), null);
  assert.equal(monthlyReportApiAccess(viaDepartment, { upload: true }), null);
  assert.equal(monthlyReportApiAccess(outsider, { upload: true })?.status, 403);
});
```

- [ ] **Step 2: Update FTD daily permissions test**

In `tests/monthly-report-ftd-daily.test.ts`, change the test title and body so a department viewer can upload (manual FTD daily). Keep legacy FTD **file** import admin-only.

```ts
test('ftd-daily: permissions — same as view (admin or monthly-report access); legacy FTD file import is admin only', async () => {
  const admin = { role: 'admin', features: [] };
  const viaDepartment = { role: 'user', features: ['monthly-report'], monthlyReportUpload: false };
  const outsider = { role: 'user', features: [] };
  assert.equal(canUploadMonthlyReport(admin), true);
  assert.equal(canUploadMonthlyReport(viaDepartment), true);
  assert.equal(monthlyReportApiAccess(admin, { upload: true }), null);
  assert.equal(monthlyReportApiAccess(viaDepartment, { upload: true }), null);
  assert.equal(monthlyReportApiAccess(outsider, { upload: true })?.status, 403);
  assert.equal(monthlyReportApiAccess(viaDepartment, { adminOnly: true })?.status, 403);
  const route = await readFile('src/app/api/monthly-report/ftd-daily/route.ts', 'utf8');
  for (const method of ['GET', 'POST', 'DELETE']) assert.match(route, new RegExp(`export async function ${method}\\(`));
  assert.equal(route.match(/requireMonthlyReport\(request, \{ upload: true \}\)/g)?.length, 3);
  assert.match(route, /validateManualFtd\(body, todayWib\(\)\)/);
  const ftdUpload = await readFile('src/app/api/monthly-report/uploads/ftd/route.ts', 'utf8');
  assert.match(ftdUpload, /requireMonthlyReport\(request, \{ adminOnly: true \}\)/);
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
npx tsx --test tests/monthly-report-access.test.ts tests/monthly-report-ftd-daily.test.ts
```

Expected: FAIL on `canUploadMonthlyReport(viaDepartment)` still false / upload pageAccess forbidden.

- [ ] **Step 4: Implement minimal change in `access.ts`**

Update the file header comment and `canUploadMonthlyReport`:

```ts
/**
 * Monthly Report access rules.
 *  - View:   admin, OR the user's department has `monthly-report`, OR a row in
 *            monthly_report_access (personal grant).
 *  - Upload: same as view (operators self-upload).
 * Everyone who can view sees the same report.
 */
// ... existing imports and helpers unchanged ...

export function canUploadMonthlyReport(principal: MonthlyReportPrincipal): boolean {
  return canViewMonthlyReport(principal);
}
```

Leave `monthlyReportUpload` on the principal and `MONTHLY_REPORT_GRANT_SQL` as-is (session still loads the grant for Access listing / feature injection). Do not require `principal.monthlyReportUpload` in the upload gate.

- [ ] **Step 5: Re-run tests — expect PASS**

```bash
npx tsx --test tests/monthly-report-access.test.ts tests/monthly-report-ftd-daily.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/monthly-report/access.ts tests/monthly-report-access.test.ts tests/monthly-report-ftd-daily.test.ts
git commit -m "feat(monthly-report): view access implies upload"
```

---

### Task 2: Access API always grants upload with view

**Files:**
- Modify: `src/app/api/monthly-report/access/route.ts`
- Modify: `src/lib/monthly-report/store.ts` (`setUserAccess` comment + force `can_upload=true`)
- Test: add source assertions in `tests/monthly-report-access.test.ts` (readFile of route + store)

**Interfaces:**
- Consumes: `setUserAccess(userId, { view, upload }, grantedBy)`
- Produces: PUT body may omit `upload` or send any boolean; server sets `can_upload=true` whenever `view=true`; `view=false` deletes the row

- [ ] **Step 1: Add source-lock test**

Append to `tests/monthly-report-access.test.ts`:

```ts
test('Access API: personal grant always stores can_upload=true; upload flag optional', () => {
  const route = read('src/app/api/monthly-report/access/route.ts');
  const store = read('src/lib/monthly-report/store.ts');
  assert.match(route, /typeof body\.view !== 'boolean'/);
  assert.doesNotMatch(route, /typeof body\.upload !== 'boolean'/);
  assert.match(route, /can_upload|upload:\s*true/);
  assert.match(store, /access\.upload|can_upload/);
  // setUserAccess must force true on insert when view is granted
  assert.match(store, /VALUES \(\?, \?, \?\)/);
});
```

Refine the assertions after implementing so they lock the real shape (force `true` literal in `setUserAccess` call or inside store).

- [ ] **Step 2: Run test — expect FAIL** (route still requires `upload` boolean)

```bash
npx tsx --test tests/monthly-report-access.test.ts
```

- [ ] **Step 3: Update `setUserAccess` in `store.ts`**

```ts
/** view=false removes the personal grant; view=true always stores can_upload=true (upload = view). */
export async function setUserAccess(userId: string, access: { view: boolean; upload?: boolean }, grantedBy: string): Promise<boolean> {
  const user = await queryOne('SELECT id FROM users WHERE id = ?', [userId]);
  if (!user) return false;
  await executeTransaction(async transaction => {
    if (!access.view) {
      await transaction.execute('DELETE FROM monthly_report_access WHERE user_id = ?', [userId]);
      return;
    }
    await transaction.execute(
      `INSERT INTO monthly_report_access (user_id, can_upload, granted_by) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET can_upload = EXCLUDED.can_upload, granted_by = EXCLUDED.granted_by, updated_at = CURRENT_TIMESTAMP`,
      [userId, true, grantedBy],
    );
  });
  return true;
}
```

- [ ] **Step 4: Update Access PUT route**

```ts
/** Admin only: who can open Onboarding Reports (view = upload). */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  return NextResponse.json({ users: await listAccessUsers() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => null) as { userId?: unknown; view?: unknown; upload?: unknown } | null;
  if (!body || typeof body.userId !== 'string' || typeof body.view !== 'boolean') {
    return NextResponse.json({ error: 'userId and view are required' }, { status: 400 });
  }
  const ok = await setUserAccess(body.userId, { view: body.view, upload: true }, admin.id);
  if (!ok) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const user = (await listAccessUsers()).find(u => u.id === body.userId);
  return NextResponse.json({ user });
}
```

Ignore client `upload` (do not reject `upload && !view`; view=false already deletes).

- [ ] **Step 5: Align the source-lock test with the real code, re-run PASS**

```bash
npx tsx --test tests/monthly-report-access.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/monthly-report/access/route.ts src/lib/monthly-report/store.ts tests/monthly-report-access.test.ts
git commit -m "fix(monthly-report): Access API grants upload with view"
```

---

### Task 3: Access page UI — one Personal access toggle

**Files:**
- Modify: `src/app/dashboard/monthly-report/access/page.tsx`
- Optional source lock in `tests/monthly-report-access.test.ts`

- [ ] **Step 1: Rewrite Access page**

Replace client page with a single Personal access toggle (no Upload column). Keep badges for View (Admin / Via department / Personal / No access).

Key bits:

```tsx
type AccessUser = { id: string; username: string; name: string; role: string; department_name: string | null; via_department: boolean; personal_grant: boolean; can_upload: boolean };

const update = async (user: AccessUser, view: boolean) => {
  setSaving(user.id);
  setError('');
  const response = await fetch('/api/monthly-report/access', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: user.id, view }),
  });
  // ... same success/error handling ...
};

// PageHeader description:
// "Who can open Onboarding Reports. Anyone with access can upload. Admins always have full access."

// DataTableFrame description:
// "Access comes from the department (Accounts → Departments → Onboarding Reports) or a personal grant here. View and upload are the same."

// thead: ['User', 'Department', 'View', 'Personal access'] — no 'Can upload'

// Personal toggle:
<Toggle
  label={`Personal access for ${user.name}`}
  checked={admin || user.personal_grant}
  disabled={admin || saving === user.id}
  onChange={value => update(user, value)}
/>
```

Remove the Upload rights `<td>` and the old `update(user, view, upload)` signature.

- [ ] **Step 2: Source lock (optional but preferred)**

```ts
test('Access page has Personal access only (no separate Upload toggle)', () => {
  const page = read('src/app/dashboard/monthly-report/access/page.tsx');
  assert.match(page, /Personal access/);
  assert.doesNotMatch(page, /Upload rights for/);
  assert.doesNotMatch(page, /'Can upload'/);
  assert.match(page, /JSON\.stringify\(\{ userId: user\.id, view \}\)/);
});
```

- [ ] **Step 3: Run access tests PASS**

```bash
npx tsx --test tests/monthly-report-access.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/monthly-report/access/page.tsx tests/monthly-report-access.test.ts
git commit -m "ui(monthly-report): Access page drops Upload toggle"
```

---

### Task 4: Verify empty-state copy + full related suite + PR

**Files:**
- Possibly touch: `src/app/dashboard/monthly-report/page.tsx` (only if a source test or copy still implies viewers cannot upload — optional; `canUpload` will be true for all viewers so the "Ask an admin…" branch is dead for them)

- [ ] **Step 1: Grep for stale upload-only wording**

```bash
rg -n "Ask an admin|upload rights|Can upload|can_upload = true|monthlyReportUpload === true" src tests docs/superpowers/specs/2026-11-05-onboarding-upload-equals-view-design.md
```

If `page.tsx` still has "Ask an admin or an uploader…", leave it (unreachable for viewers) or simplify to always show the uploads CTA when `canUpload` — no functional requirement. Do not change admin-only FTD file import.

- [ ] **Step 2: Run related tests**

```bash
npx tsx --test tests/monthly-report-access.test.ts tests/monthly-report-ftd-daily.test.ts tests/monthly-report-onboarding-page.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Push branch and open PR**

```bash
git push -u origin HEAD
gh pr create --base main --title "feat(monthly-report): view access implies upload" --body "$(cat <<'BODY'
## Summary
- Anyone who can open Onboarding Reports (department feature or personal grant) can upload.
- Access page: Personal access toggle only; Upload column removed.
- DB `can_upload` kept; always written `true` on grant; ignored by auth checks.

## Spec
`docs/superpowers/specs/2026-11-05-onboarding-upload-equals-view-design.md`

## Test plan
- [ ] `npx tsx --test tests/monthly-report-access.test.ts tests/monthly-report-ftd-daily.test.ts`
- [ ] Non-admin with dept `monthly-report` opens Uploads and can POST
- [ ] User without access still 403
- [ ] Access page shows one Personal toggle
BODY
)"
```

- [ ] **Step 4: Stop.** Do not squash-merge; wait for Bayu.

---

## Self-review

1. Spec coverage: view=upload rule → Task 1; Access UI → Task 3; API/`can_upload=true` → Task 2; no migration / FTD file admin-only → Task 4 grep + ftd test. OK.
2. No TBD/placeholder steps.
3. Types: `setUserAccess(..., { view, upload? })` consistent across Task 2–3.
