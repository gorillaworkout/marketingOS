import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  IMAGE_ASPECT_RATIOS,
  getImageGenerationSpec,
  parseImageAspectRatio,
  withImageAspectPrompt,
} from '../src/lib/image-aspect-ratio';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

test('allows the five ratios and defaults omitted input to desktop 16:9', () => {
  assert.deepEqual(IMAGE_ASPECT_RATIOS, ['16:9', '4:3', '1:1', '3:4', '9:16']);
  assert.equal(DEFAULT_IMAGE_ASPECT_RATIO, '16:9');
  assert.equal(parseImageAspectRatio(undefined), '16:9');
  for (const ratio of IMAGE_ASPECT_RATIOS) assert.equal(parseImageAspectRatio(ratio), ratio);
});

test('rejects invalid ratio input at the server boundary', () => {
  assert.throws(() => parseImageAspectRatio('2:1'), /Invalid image aspect ratio/);
  assert.throws(() => parseImageAspectRatio(16), /Invalid image aspect ratio/);
});

test('maps ratios to supported gateway sizes and preserves exact composition intent', () => {
  assert.deepEqual(getImageGenerationSpec('16:9'), {
    size: '1536x1024',
    orientation: 'landscape',
    promptSuffix: 'Compose the image in an exact 16:9 landscape aspect ratio (1536x1024); keep all essential subjects and branding inside that frame.',
  });
  assert.equal(getImageGenerationSpec('4:3').size, '1536x1024');
  assert.equal(getImageGenerationSpec('1:1').size, '1024x1024');
  assert.equal(getImageGenerationSpec('3:4').size, '1024x1536');
  assert.equal(getImageGenerationSpec('9:16').size, '1024x1536');
  for (const ratio of IMAGE_ASPECT_RATIOS) {
    const spec = getImageGenerationSpec(ratio);
    assert.match(spec.promptSuffix, new RegExp(`exact ${ratio.replace(':', '\\:')}`));
    assert.match(spec.promptSuffix, new RegExp(spec.size));
  }
});

test('withImageAspectPrompt bakes dropdown size into prompt text without stacking', () => {
  const first = withImageAspectPrompt('Premium Instagram advertising poster', '9:16');
  assert.match(first, /exact 9:16 portrait aspect ratio \(1024x1536\)/);
  const second = withImageAspectPrompt(first, '1:1');
  assert.match(second, /exact 1:1 square aspect ratio \(1024x1024\)/);
  assert.equal(second.includes(getImageGenerationSpec('9:16').promptSuffix), false);
  assert.equal(withImageAspectPrompt(second, '1:1'), second);
});

test('Social Post chooser precedes Generate image and submits selected ratio plus prompt locks', () => {
  const page = read('src/app/dashboard/social-post/page.tsx');
  assert.match(page, /useState<ImageAspectRatio>\(DEFAULT_IMAGE_ASPECT_RATIO\)/);
  assert.match(page, /applyDupoinImagePromptLocks\(editableImagePrompt, imageAspectRatio\)/);
  assert.match(page, /JSON\.stringify\(\{[\s\S]*prompt: imagePrompt[\s\S]*aspectRatio: imageAspectRatio/);
  const chooser = page.indexOf('Image aspect ratio');
  const generate = page.indexOf("generatingImage ? 'Generating image…' : 'Generate image'");
  assert.ok(chooser >= 0 && chooser < generate, 'ratio chooser must render before Generate image');
  assert.match(page, /IMAGE_ASPECT_RATIOS\.map\(ratio => <option key=\{ratio\} value=\{ratio\}>\{ratio\}<\/option>\)/);
  assert.match(page, /applyDupoinImagePromptLocks\(prev, ratio\)/);
});

test('route threads ratio through gateway request, job result, and task history', () => {
  const route = read('src/app/api/generate-image/route.ts');
  const status = read('src/lib/image-job-status.ts');
  assert.match(route, /parseImageAspectRatio\(body\.aspectRatio\)/);
  assert.match(route, /runImageJob\([\s\S]*aspectRatio/);
  assert.match(route, /applyDupoinImagePromptLocks\(prompt, aspectRatio\)/);
  assert.match(route, /prompt: gatewayPrompt/);
  assert.match(route, /size: generationSpec\.size/);
  assert.match(route, /result: ImageJobResult = \{[\s\S]*aspectRatio/);
  assert.match(route, /recordImageOnTask\([\s\S]*aspectRatio/);
  assert.match(status, /aspectRatio\?: ImageAspectRatio/);
  assert.match(status, /usedModel\?: string/);
  assert.match(status, /fallbackFrom\?: string/);
  assert.match(status, /fallbackMessage\?: string/);
});
