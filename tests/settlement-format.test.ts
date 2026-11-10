import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeDelta, formatCompact, formatDailySpan, formatDurationShort, formatIdr, formatUsd } from '../src/lib/settlement/format';

describe('settlement report formatters', () => {
  it('formats IDR with 0 decimals and a typographic minus', () => {
    assert.equal(formatIdr(48210770000.49), '48,210,770,000');
    assert.equal(formatIdr(-1234.5), '−1,235');
    assert.equal(formatIdr(null), '—');
  });

  it('formats USD with 2 decimals and a typographic minus', () => {
    assert.equal(formatUsd(1957.449), '1,957.45');
    assert.equal(formatUsd(-12.5), '−12.50');
    assert.equal(formatUsd(null), '—');
  });

  it('compacts IDR headlines at B, M and K boundaries', () => {
    assert.equal(formatCompact(48_210_000_000), '48.21 B');
    assert.equal(formatCompact(1_840_000), '1.84 M');
    assert.equal(formatCompact(912_400), '912.4 K');
    assert.equal(formatCompact(999), '999');
    assert.equal(formatCompact(-48_210_000_000), '−48.21 B');
  });

  it('shortens durations and leaves an empty value as an em dash', () => {
    assert.equal(formatDurationShort(252), '4m 12s');
    assert.equal(formatDurationShort(72_900), '20h 15m');
    assert.equal(formatDurationShort(null), '—');
  });

  it('labels a 12:00 window with both dates', () => {
    assert.equal(formatDailySpan('2026-11-05', '2026-11-06'), '05–06 Nov');
    assert.equal(formatDailySpan('2026-10-31', '2026-11-01'), '31 Oct–01 Nov');
    assert.equal(formatDailySpan('2025-12-31', '2026-01-01'), '31 Dec 2025–01 Jan 2026');
  });

  it('computes a relative, points or seconds delta and drops a missing previous value', () => {
    const up = computeDelta(112.4, 100, { kind: 'relative', favourable: 'up' });
    assert.equal(up?.text, '▲ 12.4%');
    assert.equal(up?.tone, 'good');
    assert.match(up?.sr ?? '', /up 12\.4% versus previous period/);

    const down = computeDelta(64.4, 60.9, { kind: 'points', favourable: 'up' });
    assert.equal(down?.text, '▲ 3.5 pt');
    assert.equal(down?.tone, 'good');

    const slower = computeDelta(290, 252, { kind: 'seconds', favourable: 'down' });
    assert.equal(slower?.text, '▲ 38s');
    assert.equal(slower?.tone, 'bad');
    assert.match(slower?.sr ?? '', /up 38 seconds versus previous period/);

    const faster = computeDelta(214, 252, { kind: 'seconds', favourable: 'down' });
    assert.equal(faster?.tone, 'good');

    assert.equal(computeDelta(10, null, { kind: 'relative', favourable: 'up' }), null);
    assert.equal(computeDelta(10, 0, { kind: 'relative', favourable: 'up' }), null);
    assert.equal(computeDelta(100.04, 100, { kind: 'relative', favourable: 'up' })?.tone, 'flat');
    assert.equal(computeDelta(110, 100, { kind: 'relative', favourable: 'neutral' })?.tone, 'neutral');
  });
});
