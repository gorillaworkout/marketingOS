# Social Post v2 — Generation Brief + Advanced Tools (design)

Status: draft for Bayu's review. Repo base: `origin/main` @ `2907a37` (after PR #150). Latest migration: 051.
Nothing here is built yet. No push, no PR, no production change.

---

## 1. Current state (what exists today)

| Piece | Where | Notes |
|---|---|---|
| Page | `src/app/dashboard/social-post/page.tsx` (1677 lines) | One "Generation brief" panel: **Platform**, **Target audience**, **Goal**, **Brand guideline** (picker), **Brief** (textarea). Then 3 options → QC → pick → image prompt editor → image. |
| Platforms | page select + `getPlatformOptimization()` in `src/lib/openai.ts` | Instagram, TikTok, LinkedIn, Twitter/X, Facebook. |
| Generate API | `POST /api/social-post/generate` (SSE) | Body `{ brief, platform, targetAudience, goal, brandGuidelineId }`. Steps: web research (`social-post-research.ts`) → past posts → 3 parallel style variants (Bold / Professional / Creative, JSON `{hook, caption, hashtags, citationIds}`) → `runQC` → image prompt per option → save in `tasks` (`type='social-post'`, `output_data` JSON) + `public/outputs/social-posts/*.json`. |
| Status API | `POST /api/social-post/status` | draft / approved etc. (`social-post-status.ts`). |
| Image | `POST /api/generate-image` (async job + polling) | `applyDupoinImagePromptLocks(prompt, ratio, { includeSwipeLeft, dupoinAcademy })`; Academy ON → Academy logo top-centre, OFF → Dupoin logo left. Unchanged by this design. |
| Model | `getUserPreferredModel(userId,'social-post')` → `resolveFeatureModel` (user pref in `task_model_preferences`, else org default) | Tier **Fast** = `ag/gemini-3-flash` (`model-tiers.ts`). Caption + image-prompt share it. |
| Brand guidelines | table `brand_guidelines` (001) — **per-user** (`user_id`), fields `brand_name, tone_of_voice, target_market, key_messages, do_list, dont_list, examples`; API `/api/brand-guidelines` (session only, no feature check); page `/dashboard/brand-guidelines`; seeded "Dupoin Futures" per user (023). Injected by `generateContent` → `buildBrandGuidelinesPrompt`. |
| Memory / RAG | `fetchContextMemory` (last 5 completed tasks of the user), `fetchStyleContext` (`user_style_preferences`, `global_style_profile`), `fetchKnowledgeContext` (`knowledge_entries` + local hashed-1024 embeddings, `findSimilarEntries`), "best examples" (rating ≥ 4, all users). AI Research has `user_memories` + `ai_research_qa_index` (026), per-user. |
| Vision | Only AI Research sends `image_url` parts (`src/lib/ai-research.ts`). `generateContent` is text-only. |
| Uploads | Pattern in `/api/internal-docs` (formData → size/type check → `writeFile` under a private dir). |
| Access | `requireFeature(request,'social-post')`; menu from `authorization.ts` + Accounts → Departments grants. `requireAdmin` exists. No org table — the app is single-tenant (Dupoin). |

Existing issues found while mapping (fix in PR1, small):
1. `getPlatformOptimization` lowercases `"Twitter/X"` → `"twitter/x"`, which misses the `'twitter'` key, so X posts get the generic fallback.
2. Hashtag rules conflict: platform prompt says Instagram 15–20, LinkedIn 3–5, X 1–3, but `runQC` passes only 5–15 for every platform. Bold style says "emojis generously" but QC fails > 3 emojis.

---

## 2. UI layout

Keep the page; split the left form panel into two tabs, add a right-side "Tools" column. English UI.

