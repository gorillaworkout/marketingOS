'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DUPOIN } from '@/components/monthly-report/brand';
import { useSettlementPermissions } from './SettlementContext';

export function SettlementNav() {
  const pathname = usePathname();
  const { isAdmin } = useSettlementPermissions();
  const tabs = [
    { href: '/dashboard/settlement-report', label: 'Report' },
    ...(isAdmin ? [{ href: '/dashboard/settlement-report/access', label: 'Access' }] : []),
  ];
  return (
    <nav aria-label="Settlement Report sections" className="flex gap-1 border-b border-[var(--mos-border-subtle)]">
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
