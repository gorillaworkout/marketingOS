/** Deep link from History into the editor that created the task. */

export const TASK_EDITOR_QUERY = 'task';

const EDITOR_PATHS: Record<string, string> = {
  'social-post': '/dashboard/social-post',
  'video-script': '/dashboard/video-script',
  'event-plan': '/dashboard/event-plan',
  'article-market-news': '/dashboard/sop',
  'market-research': '/dashboard/market-research',
};

export interface OwnHistoryTask {
  id: string;
  type?: string;
  title?: string;
  brief?: string;
  status?: string;
  output_data?: string;
  created_at?: string;
}

export function historyEditorHref(type: string, taskId: string): string | null {
  const path = EDITOR_PATHS[type];
  if (!path || !taskId) return null;
  return `${path}?${TASK_EDITOR_QUERY}=${encodeURIComponent(taskId)}`;
}

export function historyEditorLabel(type: string): string {
  return type === 'social-post' ? 'Re-generate' : 'Use in editor';
}

/** Loads one of the signed-in user's tasks. Other people's rows are not returned. */
export async function fetchOwnHistoryTask(type: string, id: string): Promise<OwnHistoryTask | null> {
  const response = await fetch(`/api/dashboard/history?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);
  if (!response.ok) return null;
  const data = await response.json().catch(() => null) as { tasks?: unknown } | null;
  const task = data && Array.isArray(data.tasks) ? data.tasks[0] : null;
  if (!task || typeof task !== 'object') return null;
  const row = task as OwnHistoryTask;
  return typeof row.id === 'string' ? row : null;
}
