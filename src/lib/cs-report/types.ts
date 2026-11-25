import type { CountKey, CsStatus } from './fields';

export type Counts = Record<CountKey, number | null>;

/** One agent-day (Weekly Work List row). */
export interface DailyEntryInput extends Counts {
  date: string; // YYYY-MM-DD
  status: CsStatus;
  unsolvedUids: string;
  followUpMinutes: number;
  frequentQuestion: string;
  difficultQuestion: string;
}

export interface DailyEntry extends DailyEntryInput {
  id: string;
  agentId: string;
  agentName: string;
  source: 'web' | 'upload';
  updatedAt: string | null;
  /** Name of the user who last saved this row (the uploader for imported rows). */
  updatedByName: string | null;
}

export interface ComplaintInput {
  date: string;
  clientName: string;
  uid: string;
  account: string;
  platform: string;
  description: string;
  cause: string;
  resolution: string;
  completionDate: string | null;
  status: string;
  slaMet: boolean | null;
  urgency: string;
  category: string;
}

export interface Complaint extends ComplaintInput {
  id: string;
  agentId: string | null;
  agentName: string | null;
  source: 'web' | 'upload';
  createdBy: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface WeeklyNote {
  weekStart: string;
  weekEnd: string;
  channel: string;
  frequentQuestion: string;
  difficultQuestion: string;
}

export interface CsAgent {
  id: string;
  displayName: string;
  userId: string | null;
  aliases: string[];
}
