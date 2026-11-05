/**
 * Onboarding report definitions with no dependencies, so client components can
 * import them without pulling the xlsx parser into the bundle.
 *
 * Total Real Account (business definition confirmed by the owner, Nov 2026):
 * real accounts activated (unique) + manual KYC approved (demo not done).
 * For a day with an onboarding_daily_summary row: TOTAL REAL ACCOUNT +
 * "KYC Manual Approved Demo Not Done" (TOTAL REAL ACCOUNT is activations only;
 * it is not added twice when the sheet already absorbed manual — see summary-parse).
 */
export const TOTAL_REAL_ACCOUNT_LABEL = 'Total Real Account';
export const TOTAL_REAL_ACCOUNT_NOTE = 'Real accounts activated + KYC manual approved (demo not done)';
export const REAL_ACCOUNT_ACTIVATED_LABEL = 'Real Account Activated';
export const MANUAL_APPROVED_DEMO_NOT_DONE_LABEL = 'Manual Approved Demo Not Done';

/** Why the same-account cohort (Activated → FTD) shows "No data" for a period. */
export const COHORT_UNAVAILABLE_NOTE = 'Needs the account-level FTD file for every day of the period; manual daily FTD entries have no account numbers.';
