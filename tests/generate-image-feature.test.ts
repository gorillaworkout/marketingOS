import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  AVAILABLE_IMAGE_MODELS,
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  PAID_IMAGE_MODELS,
  findImageModel,
  isAllowedImageModel,
  isPaidImageModel,
  isSelectableImageModel,
  livePaidImageModels,
  maxInputImagesFor,
  resolveImageModel,
} from '../src/lib/image-models';
import {
  applyDupoinImagePromptLocks,
  dupoinChromeLockLine,
  resolveDupoinLogoChoice,
  stripBrandDrawingLanguage,
  stripDupoinImagePromptLocks,
} from '../src/lib/dupoin-image-prompt';
import {
  parseImageDataUrl,
  prepareModelInputImages,
  readInputImageLists,
  referencePromptBlock,
} from '../src/lib/image-reference-inputs';
import { readAllGeneratedImageMeta, readUserGeneratedImageMeta, writeGeneratedImageMeta } from '../src/lib/generated-image-meta';
import { accountFeatureFromPath, isDashboardNavItemVisible, shouldBlockDashboardGenerationPath } from '../src/lib/authorization';
import { generateImageHref } from '../src/lib/generate-image-handoff';

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), 'utf8');

test('free catalog stays free; paid models are separate, priced, and never defaults', () => {
  assert.ok(AVAILABLE_IMAGE_MODELS.every(model => !model.paid));
  assert.ok(IMAGE_MODELS.includes(DEFAULT_IMAGE_MODEL));
  assert.ok(PAID_IMAGE_MODELS.length > 0);
  for (const model of PAID_IMAGE_MODELS) {
    assert.equal(model.paid, true, model.id);
    assert.equal(model.provider, 'openrouter', model.id);
    assert.ok((model.estimatedCostUsd ?? 0) > 0, `${model.id} shows an estimated cost`);
    assert.ok((model.maxInputImages ?? 0) >= 1, `${model.id} accepts image input`);
    assert.equal(isAllowedImageModel(model.id), false, 'paid ids never enter defaults/assignments');
    assert.equal(isPaidImageModel(model.id), true);
  }
  assert.ok(PAID_IMAGE_MODELS.some(model => model.family === 'gpt-image'));
  assert.ok(PAID_IMAGE_MODELS.some(model => model.family === 'nano-banana' || model.family === 'gemini'));
  assert.equal(isPaidImageModel(DEFAULT_IMAGE_MODEL), false);
  assert.equal(resolveImageModel('google/gemini-2.5-flash-image'), 'google/gemini-2.5-flash-image');
  assert.equal(resolveImageModel('not/a-model'), DEFAULT_IMAGE_MODEL);
  assert.ok(maxInputImagesFor(DEFAULT_IMAGE_MODEL) >= 1);
});

test('paid models with an expiry drop out after their date', () => {
  const expiring = PAID_IMAGE_MODELS.find(model => model.expiresOn);
  assert.ok(expiring);
  const after = Date.parse(`${expiring.expiresOn}T00:00:00Z`) + 86_400_000;
  assert.ok(!livePaidImageModels(after).some(model => model.id === expiring.id));
  assert.equal(isSelectableImageModel(expiring.id, after), false);
  assert.equal(findImageModel(expiring.id, after), undefined);
  assert.ok(livePaidImageModels(Date.parse('2026-11-17T00:00:00Z')).some(model => model.id === expiring.id));
});

test('logo / footer locks: default wording unchanged, other combinations reserve only what is drawn', () => {
  assert.equal(resolveDupoinLogoChoice({ logo: 'none' }), 'none');
  assert.equal(resolveDupoinLogoChoice({ dupoinAcademy: true }), 'academy');
  assert.equal(resolveDupoinLogoChoice({ logo: 'bogus' }), 'dupoin');
  assert.equal(dupoinChromeLockLine('3:4', { logo: 'dupoin', footer: true }), dupoinChromeLockLine('3:4'));

  const noLogo = applyDupoinImagePromptLocks('Scene', '3:4', { logo: 'none' });
  assert.doesNotMatch(noLogo, /Leave the top/);
  assert.doesNotMatch(noLogo, /Keep the top/);
  assert.match(noLogo, /Keep the bottom \d+% of the frame as clean, empty background/);

  const noFooter = applyDupoinImagePromptLocks('Scene', '3:4', { footer: false });
  assert.match(noFooter, /Keep the top \d+%/);
  assert.doesNotMatch(noFooter, /Keep the bottom/);

  const bare = applyDupoinImagePromptLocks('Scene', '3:4', { logo: 'none', footer: false, brandStyle: false });
  assert.doesNotMatch(bare, /Keep the/);
  assert.match(bare, /No logos, no brand names, no wordmarks/);

  for (const options of [{ logo: 'none' as const }, { footer: false }, { logo: 'none' as const, footer: false, includeSwipeLeft: true }]) {
    const locked = applyDupoinImagePromptLocks('Scene', '3:4', options);
    assert.equal(applyDupoinImagePromptLocks(locked, '3:4', options), locked, 'idempotent');
    assert.equal(applyDupoinImagePromptLocks(locked, '3:4'), applyDupoinImagePromptLocks('Scene', '3:4'), 'switching back replaces the line');
  }
});

