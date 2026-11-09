'use client';

import { useEffect, useState } from 'react';
import { DataTableFrame, EmptyState, PageHeader, PageStack, StatusBadge } from '@/components/ui/dashboard';
import { DUPOIN } from '@/components/monthly-report/brand';
import { SettlementNav } from '@/components/settlement/SettlementNav';

type AccessUser = { id: string; username: string; name: string; role: string; department_name: string | null; via_department: boolean; personal_grant: boolean; can_upload: boolean };

export default function SettlementReportAccessPage() {
  const [users, setUsers] = useState<AccessUser[] | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');

  useEffect(() => {
    fetch('/api/settlement-report/access').then(async response => {
      const data = await response.json().catch(() => ({}));
      if (response.ok) setUsers(data.users); else setError(data.error || 'Could not load users');
    });
  }, []);

  const update = async (user: AccessUser, view: boolean) => {
    setSaving(user.id);
    setError('');
    const response = await fetch('/api/settlement-report/access', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.id, view }) });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.user) setUsers(list => list?.map(u => (u.id === user.id ? data.user : u)) ?? null);
    else setError(data.error || 'Could not save');
    setSaving('');
  };

  return (
    <PageStack>
      <PageHeader eyebrow="Reports" title="Settlement Report" description="Who can open Settlement Report. Anyone with access can upload. Admins always have full access." />
      <SettlementNav />
      {error && <p className="text-xs text-red-300">{error}</p>}
      <DataTableFrame title="Access" description="Access comes from the department (Accounts → Departments → Settlement Report) or a personal grant here. View and upload are the same.">
        {!users ? <p className="px-5 py-6 text-xs text-[var(--mos-text-muted)]">Loading…</p> : users.length === 0 ? <EmptyState title="No users" /> : (
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--mos-text-faint)]"><tr>{['User', 'Department', 'View', 'Personal access'].map(h => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {users.map(user => {
                const admin = user.role === 'admin';
                const canView = admin || user.via_department || user.personal_grant;
                return (
                  <tr key={user.id} className="border-t border-[var(--mos-border-subtle)] text-[var(--mos-text-secondary)]">
                    <td className="px-4 py-2.5"><span className="font-medium text-[var(--mos-text)]">{user.name}</span> <span className="text-[var(--mos-text-faint)]">@{user.username}</span></td>
                    <td className="px-4 py-2.5">{user.department_name ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      {admin ? <StatusBadge tone="info">Admin</StatusBadge> : canView ? <StatusBadge tone="success">{user.via_department ? 'Via department' : 'Personal'}</StatusBadge> : <StatusBadge>No access</StatusBadge>}
                    </td>
                    <td className="px-4 py-2.5">
                      <Toggle label={`Personal access for ${user.name}`} checked={admin || user.personal_grant} disabled={admin || saving === user.id} onChange={value => update(user, value)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </DataTableFrame>
    </PageStack>
  );
}

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-5 w-9 rounded-full border border-[var(--mos-border)] transition disabled:opacity-50"
      style={{ background: checked ? DUPOIN.teal : 'rgba(255,255,255,0.06)' }}
    >
      <span className="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all" style={{ left: checked ? 18 : 2 }} />
    </button>
  );
}
