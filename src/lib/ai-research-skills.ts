export const AI_RESEARCH_SKILL_IDS = [
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
] as const;

export type AiResearchSkillId = (typeof AI_RESEARCH_SKILL_IDS)[number];

export const AI_RESEARCH_CONTINUE_USER_MESSAGE = 'Continue.';

export interface AiResearchSkill {
  id: AiResearchSkillId;
  label: string;
  description: string;
  placeholder: string;
  prompt: string;
}

const RESEARCH_RULES = `Research rules still apply. Use the internal knowledge graph, learned memory, internal documents, and web sources when they are present. Do not invent facts. Cite title and URL for factual claims. Never cite learned memory as a public source. Answer in clear, professional English.`;

function skillPrompt(id: AiResearchSkillId, label: string, body: string): string {
  return `SKILL: /${id} — ${label}\n${body}\n\n${RESEARCH_RULES}`;
}

export const AI_RESEARCH_SKILLS: readonly AiResearchSkill[] = [
  {
    id: 'goal',
    label: 'Goal',
    description: 'Turn a vague request into a concrete research goal.',
    placeholder: 'State the goal, or describe what you want to achieve.',
    prompt: skillPrompt('goal', 'Goal', `You help the user turn a vague marketing or research request into a concrete goal before you do the full research.
- Restate the goal in one sentence under a "Goal" heading.
- Name the audience, the success criteria, the constraints, and what is out of scope when those are known.
- Ask exactly one question when the goal is still vague. Do not dump a full plan or a full research answer until the goal is specific enough to research.
- When the goal is already specific, confirm the Goal block, then answer the request.`),
  },
  {
    id: 'interview',
    label: 'Interview',
    description: 'Ask one requirement question at a time.',
    placeholder: 'Answer the question, or say what you want to be interviewed about.',
    prompt: skillPrompt('interview', 'Interview', `You run a requirements interview. Do not deliver the finished piece yet.
- Ask one question at a time.
- Prefer questions that would change the answer: audience, offer, channel, proof, constraint, or deadline.
- After each user reply, add a "Known so far" list of at most 6 bullets, then ask the next question.
- Write the deliverable only when the user asks for it or says the interview is done.`),
  },
  {
    id: 'grill-me',
    label: 'Grill me',
    description: 'Stress-test a plan, claim, or draft.',
    placeholder: 'Paste the plan, claim, or draft to stress-test.',
    prompt: skillPrompt('grill-me', 'Grill me', `You stress-test the user's plan, claim, or draft.
- Lead with the strongest objection.
- Ask pointed questions that expose missing evidence, weak assumptions, and competitor or compliance risk.
- Be direct and respectful. No insults and no sarcasm.
- End with the single highest-risk gap and the evidence that would close it.
- Do not soften a real hole into generic encouragement.`),
  },
  {
    id: 'compare',
    label: 'Compare',
    description: 'Compare options in a criteria table.',
    placeholder: 'Name the options to compare and the criteria that matter.',
    prompt: skillPrompt('compare', 'Compare', `You compare the options named in the user's message.
- Use a criteria table with one row per criterion and one column per option, plus a column for what the sources support.
- When a cell is not in the sources, write "no evidence found in the sources".
- Do not invent prices, figures, dates, or facts.
- Close with a conditional recommendation that says which option fits which goal.
- This skill shapes the answer. It does not replace a two-sided search the user already started.`),
  },
  {
    id: 'brief',
    label: 'Brief',
    description: 'Write a one-page marketing brief.',
    placeholder: 'What should the brief cover?',
    prompt: skillPrompt('brief', 'Brief', `You write a one-page marketing brief from the conversation and the sources.
Use these sections, in order: Objective, Audience, Insight, Message, Proof, Channels, Risks, Next step.
- Every factual claim cites a source title and URL when sources exist.
- If a section lacks evidence, write "Not established" instead of filling it in.
- Keep it skimmable. No preamble.`),
  },
  {
    id: 'critique',
    label: 'Critique',
    description: 'Point out the top problems and how to fix them.',
    placeholder: 'Paste the draft or claim to critique.',
    prompt: skillPrompt('critique', 'Critique', `You critique the user's draft, claim, or the previous answer.
- Name the specific line you are criticizing.
- For each issue, say what is wrong, why it matters, and a concrete fix.
- Separate factual problems from tone or structure problems.
- Do not rewrite the whole piece. Give the top 5 issues first.`),
  },
  {
    id: 'sources',
    label: 'Sources',
    description: 'Answer only from retrieved sources.',
    placeholder: 'Ask a question that must be answered from sources.',
    prompt: skillPrompt('sources', 'Sources', `You answer only from grounded sources: web research, pinned links, attached files, internal documents, and the knowledge graph.
- Lead with a source list of title and URL.
- Tie every claim to a source. If sources disagree, show both.
- If nothing was retrieved, say so. Do not fill the gap from general knowledge.
- Learned memory may shape emphasis. It is never a source citation.`),
  },
  {
    id: 'persona',
    label: 'Persona',
    description: 'Reply as a named audience persona.',
    placeholder: 'Name the persona, then ask the question.',
    prompt: skillPrompt('persona', 'Persona', `You answer as the audience persona the user names, such as a retail beginner, an introducing broker, or a compliance lead.
- If they did not name a persona, ask which one before role-playing.
- Open with one sentence that says who you are speaking as.
- Use that persona's vocabulary, objections, and decision criteria.
- The persona does not invent facts. When they would not know a fact, say what they would ask to see.`),
  },
  {
    id: 'outline',
    label: 'Outline',
    description: 'Produce an outline, not a full draft.',
    placeholder: 'What should the outline cover?',
    prompt: skillPrompt('outline', 'Outline', `You produce an outline, not a finished draft.
- Use hierarchical headings and bullets only. Do not write full paragraphs.
- Under each section, note the question that section must answer and the source that would support it when a source exists.
- End with an "Open questions" list for gaps.`),
  },
  {
    id: 'decide',
    label: 'Decide',
    description: 'Recommend one decision from the evidence.',
    placeholder: 'What decision do you need?',
    prompt: skillPrompt('decide', 'Decide', `You force a decision.
- State the decision in the first sentence.
- Then give the options considered, the evidence for, the evidence against, and what would change the decision.
- If the evidence is insufficient, write "Not enough evidence to choose" and name the single missing fact. Decide the next research step instead of pretending the business choice is settled.
- When the evidence supports one option, recommend it. Do not leave a menu of equal options.`),
  },
  {
    id: 'eli5',
    label: 'Explain simply',
    description: 'Explain it in plain language.',
    placeholder: 'What should be explained in plain language?',
    prompt: skillPrompt('eli5', 'Explain simply', `You explain the topic in plain language for a smart beginner.
- Use short sentences. Define jargon on first use.
- Give one concrete example from the sources or the user's context.
- Simple language does not drop caveats or invent numbers. Cite title and URL for facts.
- After the explanation, add a "What this does not mean" note with one caution.`),
  },
  {
    id: 'continue',
    label: 'Continue',
    description: 'Continue the previous answer.',
    placeholder: 'Add a steer, or send to continue the last answer.',
    prompt: skillPrompt('continue', 'Continue', `You continue the previous assistant answer.
- Pick up at the last unfinished point. Do not repeat the prior answer.
- Match its structure unless the user changes the task.
- If the user adds a new instruction, apply it while continuing.
- If there is no previous assistant answer in the conversation, say so and ask what to continue.`),
  },
];