```
┌ Social media post ─────────────────────────────────────────── [model selector] ┐
│ [ Generate ] [ Caption Analyzer ]                     ← page-level tabs         │
├────────────────────────────────────────────┬───────────────────────────────────┤
│ GENERATION BRIEF                           │ ADVANCED (collapsible cards)      │
│ Platform | Content type | Goal             │ ▸ Brand voice     [Dupoin ▾]      │
│ Target audience | Tone of voice | CTA      │   tone + 2 samples preview        │
│ Brand guideline (existing picker)          │ ▸ Campaign memory [Campaign ▾]    │
│ Key message (1 line, required-ish)         │   active promo / dates / facts    │
│ Brief (textarea, required)                 │ ▸ Competitor references (0/3)     │
│ Content reference  [Paste text][URL][Image]│   paste text · URL · screenshot   │
│ [Generate three options]                   │ ▸ Hashtag generator               │
├────────────────────────────────────────────┤   [Suggest hashtags]              │
│ Results (unchanged: 3 options, QC, image)  │                                   │
│ + per option: "Analyze caption", "Hashtags"│                                   │
└────────────────────────────────────────────┴───────────────────────────────────┘
```

- New brief fields
  - **Content type**: `Photo` · `Carousel` · `Video` (segmented control, default Photo). Video changes the output to a caption + short on-screen hook / shot list hint and skips "Generate image" (show "Open in Video Script" handoff instead). Carousel asks for slide-by-slide text (5–7 slides) and the image prompt targets slide 1 (swipe-left lock already exists).
  - **Tone of voice**: select `Brand default` · `Professional` · `Friendly` · `Educational` · `Bold` · `Inspirational` · `Humorous` + "Custom…" free text (≤ 80 chars). Default "Brand default" (= brand voice).
  - **CTA**: `Follow` · `Learn More` · `Register` · `Comment` · `Visit Link` + `None`. `Visit Link`/`Register` show an optional URL field (validated http/https, never invented by the model).
  - **Key message**: single-line input (≤ 200 chars). Must appear in every option.
  - **Content reference**: optional, one of
    - paste text (≤ 2,000 chars),
    - URL (stored and shown as a link; we fetch it only through the existing web-research reader for public pages, title + main text ≤ 2,000 chars; on failure, ask the user to paste text),
    - image upload (PNG/JPG/WebP ≤ 5 MB, max 1) → described by a vision call, description ≤ 800 chars.
- **Caption Analyzer** tab: textarea for any caption + platform + optional goal/CTA → analysis card (§6). Also reachable from each generated option ("Analyze").
- Advanced cards are collapsed by default and remember open/closed in localStorage.
- Brand Voice, Campaign Memory management (create/edit) lives on the existing `/dashboard/brand-guidelines` page as two new tabs: **Brand voice** (existing guideline fields + samples) and **Campaigns**. No new menu item.

---

## 3. Data model — migration `052_social_post_v2.sql` + `db/rollbacks/052_social_post_v2_down.sql`

Idempotent, `BEGIN/COMMIT`, `IF NOT EXISTS`, no secrets, no data rewrite of existing rows.

