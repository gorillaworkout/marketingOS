/**
 * Picker grouping for chat models by the 9router provider prefix.
 * Pure and client-safe (no server imports).
 */
export const MODEL_PROVIDER_GROUPS = [
  { prefix: 'cc/', label: 'Claude Code' },
  { prefix: 'ag/', label: 'Antigravity (Gemini)' },
  { prefix: 'cx/', label: 'OpenAI Codex' },
] as const;

export const OTHER_PROVIDER_LABEL = 'Other';

export interface ModelGroup<T> {
  label: string;
  models: T[];
}

export function modelProviderLabel(modelId: string): string {
  return MODEL_PROVIDER_GROUPS.find(group => modelId.startsWith(group.prefix))?.label ?? OTHER_PROVIDER_LABEL;
}

/** Groups models by provider in a fixed provider order, keeping each model's relative order. Empty groups are dropped. */
export function groupModelsByProvider<T extends { id: string }>(models: readonly T[]): ModelGroup<T>[] {
  const labels: string[] = [...MODEL_PROVIDER_GROUPS.map(group => group.label), OTHER_PROVIDER_LABEL];
  return labels
    .map(label => ({ label, models: models.filter(model => modelProviderLabel(model.id) === label) }))
    .filter(group => group.models.length > 0);
}
