/** Section ids in document order. The tab bar, hash URLs, and scroll spy share this list. */
export const REPORT_SECTIONS = [
  ['overview', 'Overview'],
  ['reconciliation', 'Reconciliation'],
  ['processing', 'Processing time'],
  ['withdrawal-timing', 'Withdrawal timing'],
  ['margin', 'Margin in–out'],
  ['commission-swap', 'Commission & swap'],
  ['jisdor', 'JISDOR'],
  ['methodology', 'Methodology'],
] as const;

export type ReportSectionId = typeof REPORT_SECTIONS[number][0];

const IDS = new Set<string>(REPORT_SECTIONS.map(([id]) => id));

export function sectionIdFromHash(hash: string): ReportSectionId | null {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  return IDS.has(id) ? id as ReportSectionId : null;
}

/** Place the section's top just below a sticky bar. */
export function scrollOffsetTop(scrollTop: number, elementTop: number, sticky: number): number {
  return Math.max(0, scrollTop + elementTop - sticky);
}

/**
 * What a tab click, Enter on the link, or a direct hash must do:
 * scroll the real container and record the hash. Returns the section id, or null when it is not a section.
 */
export function activateSection(id: string, env: {
  elementTop: number | null;
  scrollTop: number;
  sticky: number;
  scrollTo: (top: number) => void;
  setHash: (hash: string) => void;
}): ReportSectionId | null {
  const section = sectionIdFromHash(`#${id}`);
  if (!section || env.elementTop === null) return null;
  env.scrollTo(scrollOffsetTop(env.scrollTop, env.elementTop, env.sticky));
  env.setHash(`#${section}`);
  return section;
}
