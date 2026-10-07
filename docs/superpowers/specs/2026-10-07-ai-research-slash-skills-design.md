# AI Research slash skills

## Overview

AI Research gets twelve slash skills. Typing `/` in the composer opens an English skill picker. Choosing a skill shows a chip and stays active until the user removes it. Each send injects that skill's behavior prompt into the system prompt. The base research rules, learned memory, knowledge graph, internal docs, and web grounding stay in place.

The skills are `/goal`, `/interview`, `/grill-me`, `/compare`, `/brief`, `/critique`, `/sources`, `/persona`, `/outline`, `/decide`, `/eli5`, and `/continue`.

## User flow

1. The user types `/` at the start of the AI Research composer. A picker lists the skills. Arrow keys move, Enter or click chooses, Escape closes the picker and leaves the typed text.
2. Choosing a skill removes the slash token from the composer and shows a chip: slash id, label, and a remove button.
3. Typing an exact id and a space does the same thing. `/brief the Q4 launch` becomes the chip **Brief** and the draft `the Q4 launch`.
4. The chip stays on for later messages, including a new question in the same conversation. Remove clears it.
5. Send includes `skill` on `POST /api/ai-research/chat`. The stored user text does not include the slash command.
6. `/continue` may be sent with an empty composer when an assistant answer already exists. The stored user text is `Continue.`

A slash that is not at the start of the composer is ordinary text. An unknown id does not activate a skill. An unknown `skill` value on the API is a 400.

## Behavior

Every skill prompt starts with `SKILL: /<id>` and ends with the same research rules: use the internal knowledge graph, learned memory, internal documents, and web sources when they are present; do not invent facts; cite title and URL; never cite learned memory as a public source; answer in English.

| Skill | Behavior |
| --- | --- |
| `/goal` | Restate a Goal. Ask exactly one question when the goal is still vague. Do not dump a full answer until the goal is specific. |
| `/interview` | Ask one question at a time. Keep a Known so far list. Do not deliver the piece until the user asks. |
| `/grill-me` | Lead with the strongest objection. End with the single highest-risk gap. No insults. |
| `/compare` | Criteria table. Missing cells say `no evidence found in the sources`. Close with a conditional recommendation. |
| `/brief` | One-page brief: Objective, Audience, Insight, Message, Proof, Channels, Risks, Next step. Missing evidence is `Not established`. |
| `/critique` | Top issues only. Separate factual problems from tone or structure. Do not rewrite the whole piece. |
| `/sources` | Lead with a source list. Do not fill gaps from general knowledge. |
| `/persona` | If no persona is named, ask which one. Stay in that voice without inventing facts. |
| `/outline` | Headings and bullets only. End with Open questions. |
| `/decide` | Decision in the first sentence, or `Not enough evidence to choose` plus the missing fact. |
| `/eli5` | Short sentences, jargon defined once, then `What this does not mean`. |
| `/continue` | Pick up the previous answer. Do not repeat it. If there is no previous answer, say so. |

`/compare` the skill shapes the answer. The existing Compare toggle still runs the two-sided search. Both may be on at once. Deep and Fast are unchanged.

## Architecture

```text
Composer
  parseComposerSlash / slashPickerOpen / commitComposerSkill
  → active skill chip
  → POST /api/ai-research/chat { skill, messages, mode, ... }

parseAiResearchChatBody
  → skill id or 400

withSkillSystemPrompt(sections, skill)
  base research prompt
  skill addendum
  learned memory, knowledge graph, internal docs, project memory
  deep or compare addendum when those modes are on
```

Skill prompts live in `src/lib/ai-research-skills.ts`. The picker and chip live in `src/components/AiResearchSkillControls.tsx`. The page owns the active skill. The chat route passes `skill` into both the fast and deep system prompts.

## Error handling

- Unknown or non-string `skill`: `Unknown research skill.` or `Research skill is not valid.` HTTP 400.
- Empty or omitted `skill`: no addendum.
- Picker with no prefix match: `No matching skill.` The message can still be sent as text.
- `/continue` with no assistant answer yet: the send stays disabled until there is text, an attachment, or a previous answer.

## Tests

Pure tests cover the twelve prompts, picker filtering, composer commit, request parsing, and prompt order (skill after the base prompt and before memory and the knowledge graph). Source tests lock the picker, chip, `skill` field, and both route call sites.

## How to try

Open AI Research, focus the composer, and type `/`.

| Type this | Then |
| --- | --- |
| `/goal` and Enter | Chip **Goal**. Ask for a campaign with no audience. Expect one clarifying question. |
| `/interview` | Answer a couple of turns. Expect one question and a Known so far list. |
| `/grill-me` | Paste a plan. Expect the strongest objection first. |
| `/compare` | Ask to compare two offers. Expect a criteria table. The Compare toggle remains the two-sided search. |
| `/brief` | Ask for a launch brief. Expect the eight brief sections. |
| `/critique` | Paste a draft. Expect top issues, not a full rewrite. |
| `/sources` | Ask a factual question. Expect a source list and no unsourced filler. |
| `/persona` | Send no persona name. Expect a question asking which persona. |
| `/outline` | Ask for a content outline. Expect bullets and Open questions. |
| `/decide` | Ask which of two options to ship. Expect a decision or `Not enough evidence to choose`. |
| `/eli5` | Ask what a spread is. Expect plain language and `What this does not mean`. |
| `/continue` | After an answer, clear the draft and send. Expect the answer to pick up without repeating. |
