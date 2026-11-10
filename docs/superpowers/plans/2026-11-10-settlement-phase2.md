# Settlement phase 2 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline; the user already chose execution in this session). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship approved groups A and B: chunked Deal-level Deals History (commission and three-term swap) and an on-demand JISDOR fixing display that does not convert reports.

**Architecture:** A pure reducer owns session, chunk, merge, coverage, and abort behavior and is unit-tested without Postgres. SQL in `deals-store.ts` performs the same steps with `?` parameters inside one transaction. JISDOR is a separate parser, table, and on-demand route. Phase 1 `swapReport` stays the CRM-S / CRM-SR function.

**Tech Stack:** Next.js 16 route handlers, PostgreSQL via `?` placeholders, `node:test` + `tsx`, existing `settlement-report` gate, 25 MB `readUploadBody`.

**Spec:** `docs/superpowers/specs/2026-11-10-settlement-phase2-design.md`

## Global Constraints

- No raw client datasets in git. Synthetic fixtures only.
- Upload request body ≤ 25 MB. A chunk has at most 2,000 deals.
- Do not store name, comment, or EA text.
- Fixed account rates from the second login digit (`rateFromAccount`). No JISDOR conversion of those rates.
- Missing Deals History coverage and missing JISDOR dates are Pending / absent, never a filled 0 and never the previous fixing.
- `Entry = in` commission only. Footer must match the sum of the Commission column or commit is rejected.
- Abort and a thrown commit leave `settlement_mt5_deal_facts` unchanged.
- No cron, no new `package.json` timer script.
- No BCA, rebate, Metabase, OCR, or access-key changes.
- Official acceptance totals, from synthetic rows that use the audited bucket amounts: commission −51,486.70, Deals History swap 0 for the listed 01–05 Oct buckets, 390,366 unique deals is the audited file count (constant), not a generated row count.
- Phase 1 CRM-S / CRM-SR posting-date behavior stays.

## File map

| File | PR | Responsibility |
|---|---|---|
| `db/migrations/047_settlement_deals_history.sql` | A | sessions, chunks, staging, facts, coverage, daily cache |
| `src/lib/settlement/deals-parse.ts` | A | UTF-16LE stream, title, footer, row |
| `src/lib/settlement/deals-engine.ts` | A | reducer: open, chunk, merge, commit, abort, coverage |
| `src/lib/settlement/deals-lock.ts` | A | per-session async lock |
| `src/lib/settlement/deals-store.ts` | A | parameterized SQL |
| `src/lib/settlement/deals-report.ts` | A | commission + swap honesty |
| `src/lib/settlement/deals-disk.ts` | A | size projection and measure SQL |
| `src/app/api/settlement-report/deals-history/route.ts` | A | open / chunk / commit / abort |
| `src/lib/settlement/deals-upload-client.ts` | A | browser chunk builder, 25 MB / 2000 cap |
| `src/components/settlement/DealsHistoryPanel.tsx` | A | upload progress |
| `src/lib/settlement/export.ts` | A | Pending cell, not 0 |
| `src/components/settlement/SettlementTables.tsx` | A | three swap lines |
| `db/migrations/048_settlement_jisdor.sql` | B | `settlement_fx_rates` |
| `src/lib/settlement/jisdor.ts` | B | HTML parser, no gap fill |
| `src/app/api/settlement-report/jisdor/route.ts` | B | GET cache, POST on-demand fetch |
| `src/components/settlement/JisdorPanel.tsx` | B | display only |

## PR split

- PR A `cursor/settlement-phase2-deals-1854` → `main`: tasks 1–8.
- PR B `cursor/settlement-phase2-jisdor-1854` branched from A → A's branch: tasks 9–10.

### Task 1: UTF-16LE reader, title, footer, row

**Files:** `src/lib/settlement/deals-parse.ts`, `tests/settlement-deals-parse.test.ts`

**Produces:** `pushUtf16LeLines(state, bytes) → { state, lines }`, `parseDealsTitle(line)`, `parseDealsHeader(line)`, `parseDealsRow(header, cells)`, `parseDealsFooter(header, cells)`, `serverDateOf(time)`, `MAX_CHUNK_DEALS = 2000`.

Tests: odd-byte split and a line split across pushes; title `for '*'` from `2026.10.01` to `2026.10.05`; footer Commission −51486.70 and Swap 0; `2026.10.25 03:00:00` server date is `2026-10-25`; Name and Comment are not on the parsed row.

