import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiResearchSkillChip, AiResearchSkillPicker } from '../src/components/AiResearchSkillControls';
import { parseAiResearchChatBody } from '../src/lib/ai-research-request';
import {
  AI_RESEARCH_CONTINUE_USER_MESSAGE,
  AI_RESEARCH_SKILL_IDS,
  AI_RESEARCH_SKILLS,
  aiResearchSkillById,
  buildSkillSystemAddendum,
  clampSkillHighlight,
  commitComposerSkill,
  filterAiResearchSkills,
  parseAiResearchSkill,
  parseComposerSlash,
  skillRemainderAfterSelect,
  slashPickerOpen,
  withSkillSystemPrompt,
} from '../src/lib/ai-research-skills';

const read = (path: string) => readFileSync(path, 'utf8');

const UNIQUE: Record<(typeof AI_RESEARCH_SKILL_IDS)[number], RegExp> = {
  goal: /Ask exactly one question/,
  interview: /Ask one question at a time/,
  'grill-me': /strongest objection/,
  compare: /criteria table/,
  brief: /Not established/,
  critique: /Do not rewrite the whole piece/,
  sources: /general knowledge/,
  persona: /did not name a persona/,
  outline: /Open questions/,
  decide: /Not enough evidence to choose/,
  eli5: /What this does not mean/,
  continue: /Do not repeat the prior answer/,
};

test('catalog is the twelve English research skills', () => {
  assert.deepEqual([...AI_RESEARCH_SKILL_IDS], [
    'goal',
    'interview',
    'grill-me',
    'compare',
    'brief',
    'critique',
    'sources',
    'persona',
    'outline',
    'decide',
    'eli5',
    'continue',
  ]);
  assert.equal(AI_RESEARCH_CONTINUE_USER_MESSAGE, 'Continue.');
  for (const id of AI_RESEARCH_SKILL_IDS) {
    const skill = aiResearchSkillById(id);
    assert.ok(skill);
    assert.equal(skill.id, id);
    assert.match(skill.label, /^[A-Z]/);
    assert.match(skill.description, /^[A-Z]/);
    assert.match(skill.placeholder, /^[A-Z]/);
    assert.doesNotMatch(`${skill.label} ${skill.description} ${skill.placeholder}`, /untuk|Bahasa/i);
  }
});

test('each skill prompt states its behavior and keeps memory and the knowledge graph', () => {
  for (const id of AI_RESEARCH_SKILL_IDS) {
    const prompt = buildSkillSystemAddendum(id);
    assert.match(prompt, new RegExp(`SKILL: /${id}`));
    assert.match(prompt, UNIQUE[id]);
    assert.match(prompt, /internal knowledge graph/i);
    assert.match(prompt, /learned memory/i);
    assert.match(prompt, /Do not invent facts/);
    assert.match(prompt, /Never cite learned memory as a public source/);
  }
  assert.equal(buildSkillSystemAddendum(undefined), '');
});

test('skill addendum is inserted after the base prompt and before memory and the knowledge graph', () => {
  const prompt = withSkillSystemPrompt([
    'BASE RULES',
    'USER PROFILE',
    'INTERNAL KNOWLEDGE GRAPH',
    '',
  ], 'sources');
  const baseAt = prompt.indexOf('BASE RULES');
  const skillAt = prompt.indexOf('SKILL: /sources');
  const profileAt = prompt.indexOf('USER PROFILE');
  const graphAt = prompt.indexOf('INTERNAL KNOWLEDGE GRAPH');
  assert.ok(baseAt >= 0 && skillAt > baseAt && profileAt > skillAt && graphAt > profileAt);
  assert.match(prompt, /general knowledge/);
  assert.equal(withSkillSystemPrompt(['BASE RULES', '', 'USER PROFILE']), 'BASE RULES\n\nUSER PROFILE');
});

test('slash picker filters by id prefix and the composer commits an exact id', () => {
  assert.equal(filterAiResearchSkills('').length, 12);
  assert.deepEqual(filterAiResearchSkills('g').map(skill => skill.id), ['goal', 'grill-me']);
  assert.deepEqual(filterAiResearchSkills('/eli').map(skill => skill.id), ['eli5']);
  assert.deepEqual(filterAiResearchSkills('Explain').map(skill => skill.id), ['eli5']);
  assert.deepEqual(filterAiResearchSkills('zzz'), []);

  assert.equal(parseComposerSlash('see /goal'), null);
  assert.deepEqual(parseComposerSlash('/go'), { token: 'go', remainder: '', incomplete: true });
  assert.deepEqual(parseComposerSlash('/GOAL write it'), {
    token: 'goal',
    remainder: 'write it',
    incomplete: false,
  });
  assert.deepEqual(commitComposerSkill('/brief  the Q4 launch'), {
    skillId: 'brief',
    nextInput: 'the Q4 launch',
  });
  assert.equal(commitComposerSkill('/go'), null);
  assert.equal(commitComposerSkill('/nope now'), null);
  assert.equal(skillRemainderAfterSelect('/bri'), '');
  assert.equal(slashPickerOpen('/g', false), true);
  assert.equal(slashPickerOpen('/goal write', false), false);
  assert.equal(slashPickerOpen('/g', true), false);
  assert.equal(slashPickerOpen('hello', false), false);
  assert.equal(clampSkillHighlight(-1, 3), 2);
  assert.equal(clampSkillHighlight(3, 3), 0);
});

