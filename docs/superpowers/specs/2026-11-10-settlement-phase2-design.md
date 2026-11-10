# Settlement phase 2 design

Status: approved by Bayu (2026-11-10), "Setuju rancangan fase 2. Lanjut upload chunked, komisi, swap, dan tampilan JISDOR; sumber yang belum ada menyusul."
Base: `main` `b279896` (phase 1, PRs #132 and #133). Raw client files are never committed.

## Approved scope

**A.** Chunked Deals History upload, one row per `Deal`, commission (`Entry = in`), and the three-term swap.
**B.** JISDOR raw daily fixings, cached and displayed. They do not convert report totals.

Not in this scope: BCA HTML, IB rebate, Metabase reject reasons, Recap Time Process reasons, OCR, KVB/July imports, access changes, cron, aggregate-only storage, and any October or November month total for Deals History.

## Verified evidence (01–05 Oct official file)

- 138.6 MB, UTF-16LE, tab-separated, 22 columns, 390,366 unique `Deal`.
- Title is `for '*'` with inclusive full server days.
- Commission on `Entry = in` is −51,486.70 and equals the file footer. `Entry = out` commission is 0.
- `Swap` is 0.00 on every row of this file. A manual September sheet shows Deals History swap can be non-zero later, so the term stays.
- No `Deal` id is shared with the Deposit & Withdrawal report.
- Day × login groups: 7,737 for these five days, about 48,000 in a month. That figure sizes the cache. It is not the stored grain.
- There is no official October recap sheet. The commission total is the source footer.
- Server-date commission (USD, 10000, 12000, 14000):
  - 2026-10-01: −24.96, −4,641.65, −18.48, −13,244.88
  - 2026-10-02: −43.24, −4,698.92, −21.68, −13,673.10
  - 2026-10-03: 0, 0, 0, 0
  - 2026-10-05: −32.59, −4,693.20, −26.73, −10,367.27
- Those four buckets sum to −51,486.70, so 4 Oct adds no commission. 4 Oct is inside the title and is not a separate non-zero bucket.
- October CRM-S by posting server date: 10000 −213,166.40, 12000 −2,044.32, 14000 −139,330.48, USD −6,366.19.
- October CRM-SR: 10000 61,984.34, 12000 544.61, 14000 49,972.04, USD 410.50.
- The comment date is always one day before the posting date. Grouping stays on the server posting date already used in phase 1.

## A — Deals History

The browser streams UTF-16LE and posts chunks of at most 2,000 deals. Each request stays at or under 25 MB. Chunks stage on an upload session. Commit is one database transaction. Abort or a failed commit leaves live fact rows unchanged and deletes only that session's staging rows.

Live grain is `settlement_mt5_deal_facts`, primary key `deal`. Columns are deal, login, server time, entry, volume, commission, fee, swap, profit, currency, and the fixed account rate from the second login digit. Name, comment, and EA text are not stored.

Upsert on `Deal`. A deal absent from the new file stays. Daily totals are deleted and reinserted from the full fact table for the touched server dates only, including a date a deal moved away from. They are a cache, not a second source. A week file overlapped with a month file must not double-count and must not drop deals that are only in the month file. Re-committing the same deals counts as unchanged.

A server date is fully covered only when a committed `for '*'` session's inclusive title range contains that date. Commission and Deals History swap for a fully covered date use the stored sums, including a real 0. A date that is not fully covered is `Pending: Deals History`, not 0. A partial or non-`*` file may store deals but does not mark the date fully covered.

Commission sums `Entry = in` only, by the MT5 server wall date (not the WIB date) and the fixed rate. `Entry = out` commission is excluded. A non-zero out total is a warning. The file footer is compared with the sum of the Commission column. A mismatch rejects the commit.

`settlement_mt5_deals` (phase 1 Deposit & Withdrawal) is not written. The audited intersection of Deal ids is empty.

Sessions are owned by the user who opened them. Another user cannot append, commit, or abort. The same session, sequence, and content hash is an idempotent replay. A different hash for an open sequence replaces only staging rows tagged with that sequence. A deal present in two sequences of the same session keeps the higher sequence. An older sequence cannot overwrite it. Chunks of one session run under a per-session lock.

UTF-16LE decoding carries a trailing odd byte and an incomplete line into the next chunk.

## B — JISDOR

`settlement_fx_rates` stores a row only for a date the official BI page published. The page table is Tanggal / Kurs (`9 November 2026`, `Rp 18.103,00` = 18103). Indonesian and English month names are accepted. Weekend and holiday gaps are absent rows, not filled from the previous fixing.

The Settlement Report page shows those fixings and a button that fetches on demand. Nothing in this design installs cron or a package script that runs on a timer. Applying a fixing to swap or commission IDR, or replacing the manual September rates 17,877 and 16,207, is out of scope. IDR accounts stay on USD × 10000 / 12000 / 14000.

## Disk

About 10 GB free on the shared VPS root is a historical snapshot, not a budget. Group A does not pick a retention cutoff. It records `pg_total_relation_size` for the fact, staging, and cache tables and projects `deals × measured bytes per deal` against that 10 GB snapshot. The 5-day file is the measurement set. Pruning facts is not in this release, because a pruned month cannot be deduped on a later reupload. Disk is checked again at deploy. This cloud run does not inspect production.

## Access and phase 1

`settlement-report` is unchanged. View and upload stay the same. Phase 1 CRM, D&W, and FTD numbers for the same inputs stay the same. CRM-S and CRM-SR are not regrouped onto the comment date.
