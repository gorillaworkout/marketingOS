'use client';

import { DUPOIN, formatInteger, formatPct } from './brand';

export interface TrendPoint { key: string; label: string; value: number | null; previous?: number | null }

/** Column chart of one metric per bucket; null values render as "no data" gaps. */
export function TrendChart({ points, ariaLabel }: { points: TrendPoint[]; ariaLabel: string }) {
  const width = 960;
  const height = 240;
  const padLeft = 44;
  const padBottom = 34;
  const padTop = 16;
  const max = Math.max(1, ...points.map(p => p.value ?? 0));
  const niceMax = niceCeil(max);
  const plotW = width - padLeft - 8;
  const plotH = height - padTop - padBottom;
  const slot = plotW / Math.max(points.length, 1);
  const barW = Math.max(2, Math.min(42, slot * 0.62));
  const labelEvery = Math.ceil(points.length / 16);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(niceMax * t));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="h-auto w-full">
      {ticks.map(tick => {
        const y = padTop + plotH - (tick / niceMax) * plotH;
        return (
          <g key={tick}>
            <line x1={padLeft} x2={width - 8} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.08} />
            <text x={padLeft - 8} y={y + 3} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity={0.45}>{formatInteger(tick)}</text>
          </g>
        );
      })}
      {points.map((point, index) => {
        const x = padLeft + slot * index + (slot - barW) / 2;
        const value = point.value;
        const h = value ? (value / niceMax) * plotH : 0;
        return (
          <g key={point.key}>
            <title>{`${point.label}: ${value === null ? 'no data' : formatInteger(value)}`}</title>
            {value === null
              ? <rect x={x} y={padTop + plotH - 3} width={barW} height={3} fill="currentColor" fillOpacity={0.12} />
              : <rect x={x} y={padTop + plotH - h} width={barW} height={Math.max(h, value > 0 ? 1 : 0)} rx={2} fill={DUPOIN.teal} />}
            {points.length <= 12 && value !== null && value > 0 && (
              <text x={x + barW / 2} y={padTop + plotH - h - 5} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity={0.75}>{formatInteger(value)}</text>
            )}
            {index % labelEvery === 0 && (
              <text x={x + barW / 2} y={height - 12} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity={0.5}>{point.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function niceCeil(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find(s => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

export interface FunnelBar { key: string; label: string; value: number | null; stepPct: number | null; overallPct: number | null }

export function FunnelChart({ steps }: { steps: FunnelBar[] }) {
  const top = steps[0]?.value ?? 0;
  return (
    <div className="space-y-3">
      {steps.map((step, index) => {
        const width = top && step.value !== null ? Math.max(2, Math.min(100, (step.value / top) * 100)) : 0;
        return (
          <div key={step.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium text-[var(--mos-text-secondary)]">{step.label}</span>
              <span className="text-[var(--mos-text-muted)]">
                <span className="font-semibold text-[var(--mos-text)]">{formatInteger(step.value)}</span>
                {index > 0 && <> · {formatPct(step.stepPct)} of previous step · {formatPct(step.overallPct)} of registrations</>}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-white/[0.05]">
              <div className="h-2.5 rounded-full" style={{ width: `${width}%`, background: index === 0 ? DUPOIN.tealDeep : DUPOIN.teal, opacity: 1 - index * 0.12 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
