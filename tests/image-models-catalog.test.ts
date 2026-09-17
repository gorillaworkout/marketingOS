import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AVAILABLE_IMAGE_MODELS,
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  isAllowedImageModel,
  resolveAssignedImageModels,
  resolveImageModel,
} from '../src/lib/image-models';

const ids = AVAILABLE_IMAGE_MODELS.map(model => model.id);

assert.equal(DEFAULT_IMAGE_MODEL, 'cx/gpt-5.5-image');
assert.deepEqual(ids, [
  'cx/gpt-5.5-image',
  'ag/nano-banana',
  'ag/nano-banana-pro',
  'ag/gemini-3.1-flash-image',
]);
assert.equal(ids.includes('cx/gpt-5.4-image'), false);
assert.equal(ids.includes('ag/nanobanana'), false);
assert.equal(isAllowedImageModel('ag/nano-banana-pro'), true);
assert.equal(isAllowedImageModel('ag/gemini-3.1-flash-image'), true);
assert.equal(isAllowedImageModel('ag/nanobanana'), false);
assert.equal(resolveImageModel('ag/nano-banana'), 'ag/nano-banana');
assert.equal(resolveImageModel('ag/gemini-3.1-flash-image'), 'ag/gemini-3.1-flash-image');
assert.equal(resolveImageModel('unknown'), DEFAULT_IMAGE_MODEL);
assert.equal(resolveImageModel(undefined), DEFAULT_IMAGE_MODEL);

const stale = resolveAssignedImageModels(['gpt-5.6-terra'], 'gpt-5.6-terra');
assert.deepEqual(stale.models.map(model => model.id), ids);
assert.equal(stale.defaultModel, DEFAULT_IMAGE_MODEL);

const generateImage = readFileSync('src/app/api/generate-image/route.ts', 'utf8');
assert.match(generateImage, /GORILLAWORKOUT_API_BASE/);
assert.match(generateImage, /\/images\/generations/);
assert.match(generateImage, /resolveImageModel/);
assert.match(generateImage, /generateWithAntigravityCapacityFallback/);
assert.doesNotMatch(generateImage, /gpt-5\.4-image|ag\/nanobanana/);

const socialPost = readFileSync('src/app/dashboard/social-post/page.tsx', 'utf8');
assert.match(socialPost, /AVAILABLE_IMAGE_MODELS/);
assert.match(socialPost, /DEFAULT_IMAGE_MODEL/);
assert.doesNotMatch(socialPost, /gpt-5\.4-image|ag\/nanobanana/);

assert.equal(IMAGE_MODELS.length, 4);
console.log('image models catalog contract passed');
