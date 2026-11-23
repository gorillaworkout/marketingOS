// src/lib/dpm-invitation/present.ts
import { formatWib, isRegistrationOpen, toWibInputValue } from './rules';
import type { InvitationEvent, InvitationResponse, ResponseCounts } from './types';

export interface PresentedEvent {
  id: string; name: string; slug: string; status: 'open' | 'closed';
  closesAt: string | null; closesAtWib: string | null; closesAtInput: string;
  isOpen: boolean; closedReason: 'manual' | 'auto' | null;
  publicPath: string; imageUrl: string; imageWidth: number; imageHeight: number;
  counts?: ResponseCounts; lastResponseAt?: string | null; createdAt: string;
}

export interface PresentedResponse {
  id: string; fullName: string; email: string; attending: boolean; hasAllergy: boolean | null;
  allergyNotes: string | null; submissionCount: number; createdAt: string; updatedAt: string; updatedAtWib: string;
}

export function imageVersion(key: string): string {
  return key.replace(/\.[a-z]+$/, '');
}

export function presentEvent(event: InvitationEvent, now: Date, extra: { counts?: ResponseCounts; lastResponseAt?: Date | null } = {}): PresentedEvent {
  const isOpen = isRegistrationOpen(event, now);
  return {
    id: event.id, name: event.name, slug: event.slug, status: event.status,
    closesAt: event.closesAt ? event.closesAt.toISOString() : null,
    closesAtWib: event.closesAt ? formatWib(event.closesAt) : null,
    closesAtInput: toWibInputValue(event.closesAt),
    isOpen, closedReason: isOpen ? null : event.status === 'closed' ? 'manual' : 'auto',
    publicPath: `/i/${event.slug}`,
    imageUrl: `/api/dpm/invitations/${event.id}/image?v=${imageVersion(event.imageKey)}`,
    imageWidth: event.imageWidth, imageHeight: event.imageHeight,
    ...(extra.counts ? { counts: extra.counts } : {}),
    ...(extra.lastResponseAt !== undefined ? { lastResponseAt: extra.lastResponseAt ? extra.lastResponseAt.toISOString() : null } : {}),
    createdAt: event.createdAt.toISOString(),
  };
}

export function presentResponse(row: InvitationResponse): PresentedResponse {
  return {
    id: row.id, fullName: row.fullName, email: row.email, attending: row.attending, hasAllergy: row.hasAllergy,
    allergyNotes: row.allergyNotes, submissionCount: row.submissionCount,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), updatedAtWib: formatWib(row.updatedAt),
  };
}

/** Deleting a whole invitation (every response and the image) is admin-only. Any feature holder may delete single responses. */
export function canDeleteInvitation(user: { role: string }): boolean {
  return user.role === 'admin';
}
