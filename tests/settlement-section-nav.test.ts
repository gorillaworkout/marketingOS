import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SectionNav } from '../src/components/settlement/report/SectionNav';
import { REPORT_SECTIONS, activateSection, sectionIdFromHash, scrollOffsetTop } from '../src/components/settlement/report/section-nav';

describe('settlement section tabs', () => {
  it('scrolls the clicked section clear of the sticky bar and records the hash', () => {
    const scrolled: number[] = [];
    const hashes: string[] = [];
    const active = activateSection('commission-swap', {
      elementTop: 940,
      scrollTop: 120,
      sticky: 52,
      scrollTo: top => scrolled.push(top),
      setHash: hash => hashes.push(hash),
    });
    assert.equal(active, 'commission-swap');
    assert.deepEqual(scrolled, [scrollOffsetTop(120, 940, 52)]);
    assert.equal(scrolled[0], 1008);
    assert.deepEqual(hashes, ['#commission-swap']);
  });

  it('reads a direct hash URL and ignores anything that is not a section', () => {
    assert.equal(sectionIdFromHash('#methodology'), 'methodology');
    assert.equal(sectionIdFromHash('#commission-swap'), 'commission-swap');
    assert.equal(sectionIdFromHash(''), null);
    assert.equal(sectionIdFromHash('#Access'), null);
    assert.equal(activateSection('not-a-section', {
      elementTop: 10, scrollTop: 0, sticky: 0, scrollTo: () => { throw new Error('should not scroll'); }, setHash: () => { throw new Error('should not set hash'); },
    }), null);
  });

  it('renders every section as a keyboard link and marks only the active one', () => {
    const html = renderToStaticMarkup(createElement(SectionNav, { mismatches: 2, pendingDays: 3, current: 'reconciliation' }));
    for (const [id] of REPORT_SECTIONS) assert.match(html, new RegExp(`href="#${id}"`));
    assert.match(html, /<a\b(?=[^>]*href="#reconciliation")(?=[^>]*aria-current="true")[^>]*>/);
    assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /tabindex="-1"/);
    assert.match(html, /hover:bg-white/);
  });
});
