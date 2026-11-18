/**
 * Thresholds for Paid vs Organic, search term suggestions, and daily alerts.
 * All are in account currency units (IDR for Dupoin) unless noted. Change them
 * here; the UI shows the values in use.
 */
export const PAID_ORGANIC = {
  /** Organic average position at or better than this counts as "top 3". */
  topPosition: 3,
  /** Organic clicks needed before we call a term "already ranking". */
  minOrganicClicks: 10,
  /** Paid spend needed before a top-3 term is flagged as a potential saving. */
  minPaidCost: 50_000,
  /** Paid conversions needed for an "SEO opportunity". */
  minPaidConversions: 1,
  /** Organic is "weak" when there is no organic data, position is worse than this, or clicks are below weakMaxClicks. */
  weakPosition: 10,
  weakMaxClicks: 5,
  /** Rows returned to the UI (export returns all). */
  rowLimit: 500,
} as const;

export const SEARCH_TERMS = {
  /** Default spend threshold for negative keyword suggestions; the UI can change it per view. */
  defaultNegativeMinCost: 100_000,
  /** Conversions needed for a keyword candidate. */
  defaultCandidateMinConversions: 1,
  rowLimit: 500,
} as const;

export const ALERTS = {
  /** Recent window vs trailing baseline, in days. The window ends yesterday (today is partial). */
  recentDays: 7,
  baselineDays: 28,
  /** Spend spike: recent daily average >= baseline x ratio and up by at least minDailyIncrease. */
  spendSpikeRatio: 1.5,
  spendSpikeMinDailyIncrease: { account: 500_000, campaign: 200_000 },
  /** CPC rise: recent CPC >= baseline x ratio, both windows with enough clicks. */
  cpcRiseRatio: 1.3,
  cpcMinClicks: 100,
  /** Cost per conversion rise. */
  cpaRiseRatio: 1.4,
  cpaMinRecentConversions: 10,
  cpaMinBaselineConversions: 20,
  /** Conversions drop: recent daily average <= baseline x ratio. */
  conversionsDropRatio: 0.6,
  conversionsDropMinBaseline: 28,
  /** Spend stopped: spend on >= minActiveDays of the baseline, avg >= minDailyCost, then 0 on the last stoppedDays days. */
  stoppedDays: 2,
  stoppedMinActiveDays: 14,
  stoppedMinDailyCost: 100_000,
  /** Change ratio at which a warning becomes critical (x2 up, or half down). */
  criticalRatio: 2,
  /** An acknowledged or dismissed alert stays quiet while the same condition repeats within this many days. */
  snoozeDays: 7,
} as const;
