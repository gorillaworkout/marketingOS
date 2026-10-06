export const IMPORT_SOURCE_LABEL = {
  codex: 'Codex / ChatGPT',
  claude: 'Claude',
  text: 'Plain text',
} as const;

export const IMPORT_STATUS_LABEL = {
  review: 'Review',
  extract_failed: 'Extract failed',
  chat_only: 'Chat only',
  approved: 'Approved',
} as const;

export type ImportListAction = 'view' | 'review' | 'retry';
export type ImportUiStatus = keyof typeof IMPORT_STATUS_LABEL;

export function importListActions(status: ImportUiStatus): ImportListAction[] {
  if (status === 'review') return ['view', 'review'];
  if (status === 'extract_failed' || status === 'chat_only') return ['view', 'retry'];
  return ['view'];
}

export function importDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export const IMPORT_MEMORY_OFF_NOTE = 'Memory is off. This chat is still saved. Approved facts and answers are stored, and Dupoin AI will not use them until you turn memory on.';
export const IMPORT_CANCEL_NOTE = 'Draft discarded. The chat stays in your knowledge graph.';
export const IMPORT_SAVED_NOTE = 'Full chat saved to your knowledge graph.';
export const IMPORT_PLAIN_TEXT_NOTE = 'This chat was saved as plain text.';
export const IMPORT_EXTRACT_FAILED_NOTE = 'The chat was saved. Fact extraction failed.';
export const IMPORT_DUPLICATE_NOTE = 'This chat is already imported.';
