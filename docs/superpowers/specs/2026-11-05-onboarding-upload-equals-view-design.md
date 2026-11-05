# Onboarding Reports: view access = upload (design)

Date: 2026-11-05 · Approach: A (view = upload, simplify Access UI)

## Goal
Anyone who can open Onboarding Reports can also upload daily files (`obd_kyc` / `user_approved` and related upload routes). Operators self-upload; Bayu is not the only uploader.

## Decision (Bayu, 2026-11-05)
- Who uploads: **everyone who can view** — via department feature `monthly-report` **or** a personal grant on Access.
- Access UI: **one** Personal access toggle; remove the separate Upload rights toggle.
- Keep table `monthly_report_access` and column `can_upload` (no drop migration). Checks ignore `can_upload`; new/updated personal grants still write `can_upload = true` for compatibility.

## Current behavior (before)
- View: admin, OR department has `monthly-report`, OR row in `monthly_report_access`.
- Upload: admin, OR personal grant with `can_upload = true`.
- Department feature alone never allowed upload → only admins (and any grant with upload) could upload. Production had zero personal grants.

## New rules
| Principal | View | Upload |
|-----------|------|--------|
| `role === 'admin'` | yes | yes |
| Department has feature `monthly-report` | yes | yes |
| Personal grant row in `monthly_report_access` | yes | yes |
| Neither | no | no |

`canUploadMonthlyReport(principal)` becomes the same predicate as `canViewMonthlyReport(principal)` (admin already covered by feature access helpers / existing view path). Stop requiring `principal.monthlyReportUpload === true`.

## Code touchpoints
- `src/lib/monthly-report/access.ts` — rewrite header comment; `canUploadMonthlyReport` = view. Keep `MONTHLY_REPORT_GRANT_SQL` / `monthlyReportUpload` wiring so session still loads; field unused for the gate (or leave load as-is for Access listing).
- `src/app/dashboard/monthly-report/access/page.tsx` — drop Upload column/toggle; description copy: view = upload. Personal toggle still PUTs `{ userId, view }`; when `view=true` API sets `can_upload=true`, when `view=false` deletes the grant row (same as today for revoke).
- Access API PUT (`/api/monthly-report/access`) — accept `view` without requiring a meaningful `upload` flag; always persist `can_upload=true` on grant insert/update. Ignore client `upload: false` if still sent.
- Uploads layout + upload APIs already call `monthlyReportPageAccess` / `monthlyReportApiAccess` with `{ upload: true }` — they automatically follow the new `canUpload` definition; no route list change.
- Onboarding page empty-state copy that says “Ask an admin…” for non-uploaders becomes unreachable for viewers; leave copy or simplify to upload CTA only when `canUpload` (still true for all viewers).
- Tests: access unit tests + any Access page / API tests that assert department-view-without-upload → update so view ⇒ upload. Add/adjust case: department feature alone can upload.

## Out of scope
- No migration to drop `can_upload`.
- No change to department feature management (Accounts → Departments).
- No change to FTD manual entry / legacy FTD file rules beyond the shared upload gate.
- No change to KYC/approver parsing or KPI layout.

## Success
- Non-admin user with department `monthly-report` can open `/dashboard/monthly-report/uploads` and POST uploads (200 path, not 403).
- Non-admin with only a personal grant (no dept feature) can do the same.
- User with neither still gets 403 / forbidden page.
- Access page shows Personal access only; admin rows remain locked full-access badges.
- Existing Jun–Oct data and daily Nov uploads unchanged.

## Risks / notes
- Broader upload surface: intentional. Revoke by removing dept feature or personal grant.
- Old clients sending `upload: false` must not strip rights; server forces `can_upload=true` on grant.
