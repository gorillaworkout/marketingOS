export function Sparkline({ points, label }: { points: Array<number | null>; label: string }) {
  const values = points.filter((point): point is number => point !== null);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = 80 / (points.length - 1);
  const coords = points.map((point, index) => {
    if (point === null) return null;
    const y = 24 - ((point - min) / span) * 20;
    return `${index * step},${y}`;
  }).filter(Boolean).join(' ');
  return (
    <svg className="mt-2.5 h-[26px] w-full" viewBox="0 0 80 26" role="img" aria-label={label}>
      <polyline fill="none" stroke="#2EB5C4" strokeWidth="1.4" points={coords} />
    </svg>
  );
}