### Task 2: Merge, overlap, coverage, abort

**Files:** `src/lib/settlement/deals-engine.ts`, `tests/settlement-deals-engine.test.ts`

**Produces:** `emptyDhState()`, `openDhSession`, `applyDhChunk`, `commitDhSession`, `abortDhSession`, `DhState`.

Tests, in order, on one state:

1. Month deals for 1–5 Oct, then a week file that omits one 3 Oct deal: the omitted deal remains; totals equal unique deals.
2. Same week file again: inserted 0, unchanged totals.
3. One deal's commission changes: that deal updates; the delta matches.
4. `for '*'` title marks each date in range `full`. A non-`*` file stores deals and does not mark `full`.
5. A date outside coverage is missing. A full date with swap sum 0 is 0, not missing.
6. `abortDhSession` drops staging and leaves facts identical.
7. `commitDhSession` that throws inside the mutation returns the pre-commit facts.
8. Other `actorId` is rejected. Same seq + hash is idempotent. A lower seq does not overwrite a higher seq's deal.
9. Footer mismatch rejects the commit.

### Task 3: Lock, chunk cap, disk SQL

**Files:** `deals-lock.ts`, `deals-disk.ts`, `deals-upload-client.ts`, tests.

Tests: two parallel chunk applies on one session do not drop deals; 2001 deals or a body over 25 MB is rejected before apply; `DISK_MEASURE_SQL` reads `pg_total_relation_size` for facts, staging, and daily cache and contains no `DELETE`; `projectFactDisk(390366, bytes)` is exact multiplication; projection vs `HISTORICAL_ROOT_FREE_BYTES` (10 GiB) is a report, not a delete.

### Task 4: Migration 047 and store SQL

**Files:** `db/migrations/047_settlement_deals_history.sql`, `deals-store.ts`, `tests/settlement-deals-store.test.ts`

SQL uses `?` only. Commit upserts `ON CONFLICT (deal) DO UPDATE ... WHERE ... IS DISTINCT FROM`. Rebuild `INSERT ... SELECT ... FROM settlement_mt5_deal_facts WHERE server_time::date = ANY(?)`. Abort deletes staging and chunk rows for the session and does not delete facts. Rollback comment included. No new value in `monthly_report_uploads.kind` and no department change.

### Task 5: Commission, swap honesty, export

**Files:** `deals-report.ts`, edits to `export.ts` and `SettlementTables.tsx`, tests.

`commissionReport` groups `Entry = in` by server date × rate. Synthetic one-deal-per-bucket rows reproduce the audited 01–05 Oct buckets and total −51,486.70 with swap 0. `composeSwap` keeps phase 1 CRM-S / CRM-SR and sets Deals History to `Pending: Deals History` when coverage is not `full`. Export writes that text, not 0. `swapReport` in `metrics.ts` is not behavior-changed (existing settlement swap tests stay green).

### Task 6: Route

**Files:** `src/app/api/settlement-report/deals-history/route.ts`

`requireSettlementReport`. Actions `open`, `chunk`, `commit`, `abort`. Chunk uses `readUploadBody` so the 25 MB cap applies. Owner check uses the session row.

### Task 7: Panel

**Files:** `DealsHistoryPanel.tsx`, mount it from `SettlementWorkspace`. Copy states the 25 MB chunk limit, Deal idempotency, and that a missing file is not zero. No second upload of D&W.

### Task 8: PR A gates

`npx tsx --test tests/settlement-*.test.ts` then `tests/*.test.ts`, `npm run build`. Commit and open the PR against `main`. Do not merge.

### Task 9: JISDOR parser and cache

**Files:** `048_settlement_jisdor.sql`, `jisdor.ts`, `tests/settlement-jisdor.test.ts`

`parseJisdorHtml` reads Tanggal / Kurs. `Rp 18.103,00` → 18103. `9 November 2026` and `30 Oktober 2026` both parse. A fixture that skips 7–8 Nov does not gain those dates. `applyFixings(existing, parsed)` upserts only parsed dates and does not copy the previous rate forward.

### Task 10: On-demand route and panel

**Files:** `src/app/api/settlement-report/jisdor/route.ts`, `JisdorPanel.tsx`

GET returns stored rows. POST calls an injected `load(url)` (default `fetch` of the BI JISDOR page) and upserts parsed rows. Unrecognized HTML stores nothing and returns an error. No `package.json` script. The panel text says the fixing is not applied to commission or swap. Mount under the swap section. PR B targets the A branch. Do not merge.