test('chat body accepts a skill id and rejects an unknown skill', () => {
  assert.equal(parseAiResearchSkill(undefined), undefined);
  assert.equal(parseAiResearchSkill(' /Goal '), 'goal');
  assert.equal(parseAiResearchSkill('grill-me'), 'grill-me');
  assert.throws(() => parseAiResearchSkill('nope'), /Unknown research skill/);
  assert.throws(() => parseAiResearchSkill(3), /Research skill is not valid/);

  const parsed = parseAiResearchChatBody({
    skill: '/sources',
    messages: [{ role: 'user', content: 'What is the spread?' }],
  });
  assert.equal(parsed.skill, 'sources');
  assert.equal(parsed.messages[0].content, 'What is the spread?');
  assert.throws(() => parseAiResearchChatBody({
    skill: 'nope',
    messages: [{ role: 'user', content: 'hello' }],
  }), /Unknown research skill/);
});

test('skill picker renders every skill and the chip names the active one', () => {
  const picker = renderToStaticMarkup(createElement(AiResearchSkillPicker, {
    skills: [...AI_RESEARCH_SKILLS],
    highlight: 0,
    onHighlight: () => {},
    onSelect: () => {},
  }));
  assert.match(picker, /id="ai-research-skill-picker"/);
  assert.match(picker, /aria-selected="true"/);
  for (const skill of AI_RESEARCH_SKILLS) {
    assert.match(picker, new RegExp(`data-testid="ai-research-skill-option-${skill.id}"`));
    assert.ok(picker.includes(skill.label), skill.label);
    assert.ok(picker.includes(skill.description), skill.description);
  }
  const empty = renderToStaticMarkup(createElement(AiResearchSkillPicker, {
    skills: [],
    highlight: 0,
    onHighlight: () => {},
    onSelect: () => {},
  }));
  assert.match(empty, /No matching skill/);
  const chip = renderToStaticMarkup(createElement(AiResearchSkillChip, {
    skill: AI_RESEARCH_SKILLS[0],
    onClear: () => {},
  }));
  assert.match(chip, /data-testid="ai-research-skill-chip"/);
  assert.match(chip, /\/goal/);
  assert.match(chip, /Remove Goal skill/);
});

test('AI Research page opens a skill picker and sends the active skill', () => {
  const page = read('src/app/dashboard/ai-research/page.tsx');
  const controls = read('src/components/AiResearchSkillControls.tsx');
  assert.match(page, /slashPickerOpen/);
  assert.match(page, /commitComposerSkill/);
  assert.match(page, /AiResearchSkillPicker/);
  assert.match(page, /AiResearchSkillChip/);
  assert.match(page, /skill: activeSkill/);
  assert.match(page, /ArrowDown/);
  assert.match(page, /Escape/);
  assert.match(page, /AI_RESEARCH_CONTINUE_USER_MESSAGE/);
  assert.match(page, /activeSkill === 'continue'/);
  assert.match(page, /Type \/ for a skill/);
  assert.match(controls, /data-testid="ai-research-skill-picker"/);
  assert.match(controls, /data-testid="ai-research-skill-chip"/);
  assert.match(controls, /role="listbox"/);
  assert.match(controls, /No matching skill/);
  assert.match(controls, /Remove \$\{skill\.label\} skill/);
});

test('chat route injects the skill prompt on fast and deep without dropping memory', () => {
  const route = read('src/app/api/ai-research/chat/route.ts');
  assert.match(route, /compare, skill/);
  const call = 'withSkillSystemPrompt(';
  assert.equal(route.split(call).length - 1, 2);
  const deepStart = route.indexOf(call);
  const fastStart = route.indexOf(call, deepStart + call.length);
  const deep = route.slice(deepStart, fastStart);
  const fast = route.slice(fastStart);
  assert.match(deep, /knowledgeContext/);
  assert.match(deep, /learned\.profileBlock/);
  assert.match(deep, /AI_RESEARCH_DEEP_SYSTEM_ADDENDUM/);
  assert.match(deep, /, skill\)/);
  assert.match(fast, /knowledgeContext/);
  assert.match(fast, /learned\.profileBlock/);
  assert.match(fast, /buildCompareSystemAddendum/);
  assert.match(fast, /, skill\)/);
});
