import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AVAILABLE_IMAGE_MODELS,
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  isAllowedImageModel,
  imageModelLabel,
  RETIRED_IMAGE_MODEL_REPLACEMENTS,
  resolveAssignedImageModels,
  resolveImageModel,
  selectableImageModel,
} from '../src/lib/image-models';

const ids = AVAILABLE_IMAGE_MODELS.map(model => model.id);

assert.equal(DEFAULT_IMAGE_MODEL, 'ag/gemini-3.1-flash-image');
assert.deepEqual(ids, ['ag/gemini-3.1-flash-image']);
// 400 on a ChatGPT-account Codex connection (2026-11-02); migration 042 repoints stored assignments.
assert.equal(ids.includes('cx/gpt-5.5-image'), false);
assert.equal(isAllowedImageModel('cx/gpt-5.5-image'), false);
assert.equal(resolveImageModel('cx/gpt-5.5-image'), 'ag/gemini-3.1-flash-image');
assert.equal(imageModelLabel('cx/gpt-5.5-image'), 'GPT-5.5 Image', 'history rows keep a readable label');
assert.equal(selectableImageModel('cx/gpt-5.5-image'), 'ag/gemini-3.1-flash-image', 'replayed tasks select a live model');
assert.equal(selectableImageModel('nope'), DEFAULT_IMAGE_MODEL);
// Not exposed by 9router (2026-11-02); migration 039 repoints stored assignments.
assert.equal(ids.includes('ag/nano-banana'), false);
assert.equal(ids.includes('ag/nano-banana-pro'), false);
assert.deepEqual({ ...RETIRED_IMAGE_MODEL_REPLACEMENTS }, {
  'ag/nano-banana': 'ag/gemini-3.1-flash-image',
  'ag/nano-banana-pro': 'ag/gemini-3.1-flash-image',
  'cx/gpt-5.5-image': 'ag/gemini-3.1-flash-image',
});
assert.equal(ids.includes('cx/gpt-5.4-image'), false);
assert.equal(ids.includes('ag/nanobanana'), false);
assert.equal(isAllowedImageModel('ag/nano-banana-pro'), false);
assert.equal(isAllowedImageModel('ag/nano-banana'), false);
assert.equal(isAllowedImageModel('ag/gemini-3.1-flash-image'), true);
assert.equal(isAllowedImageModel('ag/nanobanana'), false);
assert.equal(resolveImageModel('ag/nano-banana'), 'ag/gemini-3.1-flash-image', 'stale nano-banana requests use the live Gemini image model');
assert.equal(resolveImageModel('ag/nano-banana-pro'), 'ag/gemini-3.1-flash-image');
assert.equal(resolveImageModel('ag/gemini-3.1-flash-image'), 'ag/gemini-3.1-flash-image');
assert.equal(resolveImageModel('unknown'), DEFAULT_IMAGE_MODEL);
assert.equal(resolveImageModel(undefined), DEFAULT_IMAGE_MODEL);

const stale = resolveAssignedImageModels(['gpt-5.6-terra'], 'gpt-5.6-terra');
assert.deepEqual(stale.models.map(model => model.id), ids);
assert.equal(stale.defaultModel, DEFAULT_IMAGE_MODEL);

const generateImage = readFileSync('src/app/api/generate-image/route.ts', 'utf8');
const llmProvider = readFileSync('src/lib/llm-provider.ts', 'utf8');
assert.match(generateImage, /postImage/);
assert.match(generateImage, /\/images\/generations/);
assert.match(llmProvider, /resolveGorillaWorkoutApiBase/);
assert.match(llmProvider, /images\/generations/);
assert.match(generateImage, /resolveImageModel/);
assert.match(generateImage, /generateWithAntigravityCapacityFallback/);
assert.doesNotMatch(generateImage, /gpt-5\.4-image|ag\/nanobanana/);

const socialPost = readFileSync('src/app/dashboard/social-post/page.tsx', 'utf8');
assert.match(socialPost, /AVAILABLE_IMAGE_MODELS/);
assert.match(socialPost, /DEFAULT_IMAGE_MODEL/);
assert.doesNotMatch(socialPost, /gpt-5\.4-image|gpt-5\.5-image|ag\/nanobanana/);
assert.match(socialPost, /useState\(DEFAULT_IMAGE_MODEL\)/, 'initial selection before /api/image-models loads');
assert.match(socialPost, /selectableImageModel\(restoredModelId/);
assert.match(socialPost, /selectableImageModel\(remix\.model/);
assert.match(generateImage, /: DEFAULT_IMAGE_MODEL;/, 'requests without a model use the default');

// Production shape after the admin switch: allowed still lists the dead id.
const prod = resolveAssignedImageModels(['cx/gpt-5.5-image', 'ag/gemini-3.1-flash-image'], 'ag/gemini-3.1-flash-image');
assert.deepEqual(prod.models.map(model => model.id), ['ag/gemini-3.1-flash-image']);
assert.equal(prod.defaultModel, 'ag/gemini-3.1-flash-image');
const prodOld = resolveAssignedImageModels(['cx/gpt-5.5-image', 'ag/gemini-3.1-flash-image'], 'cx/gpt-5.5-image');
assert.equal(prodOld.defaultModel, 'ag/gemini-3.1-flash-image');

const migration = readFileSync('db/migrations/042_retire_cx_gpt_5_5_image.sql', 'utf8');
const executable = migration.replace(/--.*$/gm, '');
assert.match(executable, /BEGIN;[\s\S]*COMMIT;/);
assert.match(executable, /WHEN model = 'cx\/gpt-5\.5-image' THEN 'ag\/gemini-3\.1-flash-image'/);
assert.match(executable, /GROUP BY combined\.model/);
assert.match(executable, /ALTER COLUMN default_model SET DEFAULT 'ag\/gemini-3\.1-flash-image'/);
assert.match(executable, /ALTER COLUMN allowed_models SET DEFAULT '\["ag\/gemini-3\.1-flash-image"\]'/);
assert.doesNotMatch(executable, /\?|DELETE FROM|INSERT INTO|TRUNCATE|DROP TABLE|feature_model_assignments/i);

assert.equal(IMAGE_MODELS.length, 1);
console.log('image models catalog contract passed');
