import {
  AI_RESEARCH_DEEP_MAX_ROUNDS,
  AI_RESEARCH_DEEP_STATUS,
  DEEP_PROGRESS_COMPLETE,
  DEEP_PROGRESS_STOPPED,
  formatDeepSearchStatus,
} from './ai-research-deep';

export type DeepProgressStepId = 'plan' | 'search' | 'read' | 'draft' | 'gaps';
export type DeepProgressStepState = 'pending' | 'active' | 'done' | 'error';
export type DeepProgressOutcome = 'running' | 'complete' | 'error';

export interface DeepProgressStep {
  id: DeepProgressStepId;
  label: string;
  state: DeepProgressStepState;
  detail?: string;
}

export interface DeepProgressModel {
  outcome: DeepProgressOutcome;
  /** Announced when the current step changes. */
  liveText: string;
  steps: DeepProgressStep[];
}

export interface DeepStatusEvent {
  phase?: string;
  message?: string;
  round?: number;
  maxRounds?: number;
  sourceCount?: number;
  skippedSearch?: boolean;
}

const STEP_ORDER: DeepProgressStepId[] = ['plan', 'search', 'read', 'draft', 'gaps'];

const PHASE_TO_STEP: Record<string, DeepProgressStepId> = {
  plan: 'plan',
  search: 'search',
  read: 'read',
  synthesize: 'draft',
  draft: 'draft',
  gaps: 'gaps',
};

const IDLE_LABEL: Record<DeepProgressStepId, string> = {
  plan: 'Planning',
  search: 'Searching',
  read: 'Reading sources',
  draft: 'Drafting answer',
  gaps: 'Checking gaps / limitations',
};

const ACTIVE_LABEL: Record<DeepProgressStepId, string> = {
  plan: AI_RESEARCH_DEEP_STATUS.plan,
  search: AI_RESEARCH_DEEP_STATUS.search,
  read: AI_RESEARCH_DEEP_STATUS.read,
  draft: AI_RESEARCH_DEEP_STATUS.synthesize,
  gaps: AI_RESEARCH_DEEP_STATUS.gaps,
};

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stripEllipsis(label: string): string {
  return label.replace(/…$/, '');
}

function sourceDetail(count: number): string {
  return count === 1 ? '1 source' : `${count} sources`;
}

function activeLabel(id: DeepProgressStepId, event: DeepStatusEvent): string {
  const message = event.message?.trim();
  if (message) return message;
  if (id === 'search') {
    return formatDeepSearchStatus(event.round ?? 1, event.maxRounds ?? AI_RESEARCH_DEEP_MAX_ROUNDS);
  }
  return ACTIVE_LABEL[id];
}

export function createDeepProgress(): DeepProgressModel {
  return {
    outcome: 'running',
    liveText: AI_RESEARCH_DEEP_STATUS.plan,
    steps: STEP_ORDER.map(id => ({
      id,
      label: id === 'plan' ? ACTIVE_LABEL.plan : IDLE_LABEL[id],
      state: id === 'plan' ? 'active' : 'pending',
    })),
  };
}

export function readDeepStatusEvent(raw: {
  phase?: unknown;
  message?: unknown;
  round?: unknown;
  maxRounds?: unknown;
  sourceCount?: unknown;
  skippedSearch?: unknown;
}): DeepStatusEvent | null {
  const phase = typeof raw.phase === 'string' ? raw.phase.trim() : '';
  const message = typeof raw.message === 'string' ? raw.message.trim() : '';
  const known = phase === 'done' || phase === 'error' || Boolean(PHASE_TO_STEP[phase]);
  if (!known && !message) return null;
  return {
    phase: phase || undefined,
    message: message || undefined,
    round: finiteNumber(raw.round),
    maxRounds: finiteNumber(raw.maxRounds),
    sourceCount: finiteNumber(raw.sourceCount),
    skippedSearch: raw.skippedSearch === true,
  };
}

export function completeDeepProgress(model: DeepProgressModel): DeepProgressModel {
  return {
    outcome: 'complete',
    liveText: DEEP_PROGRESS_COMPLETE,
    steps: model.steps.map(step => ({
      ...step,
      state: 'done',
      label: stripEllipsis(step.label),
    })),
  };
}

export function failDeepProgress(model: DeepProgressModel): DeepProgressModel {
  if (model.outcome === 'complete') return model;
  let marked = false;
  const steps = model.steps.map(step => {
    if (!marked && step.state === 'active') {
      marked = true;
      return { ...step, state: 'error' as const };
    }
    return step;
  });
  if (!marked) {
    const fallback = [...steps].reverse().findIndex(step => step.state === 'done');
    const index = fallback >= 0 ? steps.length - 1 - fallback : 0;
    steps[index] = { ...steps[index], state: 'error' };
  }
  return {
    outcome: 'error',
    liveText: DEEP_PROGRESS_STOPPED,
    steps,
  };
}

export function noteDeepLimitationsInProgress(model: DeepProgressModel | null): DeepProgressModel | null {
  if (!model || model.outcome !== 'running') return model;
  if (model.steps.some(step => step.id === 'gaps' && step.state !== 'pending')) return model;
  return applyDeepStatusEvent(model, { phase: 'gaps' });
}

export function applyDeepStatusEvent(model: DeepProgressModel, event: DeepStatusEvent): DeepProgressModel {
  if (model.outcome !== 'running') return model;
  if (event.phase === 'done') return completeDeepProgress(model);
  if (event.phase === 'error') return failDeepProgress(model);

  const stepId = event.phase ? PHASE_TO_STEP[event.phase] : undefined;
  if (!stepId) {
    const message = event.message?.trim();
    if (!message) return model;
    return {
      ...model,
      liveText: message,
      steps: model.steps.map(step => (step.state === 'active' ? { ...step, label: message } : step)),
    };
  }

  const index = STEP_ORDER.indexOf(stepId);
  const label = activeLabel(stepId, event);
  const steps = STEP_ORDER.map((id, stepIndex) => {
    const previous = model.steps[stepIndex];
    if (stepIndex < index) {
      const skipped = Boolean(event.skippedSearch)
        && (id === 'search' || id === 'read')
        && previous?.state !== 'done';
      if (skipped) {
        return { id, state: 'done' as const, label: IDLE_LABEL[id], detail: 'Not needed' };
      }
      return {
        id,
        state: 'done' as const,
        label: previous?.state === 'pending' || !previous ? IDLE_LABEL[id] : stripEllipsis(previous.label),
        detail: previous?.detail,
      };
    }
    if (stepIndex === index) {
      const detail = id === 'read' && typeof event.sourceCount === 'number'
        ? sourceDetail(event.sourceCount)
        : undefined;
      return { id, state: 'active' as const, label, detail };
    }
    return { id, state: 'pending' as const, label: IDLE_LABEL[id] };
  });

  return { outcome: 'running', liveText: label, steps };
}
