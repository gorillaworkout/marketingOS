import assert from 'node:assert/strict';
import { AVAILABLE_MODELS } from '../src/lib/openai';

/**
 * Catalog contract. Every id asserted here was verified with a real completion
 * via scripts/probe-gateway-models.ts on 2026-09-18 — never by guessing a
 * version number. `ag/gemini-3.7-*` was previously asserted as required but the
 * gateway answers 404 "Requested entity was not found" for it; the live Flash
 * generation is 3.6.
 */
const ids = AVAILABLE_MODELS.map(model => model.id);

assert(!ids.some(id => id.includes('gemini-3.5')), 'retired Gemini 3.5 models must not be offered');
assert(!ids.some(id => id.includes('gemini-3.7')), 'Gemini 3.7 does not exist on the gateway (404)');

assert(ids.includes('ag/gemini-3.6-flash-low'), 'Gemini 3.6 Flash Low must be offered');
assert(ids.includes('ag/gemini-3.6-flash-medium'), 'Gemini 3.6 Flash Medium must be offered');
assert(ids.includes('ag/gemini-3.6-flash-high'), 'Gemini 3.6 Flash High must be offered');

console.log('model catalog contract passed');