```sql
-- Brand Voice Library: extend brand_guidelines (keep per-user rows working)
ALTER TABLE brand_guidelines
  ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE,   -- org-wide when TRUE
  ADD COLUMN IF NOT EXISTS voice_character TEXT,                       -- personality, ≤ 1,500 chars
  ADD COLUMN IF NOT EXISTS banned_phrases TEXT NOT NULL DEFAULT '[]';  -- JSON array

CREATE TABLE IF NOT EXISTS brand_voice_samples (
  id TEXT PRIMARY KEY,
  brand_guideline_id TEXT NOT NULL REFERENCES brand_guidelines(id) ON DELETE CASCADE,
  platform TEXT,                      -- NULL = any
  content_type TEXT CHECK (content_type IN ('photo','carousel','video')),
  caption TEXT NOT NULL,              -- ≤ 2,200 chars
  note TEXT,                          -- why it is good
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_brand_voice_samples_guideline ON brand_voice_samples (brand_guideline_id, created_at DESC);

-- Campaign Memory (org-shared)
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','ended','archived')),
  starts_on DATE, ends_on DATE,
  objective TEXT,
  key_facts TEXT NOT NULL DEFAULT '[]',     -- JSON array of short verified facts (promo terms, prizes, dates)
  approved_claims TEXT NOT NULL DEFAULT '[]',
  links TEXT NOT NULL DEFAULT '[]',         -- JSON array of {label,url}, entered by humans only
  hashtags TEXT NOT NULL DEFAULT '[]',      -- campaign hashtags
  notes TEXT,
  embedding TEXT,                           -- local hashed-1024 JSON, same as knowledge_entries
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns (status, ends_on);

-- Competitor references (org-shared, input only, no crawling)
CREATE TABLE IF NOT EXISTS competitor_references (
  id TEXT PRIMARY KEY,
  competitor_name TEXT NOT NULL,
  platform TEXT,
  source_url TEXT,                    -- optional, stored as given
  pasted_text TEXT,                   -- ≤ 3,000 chars
  screenshot_key TEXT,                -- private storage key, not under public/
  analysis JSONB,                     -- cached LLM analysis (§5)
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_competitor_refs_created ON competitor_references (created_at DESC);

-- Caption Analyzer history (per-user)
CREATE TABLE IF NOT EXISTS caption_analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  platform TEXT, caption TEXT NOT NULL, result JSONB NOT NULL,
  model TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_caption_analyses_user ON caption_analyses (user_id, created_at DESC);
```

Brief fields are **not** new columns: they go into `tasks.output_data.input` (`{ contentType, tone, cta, ctaUrl, keyMessage, reference:{kind,text,url,imageKey}, brandGuidelineId, campaignId, competitorRefIds }`) so history/remix can restore them. Old tasks without `input` still render.

Rollback (`052_social_post_v2_down.sql`): `DROP TABLE IF EXISTS caption_analyses, competitor_references, campaigns, brand_voice_samples;` `ALTER TABLE brand_guidelines DROP COLUMN IF EXISTS is_shared, DROP COLUMN IF EXISTS voice_character, DROP COLUMN IF EXISTS banned_phrases;` delete `schema_migrations` row `052_social_post_v2.sql`. Stored screenshot files are left on disk (note in script). Each PR may ship its own slice (052 / 053 / 054) if split, each with its own down script.

---

## 4. API routes

All require `requireFeature(request,'social-post')` unless stated. JSON in/out; errors use the PR #150 status mapping (429/402/424/503).

| Route | Method | Purpose |
|---|---|---|
| `/api/social-post/generate` | POST (SSE) | **Extended** body: `contentType, tone, cta, ctaUrl, keyMessage, reference, campaignId, competitorRefIds[]`. Old body still works. |
| `/api/social-post/reference` | POST (multipart or JSON) | Normalise a Content reference: text → trimmed; URL → read via existing reader; image → store privately + vision description. Returns `{ kind, text, url?, imageKey? }`. |
| `/api/social-post/hashtags` | POST | `{ topic|caption, platform, contentType?, campaignId? }` → §7. |
| `/api/social-post/analyze-caption` | POST | `{ caption, platform, goal?, cta?, brandGuidelineId? , taskId? }` → §6; saved to `caption_analyses`. `GET` lists the user's last 20. |
| `/api/brand-guidelines` | GET/POST/PUT/DELETE | **Extended**: GET returns own + `is_shared` rows; new fields. Only admin can set/edit `is_shared` rows. Add `requireFeature('social-post')` alongside session (Video Script / Event Plan users keep access — check any of the three generation features). |
| `/api/brand-guidelines/[id]/samples` | GET/POST/DELETE | Voice samples (max 20 per guideline). |
| `/api/campaigns` | GET/POST/PUT/DELETE | Campaign Memory CRUD. |
| `/api/competitor-references` | GET/POST/DELETE | Create (text/URL/screenshot), list, delete; POST `?analyze=1` runs §5 and caches `analysis`. |

---

