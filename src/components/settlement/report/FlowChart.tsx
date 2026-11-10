import { formatCompact } from '@/lib/settlement/format';
import type { DailyFlow } from '@/lib/settlement/summary';

export function FlowChart({ daily, label }: { daily: DailyFlow[]; label: string }) {
  const width = 640;
  const height = 220;
  const pad = { l: 48, r: 12, t: 16, b: 28 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const max = Math.max(1, ...daily.flatMap(row => [row.depositIdr, row.withdrawalIdr, Math.abs(row.netIdr)]));
  const y = (value: number) => pad.t + plotH - (value / max) * plotH;
  const slot = plotW / Math.max(daily.length, 1);
  const net = daily.map((row, index) => `${pad.l + slot * index + slot / 2},${y(row.netIdr)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="h-auto w-full text-[var(--mos-text-muted)]">
      {[0, 0.5, 1].map(step => (
        <text key={step} x={pad.l - 6} y={y(max * step) + 3} textAnchor="end" fontSize="10" fill="currentColor">{formatCompact(max * step)}</text>
      ))}
      {daily.map((row, index) => {
        const x = pad.l + slot * index + slot * 0.15;
        const bar = Math.max(2, slot * 0.28);
        return (
          <g key={row.date}>
            <rect x={x} y={y(row.depositIdr)} width={bar} height={Math.max(0, pad.t + plotH - y(row.depositIdr))} fill="#2EB5C4">
              <title>{`${row.date} deposits ${formatCompact(row.depositIdr)}`}</title>
            </rect>
            <rect x={x + bar + 1} y={y(row.withdrawalIdr)} width={bar} height={Math.max(0, pad.t + plotH - y(row.withdrawalIdr))} fill="#5e626b">
              <title>{`${row.date} withdrawals ${formatCompact(row.withdrawalIdr)}`}</title>
            </rect>
          </g>
        );
      })}
      {daily.length > 1 && <polyline fill="none" stroke="#f2c46b" strokeWidth="1.6" points={net} />}
    </svg>
  );
}
