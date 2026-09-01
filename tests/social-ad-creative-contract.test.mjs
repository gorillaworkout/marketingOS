import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const openai = readFileSync(new URL('../src/lib/openai.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/app/api/social-post/generate/route.ts', import.meta.url), 'utf8');
const imagePromptSection = openai.slice(openai.indexOf("'image-prompt':"), openai.indexOf("Tulis prompt langsung tanpa pembuka"));
const routePromptStart = route.indexOf('Buat advertising creative prompt');
const routePrompt = route.slice(routePromptStart, route.indexOf('userId,', routePromptStart));

for (const term of ['Exact headline', 'Subheadline', 'CTA', 'visual hierarchy', '80px', 'Dupoin logo']) {
  assert.match(`${imagePromptSection}\n${routePrompt}`, new RegExp(term, 'i'), `missing advertising contract: ${term}`);
}
assert.match(routePrompt, /selectedCaption\.hook/, 'image prompt must use the selected hook');
assert.match(routePrompt, /selectedCaption\.caption/, 'image prompt must use the selected caption');
assert.doesNotMatch(`${imagePromptSection}\n${routePrompt}`, /JANGAN (minta|tulis)[^\n]*teks/i, 'must not prohibit advertising text');
console.log('social ad creative contract passed');
