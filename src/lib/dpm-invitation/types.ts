// src/lib/dpm-invitation/types.ts
export type InvitationStatus = 'open' | 'closed';

export interface InvitationEvent {
  id: string;
  name: string;
  slug: string;
  status: InvitationStatus;
  closesAt: Date | null;
  imageKey: string;
  imageMime: string;
  imageWidth: number;
  imageHeight: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResponseCounts {
  total: number;
  attending: number;
  notAttending: number;
  withAllergies: number;
}

export interface InvitationResponse {
  id: string;
  eventId: string;
  fullName: string;
  email: string;
  attending: boolean;
  hasAllergy: boolean | null;
  allergyNotes: string | null;
  submissionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ResponseFilter = 'all' | 'attending' | 'not-attending' | 'allergy';

export interface ParsedResponse {
  fullName: string;
  email: string;
  emailNormalized: string;
  attending: boolean;
  hasAllergy: boolean | null;
  allergyNotes: string | null;
}

export type ResponseFieldErrors = Partial<Record<'fullName' | 'email' | 'attending' | 'hasAllergy' | 'allergyNotes', string>>;
