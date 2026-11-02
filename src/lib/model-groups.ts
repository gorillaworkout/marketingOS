/**
 * Picker grouping for chat models by the 9router provider prefix.
 * Pure and client-safe (no server imports).
 */
export const MODEL_PROVIDER_GROUPS = [
  { prefix: 'cc/', label: 'Claude Code' },
  { prefix: 'ag/', label: 'Antigravity' },
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

/**
 * Models that answer correctly but slowly (9router v0.5.112, 2026-11-02:
 * ag/gemini-4-argon-high took ~52s for a tiny reply). Health checks give
 * them a longer timeout; the catalog name carries "(slow)".
 */
export const SLOW_TEXT_MODELS: readonly string[] = ['ag/gemini-4-argon-high'];

export function isSlowTextModel(modelId: string): boolean {
  return SLOW_TEXT_MODELS.includes(modelId);
}
