import assert from 'node:assert/strict';
import { AVAILABLE_MODELS, PREFERRED_CODEX_MODEL } from '../src/lib/openai';

/**
 * Catalog contract. Gemini 3.6 ids were verified with a real completion via
 * scripts/probe-gateway-models.ts. Codex `cx/*` is restored from the VPS
 * llmdupoin GET /v1/models probe (HTTP 200, 51 ids, 2026-09-18) so
 * /dashboard/models is not empty of GPT-5.6 Sol. Re-probe before removing.
 * `ag/gemini-3.7-*` was previously asserted as required but the gateway
 * answers 404; the live Flash generation is 3.6.
 */
const ids = AVAILABLE_MODELS.map(model => model.id);

assert(!ids.some(id => id.includes('gemini-3.5')), 'retired Gemini 3.5 models must not be offered');
assert(!ids.some(id => id.includes('gemini-3.7')), 'Gemini 3.7 does not exist on the gateway (404)');

assert(ids.includes('ag/gemini-3.6-flash-low'), 'Gemini 3.6 Flash Low must be offered');
assert(ids.includes('ag/gemini-3.6-flash-medium'), 'Gemini 3.6 Flash Medium must be offered');
assert(ids.includes('ag/gemini-3.6-flash-high'), 'Gemini 3.6 Flash High must be offered');

assert.equal(PREFERRED_CODEX_MODEL, 'cx/gpt-5.6-sol');
assert(ids.includes('cx/gpt-5.6-sol'), 'GPT-5.6 Sol must be offered');
assert(ids.includes('cx/gpt-5.6-terra'), 'GPT-5.6 Terra must be offered');
assert(ids.includes('cx/gpt-5.6-luna'), 'GPT-5.6 Luna must be offered');
assert(ids.includes('cx/gpt-5.5'), 'GPT-5.5 must be offered');
assert(ids.includes('cx/gpt-5.4'), 'GPT-5.4 must be offered');
assert(ids.includes('cx/gpt-5.4-mini'), 'GPT-5.4 Mini must be offered');
assert(ids.includes('cx/gpt-5.3-codex-spark'), 'GPT-5.3 Codex Spark must be offered');

assert(!ids.some(id => id.startsWith('kimi/') || id.startsWith('tr/') || id.startsWith('cmc/moonshotai/') || id.toLowerCase().includes('kimi')), 'Kimi / moonshot must stay removed');
assert(!ids.some(id => id.startsWith('cc/')), 'retired Claude Code must stay out');
assert(!ids.some(id => id.endsWith('-review')), 'unverified Codex *-review ids stay out');
assert(!ids.includes('pecut-free'), 'pecut-free must stay retired');

console.log('model catalog contract passed');
