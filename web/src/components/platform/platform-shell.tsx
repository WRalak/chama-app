'use client';

import * as DM from '@radix-ui/react-dropdown-menu';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Bell,
  BookOpenCheck,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  Globe2,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  PlugZap,
  Receipt,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  UserRound,
  Users,
  Wallet,
  X,
  FolderLock,
  Repeat,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PlatformPermission as PP, type PlatformPermission } from '@chamahub/shared';
import { api, ApiError } from '@/lib/api';
import { staffSignOut, usePlatformMe } from '@/lib/platform-session';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/layout-parts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { BrandMark } from '@/components/shell/brand';

type Icon = React.ComponentType<{ className?: string }>;
/** An item shows when the caller holds ANY of its permissions (none = every signed-in staff member). */
export interface PortalNavItem { href: string; label: string; icon: Icon; any?: PlatformPermission[]; exact?: boolean }

export const PORTAL_NAV: { label: string; items: PortalNavItem[] }[] = [
  { label: 'Overview', items: [{ href: '/platform/dashboard', label: 'Dashboard', icon: LayoutDashboard, any: [PP.PLATFORM_VIEW_STATS] }] },
  {
    label: 'People',
    items: [
      { href: '/platform/users', label: 'Users', icon: Users, any: [PP.PLATFORM_VIEW_USERS] },
      { href: '/platform/groups', label: 'Groups', icon: Building2, any: [PP.PLATFORM_VIEW_GROUPS] },
      { href: '/platform/helpers', label: 'Helpers', icon: UserCog, any: [PP.PLATFORM_MANAGE_HELPERS] },
      { href: '/platform/roles', label: 'Roles & Permissions', icon: KeyRound, any: [PP.PLATFORM_MANAGE_HELPERS, PP.PLATFORM_MANAGE_ROLES] },
    ],
  },
  {
    label: 'Support',
    items: [
      { href: '/platform/support', label: 'Support Inbox', icon: Inbox, any: [PP.PLATFORM_SUPPORT_MANAGE], exact: true },
      { href: '/platform/support/mine', label: 'My Assigned Cases', icon: LifeBuoy, any: [PP.PLATFORM_SUPPORT] },
      { href: '/platform/support/access', label: 'Group Access Requests', icon: FolderLock, any: [PP.PLATFORM_REQUEST_GROUP_ACCESS] },
    ],
  },
  {
    label: 'Business',
    items: [
      { href: '/platform/subscriptions', label: 'Subscriptions', icon: Repeat, any: [PP.PLATFORM_VIEW_BILLING] },
      { href: '/platform/plans', label: 'Plans & Pricing', icon: Receipt, any: [PP.PLATFORM_VIEW_BILLING] },
      { href: '/platform/billing', label: 'Billing', icon: CreditCard, any: [PP.PLATFORM_VIEW_BILLING] },
      { href: '/platform/revenue', label: 'Revenue Analytics', icon: BarChart3, any: [PP.PLATFORM_VIEW_REVENUE] },
      { href: '/platform/finance', label: 'Costs & Exchange Rates', icon: Wallet, any: [PP.PLATFORM_VIEW_REVENUE] },
    ],
  },
  {
    label: 'Platform',
    items: [
      { href: '/platform/countries', label: 'Countries & Currencies', icon: Globe2, any: [PP.PLATFORM_VIEW_BILLING, PP.PLATFORM_CONFIGURE] },
      { href: '/platform/integrations', label: 'Integrations', icon: PlugZap, any: [PP.PLATFORM_CONFIGURE] },
      { href: '/platform/settings', label: 'Feature Settings', icon: SlidersHorizontal, any: [PP.PLATFORM_CONFIGURE] },
    ],
  },
  {
    label: 'Security',
    items: [
      { href: '/platform/audit', label: 'Audit Logs', icon: BookOpenCheck, any: [PP.PLATFORM_VIEW_AUDIT] },
      { href: '/platform/security', label: 'Security Events', icon: ShieldAlert, any: [PP.PLATFORM_VIEW_SECURITY] },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/platform/profile', label: 'My Profile', icon: UserRound },
      { href: '/platform/account-security', label: 'Security Settings', icon: ShieldCheck },
    ],
  },
];

export function allowedNav(permissions: readonly string[]) {
  return PORTAL_NAV.map((s) => ({ ...s, items: s.items.filter((i) => !i.any || i.any.some((p) => permissions.includes(p))) })).filter((s) => s.items.length);
}

const COLLAPSE_KEY = 'chp_nav_collapsed';

