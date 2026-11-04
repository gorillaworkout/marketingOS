/**
 * Onboarding report definitions with no dependencies, so client components can
 * import them without pulling the xlsx parser into the bundle.
 *
 * Total Real Account (business definition confirmed by the owner, Nov 2026):
 * real accounts activated (unique) + manual KYC approved (demo not done).
 * Matches the reference sheet's TOTAL REAL ACCOUNT + "KYC Manual Approved Demo Not Done".
 */
export const TOTAL_REAL_ACCOUNT_LABEL = 'Total Real Account';
export const TOTAL_REAL_ACCOUNT_NOTE = 'Real accounts activated + KYC manual approved (demo not done)';
export const REAL_ACCOUNT_ACTIVATED_LABEL = 'Real Account Activated';
export const MANUAL_APPROVED_DEMO_NOT_DONE_LABEL = 'Manual Approved Demo Not Done';

/** Pending = Registrations − Total Real Account − KYC Rejected (null when there are no registrations). */
export function pending(values: { registrations: number | null; realAccountApproved: number; kycRejected: number }): number | null {
  return !values.registrations ? null : values.registrations - values.realAccountApproved - values.kycRejected;
}
