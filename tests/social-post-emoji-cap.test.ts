import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runQC } from '../src/lib/openai';
import { capSocialPostEmojis, countEmojis, emojiLimit, emojiPromptRule, trimEmojis } from '../src/lib/social-post-brief';

const tags = Array.from({ length: 16 }, (_, index) => `#gold${index}`);
const emojiCheck = (caption: string, platform = 'Instagram', style = 'bold') =>
  runQC(caption, tags, platform, { style }).checks.find(check => check.name === 'emoji_count');

test('countEmojis counts whole emoji sequences, not code points', () => {
  assert.equal(countEmojis('Halo 😀'), 1);
  assert.equal(countEmojis('❤️ love'), 1, 'variation selector is part of the emoji');
  assert.equal(countEmojis('👍🏽 mantap'), 1, 'skin tone modifier is part of the emoji');
  assert.equal(countEmojis('👨‍👩‍👧‍👦 keluarga'), 1, 'ZWJ family is one emoji');
  assert.equal(countEmojis('👩🏽‍💻 trader'), 1, 'ZWJ with a skin tone is one emoji');
  assert.equal(countEmojis('🇮🇩 Indonesia'), 1, 'a flag is one emoji');
  assert.equal(countEmojis('1️⃣ langkah'), 1, 'a keycap is one emoji');
  assert.equal(countEmojis('🏴󠁧󠁢󠁳󠁣󠁴󠁿 tag flag'), 1, 'a tag-sequence flag is one emoji');
  assert.equal(countEmojis('Dupoin® dan Gold™ 2026 #1'), 0, 'plain ®, ™, digits and # are not emojis');
  assert.equal(countEmojis('🔥🚀💰📈✨'), 5);
});

test('trimEmojis keeps the first N emojis and removes the rest', () => {
  const text = '🔥 Emas naik! 🚀 Cek sekarang 💰 dan 📈 juga ✨ ya 👍🏽';
  const trimmed = trimEmojis(text, 3);
  assert.equal(countEmojis(trimmed.text), 3);
  assert.equal(trimmed.removed, 3);
  assert.ok(trimmed.text.startsWith('🔥 Emas naik! 🚀 Cek sekarang 💰 dan'));
  assert.doesNotMatch(trimmed.text, /📈|✨|👍/);
  assert.doesNotMatch(trimmed.text, /\uFE0F|\u{1F3FD}|\u200D/u, 'no orphaned selectors, skin tones or joiners');
  assert.doesNotMatch(trimmed.text, / {2}/, 'no double spaces left behind');
  assert.match(trimmed.text, /juga ya$/);
});

test('trimEmojis removes ZWJ sequences whole and is a no-op under the cap', () => {
  const text = 'A 😀 B 👨‍👩‍👧‍👦 C ❤️ D';
  const trimmed = trimEmojis(text, 1);
  assert.equal(trimmed.text, 'A 😀 B C D');
  assert.equal(trimmed.removed, 2);
  assert.deepEqual(trimEmojis('Tanpa emoji', 3), { text: 'Tanpa emoji', removed: 0 });
  assert.deepEqual(trimEmojis('😀 ok', 5), { text: '😀 ok', removed: 0 });
  assert.equal(trimEmojis('😀 ok 😀', 0).text, 'ok');
});

test('production repro: 20 and 12 emojis on Bold pass QC after the cap', () => {
  const max = emojiLimit('Instagram', 'bold');
  const hook = '🔥🔥 GAS TERUS! 🚀';
  const caption = `${'Emas lagi panas banget 😂🤣 '.repeat(4)}Yuk belajar 📈💰✨🎯💪👀🙌 di Dupoin Academy! 👇👇 ${'A'.repeat(40)}`;
  const before = `${hook}\n${caption}`;
  assert.ok(countEmojis(before) >= 20);
  assert.equal(emojiCheck(before)?.passed, false);
  const capped = capSocialPostEmojis({ hook, caption }, max);
  assert.equal(countEmojis(`${capped.hook}\n${capped.caption}`), max);
  assert.equal(capped.removed, countEmojis(before) - max);
  assert.ok(capped.hook.startsWith('🔥🔥 GAS TERUS! 🚀'), 'the hook keeps its first emojis');
  const check = emojiCheck(`${capped.hook}\n${capped.caption}`);
  assert.equal(check?.passed, true);
  assert.equal(check?.detail, `${max} emojis (max ${max})`);

  const twelve = `${'Halo 😂 '.repeat(12)}${'B'.repeat(60)}`;
  assert.equal(emojiCheck(twelve)?.detail, '12 emojis — too many (max 8)');
  const cappedTwelve = capSocialPostEmojis({ hook: '', caption: twelve }, max);
  assert.equal(emojiCheck(`${cappedTwelve.hook}\n${cappedTwelve.caption}`)?.passed, true);
});

test('QC counts a ZWJ or variation-selector emoji once', () => {
  assert.equal(emojiCheck(`${'A'.repeat(80)} ❤️❤️`, 'LinkedIn')?.passed, true);
  assert.equal(emojiCheck(`${'A'.repeat(80)} 👨‍👩‍👧‍👦`, 'LinkedIn')?.detail, '1 emojis (max 2)');
});

test('the prompt states the emoji cap explicitly for each style and platform', () => {
  assert.match(emojiPromptRule('Instagram', 'bold'), /at most 8 emojis/i);
  assert.match(emojiPromptRule('LinkedIn', 'bold'), /at most 2 emojis/i);
  assert.match(emojiPromptRule('Instagram', 'professional'), /at most 6 emojis/i);
  const route = readFileSync('src/app/api/social-post/generate/route.ts', 'utf8');
  assert.match(route, /emojiPromptRule\(platform, variant\.style\)/);
  assert.doesNotMatch(route, /Use emojis generously/);
  const capAt = route.indexOf('capSocialPostEmojis(');
  const qcAt = route.indexOf('runQC(`${opt.hook}');
  assert.ok(capAt > 0 && capAt < qcAt, 'emojis are capped before QC runs');
});
