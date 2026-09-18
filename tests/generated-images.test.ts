import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { isSafeGeneratedImageFilename, generatedImageContentType } from '../src/lib/generated-images';
import { GET, respondGeneratedImage } from '../src/app/api/generated-images/[filename]/route';

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

test('unauthenticated generated-image GET is rejected', async () => {
  const request = new NextRequest('http://localhost/api/generated-images/DUPOIN_Test_SocialPost_V1_20260723.png');
  const response = await GET(request, {
    params: Promise.resolve({ filename: 'DUPOIN_Test_SocialPost_V1_20260723.png' }),
  });

  assert.equal(response.status, 401);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Unauthorized');
  assert.doesNotMatch(response.headers.get('Cache-Control') || '', /public/i);
});

test('authenticated generated-image GET serves the file privately', async () => {
  const filename = 'DUPOIN_AuthCheck_SocialPost_V1_20260918.png';
  const imagesDir = path.join(process.cwd(), 'public', 'outputs', 'images');
  const filePath = path.join(imagesDir, filename);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  fs.mkdirSync(imagesDir, { recursive: true });
  fs.writeFileSync(filePath, png);
  try {
    const response = await respondGeneratedImage(
      { userId: 'test-user' },
      { filename },
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'image/png');
    assert.equal(response.headers.get('Cache-Control'), 'private, max-age=3600');
    assert.doesNotMatch(response.headers.get('Cache-Control') || '', /public/i);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, png);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test('authenticated generated-image GET still rejects traversal filenames', async () => {
  const response = await respondGeneratedImage(
    { userId: 'test-user' },
    { filename: '../.env' },
  );
  assert.equal(response.status, 404);
});
