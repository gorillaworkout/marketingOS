import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AI_RESEARCH_CAMERA_ACCEPT,
  AI_RESEARCH_CAMERA_CAPTURE,
  cameraCaptureErrorMessage,
  cameraFileForAttachment,
  cameraPhotoWithinLimit,
  inPageCameraBlockReason,
  prefersOsCamera,
} from '../src/lib/ai-research-camera';
import { AI_RESEARCH_MAX_IMAGE_BYTES } from '../src/lib/ai-research';

const read = (path: string) => readFileSync(path, 'utf8');
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('camera files keep allowed image types and gain a matching name', async () => {
  const aliased = await cameraFileForAttachment(new File([jpeg], 'photo.JPG', { type: 'image/jpg' }), 1700000000000);
  assert.equal(aliased.type, 'image/jpeg');
  assert.equal(aliased.name, 'photo.JPG');

  const sniffed = await cameraFileForAttachment(new File([jpeg], 'blob', { type: '' }), 1700000000000);
  assert.equal(sniffed.type, 'image/jpeg');
  assert.equal(sniffed.name, 'blob.jpg');

  const pngFile = await cameraFileForAttachment(new File([png], 'chart.png', { type: 'image/png' }));
  assert.equal(pngFile.type, 'image/png');
  assert.equal(pngFile.name, 'chart.png');

  const rejected = new File([new Uint8Array([1, 2, 3, 4])], 'notes.txt', { type: 'text/plain' });
  assert.equal(await cameraFileForAttachment(rejected), rejected);
  assert.equal(cameraPhotoWithinLimit(AI_RESEARCH_MAX_IMAGE_BYTES), true);
  assert.equal(cameraPhotoWithinLimit(AI_RESEARCH_MAX_IMAGE_BYTES + 1), false);
});

test('mobile browsers use the OS camera and desktop explains blocked previews', () => {
  assert.equal(prefersOsCamera({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }), true);
  assert.equal(prefersOsCamera({ userAgent: 'Mozilla/5.0 (Linux; Android 14)' }), true);
  assert.equal(prefersOsCamera({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    coarsePointer: true,
  }), true);
  assert.equal(prefersOsCamera({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0',
    coarsePointer: false,
    hoverNone: false,
  }), false);
  assert.equal(prefersOsCamera({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    coarsePointer: true,
    hoverNone: true,
  }), true);

  assert.match(inPageCameraBlockReason({ secureContext: false, hasGetUserMedia: true }) || '', /HTTPS/);
  assert.match(inPageCameraBlockReason({ secureContext: true, hasGetUserMedia: false }) || '', /does not support a camera preview/);
  assert.equal(inPageCameraBlockReason({ secureContext: true, hasGetUserMedia: true }), null);
  assert.match(cameraCaptureErrorMessage('NotAllowedError'), /Camera permission was denied/);
  assert.match(cameraCaptureErrorMessage('NotFoundError'), /No camera was found/);
  assert.match(cameraCaptureErrorMessage('NotReadableError'), /in use by another app/);
  assert.match(cameraCaptureErrorMessage('Oops'), /could not be opened/);
  assert.equal(AI_RESEARCH_CAMERA_ACCEPT, 'image/*');
  assert.equal(AI_RESEARCH_CAMERA_CAPTURE, 'environment');
});

test('AI Research camera control feeds the existing attachment pipeline', () => {
  const page = read('src/app/dashboard/ai-research/page.tsx');
  const button = read('src/components/AiResearchCameraButton.tsx');
  assert.match(page, /AiResearchCameraButton/);
  assert.match(page, /onCapture=\{file => addAttachments\(\[file\]\)\}/);
  assert.match(page, /The camera button takes a photo and attaches it/);
  assert.match(button, /data-testid="ai-research-camera"/);
  assert.match(button, /data-testid="ai-research-camera-input"/);
  assert.match(button, /accept=\{AI_RESEARCH_CAMERA_ACCEPT\}/);
  assert.match(button, /capture=\{AI_RESEARCH_CAMERA_CAPTURE\}/);
  assert.match(button, /getUserMedia/);
  assert.match(button, /cameraCaptureErrorMessage/);
  assert.match(button, /inPageCameraBlockReason/);
  assert.match(button, /data-testid="ai-research-camera-shutter"/);
  assert.match(button, /data-testid="ai-research-camera-fallback"/);
  assert.doesNotMatch(button, /\/api\//);
});