export function PlatformShell({ children }: { children: React.ReactNode }) {
  const me = usePlatformMe();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* storage unavailable: keep the default */
    }
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  if (me.isLoading) return <div className="min-h-screen bg-canvas p-8"><LoadingRows rows={8} /></div>;
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) return null; // api() is sending the browser to /platform/login
    return <div className="min-h-screen bg-canvas p-8"><ErrorState error={me.error} onRetry={() => me.refetch()} /></div>;
  }
  const sections = allowedNav(me.data!.permissions);
  // A section outside the caller's role gets a plain explanation instead of an API error. (The API refuses it either way.)
  const section = PORTAL_NAV.flatMap((s) => s.items).filter((i) => pathname === i.href || (!i.exact && pathname.startsWith(`${i.href}/`))).sort((a, b) => b.href.length - a.href.length)[0];
  const blocked = !!section?.any && !section.any.some((p) => me.data!.permissions.includes(p));

  const nav = (compact: boolean) => (
    <nav aria-label="Portal" className="flex-1 space-y-4 overflow-y-auto px-2 py-4">
      {sections.map((s) => (
        <div key={s.label} className="space-y-0.5">
          {!compact && <p className="px-2.5 pb-1 text-2xs font-semibold uppercase tracking-wider text-white/55">{s.label}</p>}
          {compact && <div className="mx-2.5 mb-1 border-t border-white/10" aria-hidden />}
          {s.items.map((i) => {
            const active = i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`);
            return (
              <Link
                key={i.href}
                href={i.href}
                title={compact ? i.label : undefined}
                aria-current={active ? 'page' : undefined}
                className={cn('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white', active && 'bg-white/15 font-semibold text-white', compact && 'justify-center px-0')}
              >
                <i.icon className="h-4 w-4 shrink-0" aria-hidden />
                {compact ? <span className="sr-only">{i.label}</span> : <span className="truncate">{i.label}</span>}
              </Link>
            );
          })}
        </div>
      ))}
      <div className="space-y-0.5">
        <button onClick={staffSignOut} title={compact ? 'Sign out' : undefined} className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white', compact && 'justify-center px-0')}>
          <LogOut className="h-4 w-4 shrink-0" aria-hidden />
          {compact ? <span className="sr-only">Sign out</span> : 'Sign Out'}
        </button>
      </div>
    </nav>
  );

  const brand = (compact: boolean) => (
    <div className={cn('flex h-14 items-center gap-2 border-b border-white/10 px-4', compact && 'justify-center px-0')}>
      <BrandMark className="h-7 w-7 shrink-0" />
      {!compact && (
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">ChamaHub</p>
          <p className="text-2xs text-white/60">Staff portal</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Desktop sidebar */}
      <aside className={cn('sticky top-0 hidden h-screen shrink-0 flex-col bg-plum transition-[width] lg:flex', collapsed ? 'w-16' : 'w-64')}>
        {brand(collapsed)}
        {nav(collapsed)}
        <button onClick={toggle} className="flex h-10 items-center justify-center border-t border-white/10 text-white/70 hover:text-white" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-plum/40" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-plum">
            <div className="flex items-center justify-between pr-2">
              {brand(false)}
              <button onClick={() => setMobileOpen(false)} className="rounded p-2 text-white/80 hover:bg-white/10" aria-label="Close navigation">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-white/95 px-4 backdrop-blur">
          <button className="rounded-lg p-2 text-plum hover:bg-blush/60 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1">
            <Notifications />
            <ProfileMenu name={me.data!.fullName} email={me.data!.email} roles={me.data!.roles.map((r) => r.name)} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8">
          {blocked ? <EmptyState title={`${section!.label} is not part of your role`} description="Ask an administrator if you need this access. Use the menu for the sections you can open." /> : children}
        </main>
      </div>
    </div>
  );
}

interface SearchResult {
  users: { id: string; name: string; phoneMasked: string }[];
  groups: { id: string; name: string; countryCode: string }[];
  cases: { id: string; number: string; subject: string; status: string }[];
  staff: { id: string; name: string; email: string }[];
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const results = useQuery({ queryKey: ['platform-search', debounced], queryFn: () => api<SearchResult>('platform/search', { query: { q: debounced } }), enabled: debounced.length >= 2 });
  const go = (href: string) => {
    setOpen(false);
    setQ('');
    router.push(href);
  };
  const r = results.data;
  const groups: { label: string; rows: { key: string; title: string; sub: string; href: string }[] }[] = r
    ? [
        { label: 'Cases', rows: r.cases.map((c) => ({ key: c.id, title: `${c.number} · ${c.subject}`, sub: c.status.replace(/_/g, ' ').toLowerCase(), href: `/platform/support/${c.id}` })) },
        { label: 'Users', rows: r.users.map((u) => ({ key: u.id, title: u.name, sub: u.phoneMasked, href: `/platform/users/${u.id}` })) },
        { label: 'Groups', rows: r.groups.map((g) => ({ key: g.id, title: g.name, sub: g.countryCode, href: `/platform/groups/${g.id}` })) },
        { label: 'Staff', rows: r.staff.map((s) => ({ key: s.id, title: s.name, sub: s.email, href: `/platform/helpers/${s.id}` })) },
      ].filter((g) => g.rows.length)
    : [];
  return (
    <div ref={box} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        placeholder="Search cases, users, groups, staff"
        aria-label="Search the portal"
        className="h-9 w-full rounded-lg border border-line bg-canvas pl-9 pr-3 text-sm text-plum placeholder:text-muted/70 focus:border-rose focus:outline-none focus:ring-1 focus:ring-rose"
      />
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-11 z-40 max-h-96 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-xl" role="listbox">
          {results.isLoading && <p className="px-3 py-2 text-sm text-muted">Searching…</p>}
          {results.error && <p className="px-3 py-2 text-sm text-danger-ink">Search failed. Try again.</p>}
          {r && !groups.length && <p className="px-3 py-2 text-sm text-muted">Nothing found that you can open.</p>}
          {groups.map((g) => (
            <div key={g.label} className="py-1">
              <p className="px-3 py-1 text-2xs font-semibold uppercase tracking-wider text-muted">{g.label}</p>
              {g.rows.map((row) => (
                <button key={row.key} role="option" aria-selected={false} onClick={() => go(row.href)} className="block w-full rounded-lg px-3 py-1.5 text-left hover:bg-blush/60">
                  <span className="block truncate text-sm text-plum">{row.title}</span>
                  <span className="block truncate text-xs text-muted">{row.sub}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const q = useQuery({ queryKey: ['platform-attention'], queryFn: () => api<{ items: { key: string; label: string; count: number; href: string }[]; total: number }>('platform/notifications'), refetchInterval: 60_000 });
  const total = q.data?.total ?? 0;
  return (
    <DM.Root>
      <DM.Trigger className="relative rounded-lg p-2 text-plum hover:bg-blush/60" aria-label={total ? `Notifications: ${total} items need attention` : 'Notifications'}>
        <Bell className="h-5 w-5" />
        {total > 0 && <span className="absolute right-1 top-1 min-w-[1.1rem] rounded-full bg-berry px-1 text-center text-2xs font-semibold leading-[1.1rem] text-white">{total > 99 ? '99+' : total}</span>}
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={6} className="z-50 w-72 rounded-xl border border-line bg-white p-1 shadow-xl">
          <p className="px-3 py-2 text-xs font-semibold text-plum">Needs attention</p>
          {q.isLoading && <p className="px-3 py-2 text-sm text-muted">Loading…</p>}
          {q.data && !q.data.items.length && <p className="px-3 py-2 text-sm text-muted">Nothing for your role.</p>}
          {q.data?.items.map((i) => (
            <DM.Item key={i.key} asChild>
              <Link href={i.href} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-plum outline-none hover:bg-blush/60 focus:bg-blush/60">
                <span>{i.label}</span>
                <span className={cn('rounded-full px-2 text-xs font-semibold tabular-nums', i.count ? 'bg-blush text-berry' : 'text-muted')}>{i.count}</span>
              </Link>
            </DM.Item>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function ProfileMenu({ name, email, roles }: { name: string; email: string; roles: string[] }) {
  return (
    <DM.Root>
      <DM.Trigger className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-blush/60" aria-label="Your account">
        <Avatar name={name} />
        <span className="hidden max-w-[10rem] truncate text-left text-sm font-medium text-plum md:block">{name}</span>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={6} className="z-50 w-64 rounded-xl border border-line bg-white p-1 shadow-xl">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold text-plum">{name}</p>
            <p className="truncate text-xs text-muted">{email}</p>
            <p className="mt-1 text-2xs font-medium uppercase tracking-wide text-berry">{roles.join(' · ') || 'No role'}</p>
          </div>
          <DM.Separator className="my-1 h-px bg-line" />
          {[
            { href: '/platform/profile', label: 'My profile', icon: UserRound },
            { href: '/platform/account-security', label: 'Security settings', icon: ShieldCheck },
          ].map((i) => (
            <DM.Item key={i.href} asChild>
              <Link href={i.href} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-plum outline-none hover:bg-blush/60 focus:bg-blush/60">
                <i.icon className="h-4 w-4" aria-hidden />
                {i.label}
              </Link>
            </DM.Item>
          ))}
          <DM.Item onSelect={staffSignOut} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-plum outline-none hover:bg-blush/60 focus:bg-blush/60">
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
