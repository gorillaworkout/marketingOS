import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import {
  buildStoryboardImagePrompt,
  normalizeStoryboardScenes,
  parseVideoFormat,
  scenesFromScript,
  suggestVideoFormat,
  videoFormatInstruction,
  withStoryboard,
} from '../src/lib/video-script-format';
import { buildStoryboardPdf, buildStoryboardZip } from '../src/lib/video-script-storyboard-export';

test('each video format has its own structure', () => {
  assert.equal(parseVideoFormat('Talking-Head'), 'talking-head');
  assert.equal(parseVideoFormat('webinar'), null);
  assert.match(videoFormatInstruction('talking-head'), /to-camera lines/);
  assert.match(videoFormatInstruction('talking-head'), /cutaways/);
  assert.match(videoFormatInstruction('interview'), /HOST:/);
  assert.match(videoFormatInstruction('street-interview'), /vox-pop/);
  assert.match(videoFormatInstruction('motion-graphic'), /ON-SCREEN TEXT/);
  assert.match(videoFormatInstruction('event-recap'), /timeline of moments/);
  assert.match(videoFormatInstruction('b-roll'), /shot list/);
  assert.doesNotMatch(videoFormatInstruction('b-roll'), /HOST:/);
});

test('a Social Post handoff prefills a sensible format and still accepts the old payload', () => {
  assert.equal(suggestVideoFormat({ brief: 'Gold outlook', shots: ['Close on the chart'] }), 'b-roll');
  assert.equal(suggestVideoFormat({ brief: 'Host and guest podcast about spreads' }), 'interview');
  assert.equal(suggestVideoFormat({ brief: 'Street interview outside the exchange' }), 'street-interview');
  assert.equal(suggestVideoFormat({ brief: 'Motion graphic explainer of leverage' }), 'motion-graphic');
  assert.equal(suggestVideoFormat({ brief: 'Event recap of the awarding night' }), 'event-recap');
  assert.equal(suggestVideoFormat({ brief: 'A short market note' }), 'talking-head');
});

test('storyboard scenes are capped and a timestamped script still splits', () => {
  const scenes = normalizeStoryboardScenes([
    { shot: 'Presenter to camera', onScreenText: 'Dupoin', vo: 'Hello', duration: '4s' },
    { shot: '' },
    ...Array.from({ length: 10 }, (_, index) => ({ shot: `Extra ${index}` })),
  ]);
  assert.equal(scenes.length, 8);
  assert.equal(scenes[0].number, 1);
  assert.equal(scenes[0].onScreenText, 'Dupoin');
  const fallback = scenesFromScript('[0:00]\n[VISUAL: Chart]\n[VO: Gold moved.]\n\n[0:05]\n[SHOT: Logo]\n[VO: Trade with care.]');
  assert.equal(fallback.length, 2);
  assert.match(fallback[0].shot, /Chart/);
  const saved = withStoryboard({ event: 'Gold' }, { format: 'b-roll', scenes: fallback });
  assert.equal(saved.event, 'Gold');
  assert.equal((saved.storyboard as { format: string }).format, 'b-roll');
});

test('a storyboard frame prompt names the shot and not a competitor offer', () => {
  const prompt = buildStoryboardImagePrompt({
    number: 2,
    shot: 'Hands over a laptop',
    onScreenText: 'Clear pricing',
    vo: 'Check the spread.',
    duration: '5s',
  }, 'talking-head');
  assert.match(prompt, /Hands over a laptop/);
  assert.match(prompt, /Clear pricing/);
  assert.match(prompt, /No competitor logos/);
});

test('storyboard downloads keep the scene text when an image is missing', async () => {
  const scenes = [{ number: 1, shot: 'Wide of the studio', onScreenText: '', vo: 'Welcome.', duration: '5s', imageError: 'Image generation failed.' }];
  const pdf = await buildStoryboardPdf({ title: 'Gold', format: 'talking-head', scenes });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  const zip = await buildStoryboardZip({ title: 'Gold', scenes, readImage: async () => Buffer.from('png') });
  const unpacked = await JSZip.loadAsync(zip);
  const sheet = await unpacked.file('storyboard.txt')?.async('string');
  assert.match(sheet || '', /Wide of the studio/);
  assert.match(sheet || '', /Image generation failed/);
});

test('Video Script page requires a format and can generate a storyboard', () => {
  const page = readFileSync('src/app/dashboard/video-script/page.tsx', 'utf8');
  const route = readFileSync('src/app/api/video-script/generate/route.ts', 'utf8');
  const social = readFileSync('src/app/dashboard/social-post/page.tsx', 'utf8');
  assert.match(page, /data-testid="video-script-format"/);
  assert.match(page, /VideoStoryboard/);
  assert.match(page, /suggestVideoFormat/);
  assert.match(route, /videoFormatInstruction/);
  assert.match(route, /A video format is required/);
  assert.match(social, /contentType,/);
  assert.match(social, /Open in Video Script/);
});
