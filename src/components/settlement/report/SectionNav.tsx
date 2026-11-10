'use client';

import { useEffect, useRef, useState } from 'react';
import { REPORT_SECTIONS, activateSection, sectionFromScroll, sectionIdFromHash, type ReportSectionId } from './section-nav';

const tabClass = 'cursor-pointer rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mos-accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mos-bg)]';

function scrollMetrics(id: string, nav: HTMLElement | null): { elementTop: number | null; scrollTop: number; sticky: number; scrollTo: (top: number) => void } {
  const node = document.getElementById(id);
  const scroller = scrollContainer(nav);
  const usingWindow = scroller === document.documentElement;
  const scrollTop = usingWindow ? window.scrollY : scroller.scrollTop;
  const origin = usingWindow ? 0 : scroller.getBoundingClientRect().top;
  return {
    elementTop: node ? node.getBoundingClientRect().top - origin : null,
    scrollTop,
    sticky: (nav?.offsetHeight ?? 0) + 12,
    scrollTo: top => {
      if (scroller === document.documentElement) window.scrollTo({ top, behavior: 'smooth' });
      else scroller.scrollTo({ top, behavior: 'smooth' });
    },
  };
}

/** The element that actually scrolls. The dashboard page scrolls the document; a nested overflow pane scrolls itself. */
function scrollContainer(start: HTMLElement | null): HTMLElement {
  let node = start?.parentElement ?? null;
  while (node && node !== document.documentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return document.documentElement;
}

export function SectionNav({ mismatches, pendingDays, current: controlled }: { mismatches: number; pendingDays: number; current?: string }) {
  const navRef = useRef<HTMLElement>(null);
  const pending = useRef<ReportSectionId | null>(null);
  const [uncontrolled, setUncontrolled] = useState<ReportSectionId>('overview');
  const current = controlled ?? uncontrolled;

  useEffect(() => {
    if (controlled) return undefined;
    const go = (id: string, smooth: boolean) => {
      const metrics = scrollMetrics(id, navRef.current);
      const active = activateSection(id, {
        ...metrics,
        scrollTo: top => {
          const scroller = scrollContainer(navRef.current);
          if (scroller === document.documentElement) window.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
          else scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
        },
        setHash: hash => {
          if (window.location.hash !== hash) history.replaceState(null, '', hash);
        },
      });
      if (active) setUncontrolled(active);
    };
    const fromHash = () => {
      const id = sectionIdFromHash(window.location.hash);
      if (id) go(id, false);
    };
    const frame = requestAnimationFrame(() => {
      const id = sectionIdFromHash(window.location.hash);
      if (id) go(id, false);
    });
    const onScroll = () => {
      const scroller = scrollContainer(navRef.current);
      const origin = scroller === document.documentElement ? 0 : scroller.getBoundingClientRect().top;
      const line = origin + (navRef.current?.offsetHeight ?? 0) + 16;
      const tops = REPORT_SECTIONS.flatMap(([id]) => {
        const node = document.getElementById(id);
        return node ? [{ id, top: node.getBoundingClientRect().top }] : [];
      });
      if (pending.current) {
        const target = tops.find(item => item.id === pending.current);
        if (!target || Math.abs(target.top - line) >= 48) return;
        pending.current = null;
      }
      setUncontrolled(sectionFromScroll(tops, line, sectionIdFromHash(window.location.hash)));
    };
    const scroller = scrollContainer(navRef.current);
    const target: HTMLElement | Window = scroller === document.documentElement ? window : scroller;
    target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('hashchange', fromHash);
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('hashchange', fromHash);
    };
  }, [controlled]);

  function open(id: ReportSectionId) {
    pending.current = id;
    const active = activateSection(id, {
      ...scrollMetrics(id, navRef.current),
      setHash: hash => {
        if (window.location.hash !== hash) history.pushState(null, '', hash);
      },
    });
    if (!active) pending.current = null;
    else if (!controlled) setUncontrolled(active);
  }

  return (
    <nav ref={navRef} aria-label="Report sections" className="sticky top-0 z-10 flex flex-wrap gap-0.5 rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-bg)]/90 p-1 shadow-[var(--mos-shadow-panel)] backdrop-blur">
      {REPORT_SECTIONS.map(([id, label]) => {
        const selected = current === id;
        return (
          <a
            key={id}
            href={`#${id}`}
            aria-current={selected ? 'true' : undefined}
            className={`${tabClass} inline-flex items-center gap-1.5 ${selected ? 'bg-[var(--mos-raised)] text-[var(--mos-text)]' : 'text-[var(--mos-text-muted)] hover:bg-white/[0.06] hover:text-[var(--mos-text)] active:bg-white/[0.1]'}`}
            onClick={event => {
              event.preventDefault();
              open(id);
            }}
          >
            {label}
            {id === 'reconciliation' && mismatches > 0 && <span className="rounded bg-red-400/15 px-1.5 text-[10.5px] text-red-300">{mismatches}</span>}
            {id === 'commission-swap' && pendingDays > 0 && <span className="rounded bg-amber-400/15 px-1.5 text-[10.5px] text-amber-200">{pendingDays} Pending</span>}
          </a>
        );
      })}
    </nav>
  );
}
