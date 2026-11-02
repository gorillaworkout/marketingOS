'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DUPOIN } from './brand';
import { useMonthlyReportPermissions } from './MonthlyReportContext';

export function ReportTabs() {
  const pathname = usePathname();
  const { canUpload, isAdmin } = useMonthlyReportPermissions();
  const tabs = [
    { href: '/dashboard/monthly-report', label: 'Onboarding' },
    { href: '/dashboard/monthly-report/settlement', label: 'Settlement' },
    ...(canUpload ? [{ href: '/dashboard/monthly-report/uploads', label: 'Uploads' }] : []),
    ...(isAdmin ? [{ href: '/dashboard/monthly-report/access', label: 'Access' }] : []),
  ];
  return (
    <nav aria-label="Monthly Report sections" className="flex gap-1 border-b border-[var(--mos-border-subtle)]">
      {tabs.map(tab => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className="-mb-px border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition"
            style={{ borderColor: active ? DUPOIN.teal : 'transparent', color: active ? DUPOIN.teal : undefined }}
          >
            <span className={active ? '' : 'text-[var(--mos-text-muted)] hover:text-[var(--mos-text)]'}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Small "i" with a native tooltip, for KPI definitions. */
export function InfoTip({ text }: { text: string }) {
  return (
    <span title={text} aria-label={text} className="ml-1 inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-[var(--mos-border-strong)] text-[9px] font-semibold text-[var(--mos-text-muted)]">i</span>
  );
}
