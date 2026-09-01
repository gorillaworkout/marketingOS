import assert from 'node:assert/strict';
import { AVAILABLE_MODELS } from '../src/lib/openai';

const ids = AVAILABLE_MODELS.map(model => model.id);
assert(!ids.some(id => id.includes('gemini-3.5')), 'retired Gemini 3.5 models must not be offered');
assert(ids.includes('ag/gemini-3.7-flash-low'), 'Gemini 3.7 Flash Low must be offered');
assert(ids.includes('ag/gemini-3.7-flash-medium'), 'Gemini 3.7 Flash Medium must be offered');
assert(ids.includes('ag/gemini-3.7-flash-high'), 'Gemini 3.7 Flash High must be offered');
console.log('model catalog contract passed');
