import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DUPOIN_BLUE_HEX,
  DUPOIN_LOGO_REQUIRED_LINE,
  IMAGE_PROMPT_SYSTEM,
  applyDupoinImagePromptLocks,
  buildSocialPostImagePromptUserMessage,
} from '../src/lib/dupoin-image-prompt';
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
    assert.match(prompt, /RGB 46,181,196/);
    assert.match(prompt, /80px/);
    assert.match(prompt, /1080x1350/);
    assert.match(prompt, /1080x1080/);
    assert.match(prompt, /Exact headline/i);
    assert.match(prompt, /Subheadline/i);
    assert.match(prompt, /CTA/);
    assert.match(prompt, /visual hierarchy/i);
    // The model must RESERVE space, never draw the logo: the official wordmark
    // is composited from public/brand/dupoin-logo.png after generation.
    assert.match(prompt, /lower-right/);
    assert.equal(prompt.includes(DUPOIN_LOGO_REQUIRED_LINE), true);
    assert.match(prompt, /draw no logo|Jangan menggambar logo/i);
    assert.doesNotMatch(prompt, /graphic mark \+ wordmark/,
      'the real Dupoin logo is wordmark-only — there is no graphic mark to draw');
    assert.match(prompt, /professional, stable, trustworthy/i);
    assert.match(prompt, /Indonesian traders 25-45/i);
    assert.match(prompt, /no hashtags/i);
    assert.match(prompt, /wrong teal/i);
    assert.match(prompt, /no logo\/wordmark\/monogram of any kind/i);
    assert.match(prompt, /generic stock/i);
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
  assert.match(sample, /lower-right/i);
  assert.match(sample, /draw no logo/i);
  assert.doesNotMatch(sample, /graphic mark \+ wordmark/);
  assert.match(sample, /80px/);
  assert.match(sample, /Exact headline/);
  assert.match(sample, /Subheadline/);
  assert.match(sample, /CTA/);
  assert.match(sample, /visual hierarchy/i);
  assert.match(sample, /composited onto the finished image/i);
  assert.match(sample, /do NOT draw one/i);
  assert.equal(sample.includes(DUPOIN_LOGO_REQUIRED_LINE), true);
  assert.match(sample, /Rencana dulu, baru entry/, 'must use the selected hook');
  assert.match(sample, /Kelola risiko sebelum membuka posisi/, 'must use the selected caption');
  assert.match(sample, /no hashtags/i);
  assert.match(sample, /no logo\/wordmark\/monogram\/symbol of any kind/i);
  assert.match(sample, /"Dupoin" lettering drawn into the art/i);
  assert.match(sample, new RegExp(spec.size));
  assert.match(sample, /9:16/);
  assert.match(sample, /portrait/);
  assert.equal(sample.includes(spec.promptSuffix), true);
  assert.doesNotMatch(sample, /JANGAN (minta|tulis)[^\n]*teks/i);
  assert.doesNotMatch(sample, /Include a small official Dupoin logo/i);
});

test('applyDupoinImagePromptLocks reserves logo space and locks the selected size', () => {
  const locked = applyDupoinImagePromptLocks('Premium Instagram advertising poster', '4:3');
  const spec = getImageGenerationSpec('4:3');

  assert.match(locked, /lower-right/);
  assert.match(locked, /reserved/i);
  assert.match(locked, /#2EB5C4/);
  assert.match(locked, /draw no logo/i);
  assert.doesNotMatch(locked, /graphic mark \+ wordmark/);
  assert.equal(locked.includes(spec.promptSuffix), true);
  assert.equal(applyDupoinImagePromptLocks(locked, '4:3'), locked, 'locks must be idempotent for the same ratio');

  const switched = applyDupoinImagePromptLocks(locked, '1:1');
  assert.match(switched, /exact 1:1 square aspect ratio \(1024x1024\)/);
  assert.doesNotMatch(switched, /exact 4:3 landscape aspect ratio \(1536x1024\)/);
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
