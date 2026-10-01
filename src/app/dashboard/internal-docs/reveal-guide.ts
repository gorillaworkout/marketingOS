/** How far to scroll so a guide PDF or document body sits just under the viewport top. */
export function guideScrollTop(scrollY: number, rectTop: number, gap = 16): number {
  return Math.max(0, Math.round(scrollY + rectTop - gap));
}

const READING_TARGET = '[data-testid="guide-pdf"], [data-testid="guide-body"]';

/** Scroll the in-page PDF or document text into view. Does not touch Ask. */
export function revealGuideReading(root: ParentNode | null | undefined, focus = false): boolean {
  if (!root || typeof window === 'undefined') return false;
  const reading = root.querySelector(READING_TARGET);
  const target = reading instanceof HTMLElement
    ? reading
    : root instanceof HTMLElement
      ? root
      : null;
  if (!target) return false;
  const top = guideScrollTop(window.scrollY, target.getBoundingClientRect().top);
  window.scrollTo({ top, left: 0 });
  if (!focus) return true;
  if (target.tabIndex < 0) target.tabIndex = -1;
  target.focus({ preventScroll: true });
  return true;
}

/** Reveal the open guide when it is already on the page. A different guide stays put until it loads. */
export function revealOpenGuide(documentId?: string): boolean {
  if (typeof document === 'undefined') return false;
  const reader = document.getElementById('guide-reader');
  if (!(reader instanceof HTMLElement)) return false;
  if (documentId && reader.dataset.documentId !== documentId) return false;
  return revealGuideReading(reader, true);
}
