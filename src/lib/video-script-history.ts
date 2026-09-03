type ScriptRecord = Record<string, unknown>;

export type SavedVideoScriptRestore =
  | { kind: 'full'; script: ScriptRecord }
  | { kind: 'preview'; options: ScriptRecord[]; selectedIndex: number }
  | { kind: 'raw' };

function record(value: unknown): ScriptRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ScriptRecord
    : null;
}

function fullScript(value: unknown): ScriptRecord | null {
  const candidate = record(value);
  return candidate && typeof candidate.fullScript === 'string' && candidate.fullScript.trim()
    ? candidate
    : null;
}

export function restoreSavedVideoScript(raw: unknown): SavedVideoScriptRestore {
  const output = record(raw);
  if (!output) return { kind: 'raw' };

  const options = Array.isArray(output.options)
    ? output.options.map(record).filter((item): item is ScriptRecord => item !== null)
    : [];

  const completed = options.map(fullScript).find(Boolean) ||
    fullScript(output.scriptData) ||
    fullScript(output.script) ||
    fullScript(output);
  if (completed) return { kind: 'full', script: completed };
  if (options.length) return { kind: 'preview', options, selectedIndex: 0 };
  return { kind: 'raw' };
}
