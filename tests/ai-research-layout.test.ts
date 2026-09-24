import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

test('AI Research keeps a viewport shell and scrolls the answer, not the page', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  const page = read('src/app/dashboard/ai-research/page.tsx');
  const markdown = read('src/components/AiResearchMarkdown.tsx');
  const sources = read('src/components/AiResearchSourcesPanel.tsx');
  const watches = read('src/components/AiResearchWatchPanel.tsx');

  assert.match(layout, /lg:pl-\[264px\]/);
  assert.match(layout, /className="sticky top-0 z-30 flex h-14/);

  assert.match(page, /data-testid="ai-research-shell"/);
  assert.match(page, /fixed inset-x-0 bottom-0 top-14 z-10 flex min-h-0 min-w-0 flex-col overflow-hidden/);
  assert.match(page, /lg:left-\[264px\] lg:top-0/);
  assert.match(page, /documentElement/);
  assert.match(page, /style\.overflow = 'hidden'/);
  assert.doesNotMatch(page, /h-\[calc\(100vh-64px\)\]/);
  assert.doesNotMatch(page, /scrollIntoView/);

  assert.match(page, /data-testid="ai-research-drop-zone"/);
  assert.match(page, /relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden/);
  assert.match(page, /data-testid="ai-research-transcript"/);
  assert.match(page, /min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain/);
  assert.match(page, /transcript\.scrollTo\(\{ top: transcript\.scrollHeight \}\)/);

  assert.match(page, /data-testid="ai-research-composer"/);
  assert.match(page, /min-h-0 max-h-80 shrink overflow-y-auto overscroll-contain/);
  assert.match(page, /data-testid="ai-research-mode-toggle"/);
  assert.match(page, /data-testid="ai-research-compare-toggle"/);
  assert.match(page, /data-testid="ai-research-compare-fields"/);
  assert.match(page, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);

  assert.match(markdown, /min-w-0 max-w-full space-y-2 break-words/);
  assert.match(markdown, /max-w-full overflow-x-auto/);

  assert.match(sources, /flex min-h-0 w-\[min\(100vw,20rem\)\] flex-col overflow-hidden/);
  assert.match(sources, /min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain/);
  assert.match(watches, /flex h-full min-h-0 w-\[min\(100vw,24rem\)\] flex-col overflow-hidden/);
  assert.match(watches, /min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain/);
});
