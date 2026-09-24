import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAiResearchChatBody } from '../src/lib/ai-research-request';
import {
  AI_RESEARCH_MAX_PROJECTS,
  AI_RESEARCH_PROJECT_MEMORY_MAX_CHARS,
  AI_RESEARCH_PROJECT_NAME_MAX,
  AI_RESEARCH_PROJECT_SUMMARY_MAX,
  appendProjectSummary,
  buildProjectMemoryBlock,
  conversationBelongsToProject,
  normalizeProjectName,
  normalizeProjectNotes,
  selectProjectMemoryTurns,
} from '../src/lib/ai-research-projects';

const read = (path: string) => readFileSync(path, 'utf8');

test('project names and notes are trimmed and capped', () => {
  assert.equal(normalizeProjectName('  emas   kompetitor  '), 'emas kompetitor');
  assert.equal(normalizeProjectName(`x${'y'.repeat(200)}`).length, AI_RESEARCH_PROJECT_NAME_MAX);
  assert.throws(() => normalizeProjectName('   '), /Project name is required/);
  assert.throws(() => normalizeProjectName(12), /Project name is required/);
  assert.equal(normalizeProjectNotes('  catat spread\r\nAntam  '), 'catat spread\nAntam');
  assert.equal(normalizeProjectNotes(null), '');
  assert.ok(normalizeProjectNotes('a'.repeat(5_000)).length <= 2_000);
});

test('project membership keeps inbox and project threads apart', () => {
  assert.equal(conversationBelongsToProject(null, null), true);
  assert.equal(conversationBelongsToProject(undefined, null), true);
  assert.equal(conversationBelongsToProject('emas', null), false);
  assert.equal(conversationBelongsToProject('emas', 'emas'), true);
  assert.equal(conversationBelongsToProject('emas', 'kompetitor'), false);
  assert.equal(conversationBelongsToProject(null, 'emas'), false);
});

test('project memory keeps notes, summary, and other-thread turns inside a char cap', () => {
  const turns = selectProjectMemoryTurns([
    [
      { role: 'user', content: 'terbaru: harga emas hari ini' },
      { role: 'assistant', content: 'sumber menyebut penguatan, tanpa angka baru' },
    ],
    [
      { role: 'user', content: 'lama: kompetitor X' },
      { role: 'assistant', content: 'catatan lama yang tidak boleh menggeser giliran terbaru' },
    ],
  ], { maxTurns: 2, maxChars: 500 });
  assert.equal(turns.length, 2);
  assert.match(turns[0].content, /terbaru/);
  assert.doesNotMatch(turns.map(turn => turn.content).join(' '), /kompetitor X/);

  const block = buildProjectMemoryBlock({
    name: 'emas',
    notes: 'Jangan mengarang harga Antam.',
    summary: 'User bertanya soal spread.',
    recentTurns: turns,
  });
  assert.match(block, /Project name: emas/);
  assert.match(block, /Jangan mengarang harga Antam/);
  assert.match(block, /Project conversation summary/);
  assert.match(block, /other threads/);
  assert.match(block, /not new web evidence/);
  assert.ok(block.length <= AI_RESEARCH_PROJECT_MEMORY_MAX_CHARS);

  const huge = buildProjectMemoryBlock({
    name: 'emas',
    notes: 'catatan '.repeat(2_000),
    summary: 'ringkas '.repeat(2_000),
    recentTurns: Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `giliran ${index} ${'fakta '.repeat(80)}`,
    })),
  });
  assert.ok(huge.length <= AI_RESEARCH_PROJECT_MEMORY_MAX_CHARS);
  assert.match(huge, /Project name: emas/);
});

test('rolling project summary keeps the newest turn when the cap is exceeded', () => {
  let summary = '';
  for (let index = 0; index < 8; index += 1) {
    summary = appendProjectSummary(
      summary,
      `pertanyaan ${index} ${'emas '.repeat(40)}`,
      `jawaban ${index} ${'sumber '.repeat(40)}`,
    );
  }
  assert.ok(summary.length <= AI_RESEARCH_PROJECT_SUMMARY_MAX);
  assert.match(summary, /pertanyaan 7/);
  assert.match(summary, /jawaban 7/);
  assert.doesNotMatch(summary, /pertanyaan 0/);
});

test('chat request carries an optional project id and the route scopes threads', () => {
  const parsed = parseAiResearchChatBody({
    projectId: '  proj-emas  ',
    messages: [{ role: 'user', content: 'lanjutkan riset emas' }],
  });
  assert.equal(parsed.projectId, 'proj-emas');
  assert.equal(parseAiResearchChatBody({
    projectId: 'inbox',
    messages: [{ role: 'user', content: 'halo' }],
  }).projectId, undefined);

  const route = read('src/app/api/ai-research/chat/route.ts');
  const migration = read('db/migrations/016_ai_research_projects.sql');
  const page = read('src/app/dashboard/ai-research/page.tsx');
  const projectsRoute = read('src/app/api/ai-research/projects/route.ts');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_research_projects/);
  assert.match(migration, /project_id TEXT REFERENCES ai_research_projects\(id\) ON DELETE SET NULL/);
  assert.match(migration, /notes TEXT NOT NULL DEFAULT ''/);
  assert.match(migration, /summary TEXT NOT NULL DEFAULT ''/);
  assert.match(route, /project_id/);
  assert.match(route, /buildProjectMemoryBlock/);
  assert.match(route, /selectProjectMemoryTurns/);
  assert.match(route, /appendProjectSummary/);
  assert.match(route, /AND project_id IS NULL/);
  assert.match(route, /AND project_id = \?/);
  assert.match(route, /Boolean\(history\)/);
  assert.match(projectsRoute, /requireFeature\(request, 'ai-research'\)/);
  assert.match(projectsRoute, new RegExp(`LIMIT \\?`));
  assert.equal(AI_RESEARCH_MAX_PROJECTS, 40);
  assert.match(page, /data-testid="ai-research-project-switcher"/);
  assert.match(page, /General chat/);
  assert.match(page, /data-testid="ai-research-project-create"/);
  assert.match(page, /Pinned notes/);
  assert.match(page, /data-testid="ai-research-project-delete"/);
  assert.match(page, /Delete this project\? Conversations return to General chat\./);
  assert.match(page, /projectId: activeProjectId/);
  assert.match(page, /conversationBelongsToProject/);
  assert.match(page, /\?project=/);
});
