'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, LoadingState, PageHeader, PageStack, Panel, StatusBadge } from '@/components/ui/dashboard';

interface ModelInfo {
  id: string;
  name: string;
  tier: 'budget' | 'balanced' | 'premium';
  provider: 'gorillaworkout';
}

interface Assignment {
  feature: string;
  metadata: {
    label: string;
    description: string;
    adminOnly: boolean;
  };
  allowedModels: ModelInfo[];
  defaultModel: string;
}

interface DraftAssignment {
  allowedModels: string[];
  defaultModel: string;
}

interface GatewayStatus {
  provider: {
    label: string;
    endpoint: string;
    status: 'available' | 'not_configured';
  };
}

export default function ModelsPage() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftAssignment>>({});
  const [gateway, setGateway] = useState<GatewayStatus['provider'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, { tone: 'success' | 'danger'; message: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setPageError('');
    try {
      const [assignmentResponse, gatewayResponse] = await Promise.all([
        fetch('/api/admin/model-assignments'),
        fetch('/api/models'),
      ]);
      if (!assignmentResponse.ok || !gatewayResponse.ok) throw new Error('Unable to load model assignments.');
      const assignmentData = await assignmentResponse.json() as { assignments: Assignment[]; models: ModelInfo[] };
      const gatewayData = await gatewayResponse.json() as GatewayStatus;
      setModels(assignmentData.models);
      setAssignments(assignmentData.assignments);
      setGateway(gatewayData.provider);
      setDrafts(Object.fromEntries(assignmentData.assignments.map(assignment => [
        assignment.feature,
        {
          allowedModels: assignment.allowedModels.map(model => model.id),
          defaultModel: assignment.defaultModel,
        },
      ])));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Unable to load model assignments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleAllowed = (feature: string, modelId: string) => {
    setStatuses(previous => ({ ...previous, [feature]: { tone: 'success', message: '' } }));
    setDrafts(previous => {
      const current = previous[feature];
      const selected = current.allowedModels.includes(modelId);
      const allowedModels = selected
        ? current.allowedModels.filter(id => id !== modelId)
        : [...current.allowedModels, modelId];
      return {
        ...previous,
        [feature]: {
          allowedModels,
          defaultModel: selected && current.defaultModel === modelId ? (allowedModels[0] || '') : current.defaultModel,
        },
      };
    });
  };

  const save = async (feature: string) => {
    const draft = drafts[feature];
    setSaving(feature);
    setStatuses(previous => ({ ...previous, [feature]: { tone: 'success', message: '' } }));
    try {
      const response = await fetch('/api/admin/model-assignments', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature, ...draft }),
      });
      const data = await response.json() as { error?: string; assignment?: Assignment };
      if (!response.ok) throw new Error(data.error || 'Unable to save assignment.');
      if (data.assignment) {
        setAssignments(previous => previous.map(item => item.feature === feature ? data.assignment! : item));
      }
      setStatuses(previous => ({
        ...previous,
        [feature]: { tone: 'success', message: 'Assignment saved.' },
      }));
    } catch (error) {
      setStatuses(previous => ({
        ...previous,
        [feature]: {
          tone: 'danger',
          message: error instanceof Error ? error.message : 'Unable to save assignment.',
        },
      }));
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <LoadingState label="Loading model assignments" />;

  return (
    <PageStack className="max-w-7xl">
      <PageHeader
        eyebrow="Administration / AI governance"
        title="Model assignment"
        description="Control the GorillaWorkout models each generation feature may offer—from Social Post through Market Research—and choose its safe default."
      />

      {pageError && (
        <Panel className="border-red-400/20 bg-red-400/5" padding="compact">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="alert" className="text-sm text-red-300">{pageError}</p>
            <Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button>
          </div>
        </Panel>
      )}

      {gateway && (
        <Panel padding="compact">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--mos-text-faint)]">Generation gateway</p>
              <h2 className="mt-1 text-base font-medium text-[var(--mos-text)]">{gateway.label}</h2>
              <p className="mt-1 break-all font-mono text-[11px] text-[var(--mos-text-muted)]">{gateway.endpoint}</p>
            </div>
            <StatusBadge tone={gateway.status === 'available' ? 'success' : 'warning'} dot>
              {gateway.status === 'available' ? 'Configured' : 'API key not configured'}
            </StatusBadge>
          </div>
        </Panel>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        {assignments.map(assignment => {
          const draft = drafts[assignment.feature];
          if (!draft) return null;
          const status = statuses[assignment.feature];
          return (
            <Panel key={assignment.feature} className="flex min-h-[430px] flex-col">
              <div className="flex items-start justify-between gap-4 border-b border-[var(--mos-border-subtle)] pb-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-[var(--mos-text)]">{assignment.metadata.label}</h2>
                    {assignment.metadata.adminOnly && <StatusBadge tone="info">Admin feature</StatusBadge>}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[var(--mos-text-muted)]">{assignment.metadata.description}</p>
                </div>
                <span className="rounded-[6px] border border-[var(--mos-border)] px-2 py-1 font-mono text-[10px] text-[var(--mos-text-faint)]">{assignment.feature}</span>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--mos-text-muted)]">Allowed models</h3>
                  <span className="text-[11px] text-[var(--mos-text-faint)]">{draft.allowedModels.length} selected</span>
                </div>
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-[7px] border border-[var(--mos-border)] bg-black/10 p-2">
                  {models.map(model => {
                    const checked = draft.allowedModels.includes(model.id);
                    return (
                      <label key={model.id} className={`flex cursor-pointer items-center gap-3 rounded-[6px] px-2.5 py-2 transition ${checked ? 'bg-indigo-400/10' : 'hover:bg-white/[0.035]'}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAllowed(assignment.feature, model.id)}
                          className="h-4 w-4 accent-indigo-400"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs text-[var(--mos-text-secondary)]">{model.name}</span>
                          <span className="block truncate font-mono text-[10px] text-[var(--mos-text-faint)]">{model.id}</span>
                        </span>
                        <StatusBadge>{model.tier}</StatusBadge>
                      </label>
                    );
                  })}
                </div>
              </div>

              <label className="mt-4 block">
                <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--mos-text-muted)]">Default model</span>
                <select
                  value={draft.defaultModel}
                  onChange={event => setDrafts(previous => ({
                    ...previous,
                    [assignment.feature]: { ...previous[assignment.feature], defaultModel: event.target.value },
                  }))}
                  className="mt-2 w-full rounded-[7px] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 py-2.5 text-sm text-[var(--mos-text)] outline-none focus:border-indigo-400/60"
                >
                  {draft.allowedModels.length === 0 && <option value="">Select at least one allowed model</option>}
                  {models.filter(model => draft.allowedModels.includes(model.id)).map(model => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
                </select>
              </label>

              <div className="mt-auto flex min-h-12 flex-col gap-2 border-t border-[var(--mos-border-subtle)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p role="status" className={`text-xs ${status?.tone === 'danger' ? 'text-red-300' : 'text-emerald-300'}`}>
                  {status?.message}
                </p>
                <Button
                  size="sm"
                  onClick={() => void save(assignment.feature)}
                  disabled={saving === assignment.feature || draft.allowedModels.length === 0 || !draft.defaultModel}
                >
                  {saving === assignment.feature ? 'Saving…' : 'Save assignment'}
                </Button>
              </div>
            </Panel>
          );
        })}
      </div>
    </PageStack>
  );
}
