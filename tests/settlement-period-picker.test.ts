import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isFutureDay, isFutureMonth, monthWeeks, weekRange } from '../src/components/settlement/report/calendar';
import { PeriodDateField } from '../src/components/settlement/report/PeriodDateField';
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

describe('settlement calendar grid', () => {
  it('builds Monday weeks and marks days and months after today', () => {
    const weeks = monthWeeks(2026, 11);
    assert.equal(weeks[0][0], '2026-10-26');
    assert.equal(weeks[0][6], '2026-11-01');
    assert.deepEqual(weekRange('2026-11-08'), { from: '2026-11-02', to: '2026-11-08' });
    assert.equal(isFutureDay('2026-11-11', '2026-11-10'), true);
    assert.equal(isFutureDay('2026-11-10', '2026-11-10'), false);
    assert.equal(isFutureMonth('2026-12', '2026-11-10'), true);
    assert.equal(isFutureMonth('2026-11', '2026-11-10'), false);
  });
});

describe('settlement period picker controls', () => {
  const period = resolveSettlementPeriod('week', anchorFromPicker('week', '2026-11-08')!);

  it('opens from the period label and keeps the arrows, with no native date input', () => {
    const html = renderToStaticMarkup(createElement(SettlementPeriodBar, {
      period,
      previous: { from: '2026-10-26', to: '2026-11-01' },
      onPreset: () => undefined,
      onShift: () => undefined,
      onAnchor: () => undefined,
    }));
    assert.doesNotMatch(html, /type="date"|type="month"/);
    assert.match(html, /aria-label="Choose report period"/);
    assert.match(html, /aria-label="Choose report period calendar"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-label="Previous period"/);
    assert.match(html, /aria-label="Next period"/);
    assert.match(html, /02–08 Nov/);
  });

  it('shows a day grid that disables future days and highlights the selected week', () => {
    const day = renderToStaticMarkup(createElement(PeriodDateField, {
      preset: 'day', value: '2026-11-06', today: '2026-11-10', defaultOpen: true, label: 'Choose report period', onChange: () => undefined,
      children: '05–06 Nov',
    }));
    assert.match(day, /role="dialog"/);
    assert.match(day, /aria-label="2026-11-11" aria-selected="false" disabled=""/);
    assert.match(day, /aria-label="2026-11-06" aria-selected="true"/);
    const week = renderToStaticMarkup(createElement(PeriodDateField, {
      preset: 'week', value: '2026-11-02', today: '2026-11-10', defaultOpen: true, label: 'Choose report period', onChange: () => undefined,
      children: '02–08 Nov',
    }));
    assert.match(week, /data-selected-week="true"/);
    assert.match(week, /aria-label="2026-11-02"/);
    assert.match(week, /aria-label="2026-11-08"/);
  });

  it('shows a 12-month grid and disables months after today', () => {
    const html = renderToStaticMarkup(createElement(PeriodDateField, {
      preset: 'month', value: '2026-10-01', today: '2026-11-10', defaultOpen: true, label: 'Choose report period', onChange: () => undefined,
      children: 'October 2026',
    }));
    assert.match(html, /aria-label="2026-10"/);
    assert.match(html, /<button\b(?=[^>]*aria-label="2026-12")(?=[^>]*disabled)[^>]*>/);
    assert.match(html, /aria-label="Previous year"/);
    assert.match(html, /<button\b(?=[^>]*aria-label="Next year")(?=[^>]*disabled)[^>]*>/);
    assert.doesNotMatch(html, /type="month"/);
  });

  it('gives the reconciliation day the same popover and hides it when printing', () => {
    const html = renderToStaticMarkup(createElement(ReconciliationSection, {
      date: '2026-11-06', recon: null, list: 'all', variant: 'screen', onDate: () => undefined,
    }));
    assert.match(html, /aria-label="Choose reconciliation day"/);
    assert.match(html, /aria-label="Choose reconciliation day calendar"/);
    assert.match(html, /05–06 Nov/);
    assert.match(html, /aria-label="Previous report day"/);
    assert.doesNotMatch(html, /type="date"/);
    assert.doesNotMatch(renderToStaticMarkup(createElement(ReconciliationSection, {
      date: '2026-11-06', recon: null, list: 'all', variant: 'print',
    })), /Choose reconciliation day/);
  });
});
