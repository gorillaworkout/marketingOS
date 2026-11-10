'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DUPOIN } from '@/components/monthly-report/brand';

const TABS = [
  { href: '/dashboard/settlement-report', label: 'Report' },
  { href: '/dashboard/settlement-report/data', label: 'Data sources' },
];

export function SettlementNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settlement Report" className="flex gap-1 border-b border-[var(--mos-border-subtle)]">
      {TABS.map(tab => {
        const active = tab.href === '/dashboard/settlement-report' ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} aria-current={active ? 'page' : undefined} className="-mb-px border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium" style={{ borderColor: active ? DUPOIN.teal : 'transparent', color: active ? DUPOIN.teal : undefined }}>
            <span className={active ? '' : 'text-[var(--mos-text-muted)]'}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