test('stripDupoinImagePromptLocks returns the plain scene text', () => {
  const scene = 'A trader at a desk at night, city skyline behind.';
  for (const options of [{}, { includeSwipeLeft: true, logo: 'academy' as const }, { logo: 'none' as const, footer: false }]) {
    assert.equal(stripDupoinImagePromptLocks(applyDupoinImagePromptLocks(scene, '9:16', options)), scene);
  }
  assert.equal(stripDupoinImagePromptLocks(scene), scene);
});

const png = async (color: string, width = 40, height = 30) => {
  const bytes = await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
  return `data:image/png;base64,${bytes.toString('base64')}`;
};

test('upload validation rejects non-images and too many files', async () => {
  assert.throws(() => parseImageDataUrl('data:text/plain;base64,aGk='), /PNG, JPEG, or WebP/);
  assert.throws(() => parseImageDataUrl(42), /PNG, JPEG, or WebP/);
  const one = await png('#ff0000');
  assert.equal(readInputImageLists({ referenceImages: [one] }).references.length, 1);
  assert.throws(() => readInputImageLists({ referenceImages: [one, one, one, one, one] }), /at most 4/);
  assert.throws(() => readInputImageLists({ assetImages: 'nope' }), /list of images/);
});

test('free gateway gets one labelled sheet; paid models get each image as real input', async () => {
  const lists = readInputImageLists({ referenceImages: [await png('#ff0000'), await png('#00ff00')], assetImages: [await png('#0000ff')] });
  const sheet = await prepareModelInputImages({ ...lists, maxInputImages: 8, singleInputOnly: true });
  assert.equal(sheet.sheet, true);
  assert.equal(sheet.images.length, 1);
  assert.match(sheet.images[0], /^data:image\/png;base64,/);
  const meta = await sharp(Buffer.from(sheet.images[0].split(',')[1], 'base64')).metadata();
  assert.ok((meta.width ?? 0) >= 640 && (meta.height ?? 0) >= 640);

  const direct = await prepareModelInputImages({ ...lists, maxInputImages: 16, singleInputOnly: false });
  assert.equal(direct.sheet, false);
  assert.equal(direct.images.length, 3);
  await assert.rejects(prepareModelInputImages({ ...lists, maxInputImages: 2, singleInputOnly: false }), /at most 2 input image/);

  const single = await prepareModelInputImages({ references: lists.references.slice(0, 1), assets: [], maxInputImages: 8, singleInputOnly: true });
  assert.equal(single.sheet, false, 'one upload goes through as-is');
  const none = await prepareModelInputImages({ references: [], assets: [], maxInputImages: 8, singleInputOnly: true });
  assert.deepEqual(none.images, []);
});

test('reference prompt block tells the model how to use references and assets', () => {
  assert.equal(referencePromptBlock({ referenceCount: 0, assetCount: 0, sheet: false }), '');
  const sheet = referencePromptBlock({ referenceCount: 2, assetCount: 1, sheet: true, assetNote: 'Put the phone in her hand' });
  assert.match(sheet, /"REFERENCE ONLY" are visual references: reference only, do not include, collage or reproduce these images/);
  assert.match(sheet, /"ASSET" is a real item/);
  assert.match(sheet, /Never paste the uploaded photo itself/);
  assert.match(sheet, /Do not reproduce the sheet itself, its grid, grey panels, borders, labels or thumbnails/);
  assert.match(sheet, /How to use the uploads: Put the phone in her hand/);
  const direct = referencePromptBlock({ referenceCount: 2, assetCount: 1, sheet: false });
  assert.match(direct, /Input images 1–2 are visual references: reference only, do not include, collage or reproduce these images/);
  assert.match(direct, /Input image 3 is an asset/);
  assert.match(direct, /must appear in the new image as part of the scene/);
  assert.match(direct, /no inset, thumbnail, framed photo/);
  assert.doesNotMatch(direct, /match their composition, layout/, 'references no longer ask for a close layout copy');
  const refsOnly = referencePromptBlock({ referenceCount: 2, assetCount: 0, sheet: false });
  assert.match(refsOnly, /none of them appears in the result/);
  assert.doesNotMatch(refsOnly, /must appear/);
});

