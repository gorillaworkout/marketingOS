# Customer Service Report — design

Date: 2026-11-24. Approved by Bayu in chat (design summary below). Status: implemented in `feat/cs-report`.

## Goal

A new department **Customer Service** with its own feature **CS Report** (`cs-report`). Each CS agent fills a
daily form on the web before going home (starting the day after release); historical data comes in once through a
bulk upload of the current Excel workbook. A dashboard and an Excel export replace the hand-made monthly sheets.

## Access

- New Accounts feature `cs-report` (label "CS Report", href `/dashboard/cs-report`, prefix-matched like Onboarding
  and Settlement). Migration 069 adds it to the `departments_permitted_features_valid` CHECK and creates the
  department **Customer Service** (`00000000-0000-0000-0000-000000000008`) with `['cs-report']`. No user is moved;
  an admin assigns the CS agents to the department in Accounts.
- View = input = upload: anyone who can open CS Report can fill their own daily form, add complaints, and run a bulk
  upload. Admins always have access (same as every feature).
- Sidebar: a new **Customer Service** section with **CS Report**.
- Every API route calls `requireFeature(request, 'cs-report')`.

## Source workbook (current format)

One sheet per month (`Dec 2025` … `Nov 2026`). Each sheet repeats weekly blocks:

1. `Date: 1th Dec to 5th Dec` line, `Weekly Work List`, then the header row
   `Date | Name | IM Reception | E-mail Reception | WA Bussiness Reception | Social Media Reception | Call Reception |
   Account Problem | Deposit/Withdraw | Orders and Transactions | APP&ActsTrade&MT5 | Reward Program | Complaint |
   Unsolved Issues and Customer UID | Unsolved Completed | Conversations not followed up within N minutes`.
   N varies per block (2, 4 or 5) and is stored per row.
2. Per date: the first row carries the date, then one row per agent; then a `Total:` row (ignored, recomputed).
   Empty cells are stored as null (shown and summed as 0).
3. `Notes:` block per week: `Channel | Total | Most frequently asked questions | The most difficult question`, one row
   per channel (CRM/IM, Email, WA Bussiness, Social Media, Call). Totals are ignored (recomputed).
4. Leave is marked by the fill colour of the agent name cell. The legend says `Red : Sick Leave`,
   `Yellow : Annual Leave`; the real files use several shades (F4CCCC, FF0000, EA4335, F54A45, FDDDEF for red/pink;
   FFF2CC, FAF1D1 for yellow). The parser classifies by hue: red/pink → Sick, yellow/orange → Annual Leave, white or
   no fill → Present.
5. `Report Complaint` table per sheet. Columns are located by header text because they move between sheets
   (some sheets add `Urgency Level` or `Category`). Summary rows (`Total Complaint`, `Complaint resolved`,
   `Complaints resolved as per SLA`, `Complaint Closed Rate`) and free-text footnotes are ignored.

Known data quirks in the sample (all handled; counts verified locally):

- The `Date: … to …` label is often copied from another week (Apr block 4 says 20–24 Apr but the rows are 27 Apr–1 May;
  Nov says 1–2 Oct but the rows are 2–6 Nov). **Row dates win.** Exception: when a block's row dates repeat dates already
  used by an earlier block of the same sheet (Jul block 5 repeats 20–24 Jul) and the label's range is still free, the
  rows are moved to the same weekday inside the label's range (27–31 Jul) and the preview shows a warning.
- A week can appear in two monthly sheets (29 Jun–3 Jul is in Jun and Jul). The first sheet wins; the preview says how
  many agent-days were skipped and whether the values were identical.
- Holiday rows (`CHRISTMAS HOLIDAY`, merged across the row) are skipped; merged cells outside column A are read as
  empty so a merged label is never taken as an agent name.
- A second row for the same agent and date inside one sheet is skipped with a warning.

## Data model (migration 069)

- `cs_agents` — one row per CS agent: `display_name`, optional `user_id` (unique), `aliases TEXT[]` of normalised
  Excel names. A logged-in user gets an agent row on first save. Historical names that do not match a user can be
  stored as a name-only agent (user_id null).
