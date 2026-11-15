# Partnership: B2B Proposal Builder

Sidebar: **Partnership > Proposal Builder** (`/dashboard/partnership/proposal-builder`), gated by the `partnership`
department feature (Accounts > Departments), same as Competitor Intelligence.

## What it does

- Brief form: partner name, industry/description, optional logo (PNG/JPEG up to 700 KB), objective, collaboration
  scheme, user benefit/promo, digital exposure items + units (from the rate card), offline materials + placement/qty,
  "what we need" items (qty x unit value), base partnership fee (empty = TBD), notes, language (ID default / EN),
  template (Slide 16:9 or Document A4), and an option to add Competitor Intelligence insights to Market Landscape.
- **Draft with AI** writes only narrative text through `generateContent` (task `partnership-proposal`, model from the
  user's `market-research` routing, with the usual model failover and auth-expired cooldown). **Start from template**
  uses the approved boilerplate without AI. If AI fails, the UI offers the template path.
- Guards on AI text: any sentence with a number not in the brief is dropped, and award/license/rating claims are
  checked against the shared register in `src/lib/brand-fact-guard.ts`.
- Every narrative section is editable; any section can be switched off. Each save creates a version; older versions
  can be loaded back into the editor.
- Exports: PDF for both templates, PPTX for the slide template (pptxgenjs, native tables).

## Where the facts and numbers come from

| Data | Source | Editable by |
| --- | --- | --- |
| About Dupoin, BAPPEBTI/OJK/BI, JFX/KBI/ASPEBTINDO, license 423/BAPPEBTI/SI/VII/2004, awards, A+++ rating | `src/lib/partnership/proposal-facts.ts` | Code review only |
| Rate card, offline materials, Dupoin by Numbers, growth, demographics, regions, products, IG/website stats | Defaults in `src/lib/partnership/proposal-settings.ts` (copied from the Tadakado and Kopi Kenangan proposals); overrides in `partnership_settings` | Admins, Proposal Builder > Settings |
| Exposure table, totals, package value | Computed in `computeTotals()` | Not editable (follows rate card + brief) |
| Narrative (overview, scheme, journey, support, notes, insight) | AI draft or template, then edited | Partnership users |

Package total = digital exposure value + partner contribution (qty x unit value) + base fee when set.
Kopi Kenangan defaults give Rp 78.000.000; Tadakado (4 exposure items + 1000 x Rp 30.000 vouchers) gives Rp 58.000.000.

## Database

Migration `058_partnership_proposals.sql` (additive): `partnership_proposals`, `partnership_proposal_versions`,
`partnership_settings`. Rollback: `db/rollbacks/058_partnership_proposals_down.sql` (drops the three tables; take a
backup first). Take a production DB backup before deploying.

## Samples

`npx tsx scripts/partnership-proposal-samples.ts <outDir>` renders Tadakado and Kopi Kenangan samples with a stub AI
(no network, no database, no keys).

## Fonts

PDFs embed Fira Sans (SIL OFL 1.1, `assets/fonts/OFL.txt`). PPTX files reference "Fira Sans"; on a computer without
that font PowerPoint substitutes a default sans.
