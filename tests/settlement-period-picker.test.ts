import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReconciliationSection } from '../src/components/settlement/report/ReconciliationSection';
import { SettlementPeriodBar } from '../src/components/settlement/report/SettlementPeriodBar';
import { anchorFromPicker, dailyPairLabel } from '../src/components/settlement/report/labels';
import { reconciliationWindow } from '../src/lib/settlement/conventions';
import { resolveSettlementPeriod } from '../src/lib/settlement/report';

describe('settlement period picker snapping', () => {
  it('keeps a daily pick as that report day, labelled with both dates of the 12:00 window', () => {
    assert.equal(anchorFromPicker('day', '2026-11-06'), '2026-11-06');
    const period = resolveSettlementPeriod('day', '2026-11-06');
    assert.equal(dailyPairLabel(period.anchor), '05–06 Nov');
    assert.equal(period.window?.start, reconciliationWindow('2026-11-06').start);
    assert.equal(period.window?.end, '2026-11-06T05:00:00.000Z');
  });

  it('snaps a weekly pick to the Monday of that Mon–Sun week', () => {
    assert.equal(anchorFromPicker('week', '2026-11-08'), '2026-11-02');
    assert.equal(anchorFromPicker('week', '2026-11-04'), '2026-11-02');
    assert.deepEqual(resolveSettlementPeriod('week', anchorFromPicker('week', '2026-10-01')!).range, { from: '2026-09-28', to: '2026-10-04' });
  });

  it('turns a month pick into the first of that calendar month', () => {
    assert.equal(anchorFromPicker('month', '2026-02'), '2026-02-01');
    assert.deepEqual(resolveSettlementPeriod('month', anchorFromPicker('month', '2026-02')!).range, { from: '2026-02-01', to: '2026-02-28' });
    assert.equal(anchorFromPicker('day', '2026-02-31'), null);
    assert.equal(anchorFromPicker('month', '2026-13'), null);
    assert.equal(anchorFromPicker('week', ''), null);
  });
});

describe('settlement period picker controls', () => {
  const period = resolveSettlementPeriod('week', anchorFromPicker('week', '2026-11-08')!);
  const picks: string[] = [];

  it('renders a date input on the period label and keeps the arrows', () => {
    const html = renderToStaticMarkup(createElement(SettlementPeriodBar, {
      period,
      previous: { from: '2026-10-26', to: '2026-11-01' },
      onPreset: () => undefined,
      onShift: () => undefined,
      onAnchor: value => picks.push(value),
    }));
    assert.match(html, /type="date"/);
    assert.match(html, /value="2026-11-02"/);
    assert.match(html, /aria-label="Choose report period"/);
    assert.match(html, /aria-label="Previous period"/);
    assert.match(html, /aria-label="Next period"/);
    assert.match(html, /02–08 Nov/);
  });

  it('uses a month input for the monthly preset', () => {
    const html = renderToStaticMarkup(createElement(SettlementPeriodBar, {
      period: resolveSettlementPeriod('month', '2026-10-15'),
      previous: { from: '2026-09-01', to: '2026-09-30' },
      onPreset: () => undefined,
      onShift: () => undefined,
      onAnchor: () => undefined,
    }));
    assert.match(html, /type="month"/);
    assert.match(html, /value="2026-10"/);
    assert.match(html, /October 2026/);
  });

  it('gives the reconciliation day its own date input beside the arrows', () => {
    const html = renderToStaticMarkup(createElement(ReconciliationSection, {
      date: '2026-11-06',
      recon: null,
      list: 'all',
      variant: 'screen',
      onDate: value => picks.push(value),
    }));
    assert.match(html, /type="date"/);
    assert.match(html, /value="2026-11-06"/);
    assert.match(html, /aria-label="Choose reconciliation day"/);
    assert.match(html, /05–06 Nov/);
    assert.match(html, /aria-label="Previous report day"/);
    assert.doesNotMatch(renderToStaticMarkup(createElement(ReconciliationSection, {
      date: '2026-11-06', recon: null, list: 'all', variant: 'print',
    })), /type="date"/);
  });
});
