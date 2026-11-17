/** Browser helper: ask the server for the Event Plan PPTX and save it. */
import { eventPlanPptxFilename, type EventPlanDeckInput } from './event-plan-deck';
import { restoreEventPlan, type EventPlanHistoryTask } from './event-plan-history';

export async function downloadEventPlanPptx(input: EventPlanDeckInput): Promise<void> {
  const response = await fetch('/api/event-plan/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `PPT export failed (${response.status}).`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] || eventPlanPptxFilename(input.eventName);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The deck input for a saved History item: its first option, as History shows it. */
export function deckInputFromHistory(task: EventPlanHistoryTask, optionIndex = 0): EventPlanDeckInput {
  const restored = restoreEventPlan(task);
  const option = restored.options[Math.min(Math.max(0, optionIndex), restored.options.length - 1)];
  return {
    eventName: restored.eventName,
    location: restored.location,
    theme: restored.theme,
    targetDate: restored.targetDate,
    venueName: restored.venueName,
    participants: restored.participants,
    speakers: restored.speakers,
    quotations: restored.quotations,
    contingencyPercent: restored.contingencyPercent,
    option,
  };
}