## 5. Prompt assembly (how each piece reaches the model)

Order in the user prompt of each of the 3 style variants (new blocks marked ★). Hard caps keep the Fast tier prompt ≲ 6k tokens extra.

```
Create a social media post with these details:
Brief: …                          (≤ 2,000 chars)
Platform: …   Content type: ★     Goal: …   Target Audience: …
Tone of voice: ★ (overrides style variant tone only for word choice; the 3 variants still differ in structure/energy)
Key message: ★ "…" — must appear, paraphrase allowed, in hook or first 2 lines
CTA: ★ "Register" → end with one clear CTA line; if ctaUrl given, use exactly that URL; never invent URLs
CONTENT_REFERENCE ★ (≤ 2,000 chars; image → ≤ 800-char description) — "use as inspiration for angle/format; do not copy wording"
BRAND_VOICE ★ (character ≤ 1,500 chars + top 3 samples matching platform/content type, each ≤ 400 chars; total ≤ 2,500)
CAMPAIGN_MEMORY ★ (selected campaign, or top 2 active campaigns by embedding similarity ≥ 0.35; facts/claims/links/hashtags; ≤ 1,500 chars) — "facts here are the only promo facts you may state"
COMPETITOR_INSIGHTS ★ (≤ 3 refs, cached analysis summaries only, ≤ 400 chars each) — "differentiate; never name or disparage competitors; never copy"
{variant.instruction} {bestExamples} {contextMemory} {knowledgeContext} {evidence}
Output JSON: { hook, caption, hashtags[], citationIds[], ★ slides?[{title,text}] (carousel), ★ videoHook?, ★ shotList?[] (video), ★ cta }
```

- Brand guideline do/don't list keeps going through `buildBrandGuidelinesPrompt` (system prompt); Brand voice samples are added there too so all three variants share them.
- Image prompt step gets `contentType`, `keyMessage` and `cta` (CTA text on creative when Photo/Carousel). Academy/Dupoin logo locks unchanged.
- QC additions: `key_message_present` (fuzzy), `cta_present`, `no_invented_url` (any URL in caption must equal ctaUrl or a campaign link), platform-specific hashtag ranges (fixes issue 2).
- Truncation: each block is cut at its cap with "…", and a block is dropped (with an SSE `research` note) when empty.

### Competitor Reference analysis (cached per reference)
Input: pasted text / screenshot (vision) / URL **as given by the user**. Output JSON:
`{ hookPattern, structure, tone, ctaStyle, hashtagStyle, visualNotes?, strengths[], weaknesses[], whatToAvoid[], differentiationIdeas[] }`.
ToS rule: we **do not crawl or scrape** competitor accounts or platforms (Instagram/TikTok/X/Facebook/LinkedIn forbid automated collection). Recommended inputs: paste the caption text, upload a screenshot, or store the URL as a link only. For a non-social public article URL, the existing single-page reader may fetch once on user click; social-network URLs are never fetched.

---

## 6. Caption Analyzer — output shape

Model: Fast tier (same resolver as social-post). Deterministic checks reuse `runQC` (length, hashtags, banned words, emoji) and add LLM judgement.

```json
{
  "score": 0-100,
  "summary": "one paragraph",
  "checks": [ /* runQC checks + key_message/cta/compliance */ ],
  "dimensions": {
    "hook":        { "score": 1-5, "note": "…" },
    "clarity":     { "score": 1-5, "note": "…" },
    "brandVoice":  { "score": 1-5, "note": "…" },
    "cta":         { "score": 1-5, "note": "…" },
    "platformFit": { "score": 1-5, "note": "…" },
    "compliance":  { "score": 1-5, "note": "BAPPEBTI: no guaranteed-profit claims …" }
  },
  "recommendations": [ { "priority": "high|medium|low", "issue": "…", "fix": "…" } ],
  "rewrittenHook": "…",
  "improvedCaption": "…",
  "suggestedHashtags": ["#…"]
}
```
UI: score ring, dimension bars, recommendation list, "Use improved caption" (copies into the editor; never overwrites silently).

