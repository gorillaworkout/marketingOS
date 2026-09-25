import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  imageRemixHref,
  imageRemixTarget,
  linkedGeneratedImages,
} from '../src/lib/image-remix';
import { historyEditorHref, historyEditorLabel } from '../src/lib/history-editor';

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), 'utf8');

test('linked images keep the prompt and generation inputs stored on that file', () => {
  const linked = linkedGeneratedImages({
    imagePrompt: 'caption prompt fallback',
    includeSwipeLeft: true,
    imageUrl: '/api/generated-images/latest.png',
    images: [
      {
        imageUrl: '/api/generated-images/older.png',
        fileName: 'older.png',
        prompt: 'Older scene with a navy field',
        aspectRatio: '4:3',
        model: 'gpt-image-2',
        includeSwipeLeft: false,
      },
      {
        imageUrl: '/api/generated-images/latest.png',
        prompt: 'Latest scene prompt',
        aspectRatio: '9:16',
        model: 'cx/gpt-5.4-image',
        includeSwipeLeft: true,
      },
    ],
  });

  assert.deepEqual(linked.map(item => item.filename), ['older.png', 'latest.png']);
  assert.deepEqual(linked[0], {
    filename: 'older.png',
    prompt: 'Older scene with a navy field',
    aspectRatio: '4:3',
    model: 'gpt-image-2',
    includeSwipeLeft: false,
  });
  assert.equal(linked[1]?.prompt, 'Latest scene prompt');
  assert.equal(linked[1]?.includeSwipeLeft, true);
  assert.equal(linked[1]?.aspectRatio, '9:16');
});

test('a filename-only image falls back to the task image prompt and does not invent one for other files', () => {
  const linked = linkedGeneratedImages({
    imagePrompt: 'Shared caption prompt',
    imageUrl: '/outputs/images/only.png',
    images: ['/api/generated-images/encoded%20name.png'],
  });
  assert.equal(linked.find(item => item.filename === 'only.png')?.prompt, 'Shared caption prompt');
  assert.equal(linked.find(item => item.filename === 'encoded name.png')?.prompt, 'Shared caption prompt');
  assert.equal(linkedGeneratedImages({ imagePrompt: 'hidden', images: [] }).length, 0);
  assert.equal(linkedGeneratedImages(null).length, 0);
});

test('remix routes only Social Post images and history opens the matching editor', () => {
  assert.equal(imageRemixTarget('social-post'), 'social-post');
  assert.equal(imageRemixTarget('video-script'), null);
  assert.equal(imageRemixTarget(null), null);
  assert.equal(imageRemixHref('social-post'), '/dashboard/social-post?remix=1');
  assert.equal(historyEditorHref('social-post', 'task 1'), '/dashboard/social-post?task=task%201');
  assert.equal(historyEditorHref('video-script', 'abc'), '/dashboard/video-script?task=abc');
  assert.equal(historyEditorHref('event-plan', 'abc'), '/dashboard/event-plan?task=abc');
  assert.equal(historyEditorHref('article-market-news', 'abc'), '/dashboard/sop?task=abc');
  assert.equal(historyEditorHref('market-research', 'abc'), '/dashboard/market-research?task=abc');
  assert.equal(historyEditorHref('unknown', 'abc'), null);
  assert.equal(historyEditorLabel('social-post'), 'Re-generate');
  assert.equal(historyEditorLabel('event-plan'), 'Use in editor');
});

test('gallery and history surface the stored prompt without pulling sharp into the client', () => {
  const gallery = read('src/app/dashboard/images/page.tsx');
  const galleryApi = read('src/app/api/images/route.ts');
  const history = read('src/app/dashboard/history/page.tsx');
  const historyApi = read('src/app/api/dashboard/history/route.ts');
  const social = read('src/app/dashboard/social-post/page.tsx');
  const remix = read('src/lib/image-remix.ts');
  const editor = read('src/lib/history-editor.ts');

  assert.match(galleryApi, /linkedGeneratedImages/);
  assert.match(galleryApi, /t\.type/);
  assert.match(gallery, /data-testid="gallery-image-prompt"/);
  assert.match(gallery, /data-testid="gallery-copy-prompt"/);
  assert.match(gallery, /data-testid="gallery-regenerate"/);
  assert.match(gallery, /writeImageRemix/);
  assert.match(gallery, /imageRemixHref/);
  assert.match(history, /historyEditorHref/);
  assert.match(history, /data-testid="history-use-in-editor"/);
  assert.match(historyApi, /searchParams\.get\('id'\)/);
  assert.match(historyApi, /user_id = \? AND id = \?/);
  assert.match(social, /IMAGE_REMIX_QUERY/);
  assert.match(social, /TASK_EDITOR_QUERY/);
  assert.match(social, /includeSwipeLeft/);
  assert.match(social, /data-testid="social-post-image-history-remix"/);
  assert.doesNotMatch(social, /setGeneratedImage\(img\.imageUrl\)/);

  for (const source of [gallery, history, social, remix, editor]) {
    assert.doesNotMatch(source, /from 'sharp'/);
    assert.doesNotMatch(source, /dupoin-ig-chrome['"]/);
  }
});
