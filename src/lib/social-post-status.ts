/** A Social Post history row, or the post currently open in the detail pane. */
export type SocialPostStatusRecord = {
  id?: string;
  status?: string | null;
};

/**
 * Statuses confirmed by a successful `PUT /api/social-post/status` in this page session.
 * History reloads must not paint an older value over these.
 */
export type ConfirmedSocialPostStatuses = Readonly<Record<string, string>>;

/**
 * Status to show after `PUT /api/social-post/status`.
 * Returns null when the response is not a successful update.
 */
export function socialPostStatusFromResponse(body: unknown, requestedStatus: string): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as { success?: unknown; newStatus?: unknown; error?: unknown };
  if (record.success === false || typeof record.error === 'string') return null;
  if (typeof record.newStatus === 'string' && record.newStatus.trim()) return record.newStatus;
  if (requestedStatus.trim()) return requestedStatus;
  return null;
}

/** Replace list statuses with ones this session already saved. */
export function mergeConfirmedSocialPostStatus<T extends SocialPostStatusRecord>(
  posts: readonly T[],
  confirmed: ConfirmedSocialPostStatuses,
): T[] {
  return posts.map((post) => {
    const status = post.id ? confirmed[post.id] : undefined;
    if (!status || post.status === status) return post;
    return { ...post, status };
  });
}

/** Keep the open post aligned with a confirmed status, without touching a different row. */
export function viewingPostWithConfirmedStatus<T extends SocialPostStatusRecord>(
  viewingPost: T | null,
  confirmed: ConfirmedSocialPostStatuses,
): T | null {
  if (!viewingPost?.id) return viewingPost;
  const status = confirmed[viewingPost.id];
  if (!status || viewingPost.status === status) return viewingPost;
  return { ...viewingPost, status };
}
