import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeGeneratedImageFilename, generatedImageContentType } from '../src/lib/generated-images';

test('accepts a generated PNG filename and resolves its content type', () => {
  const filename = 'DUPOIN_RisikoTrading_SocialPost_V1_20260723.png';

  assert.equal(isSafeGeneratedImageFilename(filename), true);
  assert.equal(generatedImageContentType(filename), 'image/png');
});

test('rejects traversal attempts and unsupported files', () => {
  assert.equal(isSafeGeneratedImageFilename('../.env'), false);
  assert.equal(isSafeGeneratedImageFilename('image.svg'), false);
  assert.equal(isSafeGeneratedImageFilename('image.png/../../secret'), false);
});
