# Image Studio 2K / assets / edit — implementation plan

> 2026-11-26 18:24 WIB: 2K output is deferred. Steps 1–4 ship behind `IMAGE_2K_OUTPUT_ENABLED = false`
> (classic sizes, 1K paid, no upscale). Size tests live in `tests/image-output-size.test.ts`.

Spec: `docs/superpowers/specs/2026-11-26-image-studio-2k-assets-edit-design.md`. Base: `origin/main` `f943a2a`.

## PR A — `feat/image-studio-2k-gallery` (base main)

1. `src/lib/image-aspect-ratio.ts`: 2K size table, legacy table, `gatewayImageSize(model, ratio)`,
   `legacyGatewayImageSize(ratio)`, `MIN_OUTPUT_LONG_SIDE = 2048`. Prompt suffix shows the 2K size.
   Tests: `tests/image-aspect-ratio.test.ts` (updated), `tests/image-2k-size.test.ts` (rules: ×16, ≤3840, ratio).
2. `src/lib/image-upscale.ts`: `ensureMinLongSide(bytes, min)` (lanczos3). Tests: `tests/image-upscale.test.ts`
   (small → 2048 long side, aspect kept, large untouched, chrome composited after upscale lands at final size).
3. `src/lib/llm-provider.ts`: `openRouterImageResolution(model)`; paid call uses it.
4. `src/app/api/generate-image/route.ts`: per-model size, size-refusal retry with legacy size, upscale before
   chrome, `width/height/upscaledFrom` in result; `nextSopVersion` (max+1).
5. `src/lib/generated-image-delete.ts`: filename guard, owner resolution, permission, file removal, task output
   pruning (pure + injectable DB). Tests: `tests/generated-image-delete.test.ts`.
6. `src/app/api/generated-images/[filename]/route.ts`: `DELETE`. `src/app/api/images/route.ts`: `scope`, `canDelete`.
7. `src/app/dashboard/images/page.tsx`: Mine / All toggle, Delete + confirm dialog (card + lightbox).
8. Verify: `npx tsx --test tests/*.test.ts`, ESLint on changed files, `npm run build`.

## PR B — `feat/image-asset-library` (base PR A)

1. `db/migrations/072_image_assets.sql` + `db/rollbacks/072_image_assets_down.sql` (no `?`).
2. `src/lib/image-assets.ts` (validation with sharp, quotas, paths, permissions) + store functions.
3. API routes under `src/app/api/image-assets/`.
4. `src/components/image-asset-picker.tsx` + Generate Image wiring ("Pick from library", "Save to library").
5. Tests: `tests/image-assets.test.ts` (validation, quota, permissions, path safety, migration static checks),
   PG round-trip test skipped without `TEST_DATABASE_URL`.

## PR C — `feat/image-edit` (base PR B)

1. Save pre-chrome original in `generate-image` route.
2. `editOf` / `editInstruction` path in the route (load original or composited, edit-capable model, re-chrome,
   new file with `parentFileName`).
3. Gallery Edit dialog with the "older image" note.
4. Tests: `tests/image-edit.test.ts`.
