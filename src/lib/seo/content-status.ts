/**
 * Content Studio workflow: draft -> review -> approved -> queued -> published.
 * Pure logic so the API and the UI agree on which buttons are valid.
 */
export const CONTENT_STATUSES = ['draft', 'review', 'approved', 'queued', 'published'] as const;
export type ContentStatus = typeof CONTENT_STATUSES[number];

export const CONTENT_ACTIONS = ['submit', 'request-changes', 'approve', 'queue', 'unqueue', 'publish'] as const;
export type ContentAction = typeof CONTENT_ACTIONS[number];

const TRANSITIONS: Record<ContentAction, { from: readonly ContentStatus[]; to: ContentStatus; verb: string }> = {
  submit: { from: ['draft'], to: 'review', verb: 'submit' },
  'request-changes': { from: ['review', 'approved'], to: 'draft', verb: 'request changes on' },
  approve: { from: ['review'], to: 'approved', verb: 'approve' },
  queue: { from: ['approved'], to: 'queued', verb: 'queue' },
  unqueue: { from: ['queued'], to: 'approved', verb: 'remove from the queue' },
  publish: { from: ['queued'], to: 'published', verb: 'publish' },
};

export const ACTION_LABELS: Record<ContentAction, string> = {
  submit: 'Submit for review',
  'request-changes': 'Request changes',
  approve: 'Approve',
  queue: 'Add to publish queue',
  unqueue: 'Remove from queue',
  publish: 'Mark published',
};

export function isContentStatus(value: unknown): value is ContentStatus {
  return typeof value === 'string' && (CONTENT_STATUSES as readonly string[]).includes(value);
}

export function isContentAction(value: unknown): value is ContentAction {
  return typeof value === 'string' && (CONTENT_ACTIONS as readonly string[]).includes(value);
}

/** Next status, or an error when the action is not valid from `current`. */
export function transitionStatus(current: ContentStatus, action: ContentAction): ContentStatus | { error: string } {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(current)) {
    const article = /^[aeiou]/.test(current) ? 'an' : 'a';
    return { error: `Cannot ${rule.verb} ${article} ${current} item` };
  }
  return rule.to;
}

export function availableActions(current: ContentStatus): ContentAction[] {
  return CONTENT_ACTIONS.filter(action => TRANSITIONS[action].from.includes(current));
}

/** Four-eyes rule: the author cannot approve their own article; admins can. */
export function canApprove(user: { id: string; role: string }, createdBy: string | null): boolean {
  return user.role === 'admin' || !createdBy || user.id !== createdBy;
}

/** Changing reviewed/approved/queued text needs a new review. Published stays published. */
export function editResetsStatus(current: ContentStatus): ContentStatus {
  return current === 'published' ? 'published' : 'draft';
}
