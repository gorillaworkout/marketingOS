'use client';

import { useEffect, useRef } from 'react';
import type { AiResearchSkill } from '@/lib/ai-research-skills';

export function AiResearchSkillPicker({
  skills,
  highlight,
  onHighlight,
  onSelect,
}: {
  skills: AiResearchSkill[];
  highlight: number;
  onHighlight: (index: number) => void;
  onSelect: (skill: AiResearchSkill) => void;
}) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    optionRefs.current[highlight]?.scrollIntoView({ block: 'nearest' });
  }, [highlight, skills]);

  return (
    <div
      id="ai-research-skill-picker"
      role="listbox"
      aria-label="Research skills"
      data-testid="ai-research-skill-picker"
      className="max-h-64 overflow-y-auto rounded-2xl border border-[var(--mos-border)] bg-[var(--mos-raised)] p-1.5 shadow-lg"
    >
      <p className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--mos-text-muted)]">
        Research skills · ↑↓ to move · Enter to use · Esc to close
      </p>
      {skills.length === 0 ? (
        <p className="px-2.5 py-2 text-sm text-[var(--mos-text-muted)]">No matching skill.</p>
      ) : skills.map((skill, index) => (
        <button
          key={skill.id}
          type="button"
          role="option"
          id={`ai-research-skill-option-${skill.id}`}
          aria-selected={index === highlight}
          data-testid={`ai-research-skill-option-${skill.id}`}
          ref={node => { optionRefs.current[index] = node; }}
          onMouseEnter={() => onHighlight(index)}
          onClick={() => onSelect(skill)}
          className={`flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left ${
            index === highlight
              ? 'bg-indigo-600 text-white'
              : 'text-[var(--mos-text)] hover:bg-[var(--mos-hover)]'
          }`}
        >
          <span className={`w-24 shrink-0 font-mono text-[11px] ${index === highlight ? 'text-indigo-100' : 'text-indigo-300'}`}>
            /{skill.id}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{skill.label}</span>
            <span className={`block text-[11px] leading-4 ${index === highlight ? 'text-indigo-100' : 'text-[var(--mos-text-muted)]'}`}>
              {skill.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function AiResearchSkillChip({
  skill,
  onClear,
}: {
  skill: AiResearchSkill;
  onClear: () => void;
}) {
  return (
    <span
      data-testid="ai-research-skill-chip"
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-indigo-400/40 bg-indigo-500/15 py-1 pl-2.5 pr-1 text-[11px] text-[var(--mos-text)]"
    >
      <span className="font-mono text-indigo-200">/{skill.id}</span>
      <span className="font-medium">{skill.label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove ${skill.label} skill`}
        title={`Remove ${skill.label} skill`}
        className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--mos-text-muted)] hover:bg-indigo-500/20 hover:text-white"
      >
        ×
      </button>
    </span>
  );
}
