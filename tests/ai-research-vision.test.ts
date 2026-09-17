import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AI_RESEARCH_IMAGE_ONLY_PROMPT,
  buildGatewayMessages,
  buildMultimodalContent,
  conversationTitleFromMessages,
  parseChatRequest,
  parseStoredMessages,
  validateImageAttachments,
} from '../src/lib/ai-research';

const pngPixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const dataUrl = `data:image/png;base64,${pngPixel}`;

const read = (path: string) => readFileSync(path, 'utf8');

test('accepts valid image attachments and rejects type, count, and size errors', () => {
  assert.deepEqual(validateImageAttachments([{ mimeType: 'image/png', dataUrl, name: 'chart.png' }]), [
    { mimeType: 'image/png', dataUrl, name: 'chart.png' },
  ]);
  assert.throws(() => validateImageAttachments([{ mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,AAAA' }]), /Unsupported image type/i);
  assert.throws(() => validateImageAttachments(Array.from({ length: 5 }, () => ({ mimeType: 'image/png', dataUrl }))), /up to 4 images/i);
  const oversized = `data:image/jpeg;base64,${'A'.repeat(Math.ceil((4 * 1024 * 1024 + 3) * 4 / 3))}`;
  assert.throws(() => validateImageAttachments([{ mimeType: 'image/jpeg', dataUrl: oversized }]), /4 MB/i);
});

test('parses a user turn with text plus images and fills an image-only prompt', () => {
  const withText = parseChatRequest({
    conversationId: 'conv-1',
    messages: [{ role: 'user', content: 'Baca angka di grafik ini', images: [{ mimeType: 'image/png', dataUrl }] }],
  });
  assert.equal(withText.conversationId, 'conv-1');
  assert.equal(withText.messages[0].content, 'Baca angka di grafik ini');
  assert.equal(withText.messages[0].images?.[0].mimeType, 'image/png');

  const imageOnly = parseChatRequest({
    messages: [{ role: 'user', content: '   ', images: [{ mimeType: 'image/png', dataUrl }] }],
  });
  assert.equal(imageOnly.messages[0].content, AI_RESEARCH_IMAGE_ONLY_PROMPT);

  assert.throws(() => parseChatRequest({ messages: [{ role: 'user', content: '' }] }), /text or at least one image/i);
});

test('builds OpenAI-compatible multimodal content and keeps recent images for the gateway', () => {
  const content = buildMultimodalContent('Extract the headline', [{ mimeType: 'image/png', dataUrl, name: 'ad.png' }]);
  assert.deepEqual(content, [
    { type: 'text', text: 'Extract the headline' },
    { type: 'image_url', image_url: { url: dataUrl } },
  ]);

  const oldest = { role: 'user' as const, content: 'oldest chart', images: [{ mimeType: 'image/png' as const, dataUrl, name: 'old.png' }] };
  const mid = { role: 'user' as const, content: 'mid chart', images: [{ mimeType: 'image/png' as const, dataUrl, name: 'mid.png' }] };
  const newest = { role: 'user' as const, content: 'new chart', images: [{ mimeType: 'image/png' as const, dataUrl, name: 'new.png' }] };
  const gateway = buildGatewayMessages('system', [oldest, { role: 'assistant', content: 'old answer' }, mid], [newest], 20);
  assert.equal(gateway[0].content, 'system');
  assert.match(String(gateway[1].content), /image\(s\) were attached/);
  assert.deepEqual(gateway[3].content, [
    { type: 'text', text: 'mid chart' },
    { type: 'image_url', image_url: { url: dataUrl } },
  ]);
  assert.deepEqual(gateway[4].content, [
    { type: 'text', text: 'new chart' },
    { type: 'image_url', image_url: { url: dataUrl } },
  ]);
});

test('conversation titles prefer user text and stay backward compatible with stored string messages', () => {
  assert.equal(conversationTitleFromMessages([
    { role: 'user', content: 'What moved XAUUSD overnight?' },
  ]), 'What moved XAUUSD overnight?');
  assert.equal(conversationTitleFromMessages([
    { role: 'user', content: AI_RESEARCH_IMAGE_ONLY_PROMPT, images: [{ mimeType: 'image/png', dataUrl }] },
  ]), 'Image analysis (1)');
  assert.deepEqual(parseStoredMessages(JSON.stringify([{ role: 'user', content: 'legacy text only' }])), [
    { role: 'user', content: 'legacy text only' },
  ]);
});

test('AI Research UI adds a file picker, previews, and sends images with the prompt', () => {
  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(page, /type="file"/);
  assert.match(page, /accept=\{AI_RESEARCH_ALLOWED_IMAGE_TYPES\.join\(','\)\}/);
  assert.match(page, /multiple/);
  assert.match(page, /previewUrl/);
  assert.match(page, /JSON\.stringify\(\{ messages: \[userMsg\], conversationId: activeConvoId \}\)/);
  assert.match(page, /dataUrl: await readFileAsDataUrl\(item\.file\)/);
  assert.match(page, /canSend/);
});

test('AI Research chat route forwards multimodal content to the existing gateway', () => {
  const route = read('src/app/api/ai-research/chat/route.ts');
  assert.match(route, /requireFeature\(request, 'ai-research'\)/);
  assert.match(route, /rateLimit\(request\)/);
  assert.match(route, /parseChatRequest/);
  assert.match(route, /buildGatewayMessages/);
  assert.match(route, /resolveFeatureModel\(auth\.id, 'ai-research'\)/);
  assert.match(route, /GORILLAWORKOUT_API_BASE.*\/chat\/completions/);
  assert.doesNotMatch(route, /catch \(\(\) => 'ag\/gemini-3-flash-agent'\)/);
  assert.doesNotMatch(route, /OPENROUTER_API_KEY|callCodex|callClaude/);
});
