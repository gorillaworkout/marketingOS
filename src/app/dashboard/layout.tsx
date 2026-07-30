'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/dashboard';

interface User {
  id: string;
  username: string;
  name: string;
  role: string;
  enabledFeatures: string[];
}


type IconName =
  | 'home' | 'social' | 'video' | 'event' | 'article' | 'research'
  | 'brand' | 'image' | 'calendar' | 'template' | 'knowledge' | 'history'
  | 'graph' | 'tokens' | 'analytics' | 'accounts' | 'models';

const iconPaths: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5M9 21v-7h6v7',
  social: 'M7 8h10M7 12h7M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  video: 'm15 10 4.5-3v10L15 14M5 5h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  event: 'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Zm3-2v4m8-4v4M3 9h18M7 13h4m-4 4h8',
  article: 'M6 3h9l4 4v14H6V3Zm9 0v5h4M9 12h7m-7 4h7',
  research: 'm20 20-4.5-4.5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  brand: 'm3 12 9-9 9 9-9 9-9-9Zm6 0h6',
  image: 'M4 4h16v16H4V4Zm0 12 4-4 3 3 3-4 6 6M8 8h.01',
  calendar: 'M4 5h16v16H4V5Zm4-3v6m8-6v6M4 10h16',
  template: 'M5 3h14v18H5V3Zm4 4h6m-6 4h6m-6 4h4',
  knowledge: 'M4 5a3 3 0 0 1 3-3h5v18H7a3 3 0 0 0-3 3V5Zm16 0a3 3 0 0 0-3-3h-5v18h5a3 3 0 0 1 3 3V5Z',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5m4-2v6l4 2',
  graph: 'M12 4v6m0 4v6M6 7l6 3 6-3M6 17l6-3 6 3M6 7v10m12-10v10',
  tokens: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Zm-8 3v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  analytics: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  accounts: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 2a4 4 0 0 1 4 4v2m-4-10a4 4 0 0 0 0-8',
  models: 'M12 3 4 7v10l8 4 8-4V7l-8-4Zm-8 4 8 4 8-4m-8 4v10',
};

function NavIcon({ name }: { name: IconName }) {
  return <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={iconPaths[name]} /></svg>;
}

const generateItems = [
  { href: '/dashboard/social-post', label: 'Social post', icon: 'social' },
  { href: '/dashboard/video-script', label: 'Video script', icon: 'video' },
  { href: '/dashboard/event-plan', label: 'Event plan', icon: 'event' },
  { href: '/dashboard/sop', label: 'Article Market News', icon: 'article', adminOnly: true },
  { href: '/dashboard/market-research', label: 'Market research', icon: 'research', adminOnly: true },
] satisfies Array<{ href: string; label: string; icon: IconName; adminOnly?: boolean }>;

