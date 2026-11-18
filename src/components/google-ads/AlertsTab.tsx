'use client';

import { useState } from 'react';
import { Button, DataTableFrame, EmptyState, LoadingState, Panel, Select, StatusBadge } from '@/components/ui/dashboard';
import { formatCustomerId } from '@/lib/google-ads/format';
import type { AlertRow } from '@/lib/google-ads/alerts';
import type { ALERTS } from '@/lib/google-ads/insights-config';
import { Explainer } from './InsightTable';
import { useInsight } from './useInsight';

type AlertsResponse = { counts: { open: number; critical: number }; alerts: AlertRow[]; thresholds: typeof ALERTS };

export const ALERT_KIND_LABELS: Record<string, string> = {
  spend_spike: 'Spend spike', cpc_rise: 'CPC rise', cpa_rise: 'Cost / conv. rise', conversions_drop: 'Conversions drop', spend_stopped: 'Spend stopped',
};
const STATUS_TONE: Record<string, 'warning' | 'neutral' | 'success' | 'info'> = { open: 'warning', acknowledged: 'info', dismissed: 'neutral', resolved: 'success' };
const pct = (ratio: number) => `${Math.round((ratio - 1) * 100) > 0 ? '+' : ''}${Math.round((ratio - 1) * 100)}%`;

export function AlertsTab({ account, version, onChanged }: { account: string; version: number; onChanged: () => void }) {
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const { data, error, loading } = useInsight<AlertsResponse>(`/api/paid-media/google-ads/alerts?${new URLSearchParams({ status, account })}`, version * 1000 + refresh);
  const t = data?.thresholds;

  const act = async (id: string, action: 'acknowledge' | 'dismiss' | 'reopen') => {
    setBusy(id); setActionError('');
    try {
      const response = await fetch(`/api/paid-media/google-ads/alerts/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) setActionError(body.error || 'Could not update the alert.');
    } catch {
      setActionError('Could not update the alert.');
    } finally {
      setBusy(''); setRefresh(value => value + 1); onChanged();
    }
  };

  return <>
    <Panel padding="compact">
      <Explainer>
        <li>Checked automatically after the daily 09:00 WIB sync (and after Sync now): the last {t?.recentDays ?? 7} complete days are compared with the {t?.baselineDays ?? 28} days before, for each account and campaign. Alerts stay in MarketingOS; nothing is emailed or posted.</li>
        <li>Rules: <b>Spend spike</b> daily spend ≥ {t ? `${t.spendSpikeRatio}×` : '1.5×'} baseline; <b>CPC rise</b> ≥ {t ? `${t.cpcRiseRatio}×` : '1.3×'}; <b>Cost / conv. rise</b> ≥ {t ? `${t.cpaRiseRatio}×` : '1.4×'}; <b>Conversions drop</b> to ≤ {t ? `${Math.round(t.conversionsDropRatio * 100)}%` : '60%'} of baseline; <b>Spend stopped</b> a campaign that spent steadily had 0 spend for the last {t?.stoppedDays ?? 2} days. Minimum volumes apply so small campaigns do not create noise.</li>
        <li><b>Acknowledge</b> = you are on it; <b>Dismiss</b> = not a problem. Either keeps the same alert quiet for {t?.snoozeDays ?? 7} days while the condition repeats. Open alerts close as <b>resolved</b> when the numbers return to normal.</li>
      </Explainer>
    </Panel>
    <div className="flex items-center gap-2">
      <Select aria-label="Alert status" value={status} onChange={event => setStatus(event.target.value as 'open' | 'all')} className="w-auto">
        <option value="open">Open alerts</option>
        <option value="all">All alerts (history)</option>
      </Select>
      {data && <span className="text-xs text-[var(--mos-text-faint)]">{data.counts.open} open{data.counts.critical ? `, ${data.counts.critical} critical` : ''}</span>}
    </div>
    {(error || actionError) && <Panel><p className="text-sm text-red-300">{error || actionError}</p></Panel>}
    {loading && !data && <LoadingState label="Loading alerts" />}
    {data && !data.alerts.length && <Panel padding="none"><EmptyState title={status === 'open' ? 'No open alerts' : 'No alerts yet'} description="Alerts are computed after each sync. Nothing unusual was found in the latest check." /></Panel>}
    {data && data.alerts.length > 0 && <DataTableFrame title={`${status === 'open' ? 'Open alerts' : 'Alerts'} (${data.alerts.length})`}>
      <table className="w-full min-w-[980px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">
          <tr><th className="p-3">Alert</th><th className="p-3">Where</th><th className="p-3">What changed</th><th className="p-3 text-right">Change</th><th className="p-3">Seen</th><th className="p-3">Status</th><th className="p-3 text-right">Action</th></tr>
        </thead>
        <tbody>
          {data.alerts.map(alert => <tr key={alert.id} className="border-b border-[var(--mos-border)] align-top text-[var(--mos-text-secondary)]">
            <td className="whitespace-nowrap p-3"><StatusBadge tone={alert.severity === 'critical' ? 'danger' : 'warning'} dot>{ALERT_KIND_LABELS[alert.kind] ?? alert.kind}</StatusBadge></td>
            <td className="max-w-[260px] p-3"><div className="truncate text-white" title={alert.campaignName || 'Whole account'}>{alert.campaignId ? alert.campaignName : 'Whole account'}</div>
              <div className="text-[11px] text-[var(--mos-text-faint)]">{alert.accountName || 'Account'} · {formatCustomerId(alert.customerId)}</div></td>
            <td className="max-w-[420px] p-3 text-xs leading-5">{alert.message}</td>
            <td className="whitespace-nowrap p-3 text-right tabular-nums">{alert.changeRatio == null ? '—' : alert.kind === 'spend_stopped' ? '−100%' : pct(alert.changeRatio)}</td>
            <td className="whitespace-nowrap p-3 text-xs">{alert.firstSeenDate === alert.lastSeenDate ? alert.lastSeenDate : `${alert.firstSeenDate} to ${alert.lastSeenDate}`}</td>
            <td className="whitespace-nowrap p-3 text-xs"><StatusBadge tone={STATUS_TONE[alert.status] ?? 'neutral'}>{alert.status}</StatusBadge>
              {alert.statusBy && alert.status !== 'open' && <div className="mt-1 text-[11px] text-[var(--mos-text-faint)]">by {alert.statusBy}</div>}</td>
            <td className="whitespace-nowrap p-3 text-right">
              {alert.status === 'open' && <span className="inline-flex gap-1">
                <Button size="sm" disabled={busy === alert.id} onClick={() => act(alert.id, 'acknowledge')}>Acknowledge</Button>
                <Button size="sm" variant="ghost" disabled={busy === alert.id} onClick={() => act(alert.id, 'dismiss')}>Dismiss</Button>
              </span>}
              {(alert.status === 'acknowledged' || alert.status === 'dismissed') && <Button size="sm" variant="ghost" disabled={busy === alert.id} onClick={() => act(alert.id, 'reopen')}>Reopen</Button>}
            </td>
          </tr>)}
        </tbody>
      </table>
    </DataTableFrame>}
  </>;
}
