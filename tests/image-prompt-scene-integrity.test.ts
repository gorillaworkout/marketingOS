import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stripFlatOverlayLanguage,
  applyDupoinImagePromptLocks,
  IMAGE_PROMPT_SYSTEM,
  buildSocialPostImagePromptUserMessage,
} from '../src/lib/dupoin-image-prompt';

/**
 * Regression: generated creatives came back with a flat translucent slab pasted
 * over the artwork — "filled only with a very subtle dark charcoal gradient
 * (#1A1F24 at 80% opacity)". That phrasing is not in our code; the model invents
 * it whenever it wants text contrast. Instructions alone do not stop it, so the
 * clause is stripped in code before the prompt reaches the renderer.
 */

test('strips the exact slab phrasing that shipped on a real creative', () => {
  const prompt = [
    'A trader at a walnut desk beside a tall window, late afternoon light from camera left.',
    'The lower third is filled only with a very subtle dark charcoal gradient (#1A1F24 at 80% opacity).',
    'Headline sits on the plain wall above.',
  ].join(' ');

  const cleaned = stripFlatOverlayLanguage(prompt);

  assert.doesNotMatch(cleaned, /80% opacity/i);
  assert.doesNotMatch(cleaned, /#1A1F24/);
  assert.match(cleaned, /walnut desk/, 'the real scene description must survive');
  assert.match(cleaned, /Headline sits on the plain wall/, 'unrelated sentences must survive');
});

test('strips every common way the model asks for a slab', () => {
  const cases = [
    'Dark gradient overlay across the bottom for text contrast.',
    'A semi-transparent black panel behind the headline.',
    'Add a contrast panel under the copy.',
    'Place a scrim over the lower half.',
    'Background at opacity: 0.6 to help the type read.',
    'A gradient layer sits above the photograph.',
    'Text box behind the headline in dark grey.',
  ];

  for (const sentence of cases) {
    const cleaned = stripFlatOverlayLanguage(`A trader at a desk by a window. ${sentence}`);
    assert.match(cleaned, /A trader at a desk by a window/, `scene must survive: ${sentence}`);
    assert.doesNotMatch(
      cleaned,
      /overlay|scrim|opacity|panel behind|contrast panel|gradient layer|text box behind/i,
      `slab language leaked through: ${sentence}`,
    );
  }
});

test('keeps our own negative instructions, which legitimately name those words', () => {
  const negatives = 'No overlay, no panel behind the text, no gradient layer, no opacity effects.';
  assert.equal(stripFlatOverlayLanguage(negatives).includes('No overlay'), true);
});

test('keeps light and colour that belong to the scene', () => {
  const scene = 'Dupoin Blue #2EB5C4 glows from the chart lines on the monitor and rims his jaw. '
    + 'Warm window light falls across the desk, leaving soft shadow in the lower-right corner.';
  const cleaned = stripFlatOverlayLanguage(scene);
  assert.match(cleaned, /#2EB5C4/, 'brand accent as real light must survive');
  assert.match(cleaned, /chart lines/);
  assert.match(cleaned, /soft shadow in the lower-right/);
});

test('every generated prompt carries scene-integrity negatives', () => {
  const locked = applyDupoinImagePromptLocks(
    'A trader at a walnut desk. Lower third filled with a dark charcoal gradient at 80% opacity.',
    '3:4',
  );

  assert.doesNotMatch(locked, /80% opacity/i, 'the slab clause must be gone');
  assert.match(locked, /No overlay/i, 'and replaced by an explicit negative');
  assert.match(locked, /scene's own lighting/i);
  assert.match(locked, /walnut desk/, 'scene survives the locks');
});

test('stripping is idempotent and preserves paragraph structure', () => {
  // applyDupoinImagePromptLocks can run twice (e.g. when the aspect ratio is
  // switched), so collapsing newlines here would corrupt the prompt.
  const prompt = [
    'A trader at a walnut desk beside a tall window.',
    '',
    'Dark gradient overlay across the bottom.',
    'Headline sits on the plain wall above.',
  ].join('\n');

  const once = stripFlatOverlayLanguage(prompt);
  assert.equal(stripFlatOverlayLanguage(once), once, 'stripping twice must not change the result');
  assert.match(once, /\n/, 'paragraph breaks must survive');
  assert.doesNotMatch(once, /overlay/i);

  const locked = applyDupoinImagePromptLocks('Premium Instagram advertising poster', '4:3');
  assert.equal(applyDupoinImagePromptLocks(locked, '4:3'), locked, 'locks must stay idempotent');
});

test('the art-direction system prompt forbids slabs and demands one integrated scene', () => {
  assert.match(IMAGE_PROMPT_SYSTEM, /JANGAN pernah sebut overlay, panel, scrim/i);
  assert.match(IMAGE_PROMPT_SYSTEM, /JANGAN pernah sebut nilai opacity/i);
  assert.match(IMAGE_PROMPT_SYSTEM, /satu adegan utuh/i);
  assert.match(IMAGE_PROMPT_SYSTEM, /cahaya nyata di dalam adegan/i);
  // The fix for unreadable text is relighting, not patching.
  assert.match(IMAGE_PROMPT_SYSTEM, /mengatur ulang cahaya dan komposisi/i);
});

test('the user message asks for one flowing scene, not a spec list', () => {
  const message = buildSocialPostImagePromptUserMessage({
    brief: 'Edukasi risk management',
    hook: 'Rencana dulu, baru entry',
    caption: 'Kelola risiko sebelum membuka posisi.',
    aspectRatio: '3:4',
  });

  assert.match(message, /satu paragraf mengalir/i);
  assert.match(message, /DILARANG/);
  assert.match(message, /bukan sebagai lapisan/i);
});
