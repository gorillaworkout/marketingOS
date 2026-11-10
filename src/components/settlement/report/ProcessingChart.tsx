import type { ProcessingTime } from '@/lib/settlement/metrics';

type Point = { date: string; api: number | null; manual: number | null; withdrawal: number | null };

function pointsOf(processing: ProcessingTime): Point[] {
  const withdrawals = new Map(processing.withdrawals.map(row => [row.date, row]));
  const dates = [...new Set([...processing.deposits.map(row => row.date), ...processing.withdrawals.map(row => row.date)])].sort();
  return dates.map(date => {
    const deposit = processing.deposits.find(row => row.date === date);
    const withdrawal = withdrawals.get(date);
    const minutes = (seconds: number | null | undefined, hits: number | undefined) => (hits ? (seconds ?? 0) / 60 : null);
    return {
      date,
      api: deposit ? minutes(deposit.officeApi.avgSeconds, deposit.officeApi.hits) : null,
      manual: deposit ? minutes(deposit.officeManual.avgSeconds, deposit.officeManual.hits) : null,
      withdrawal: withdrawal ? minutes(withdrawal.office.avgSeconds, withdrawal.office.hits) : null,
    };
  });
}

function line(points: Point[], pick: (point: Point) => number | null, x: (index: number) => number, y: (value: number) => number): string[] {
  const segments: string[] = [];
  let current = '';
  points.forEach((point, index) => {
    const value = pick(point);
    if (value === null) { if (current) segments.push(current); current = ''; return; }
    current += `${current ? ' ' : ''}${x(index)},${y(value)}`;
  });
  if (current) segments.push(current);
  return segments;
}

export function ProcessingChart({ processing, label }: { processing: ProcessingTime; label: string }) {
  const points = pointsOf(processing);
  const width = 460;
  const height = 220;
  const pad = { l: 36, r: 8, t: 16, b: 28 };
  const max = Math.max(1, ...points.flatMap(point => [point.api ?? 0, point.manual ?? 0, point.withdrawal ?? 0]));
  const y = (value: number) => pad.t + (height - pad.t - pad.b) - (value / max) * (height - pad.t - pad.b);
  const x = (index: number) => pad.l + (points.length <= 1 ? 0 : (index / (points.length - 1)) * (width - pad.l - pad.r));
  const colors = [
    ['#2EB5C4', (point: Point) => point.api],
    ['#7FD6DF', (point: Point) => point.manual],
    ['#f2c46b', (point: Point) => point.withdrawal],
  ] as const;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="h-auto w-full text-[var(--mos-text-muted)]">
      <text x={pad.l - 6} y={y(max) + 3} textAnchor="end" fontSize="10" fill="currentColor">{Math.round(max)}m</text>
      <text x={pad.l - 6} y={y(0) + 3} textAnchor="end" fontSize="10" fill="currentColor">0m</text>
      {colors.map(([color, pick]) => line(points, pick, x, y).map(segment => <polyline key={`${color}-${segment.slice(0, 12)}`} fill="none" stroke={color} strokeWidth="1.6" points={segment} />))}
      {points.map(point => <title key={point.date}>{`${point.date}${point.api === null ? ' no deposit API' : ` API ${point.api.toFixed(1)} min`}`}</title>)}
    </svg>
  );
}