test('standalone Generate Image metadata round-trips per user and rejects unsafe names', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gen-meta-'));
  try {
    const base = {
      imageUrl: '/api/generated-images/a.png', type: 'generate-image' as const, prompt: 'Scene', model: DEFAULT_IMAGE_MODEL,
      aspectRatio: '4:5', logo: 'none' as const, footer: false, includeSwipeLeft: false, dupoinAcademy: false, brandStyle: true,
      referenceCount: 2, assetCount: 1, paid: false, costUsd: null, taskId: null,
    };
    writeGeneratedImageMeta({ ...base, fileName: 'a.png', userId: 'u1', generatedAt: '2026-11-17T01:00:00.000Z' }, dir);
    writeGeneratedImageMeta({ ...base, fileName: 'b.png', userId: 'u2', generatedAt: '2026-11-17T02:00:00.000Z' }, dir);
    writeGeneratedImageMeta({ ...base, fileName: '../evil.png', userId: 'u1', generatedAt: '2026-11-17T03:00:00.000Z' }, dir);
    assert.equal(readAllGeneratedImageMeta(dir).size, 2);
    const mine = readUserGeneratedImageMeta('u1', 30, dir);
    assert.deepEqual(mine.map(item => item.fileName), ['a.png']);
    assert.equal(mine[0].footer, false);
    assert.equal(mine[0].referenceCount, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Generate Image uses the Social Post grant (no new feature, no migration)', () => {
  assert.equal(accountFeatureFromPath('/dashboard/generate-image'), 'social-post');
  assert.equal(accountFeatureFromPath('/dashboard/generate-image/'), 'social-post');
  assert.equal(shouldBlockDashboardGenerationPath({ role: 'user', features: ['social-post'] }, '/dashboard/generate-image'), false);
  assert.equal(shouldBlockDashboardGenerationPath({ role: 'user', features: ['video-script'] }, '/dashboard/generate-image'), true);
  assert.equal(isDashboardNavItemVisible({ href: '/dashboard/generate-image', feature: 'social-post' }, { role: 'user', features: [] }), false);
  assert.equal(generateImageHref(), '/dashboard/generate-image');
  assert.equal(generateImageHref(true), '/dashboard/generate-image?from=social-post');

  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(layout, /href: '\/dashboard\/generate-image', label: 'Generate image', icon: 'image', feature: 'social-post'/);
  assert.ok(layout.indexOf("'/dashboard/social-post'") < layout.indexOf("'/dashboard/generate-image'"));
  assert.equal(read('.gitignore').includes('data/generated-image-meta/'), true);
});

test('route gates paid models on the server and falls back to free when credit runs out', () => {
  const route = read('src/app/api/generate-image/route.ts');
  const provider = read('src/lib/llm-provider.ts');
  assert.match(route, /isPaidImageModel\(/);
  assert.match(route, /usePaidOpenRouter/);
  assert.match(route, /is a paid OpenRouter model[^\n]*403\)/);
  assert.match(route, /isOpenRouterCreditFailure/);
  assert.match(route, /used \$\{[^}]+\} \(free\) instead/);
  assert.match(route, /referencePromptBlock\(/);
  assert.match(route, /singleInputOnly: !paid/);
  assert.match(provider, /PAID_IMAGE_DISABLED:/);
  assert.match(provider, /input_references/);
  assert.doesNotMatch(read('src/app/api/image-models/balance/route.ts'), /apiKey|OPENROUTER_API_KEY/);
});

test('Generate Image page shows paid cost and balance before a run and actual cost after', () => {
  const page = read('src/app/dashboard/generate-image/page.tsx');
  assert.match(page, /data-testid="generate-image-reference-input"/);
  assert.match(page, /data-testid="generate-image-asset-input"/);
  assert.match(page, /data-testid="generate-image-cost-notice"/);
  assert.match(page, /\/api\/image-models\/balance/);
  assert.match(page, /data-testid="generate-image-actual-cost"/);
  assert.match(page, /<optgroup label="Free \(included\)">/);
  assert.match(page, /'Paid · OpenRouter credits'/);
  assert.match(page, /disabled=\{!paidEnabled\}/);
  assert.match(page, /readGenerateImageHandoff\(/);
});

test('free gateway GPT Image models work without OpenRouter and back up an Antigravity quota hit', async () => {
  const { nextImageFallback } = await import('../src/lib/image-generation-fallback');
  const gpt = AVAILABLE_IMAGE_MODELS.filter(model => model.family === 'gpt-image');
  assert.ok(gpt.length >= 1);
  for (const model of gpt) {
    assert.ok(model.id.startsWith('cx/'));
    assert.equal(isPaidImageModel(model.id), false, `${model.id} never needs the paid toggle`);
    assert.equal(isAllowedImageModel(model.id), true);
    assert.equal(resolveImageModel(model.id), model.id);
    assert.equal(maxInputImagesFor(model.id), 8, 'uploads are merged into one sheet for the gateway');
  }
  // Production allow list after 065: the ag quota retry lands on a free GPT Image id, never a paid one.
  const fallback = nextImageFallback('ag/gemini-3.1-flash-image', IMAGE_MODELS);
  assert.equal(fallback, 'cx/gpt-image-2');
  assert.equal(isPaidImageModel(fallback), false);
});

test('paid image models stay disabled unless the toggle is on and an OpenRouter key is saved', () => {
  const picker = read('src/app/api/image-models/route.ts');
  assert.match(picker, /usePaidOpenRouter === true && settings\.openrouterKey\.trim\(\)\.length > 0/);
  assert.match(read('src/app/dashboard/generate-image/page.tsx'), /run on LLM Dupoin at no cost/);
});

test('double logo: model-facing prompt never names the logo or brand, for every logo choice', () => {
  const scene = 'Instagram post for a Dupoin Academy webinar in Dupoin Blue (#2EB5C4). Put the Dupoin Academy logo top centre. Headline "BELAJAR BERSAMA DUPOIN ACADEMY". She wears sneakers with no logos.';
  for (const logo of ['academy', 'dupoin', 'none'] as const) {
    for (const includeSwipeLeft of [false, true]) {
      const locked = applyDupoinImagePromptLocks(scene, '3:4', { logo, includeSwipeLeft, footer: true });
      const unquoted = locked.replace(/"[^"]*"/g, '""');
      assert.doesNotMatch(unquoted, /Dupoin|ACADEMY|graduation cap|Swipe left|CNN|laurel|lockup/i, `${logo}/${includeSwipeLeft}`);
      assert.doesNotMatch(locked, /logo top centre/, 'a request to draw the logo is dropped');
      assert.match(locked, /"BELAJAR BERSAMA DUPOIN ACADEMY"/, 'quoted copy the user typed is kept');
      assert.match(locked, /no logos/, 'negative sentences survive');
      assert.match(locked, /No logos, no brand names, no wordmarks, no monograms, no badges, no watermarks/);
      if (logo !== 'none') assert.match(locked, /Keep the top \d+% of the frame as clean, empty background/);
      assert.equal(applyDupoinImagePromptLocks(locked, '3:4', { logo, includeSwipeLeft, footer: true }), locked, 'idempotent');
    }
  }
  assert.equal(stripBrandDrawingLanguage("Headline 'JAGA MODALMU' in Dupoin Blue."), "Headline 'JAGA MODALMU' in cyan.");
});

test('Academy header band is taller than the Dupoin band; compositor keeps Academy centred / Dupoin left', () => {
  const academy = applyDupoinImagePromptLocks('Scene', '3:4', { logo: 'academy' });
  const dupoin = applyDupoinImagePromptLocks('Scene', '3:4', { logo: 'dupoin' });
  const pct = (text: string) => Number(/Keep the top (\d+)%/.exec(text)?.[1]);
  assert.ok(pct(academy) > pct(dupoin));
  const chrome = read('src/lib/dupoin-ig-chrome.ts');
  assert.match(chrome, /academy/i);
});

test('reference leak: route never composites uploads and never sends a brand logo file as model input', () => {
  const route = read('src/app/api/generate-image/route.ts');
  assert.match(route, /compositeDupoinInstagramChrome\(imageBytes, \{ includeSwipeLeft: swipeLeft, logo, footer \}\)/, 'compositor only gets the chrome options');
  assert.doesNotMatch(route, /compositeDupoinInstagramChrome\([^)]*(?:references|assets|prepared)/);
  assert.doesNotMatch(route, /public\/brand|dupoin-academy-logo|readFileSync\([^)]*brand/i, 'no logo file is read into the model request');
  // Every provider path builds its prompt with the same reference block.
  assert.ok((route.match(/referencePromptBlock\(/g) || []).length >= 2, 'gateway and paid→free fallback both label the uploads');
  const inputs = read('src/lib/image-reference-inputs.ts');
  assert.match(inputs, /SHEET_REFERENCE_LABEL = 'REFERENCE ONLY'/);
});

test('reference sheet labels say REFERENCE ONLY and ASSET', async () => {
  const lists = readInputImageLists({ referenceImages: [await png('#ff0000')], assetImages: [await png('#0000ff')] });
  const prepared = await prepareModelInputImages({ ...lists, maxInputImages: 8, singleInputOnly: true });
  assert.equal(prepared.sheet, true);
  const block = referencePromptBlock({ ...prepared });
  assert.match(block, /reference only, do not include, collage or reproduce these images/);
  assert.match(block, /Never paste the uploaded photo itself/);
});