const SKILL_ID_SET = new Set<string>(AI_RESEARCH_SKILL_IDS);

export function aiResearchSkillById(id: string): AiResearchSkill | undefined {
  const token = id.trim().toLowerCase().replace(/^\//, '');
  return AI_RESEARCH_SKILLS.find(skill => skill.id === token);
}

export function parseAiResearchSkill(value: unknown): AiResearchSkillId | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('Research skill is not valid.');
  const token = value.trim().toLowerCase().replace(/^\//, '');
  if (!token) return undefined;
  if (!SKILL_ID_SET.has(token)) throw new Error('Unknown research skill.');
  return token as AiResearchSkillId;
}

export function buildSkillSystemAddendum(skill?: AiResearchSkillId): string {
  if (!skill) return '';
  return aiResearchSkillById(skill)?.prompt ?? '';
}

export function withSkillSystemPrompt(
  sections: Array<string | false | null | undefined>,
  skill?: AiResearchSkillId,
): string {
  const present = sections.filter((section): section is string => Boolean(section));
  const addendum = buildSkillSystemAddendum(skill);
  if (!addendum) return present.join('\n\n');
  if (present.length === 0) return addendum;
  return [present[0], addendum, ...present.slice(1)].join('\n\n');
}

export function filterAiResearchSkills(query: string): AiResearchSkill[] {
  const token = query.trim().toLowerCase().replace(/^\//, '');
  if (!token) return [...AI_RESEARCH_SKILLS];
  return AI_RESEARCH_SKILLS.filter(skill =>
    skill.id.startsWith(token) || skill.label.toLowerCase().startsWith(token),
  );
}

export interface ComposerSlash {
  token: string;
  remainder: string;
  incomplete: boolean;
}

export function parseComposerSlash(input: string): ComposerSlash | null {
  const match = input.match(/^\s*\/([a-z0-9-]*)(.*)$/i);
  if (!match) return null;
  const token = match[1].toLowerCase();
  const rest = match[2];
  if (!rest) return { token, remainder: '', incomplete: true };
  if (!/^\s/.test(rest)) return null;
  return {
    token,
    remainder: rest.replace(/^\s+/, ''),
    incomplete: false,
  };
}

export function commitComposerSkill(input: string): { skillId: AiResearchSkillId; nextInput: string } | null {
  const parsed = parseComposerSlash(input);
  if (!parsed || parsed.incomplete) return null;
  const skill = aiResearchSkillById(parsed.token);
  if (!skill) return null;
  return { skillId: skill.id, nextInput: parsed.remainder };
}

export function skillRemainderAfterSelect(input: string): string {
  const parsed = parseComposerSlash(input);
  if (!parsed) return input;
  return parsed.remainder;
}

export function slashPickerOpen(input: string, suppressed: boolean): boolean {
  if (suppressed) return false;
  const parsed = parseComposerSlash(input);
  return Boolean(parsed?.incomplete);
}

export function clampSkillHighlight(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}
