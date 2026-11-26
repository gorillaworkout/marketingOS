# Image Studio — 2K output, gallery delete, asset library, edit — design

Date: 2026-11-26. Requested by Bayu ("Social Post": output minimal 2K, edit generated image, summon uploaded
assets, assets stay in the cloud, delete in the gallery). Design approved by Bayu in chat on 2026-11-26 17:44 WIB.
Built as three stacked PRs (A → B → C). Nothing merges without Bayu's own OK.

Images are made on **Generate Image** (`/dashboard/generate-image`) and listed on the **Image Gallery**
(`/dashboard/images`). Social Post is caption-only and hands its image prompt to Generate Image, so all of this
work lives on those two pages.

## Current state (audit, main `f943a2a`)

- Sizes: `src/lib/image-aspect-ratio.ts` sent 1536x1024 / 1024x1024 / 1024x1536. Prod outputs were 848–1672 px
  on the long side (nothing ≥ 2048). Paid OpenRouter calls were pinned to `resolution: '1K'` / `quality: 'medium'`.
- 9router 0.5.112 (read-only check of its bundled code on the VPS):
  - `cx/gpt-image-{1.5,2,2.5,2.5-flare,2.5-sunburst}` go to the ChatGPT Responses API with an `image_generation`
    tool. Body `size` and `quality` are forwarded to the tool. `image` / `images[]` in the **generations** body
    become `input_image` parts and switch the tool to `action: "edit"`. There is no `/v1/images/edits` route.
  - `ag/*` (Antigravity Gemini) only receives an aspect ratio derived from `size` (gcd of width:height); no
    `imageSize`, so Nano Banana through 9router stays ~1K.
- Uploads (references/assets) lived in browser memory only. The `assets` table (001) exists but is unused (0 rows).
- Gallery: org-wide list from `public/outputs/images`, no delete, no owner filter.
- VPS disk: 5.9 GB free of 28 GB. Generated images: 98 files, 181 MB.

## A. 2K output + gallery Mine/All + delete (PR A)

### 2K = long side ≥ 2048 px

1. **Request 2K-class sizes** (`gatewayImageSize(model, ratio)` in `image-aspect-ratio.ts`):

   | Ratio | 2K request | Legacy (fallback / gpt-image-1.5) |
   |-------|-----------|-----------------------------------|
   | 16:9  | 2048x1152 | 1536x1024 |
   | 4:3   | 2048x1536 | 1536x1024 |
   | 1:1   | 2048x2048 | 1024x1024 |
   | 3:4   | 1536x2048 | 1024x1536 |
   | 9:16  | 1152x2048 | 1024x1536 |

   All 2K sizes are multiples of 16, ≤ 3840 px per edge, ≤ 3:1, and between 0.65 MP and 8.3 MP — the
   GPT Image 2 size rules. `cx/gpt-image-1.5` only documents the three legacy sizes, so it keeps them and is
   upscaled. `ag/*` gets the 2K size too: 9router only turns it into an aspect ratio, and the 2K sizes give the
   exact 16:9 / 4:3 ratios (the legacy 1536x1024 became 3:2).
2. **Size refusal guard**: if a gateway call with a 2K size fails with HTTP 400 and the error mentions size /
   resolution / dimension, retry once with the legacy size (then upscale). Nothing else is retried here.
3. **Paid OpenRouter**: Gemini 3.x / Nano Banana 2.x ids send `resolution: '2K'` (native 2K). Gemini 2.5 Flash
   Image has no 2K option and stays `1K`; OpenAI ids keep `quality: 'medium'`. Both are upscaled if needed.
   OpenRouter bills 2K Gemini higher than 1K; the per-image estimates in the UI are still the 1K numbers
   (flagged for Bayu).
4. **Upscale** (`src/lib/image-upscale.ts`, sharp, `kernel: lanczos3`): if the decoded image's long side is
   < 2048, resize so the long side is exactly 2048 (aspect kept). Runs **before** the Dupoin chrome / logo is
   composited, so the chrome is drawn once at the final size (its placement already scales with the canvas
   width). Note: the chrome plates are 1080 px rasters, so they are scaled ~1.9× at 2048 wide; sharper chrome
   needs 2× plates from Bayu.
