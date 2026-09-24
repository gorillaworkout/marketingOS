import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DUPOIN_BLUE_HEX,
  DUPOIN_IG_STYLE_LOCK,
  DUPOIN_LOGO_REQUIRED_LINE,
  IMAGE_PROMPT_SYSTEM,
  applyDupoinImagePromptLocks,
  buildSocialPostImagePromptUserMessage,
} from '../src/lib/dupoin-image-prompt';
import { chromeClearancePercents } from '../src/lib/dupoin-ig-chrome';
import { getImageGenerationSpec } from '../src/lib/image-aspect-ratio';
import { getSmartSystemPrompt, getSystemPrompt } from '../src/lib/openai';

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), 'utf8');

const openai = read('src/lib/openai.ts');
const route = read('src/app/api/social-post/generate/route.ts');

test('image-prompt system encodes Dupoin Brand Guidelines 2026 locks', () => {
  const systemPrompt = getSystemPrompt('image-prompt');
  const smartPrompt = getSmartSystemPrompt('image-prompt', 'Instagram');

  assert.equal(systemPrompt, IMAGE_PROMPT_SYSTEM);
  assert.equal(smartPrompt.includes(systemPrompt), true, 'getSmartSystemPrompt must wrap the image-prompt system prompt');

  for (const prompt of [systemPrompt, smartPrompt]) {
    assert.match(prompt, /#2EB5C4/, 'must lock official Dupoin Blue hex');
    assert.equal(prompt.includes(DUPOIN_BLUE_HEX), true);
    assert.match(prompt, /80px/);
    assert.match(prompt, /1080x1350/);
    assert.match(prompt, /1080x1080/);
    assert.match(prompt, /[Hh]eadline/);
    assert.match(prompt, /[Ss]ubheadline/i);
    assert.match(prompt, /CTA/);
    // The model must RESERVE the header and footer bands. The official
    // plates are public/brand/dupoin-social-header.png and dupoin-social-footer.png.
    assert.match(prompt, /pita atas/i);
    assert.match(prompt, /pita bawah/i);
    assert.match(prompt, /Jangan gambar logo|Jangan menggambar logo/i);
    assert.match(prompt, /badge CNN/i);
    assert.match(prompt, /footer regulasi/i);
    assert.match(prompt, /pill terisi Dupoin Blue/i);
    assert.match(prompt, /Swipe left/);
    assert.match(prompt, /carousel atau story/i);
    assert.match(prompt, /navy atau hitam/i);
    assert.match(prompt, /laptop dengan chart/i);
    assert.match(prompt, /1080x1080 persegi/);
    assert.doesNotMatch(prompt, /kanan-bawah/i);
    assert.doesNotMatch(prompt, /telah teregulasi/);
    assert.doesNotMatch(prompt, /MOST TRUSTED BROKER/);
    assert.doesNotMatch(prompt, /graphic mark \+ wordmark/,
      'the real Dupoin logo is wordmark-only — there is no graphic mark to draw');
    assert.match(prompt, /[Tt]rader Indonesia usia 25-45/);
    assert.match(prompt, /no hashtags/i);
    assert.match(prompt, /stock-photo look|generic stock/i);
    // The scene must stay integrated: no slab pasted over the art.
    assert.match(prompt, /JANGAN pernah sebut overlay/i);
    assert.match(prompt, /JANGAN pernah sebut nilai opacity/i);
    assert.doesNotMatch(prompt, /#2eb5c4/);
    assert.doesNotMatch(prompt, /JANGAN (minta|tulis)[^\n]*teks/i);
    // Old guidance told the model to draw the mark; it must not.
    assert.doesNotMatch(prompt, /MUST include official Dupoin logo/i);
  }
});

test('sample image-prompt builder requires official logo, brand hex, and dropdown size', () => {
  const sample = buildSocialPostImagePromptUserMessage({
    brief: 'Edukasi risk management untuk trader pemula',
    platform: 'Instagram',
    targetAudience: 'Indonesian traders 25-45',
    hook: 'Rencana dulu, baru entry',
    caption: 'Kelola risiko sebelum membuka posisi. Pelajari kerangka kerja Dupoin.',
    aspectRatio: '9:16',
  });
  const spec = getImageGenerationSpec('9:16');

  assert.match(sample, /#2EB5C4/);
  assert.equal(sample.includes(DUPOIN_BLUE_HEX), true);
  assert.match(sample, /pita atas/i);
  assert.match(sample, /pita bawah/i);
  assert.doesNotMatch(sample, /kanan-bawah/i);
  assert.doesNotMatch(sample, /graphic mark \+ wordmark/);
  assert.doesNotMatch(sample, /telah teregulasi/);
  assert.match(sample, /80px/);
  assert.match(sample, /Exact headline/);
  assert.match(sample, /Subheadline/);
  assert.match(sample, /CTA/);
  assert.match(sample, /pill terisi Dupoin Blue/i);
  assert.match(sample, /Swipe left/);
  assert.match(sample, /carousel atau story/i);
  assert.match(sample, /navy\/hitam/i);
  assert.match(sample, /laptop dengan chart/i);
  assert.match(sample, /1080x1080/);
  assert.match(sample, /1080x1350/);
  assert.match(sample, /ditempel otomatis/i);
  assert.match(sample, /JANGAN digambar/i);
  assert.match(sample, /DILARANG/);
  assert.equal(sample.includes(DUPOIN_LOGO_REQUIRED_LINE), false,
    'the user message now speaks Indonesian art direction, not the raw constant');
  assert.match(sample, /Rencana dulu, baru entry/, 'must use the selected hook');
  assert.match(sample, /Kelola risiko sebelum membuka posisi/, 'must use the selected caption');
  assert.match(sample, /no hashtags/i);
  assert.match(sample, /no logo, no wordmark, no CNN badge, no laurel, no regulatory footer/i);
  assert.match(sample, /"Dupoin" lettering drawn into the art/i);
  assert.match(sample, /bukan sebagai lapisan/i);
  assert.match(sample, new RegExp(spec.size));
  assert.match(sample, /9:16/);
  assert.match(sample, /portrait/);
  assert.equal(sample.includes(spec.promptSuffix), true);
  assert.doesNotMatch(sample, /JANGAN (minta|tulis)[^\n]*teks/i);
  assert.doesNotMatch(sample, /Include a small official Dupoin logo/i);
});

test('applyDupoinImagePromptLocks reserves chrome bands and locks the selected size', () => {
  const locked = applyDupoinImagePromptLocks('Premium Instagram advertising poster', '4:3');
  const spec = getImageGenerationSpec('4:3');
  const [width, height] = spec.size.split('x').map(Number);
  const clearance = chromeClearancePercents(width, height);

  assert.match(locked, new RegExp(`top ${clearance.headerPercent}%`));
  assert.match(locked, new RegExp(`bottom ${clearance.footerPercent}%`));
  assert.match(locked, /composited Dupoin header lockup/);
  assert.match(locked, /composited white regulatory footer/);
  assert.match(locked, /#2EB5C4/);
  assert.equal(locked.includes(DUPOIN_LOGO_REQUIRED_LINE), true);
  assert.match(locked, /No overlay/i, 'scene-integrity negatives ride along with every prompt');
  assert.equal(locked.includes(DUPOIN_IG_STYLE_LOCK), true, 'Instagram style lock rides along with every prompt');
  assert.equal(locked.split(DUPOIN_IG_STYLE_LOCK).length, 2, 'style lock is applied once');
  assert.match(locked, /filled Dupoin Blue pill/);
  assert.match(locked, /Swipe left →/);
  assert.match(locked, /brief's own short CTA/);
  assert.doesNotMatch(locked, /lower-right/);
  assert.doesNotMatch(locked, /graphic mark \+ wordmark/);
  assert.doesNotMatch(locked, /telah teregulasi/);
  assert.equal(locked.includes(spec.promptSuffix), true);
  assert.equal(applyDupoinImagePromptLocks(locked, '4:3'), locked, 'locks must be idempotent for the same ratio');

  const switched = applyDupoinImagePromptLocks(locked, '1:1');
  const square = getImageGenerationSpec('1:1');
  const [squareWidth, squareHeight] = square.size.split('x').map(Number);
  const squareClearance = chromeClearancePercents(squareWidth, squareHeight);
  assert.match(switched, /exact 1:1 square aspect ratio \(1024x1024\)/);
  assert.doesNotMatch(switched, /exact 4:3 landscape aspect ratio \(1536x1024\)/);
  assert.match(switched, new RegExp(`top ${squareClearance.headerPercent}%`));
  assert.notEqual(squareClearance.headerPercent, clearance.headerPercent);
  assert.doesNotMatch(switched, new RegExp(`top ${clearance.headerPercent}%`));
});

test('Social Post generate route uses the Brand Guidelines 2026 image-prompt builder', () => {
  assert.match(openai, /IMAGE_PROMPT_SYSTEM/);
  assert.match(openai, /'image-prompt': IMAGE_PROMPT_SYSTEM/);
  assert.match(route, /getSmartSystemPrompt\('image-prompt'/);
  assert.match(route, /buildSocialPostImagePromptUserMessage/);
  assert.match(route, /selectedCaption\.hook/);
  assert.match(route, /selectedCaption\.caption/);
  assert.match(route, /DEFAULT_IMAGE_ASPECT_RATIO/);
  assert.match(route, /aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO/);
  assert.doesNotMatch(route, /Buat advertising creative prompt yang menerjemahkan post ini menjadi iklan siap tayang\.\nBrief:/);
  assert.doesNotMatch(openai, /#2eb5c4/);
  assert.doesNotMatch(openai, /small Dupoin logo in the (bottom|lower)-right corner/);
});

test('Social Post image route composites Instagram chrome instead of the lower-right wordmark', () => {
  const imageRoute = read('src/app/api/generate-image/route.ts');
  assert.match(imageRoute, /compositeDupoinInstagramChrome/);
  assert.match(imageRoute, /type === 'social-post'\s*\?\s*await compositeDupoinInstagramChrome\(imageBytes\)\s*:\s*await compositeDupoinLogo\(imageBytes\)/);
  assert.doesNotMatch(imageRoute, /imageBytes = await compositeDupoinLogo\(imageBytes\)/);
});