const resourceItems = [
  { href: '/dashboard/brand-guidelines', label: 'Brand guidelines', icon: 'brand', adminOnly: true },
  { href: '/dashboard/images', label: 'Image Gallery', icon: 'image', adminOnly: true },
  { href: '/dashboard/calendar', label: 'Calendar', icon: 'calendar', adminOnly: true },
  { href: '/dashboard/templates', label: 'Templates', icon: 'template', adminOnly: true },
  { href: '/dashboard/knowledge', label: 'Knowledge', icon: 'knowledge', adminOnly: true },
  { href: '/dashboard/history', label: 'History', icon: 'history', adminOnly: true },
] satisfies Array<{ href: string; label: string; icon: IconName; adminOnly?: boolean }>;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check' }),
    }).then(async response => {
      const data = await response.json();
      if (data.authenticated) {
        setUser(data.user);
        const generationFeature = pathname.split('/').pop() || '';
        const adminOnlyPages = ['/dashboard/tokens', '/dashboard/analytics', '/dashboard/accounts', '/dashboard/templates', '/dashboard/calendar', '/dashboard/images', '/dashboard/knowledge', '/dashboard/knowledge-graph', '/dashboard/brand-guidelines', '/dashboard/history', '/dashboard/sop', '/dashboard/market-research'];
        if (data.user.role !== 'admin' && (adminOnlyPages.includes(pathname) || (['social-post', 'video-script', 'event-plan'].includes(generationFeature) && !data.user.enabledFeatures?.includes(generationFeature)))) {
          router.replace('/dashboard');
        }
      } else {
        router.push('/');
      }
      setLoading(false);
    });
  }, [router, pathname]);


  const handleLogout = async () => {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    router.push('/');
  };


  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[var(--mos-bg)]"><span className="h-5 w-5 animate-spin rounded-full border border-[var(--mos-border-strong)] border-t-[var(--mos-accent)]" /></div>;
  }

  const sections: Array<{ label?: string; items: Array<{ href: string; label: string; icon: IconName; adminOnly?: boolean }> }> = [
    { items: [{ href: '/dashboard', label: 'Overview', icon: 'home' }] },
    {
      label: 'Create',
      items: generateItems,
    },
    {
      label: 'Library',
      items: resourceItems,
    },
    {
      label: 'AI workspace',
      items: [{ href: '/dashboard/models', label: 'Models', icon: 'models' }],
    },
    {
      label: 'Administration',
      items: [
        { href: '/dashboard/knowledge-graph', label: 'Knowledge Graph', icon: 'graph', adminOnly: true },
        { href: '/dashboard/tokens', label: 'Token usage', icon: 'tokens', adminOnly: true },
        { href: '/dashboard/analytics', label: 'Analytics', icon: 'analytics', adminOnly: true },
        { href: '/dashboard/accounts', label: 'Accounts', icon: 'accounts', adminOnly: true },
      ],
    },
  ];

  const visibleSections = sections.map(section => ({
    ...section,
    items: section.items.filter(item => {
      if (item.adminOnly) return user?.role === 'admin';
      if (!['social-post', 'video-script', 'event-plan'].includes(item.href.split('/').pop() || '')) return true;
      return user?.role === 'admin' || user?.enabledFeatures.includes(item.href.split('/').pop() || '');
    }),
  })).filter(section => section.items.length);


  const sidebar = (
    <aside className="flex h-full w-[264px] flex-col border-r border-[var(--mos-border-subtle)] bg-[var(--mos-sidebar)]">
      <div className="flex h-16 items-center gap-3 border-b border-[var(--mos-border-subtle)] px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-[7px] border border-white/[0.08] bg-white/[0.045] text-[11px] font-semibold tracking-[-0.02em] text-[var(--mos-text)]">MO</div>
        <div className="min-w-0">
          <p className="text-sm font-[560] tracking-[-0.02em] text-[var(--mos-text)]">MarketingOS</p>
          <p className="truncate text-[11px] text-[var(--mos-text-faint)]">Dupoin workspace</p>
        </div>
        <button aria-label="Close navigation" className="ml-auto p-2 text-[var(--mos-text-muted)] lg:hidden" onClick={() => setMobileOpen(false)}>×</button>
      </div>

      <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-gutter:stable]">
        {visibleSections.map((section, sectionIndex) => (
          <div key={section.label || sectionIndex}>
            {section.label && <p className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--mos-text-faint)]">{section.label}</p>}
            <div className="space-y-0.5">
              {section.items.map(item => {
                const active = item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={`group flex h-8.5 items-center gap-2.5 rounded-[6px] px-2.5 text-[13px] transition ${active ? 'bg-white/[0.065] text-[var(--mos-text)] shadow-[inset_2px_0_0_var(--mos-accent)]' : 'text-[var(--mos-text-muted)] hover:bg-white/[0.035] hover:text-[var(--mos-text-secondary)]'}`}>
                    <NavIcon name={item.icon} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>


      <div className="flex items-center gap-3 border-t border-[var(--mos-border-subtle)] p-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-indigo-300/15 bg-indigo-400/10 text-xs font-medium text-indigo-100">{user?.name?.charAt(0) || '?'}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-[var(--mos-text-secondary)]">{user?.name}</p>
          <p className="truncate text-[10px] capitalize text-[var(--mos-text-faint)]">{user?.role} account</p>
        </div>
        <Button variant="ghost" size="sm" aria-label="Sign out" onClick={handleLogout} className="w-8 px-0">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeWidth="1.7" d="M10 17l5-5-5-5m5 5H3m10-9h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></svg>
        </Button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-[var(--mos-bg)] text-[var(--mos-text)]">
      <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">{sidebar}</div>
      {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button aria-label="Close navigation overlay" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} /><div className="relative h-full">{sidebar}</div></div>}
      <header className="sticky top-0 z-30 flex h-14 items-center border-b border-[var(--mos-border-subtle)] bg-[var(--mos-bg)]/90 px-4 backdrop-blur-xl lg:hidden">
        <button aria-label="Open navigation" className="mr-3 flex h-11 w-11 items-center justify-center rounded-[6px] border border-[var(--mos-border)] text-[var(--mos-text-muted)]" onClick={() => setMobileOpen(true)}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <p className="text-sm font-medium text-[var(--mos-text)]">MarketingOS</p>
        <Link href="/dashboard/models" className="ml-auto flex min-h-11 items-center px-2 text-[11px] font-medium text-[var(--mos-accent-soft)]">Models</Link>
      </header>
      <main className="min-h-screen lg:pl-[264px]">
        <div className="mx-auto w-full max-w-[1544px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