5. The job result records `width`, `height`, and `upscaledFrom` (`"1086x1448"`) when an upscale happened.
6. **Post-deploy check** (not run here, no generations were approved): generate one free `cx/gpt-image-2`
   image per orientation and confirm the long side is ≥ 2048 and whether it was native or upscaled.

### File naming fix

`generateSOPFileName` counted existing files to pick `_V<n>`. After a delete that count can collide with a file
that still exists and overwrite it. It now uses the highest existing version + 1.

### Gallery: Mine / All

`GET /api/images?scope=mine|all` (default `all`, same as before). Owner = the task's `user_id` for task-linked
images, else the meta sidecar's `userId`. Images with no owner record only show under All. Each item now carries
`canDelete`.

### Delete (permanent)

`DELETE /api/generated-images/[filename]`:

- Auth via `getAuthorizedUser`. Owner may delete their own image; `admin` may delete any. An image with no owner
  record (legacy) is admin-only. If it is linked to several tasks, a non-admin must own all of them.
- Filename must match `^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp)$` and resolve inside the images dir.
- Removes: `public/outputs/images/<file>`, `data/generated-image-meta/<file>.json`,
  `data/generated-image-originals/<file>` (pre-chrome original, written from PR C on), and every entry in
  `tasks.output_data.images[]` that points to the file; `imageUrl` is moved to the last remaining image or dropped.
- No soft delete and no undo (Bayu's decision). The UI asks for confirmation first ("Delete permanently?").
- Reversibility of the *feature*: revert the PR. Deleted files are only recoverable from server backups.

## B. Asset library (PR B, stacked on A)

- **Storage**: VPS disk at `data/image-assets/<userId>/<assetId>.<ext>` (outside `public/`), served only through
  `GET /api/image-assets/[id]/file` after an access check. No cloud bucket (no credentials exist; Bayu can add an
  S3/R2 backend later behind the same table).
- **Table** `image_assets` (migration `072_image_assets.sql`, rollback `db/rollbacks/072_image_assets_down.sql`):
  `id, owner_id → users ON DELETE CASCADE, original_name, mime_type, file_size, width, height, shared,
  storage_key, created_at, updated_at`. The unused 001 `assets` table is left alone (its type CHECK and task link
  do not fit). No `?` in the SQL.
- **Rules**: personal by default; owner can toggle **Shared with team**. Visible = own + shared. Owner or admin can
  delete (row + file) and toggle sharing. 8 MB per file, 500 MB per user (sum of `file_size`). Real-image check with
  sharp (decoded format must be png / jpeg / webp and match the stored extension; dimensions recorded; ≤ 8000 px
  per side).
- **API**: `GET /api/image-assets` (mine + shared, usage), `POST` (multipart upload), `PATCH /api/image-assets/[id]`
  (`shared`), `DELETE /api/image-assets/[id]`, `GET /api/image-assets/[id]/file`.
- **Generate Image**: "Pick from library" next to each Upload (references and assets). Picker tabs: My assets,
  Shared with team, Generated images (from the gallery). Picked items are loaded into the same in-browser upload
  list as a file (data URL), so the generate request does not change. Each local upload has "Save to library".

## C. Edit (PR C, stacked on B)

- From now on every new image also saves its **pre-chrome original** (after upscale, before chrome) to
  `data/generated-image-originals/<file>` (outside `public/`).
- Gallery **Edit** button → dialog with a text instruction (whole image). `POST /api/generate-image` with
  `editOf: <filename>` and `editInstruction`. The server loads the pre-chrome original (or the composited file for
  older images, with a UI note that the result may be less clean because the logo/footer are baked in), sends it as
  the single input image to an edit-capable model (`cx/gpt-image-2` family; 9router turns the input into
  `action: "edit"`), upscales if needed, re-applies the same chrome options as the parent, and saves a **new**
  image. The parent is kept; the new meta records `parentFileName`.
- Only owners / admins can edit (same as delete) — edits create images under the editor's name.
- **Later phase (not built)**: mask / inpaint (paint an area). TODO left in the edit route.

## Out of scope

Cloud bucket, mask/inpaint, chrome plate redesign, cost-estimate changes for 2K paid models.
