/** Display helpers shared by the SEO dashboard (pure, client-safe). */

export function formatInteger(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export function formatCtr(value: number): string {
  return `${(value * 100).toFixed(value > 0 && value < 0.001 ? 2 : 1)}%`;
}

export function formatPosition(value: number | null): string {
  return value == null ? '—' : value.toFixed(1);
}

/** Relative change vs the previous period, or null when there is no baseline. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / previous;
}

/**
 * Change label. For position lower is better, so the sign is inverted when
 * deciding whether the change is an improvement.
 */
export function changeLabel(current: number | null, previous: number | null, metric: 'clicks' | 'impressions' | 'ctr' | 'position'): { text: string; good: boolean | null } {
  if (current == null || previous == null) return { text: 'no comparison', good: null };
  if (metric === 'position') {
    if (!previous) return { text: 'no comparison', good: null };
    const delta = current - previous;
    if (Math.abs(delta) < 0.05) return { text: '±0.0', good: null };
    return { text: `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}`, good: delta < 0 };
  }
  const change = percentChange(current, previous);
  if (change == null) return { text: 'no comparison', good: null };
  if (Math.abs(change) < 0.0005) return { text: '±0%', good: null };
  return { text: `${change > 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(1)}%`, good: change > 0 };
}

/** SVG polyline points for a series scaled into a width x height box. */
export function sparklinePoints(values: number[], width: number, height: number, padding = 4): string {
  if (!values.length) return '';
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      const x = padding + index * step;
      const y = height - padding - ((value - min) / span) * (height - padding * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
