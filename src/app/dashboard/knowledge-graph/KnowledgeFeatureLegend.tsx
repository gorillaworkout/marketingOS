'use client';

import { knowledgeFeaturesInGraph } from '@/lib/knowledge-graph-colors';

export default function KnowledgeFeatureLegend({ taskTypes }: { taskTypes: Iterable<string | null | undefined> }) {
  const features = knowledgeFeaturesInGraph(taskTypes);
  if (!features.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--mos-border-subtle)] px-5 py-3" aria-label="Source features">
      <span className="text-[10px] font-medium uppercase tracking-[.12em] text-[var(--mos-text-faint)]">Source feature</span>
      {features.map(feature => (
        <span key={feature.key} className="inline-flex items-center gap-1.5 text-[11px] text-[var(--mos-text-secondary)]">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: feature.color, boxShadow: `0 0 8px ${feature.color}` }} />
          {feature.label}
        </span>
      ))}
    </div>
  );
}
