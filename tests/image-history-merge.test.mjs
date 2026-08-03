// Self-check for the output_data merge used by recordImageOnTask:
// appending an image must preserve existing task fields and prior images.
import assert from 'node:assert/strict';

function mergeImage(outputData, entry) {
  let data = {};
  if (outputData) {
    const parsed = typeof outputData === 'string' ? JSON.parse(outputData) : outputData;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
  }
  const existing = Array.isArray(data.images) ? data.images : [];
  return JSON.stringify({ ...data, images: [...existing, entry], imageUrl: entry.imageUrl });
}

const img1 = { imageUrl: '/api/generated-images/a.png', fileName: 'a.png', model: 'gpt-5.6-terra' };
const img2 = { imageUrl: '/api/generated-images/b.png', fileName: 'b.png', model: 'gpt-image-2' };

// 1. Existing generation fields survive the merge.
const original = JSON.stringify({ options: [{ caption: 'hi' }], qcResults: ['ok'], researchPosts: [1, 2] });
const after1 = JSON.parse(mergeImage(original, img1));
assert.deepEqual(after1.options, [{ caption: 'hi' }], 'options must survive');
assert.deepEqual(after1.qcResults, ['ok'], 'qcResults must survive');
assert.deepEqual(after1.researchPosts, [1, 2], 'researchPosts must survive');
assert.equal(after1.images.length, 1);
assert.equal(after1.imageUrl, img1.imageUrl, 'latest imageUrl is exposed');

// 2. Second generation appends instead of overwriting.
const after2 = JSON.parse(mergeImage(JSON.stringify(after1), img2));
assert.equal(after2.images.length, 2, 'images must accumulate');
assert.equal(after2.images[0].fileName, 'a.png');
assert.equal(after2.images[1].fileName, 'b.png');
assert.equal(after2.imageUrl, img2.imageUrl, 'imageUrl points at newest');
assert.deepEqual(after2.options, [{ caption: 'hi' }], 'options still survive');

// 3. Null / malformed output_data must not throw.
assert.equal(JSON.parse(mergeImage(null, img1)).images.length, 1);
assert.equal(JSON.parse(mergeImage('[1,2,3]', img1)).images.length, 1, 'array payload is ignored, not merged');

console.log('image-history-merge: all assertions passed');