- `cs_daily_entries` — one row per agent per date (`UNIQUE (agent_id, entry_date)`): status
  (`present` / `sick` / `annual_leave`), five channel counts, six category counts, unsolved issues + optional UIDs
  text, unsolved completed, not-followed-up count + `follow_up_minutes` (default 4), most frequent and most difficult
  question, source (`web` / `upload`), upload id, created/updated by.
- `cs_complaints` — one row per case: date, agent (null for imported cases: the Excel table has no agent),
  client name, UID, account, platform, description, cause, resolution, completion date, status, `sla_met` (nullable),
  urgency, category, source. `dedupe_key` (unique) = sha1 of date + UID + account + normalised description.
- `cs_weekly_notes` — imported Notes block: week start/end, channel, frequent and difficult question
  (`UNIQUE (week_start, channel)`).
- `cs_report_uploads` — upload history: file name, uploader, sheet count, inserted/skipped counts for entries,
  complaints and notes, warnings (JSONB), data range, created_at.

Rollback `db/rollbacks/069_cs_report_down.sql` drops the five tables, removes `cs-report` from every department,
restores the previous CHECK and deletes the schema_migrations row. The Customer Service department row is kept
(users may be assigned), same as 066.

## Daily Input tab

- Date defaults to today in WIB; future dates are rejected. Agent = logged-in user (admins may pick another agent to
  correct an entry).
- Status: Present / Sick / Annual Leave. On leave the numbers are optional (stored null when left blank).
- Every Weekly Work List column as a number field, Unsolved UIDs text, follow-up minutes (default 4), most frequent
  and most difficult question.
- Saving the same date again updates the row (upsert on agent + date). A non-admin can only write their own row.
- Complaint section below: list of complaints for that agent and date; add / edit / delete one case at a time
  (client name, UID, account, platform, description, cause, resolution, completion date, status, SLA met yes/no).
  A non-admin can edit only complaints they created or that belong to their agent.

## Dashboard tab

- Filters: Day, Week (Mon–Sun containing the picked date), Month, Custom range; agent (all or one).
- KPIs: total conversations (sum of 5 channels), per-channel totals, complaints total, resolved, resolved within SLA,
  closed rate (resolved / total), not followed up.
  - Resolved = status matches solved / resolved / closed / done (case-insensitive).
  - Resolved within SLA = resolved AND `sla_met` is not false. Imported cases have no SLA flag (null) and therefore
    count as within SLA when resolved; the dashboard says so. (The Excel summary for Sep 2026 says 21 of 23 met SLA;
    the per-case flag is not in the file.)
- Daily trend chart (conversations per day, stacked by channel), category breakdown bars, per-agent table
  (days present, sick, leave, conversations, categories, not followed up), weekly work list recap like the Excel
  (per date, per agent, with a Total row), list of frequent and difficult questions (daily entries + imported weekly
  notes), complaint table.
- Complaints are filtered by agent only when an agent is selected; imported cases (no agent) show under "All".

## Bulk Upload tab

- Upload the workbook (.xlsx, ≤ 25 MB). Preview parses every monthly sheet and shows per sheet: agent-days,
  leave days, complaints, notes, plus warnings; and how many rows are new vs already stored.
- Name mapping: each Excel name is matched (1) to an agent alias already stored, (2) to a user whose name equals the
  Excel name (case-insensitive), (3) to a CS user whose first name matches uniquely. Users already linked to an agent are matched only through that
  agent's aliases. The preview shows the suggestion with a
  dropdown: any CS user, or "Keep as name only" (default when nothing matches). Name-only agents keep the data and can
  be linked later by mapping the same name to a user in a later upload (the agent is linked if that user has no agent
  yet).
- Commit inserts with `ON CONFLICT DO NOTHING`: agent+date for entries (an existing web entry is never overwritten),
  dedupe_key for complaints, week_start+channel for notes. Re-uploading the same file inserts nothing.
- Each commit writes one `cs_report_uploads` row; the tab lists the history (newest first).

## Export

`GET /api/cs-report/export?from&to` → .xlsx (ExcelJS) with one sheet per month in the range, in the current layout:
weekly blocks (`Date: …` line, Weekly Work List header, agent rows per date, recomputed Total row, Notes block with
recomputed channel totals and the questions, legend), leave as red/yellow fill on the name cell, then the Report
Complaint table and the recomputed summary rows.

## Out of scope

Editing imported weekly notes in the UI; SLA timers; per-agent targets; notifications/reminders to fill the form.