## 7. Hashtag Generator

LLM-based (Fast tier), grounded by platform rules + campaign hashtags; no external trend API (none exists in the app, and we must not invent "trending" volumes).

Platforms (from the app): Instagram, TikTok, LinkedIn, Twitter/X, Facebook.

| Platform | Count returned | Mix |
|---|---|---|
| Instagram | 15–20 (UI suggests 8–15 to use) | brand · campaign · niche (ID/EN trading) · broad |
| TikTok | 3–6 | niche + broad (#fyp-style only if user keeps it) |
| LinkedIn | 3–5 | professional / industry |
| Twitter/X | 1–3 | topical |
| Facebook | 1–3 | brand / campaign |

Output: `{ platform, groups: { brand:[], campaign:[], niche:[], broad:[] }, recommended:[], avoid:[{tag, reason}], notes }`. Always includes Dupoin brand tags from the brand voice and campaign hashtags; filters banned/compliance-risky tags (e.g. guaranteed-profit wording). Tags are lowercase-normalised, `#` prefixed, deduped, no spaces. "Apply to option" replaces the option's hashtags; QC re-runs.

---

## 8. Access rules

| Thing | Read | Create / edit | Delete |
|---|---|---|---|
| Brief fields, Hashtag Generator, Caption Analyzer | anyone with `social-post` grant | — | own analyses |
| Brand voice (`is_shared=false`) | owner | owner | owner |
| Brand voice (`is_shared=true`, e.g. "Dupoin Futures" official) | all with `social-post` | **admin only** (default; see Q2) | admin |
| Voice samples | as parent guideline | as parent guideline; members may **suggest** a sample from a generated option ("Save as voice sample") → added to their own guideline or, for shared ones, admin-only | same |
| Campaigns | all with `social-post` | any `social-post` user (default; see Q2), `updated_by` tracked | creator or admin |
| Competitor references | all with `social-post` | any `social-post` user | creator or admin |

No new Accounts feature key and no new menu: everything sits under the `social-post` grant (menu access stays only via Accounts → Departments). If Bayu later wants to restrict Campaign editing, add a sub-permission then.

---

## 9. Suggested PR split

1. **PR1 — Brief fields + Hashtag Generator** (no migration). Content type, Tone, CTA (+URL), Key message, Content reference (text + URL; image upload behind a vision helper), prompt + QC updates, platform-hashtag fix, Twitter/X key fix, `/api/social-post/hashtags`, history restore of `input`. Tests: request body helper, prompt builder caps, QC rules, hashtag normaliser.
2. **PR2 — Brand Voice Library + Campaign Memory** (migration 052 + down). Brand-guidelines page tabs, samples, shared flag, campaigns CRUD, retrieval + injection with caps, Advanced cards on Social Post.
3. **PR3 — Competitor Reference + Caption Analyzer** (migration 053 + down). Private screenshot storage, vision analysis cache, analyzer tab + per-option "Analyze", `caption_analyses` history.

Each PR: CI Postgres migration test, `next build`, Playwright smoke on the Social Post page, squash-merge only after Bayu's OK.

---

## 10. Open questions for Bayu (with recommended defaults)

1. **Video content type** — should Social Post write video copy itself, or hand off to Video Script? *Default: Social Post writes caption + 3-second hook + short shot list and skips image; a "Open in Video Script" button for a full script.*
2. **Who edits shared Brand Voice and Campaigns?** *Default: shared Brand Voice = admin only; Campaigns and Competitor refs = any Social Post user (edits logged).*
3. **Campaign Memory auto-inject** — always add active campaigns, or only when picked? *Default: only the picked campaign; if none picked, suggest (not inject) the top matching active campaign.*
4. **Content reference / competitor URL** — fetch the page or only store it? *Default: store social-network URLs as links only (no scraping, ToS); fetch once only for public non-social article URLs on click; recommend paste text or screenshot.*
