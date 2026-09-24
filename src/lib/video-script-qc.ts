import { scanResearchCompliance } from './ai-research-compliance';
import type { QCCheck, QCResult } from './openai';
import { auditSocialPostHardFacts, type SocialPostCitation } from './social-post-research';

export type VideoScriptQcMode = 'preview' | 'full';

export type VideoScriptQcInput = {
  mode: VideoScriptQcMode;
  platform?: string;
  duration?: string;
  hook?: string;
  context?: string;
  highlight?: string;
  brandTieIn?: string;
  cta?: string;
  fullScript?: string;
  citations?: SocialPostCitation[];
};

/**
 * Advisory script check. A failed check is a warning for the operator.
 * Creative voiceover with no hard numbers, prices, or quotations passes the
 * grounded-facts check, and this function never rejects the script.
 */
export function runVideoScriptQc(input: VideoScriptQcInput): QCResult {
  const hook = (input.hook || '').trim();
  const cta = (input.cta || '').trim();
  const fullScript = (input.fullScript || '').trim();
  const spoken = [hook, input.context, input.highlight, input.brandTieIn, cta, fullScript]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n');
  const checks: QCCheck[] = [];

  if (!hook) {
    checks.push({
      name: 'hook',
      label: 'Hook',
      passed: false,
      detail: 'Add an opening hook that can be spoken in the first few seconds.',
    });
  } else if (hook.length > 220) {
    checks.push({
      name: 'hook',
      label: 'Hook',
      passed: false,
      detail: `Hook is ${hook.length} characters. Keep the scroll-stop line short enough to say in a few seconds.`,
    });
  } else {
    checks.push({
      name: 'hook',
      label: 'Hook',
      passed: true,
      detail: 'Opening hook is present.',
    });
  }

  checks.push({
    name: 'cta',
    label: 'Call to action',
    passed: Boolean(cta),
    detail: cta ? 'Call to action is present.' : 'Add a call to action for the end of the video.',
  });

  const compliance = scanResearchCompliance(spoken);
  checks.push({
    name: 'compliance',
    label: 'Compliance language',
    passed: !compliance.flagged,
    detail: compliance.flagged
      ? compliance.flags.map((flag) => `${flag.label}${flag.excerpt ? `: “${flag.excerpt}”` : ''}`).join(' ')
      : 'No guaranteed-return or high-pressure solicitation language.',
  });

  const grounded = auditSocialPostHardFacts(spoken, input.citations || []);
  checks.push({
    name: 'grounded_facts',
    label: 'Grounded facts',
    passed: grounded.passed,
    detail: grounded.detail,
  });

  if (input.mode === 'full') {
    const voiceover = extractVoiceover(fullScript);
    checks.push({
      name: 'voiceover',
      label: 'Voiceover',
      passed: voiceover.length > 0,
      detail: voiceover.length
        ? `${voiceover.length} voiceover block${voiceover.length === 1 ? '' : 's'} found.`
        : 'Full script has no voiceover. Add [VO: ...] narration.',
    });

    const timed = /\b\d{1,2}:\d{2}\b/.test(fullScript);
    checks.push({
      name: 'timing',
      label: 'Timing',
      passed: timed,
      detail: timed
        ? 'Timing marks are present.'
        : 'Full script has no timing marks. Add timestamps such as [0:00].',
    });

    if (voiceover.length) {
      const short = voiceover.filter((block) => sentenceCount(block) < 2);
      checks.push({
        name: 'voiceover_sentences',
        label: 'Voiceover length',
        passed: short.length === 0,
        detail: short.length
          ? 'A voiceover block is a single sentence. Write a few sentences so the narration can breathe. Creative wording is fine.'
          : 'Voiceover blocks are more than a single sentence.',
      });

      const bounds = parseDurationSeconds(input.duration);
      if (bounds) {
        const words = countWords(voiceover.join(' '));
        const minWords = Math.max(8, Math.floor(bounds.min * 1.2));
        const maxWords = Math.ceil(bounds.max * 4.5);
        const fits = words >= minWords && words <= maxWords;
        checks.push({
          name: 'spoken_length',
          label: 'Spoken length',
          passed: fits,
          detail: fits
            ? `Spoken voiceover is ${words} words, which fits ${input.duration}.`
            : `Spoken voiceover is ${words} words. A ${input.duration} script usually lands around ${minWords}–${maxWords} words at a natural pace.`,
        });
      }
    }
  }

  const passedCount = checks.filter((check) => check.passed).length;
  return {
    allPassed: passedCount === checks.length,
    checks,
    score: checks.length ? Math.round((passedCount / checks.length) * 100) : 0,
  };
}

export function readStoredVideoScriptQc(value: unknown): QCResult[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const checks = Array.isArray(row.checks)
      ? row.checks.flatMap((check) => readStoredCheck(check))
      : [];
    if (!checks.length) return [];
    const passedCount = checks.filter((check) => check.passed).length;
    return [{
      allPassed: passedCount === checks.length,
      checks,
      score: Math.round((passedCount / checks.length) * 100),
    }];
  });
}

function readStoredCheck(value: unknown): QCCheck[] {
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, unknown>;
  if (typeof row.name !== 'string' || typeof row.label !== 'string' || typeof row.detail !== 'string') return [];
  return [{
    name: row.name,
    label: row.label,
    passed: row.passed === true,
    detail: row.detail,
  }];
}

function extractVoiceover(fullScript: string): string[] {
  if (!fullScript) return [];
  const blocks: string[] = [];
  for (const match of fullScript.matchAll(/\[\s*VO\s*:?\s*([\s\S]*?)\]/gi)) {
    const text = match[1].replace(/\s+/g, ' ').trim();
    if (text) blocks.push(text);
  }
  if (blocks.length) return blocks;

  const lines = fullScript.split('\n');
  let current: string[] | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.join(' ').replace(/\s+/g, ' ').trim();
    if (text) blocks.push(text);
    current = null;
  };
  for (const line of lines) {
    const start = line.match(/^\s*(?:\[\s*)?VO\s*:\s*(.*)$/i);
    if (start) {
      flush();
      current = [start[1].replace(/\]\s*$/, '')];
      continue;
    }
    if (current) {
      if (!line.trim() || /^\s*\[/.test(line)) flush();
      else current.push(line);
    }
  }
  flush();
  return blocks;
}

function sentenceCount(text: string): number {
  return text
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter((part) => part.split(/\s+/).filter(Boolean).length >= 2)
    .length;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function parseDurationSeconds(duration?: string): { min: number; max: number } | null {
  if (!duration) return null;
  const unit = /minute/i.test(duration) ? 60 : 1;
  const range = duration.match(/(\d+)\s*-\s*(\d+)/);
  if (range) {
    return { min: Number(range[1]) * unit, max: Number(range[2]) * unit };
  }
  const single = duration.match(/(\d+)/);
  if (!single) return null;
  const value = Number(single[1]) * unit;
  if (!Number.isFinite(value) || value <= 0) return null;
  return { min: value, max: value };
}
