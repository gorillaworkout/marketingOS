import { AI_RESEARCH_ASSISTANT_NAME } from '@/lib/ai-research';
import { DEEP_PROGRESS_STOPPED } from '@/lib/ai-research-deep';
import type { DeepProgressModel, DeepProgressStepState } from '@/lib/ai-research-deep-progress';

function StepGlyph({ state, running }: { state: DeepProgressStepState; running: boolean }) {
  if (state === 'active' && running) {
    return (
      <span
        data-testid="ai-research-deep-step-spinner"
        className="mt-0.5 inline-block h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-300"
        aria-hidden="true"
      />
    );
  }
  if (state === 'done') {
    return (
      <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-300" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.18" />
        <path d="M4.5 8.2 7 10.5 11.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (state === 'error') {
    return (
      <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-300" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.18" />
        <path d="M8 4.5v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="8" cy="11.2" r="0.8" fill="currentColor" />
      </svg>
    );
  }
  return <span className="mt-0.5 inline-block h-3.5 w-3.5 flex-shrink-0 rounded-full border border-[var(--mos-border)]" aria-hidden="true" />;
}

export function AiResearchDeepProgress({ progress }: { progress: DeepProgressModel }) {
  const running = progress.outcome === 'running';
  return (
    <div className="sticky top-0 z-10 bg-[var(--mos-bg)] pb-2">
      <div className="flex justify-start">
        <div className="flex max-w-[85%] gap-3 sm:max-w-[75%]">
          <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-600">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold text-[var(--mos-text-muted)]">
              {AI_RESEARCH_ASSISTANT_NAME}
              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-200">
                Deep
              </span>
            </p>
            <div
              data-testid="ai-research-deep-progress"
              data-outcome={progress.outcome}
              className="rounded-2xl rounded-tl-md border border-[var(--mos-border)] bg-[var(--mos-raised)] px-4 py-3"
            >
              <p className="sr-only" role="status" aria-live="polite">{progress.liveText}</p>
              <p className="mb-2 text-[11px] font-medium text-[var(--mos-text)]">Deep research</p>
              <ol className="space-y-1.5" aria-label="Deep research progress">
                {progress.steps.map(step => (
                  <li
                    key={step.id}
                    data-testid={`ai-research-deep-step-${step.id}`}
                    data-state={step.state}
                    aria-current={step.state === 'active' ? 'step' : undefined}
                    className="flex items-start gap-2 text-[12px] leading-5"
                  >
                    <StepGlyph state={step.state} running={running} />
                    <span className={step.state === 'pending' ? 'text-[var(--mos-text-muted)]' : 'text-[var(--mos-text)]'}>
                      {step.label}
                      {step.detail ? (
                        <span className="ml-1.5 text-[10px] text-[var(--mos-text-muted)]">{step.detail}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
              {progress.outcome === 'error' && (
                <p className="mt-2 text-[11px] text-red-300" data-testid="ai-research-deep-progress-error">
                  {DEEP_PROGRESS_STOPPED}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
