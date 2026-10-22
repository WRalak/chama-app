'use client';

import * as DM from '@radix-ui/react-dropdown-menu';
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  BookOpenCheck,
  Building2,
  CalendarDays,
  ChevronsUpDown,
  CircleDollarSign,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  PiggyBank,
  UserRound,
  Gavel,
  HandCoins,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  PieChart,
  Receipt,
  RefreshCcw,
  ScrollText,
  Settings,
  Shield,
  Users,
  Wallet,
  X,
  CreditCard,
  LifeBuoy,
  Vote,
  SearchCheck,
  KeyRound,
  UserCog,
  SlidersHorizontal,
  FileSearch,
  Landmark,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { LABELS, Permission, PlatformPermission } from '@chamahub/shared';
import { cn } from '@/lib/utils';
import { useCan, useGroup, useGroupId, useMe, useMyGroups, usePlatformCan } from '@/lib/session';
import { EmptyState, LoadingRows } from '@/components/ui/states';
import { Brand } from './brand';

/** `permission` may be a list: the item shows if the role holds ANY of them. */
type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; permission?: Permission | Permission[] };

type NavSection = { label: string; icon: NavItem['icon']; items: NavItem[] };

/**
 * Group sections, in the order officers work through them. A section shows
 * only if the caller's role can open at least one of its pages; its pages are
 * listed under it while it is open.
 */
const GROUP_SECTIONS: NavSection[] = [
  { label: 'Overview', icon: LayoutDashboard, items: [{ href: 'overview', label: 'Overview', icon: LayoutDashboard }, { href: 'assistant', label: 'AI Assistant', icon: Sparkles }] },
  {
    label: 'My account',
    icon: UserRound,
    items: [
      { href: 'my', label: 'My contributions', icon: PiggyBank },
      { href: 'my-loans', label: 'My loans', icon: HandCoins },
      { href: 'statements', label: 'Group statements', icon: FileText, permission: Permission.STATEMENTS_VIEW },
    ],
  },
  {
    label: 'Members',
    icon: Users,
    items: [
      { href: 'members', label: 'Members', icon: Users, permission: Permission.MEMBERS_VIEW },
      { href: 'meetings', label: 'Meetings', icon: CalendarDays, permission: Permission.MEETINGS_VIEW },
      { href: 'decisions', label: 'Decisions & votes', icon: Vote },
    ],
  },
  { label: 'Contributions', icon: Wallet, items: [{ href: 'contributions', label: 'Contributions', icon: Wallet, permission: Permission.CONTRIBUTIONS_VIEW_ALL }, { href: 'fines', label: 'Fines', icon: Gavel, permission: Permission.FINES_VIEW_ALL }] },
  {
    label: 'Reconciliation',
    icon: ArrowLeftRight,
    items: [
      { href: 'collections', label: 'Collections', icon: ArrowLeftRight, permission: Permission.RECONCILIATION_MANAGE },
      { href: 'statement-imports', label: 'Statement import', icon: FileSearch, permission: [Permission.RECONCILIATION_MANAGE, Permission.AUDIT_VIEW] },
      { href: 'payment-destinations', label: 'Payment destinations', icon: Landmark },
    ],
  },
  { label: 'Payouts', icon: CircleDollarSign, items: [{ href: 'rotations', label: 'Payout rotation', icon: CircleDollarSign, permission: Permission.ROTATIONS_VIEW }, { href: 'distributions', label: 'Distributions', icon: PieChart, permission: Permission.REPORTS_VIEW }] },
  { label: 'Loans', icon: HandCoins, items: [{ href: 'loans', label: 'Loans', icon: HandCoins, permission: Permission.LOANS_VIEW_ALL }, { href: 'repayments', label: 'Repayments', icon: RefreshCcw, permission: Permission.LOANS_VIEW_ALL }] },
  { label: 'Expenses', icon: Receipt, items: [{ href: 'expenses', label: 'Expenses', icon: Receipt, permission: Permission.EXPENSES_VIEW }] },
  { label: 'Reports', icon: BarChart3, items: [{ href: 'reports', label: 'Financial reports', icon: BarChart3, permission: Permission.REPORTS_VIEW }, { href: 'imports', label: 'Imports & migration', icon: FileSpreadsheet, permission: [Permission.IMPORTS_MANAGE, Permission.IMPORTS_APPROVE] }] },
  { label: 'Audit Logs', icon: ScrollText, items: [{ href: 'audit', label: 'Audit logs', icon: ScrollText }, { href: 'findings', label: 'Audit findings', icon: SearchCheck, permission: [Permission.FINDINGS_RAISE, Permission.FINDINGS_RESOLVE, Permission.AUDIT_VIEW] }, { href: 'handovers', label: 'Officer handovers', icon: ArrowLeftRight }] },
  {
    label: 'Settings',
    icon: Settings,
    items: [
      { href: 'settings', label: 'Group settings', icon: Settings, permission: Permission.GROUP_CONFIGURE },
      { href: 'roles', label: 'Roles & permissions', icon: KeyRound, permission: Permission.PERMISSIONS_CONFIGURE },
      { href: 'notifications', label: 'Notifications', icon: Bell },
    ],
  },
];

const GROUP_NAV: NavItem[] = GROUP_SECTIONS.flatMap((sec) => sec.items);

const allowed = (can: (p: Permission) => boolean, p?: Permission | Permission[]) => !p || (Array.isArray(p) ? p.some(can) : can(p));

const PLATFORM_NAV: (Omit<NavItem, 'permission'> & { permission: PlatformPermission })[] = [
  { href: '/platform', label: 'Platform overview', icon: Shield, permission: PlatformPermission.PLATFORM_VIEW_STATS },
  { href: '/platform/groups', label: 'All Chamas', icon: Building2, permission: PlatformPermission.PLATFORM_VIEW_STATS },
  { href: '/platform/users', label: 'Accounts', icon: Users, permission: PlatformPermission.PLATFORM_SUPPORT },
  { href: '/platform/staff', label: 'Platform staff', icon: UserCog, permission: PlatformPermission.PLATFORM_MANAGE_ADMINS },
  { href: '/platform/settings', label: 'Platform settings', icon: SlidersHorizontal, permission: PlatformPermission.PLATFORM_CONFIGURE },
  { href: '/platform/subscriptions', label: 'Subscriptions', icon: CreditCard, permission: PlatformPermission.PLATFORM_VIEW_STATS },
  { href: '/platform/security', label: 'Security events', icon: BookOpenCheck, permission: PlatformPermission.PLATFORM_VIEW_SECURITY },
  { href: '/platform/support', label: 'Support', icon: LifeBuoy, permission: PlatformPermission.PLATFORM_SUPPORT },
];

function NavLink({ href, label, icon: Icon, active, onClick, sub }: { href: string; label: string; icon: NavItem['icon']; active: boolean; onClick?: () => void; sub?: boolean }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center gap-2.5 rounded-lg px-2.5 text-sm text-white/75 hover:bg-white/10 hover:text-white',
        sub ? 'ml-6 py-1.5 text-[13px]' : 'py-2',
        active && 'bg-white/10 font-semibold text-white before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-rose',
      )}
    >
      {!sub && <Icon className="h-4 w-4 shrink-0" />}
      <span className="truncate">{label}</span>
    </Link>
  );
}

function GroupSwitcher() {
  const groupId = useGroupId();
  const router = useRouter();
  const pathname = usePathname();
  const { data: groups } = useMyGroups();
  const current = groups?.find((g) => g.groupId === groupId);
  const section = pathname.split('/')[3] ?? 'overview';
  return (
    <DM.Root>
      <DM.Trigger className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/15 bg-white/5 px-2.5 py-2 text-left hover:bg-white/10">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{current?.name ?? 'Select a Chama'}</p>
          <p className="truncate text-2xs text-white/65">{current ? `${LABELS.groupRole[current.role]}${current.specialRoles.length ? ' +' : ''} · ${LABELS.groupType[current.type]}` : `${groups?.length ?? 0} Chamas`}</p>
        </div>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-white/65" />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="start" sideOffset={4} className="z-50 w-64 rounded-md border border-line bg-white p-1 shadow-lg">
          {groups?.map((g) => (
            <DM.Item key={g.groupId} onSelect={() => router.push(`/g/${g.groupId}/${section}`)} className={cn('cursor-pointer rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-canvas', g.groupId === groupId && 'font-medium text-berry')}>
              <p className="truncate">{g.name}</p>
              <p className="text-2xs text-muted">{LABELS.groupRole[g.role]}</p>
            </DM.Item>
          ))}
          <DM.Separator className="my-1 h-px bg-line" />
          <DM.Item onSelect={() => router.push('/chamas')} className="cursor-pointer rounded px-2 py-1.5 text-sm text-berry outline-none data-[highlighted]:bg-canvas">
            All my Chamas / create new
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const groupId = useGroupId();
  const pathname = usePathname();
  const can = useCan();
  const platformCan = usePlatformCan();
  const { data: groups } = useMyGroups();
  const platformItems = PLATFORM_NAV.filter((i) => platformCan(i.permission));
  return (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto bg-plum px-3 py-4" aria-label="Main">
      <div className="px-1 [&_p:first-child]:text-white [&_p:last-child]:text-white/60">
        <Brand />
      </div>
      {(groups?.length ?? 0) > 0 && <GroupSwitcher />}
      <div className="space-y-0.5">
        <NavLink href="/home" label="My home" icon={Home} active={pathname === '/home'} onClick={onNavigate} />
        <NavLink href="/finances" label="My finances" icon={Wallet} active={pathname === '/finances'} onClick={onNavigate} />
        <NavLink href="/chamas" label="Groups" icon={ClipboardList} active={pathname === '/chamas'} onClick={onNavigate} />
        <NavLink href="/notifications" label="Notifications" icon={Bell} active={pathname === '/notifications'} onClick={onNavigate} />
        <NavLink href="/profile" label="Profile" icon={UserRound} active={pathname === '/profile'} onClick={onNavigate} />
      </div>
      <div className="space-y-0.5">
        {groupId &&
          GROUP_SECTIONS.map((sec) => {
            const items = sec.items.filter((i) => allowed(can, i.permission));
            if (!items.length) return null;
            const at = (i: NavItem) => { const base = `/g/${groupId}/${i.href}`; return pathname === base || pathname.startsWith(`${base}/`); };
            const open = items.some(at);
            return (
              <div key={sec.label}>
                <NavLink href={`/g/${groupId}/${items[0].href}`} label={sec.label} icon={sec.icon} active={open && items.length === 1} onClick={onNavigate} />
                {open && items.length > 1 && items.map((i) => <NavLink key={i.href} sub href={`/g/${groupId}/${i.href}`} label={i.label} icon={i.icon} active={at(i)} onClick={onNavigate} />)}
              </div>
            );
          })}
      </div>
      {platformItems.length > 0 && (
        <div className="space-y-0.5">
          <p className="px-2.5 pb-1 text-2xs font-semibold uppercase tracking-wider text-white/55">Platform administration</p>
          {platformItems.map((i) => (
            <NavLink key={i.href} href={i.href} label={i.label} icon={i.icon} active={i.href === '/platform' ? pathname === '/platform' : pathname.startsWith(i.href)} onClick={onNavigate} />
          ))}
        </div>
      )}
      <p className="mt-auto px-2.5 pt-2 text-2xs text-white/55">
        <Link href="/privacy" className="hover:text-white hover:underline">Privacy</Link> · <Link href="/terms" className="hover:text-white hover:underline">Terms</Link>
      </p>
    </nav>
  );
}

function NotificationBell() {
  const { data } = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api<{ unread: number }>('notifications', { query: { pageSize: 1 } }), refetchInterval: 60_000 });
  const unread = data?.unread ?? 0;
  return (
    <Link href="/notifications" className="relative rounded p-1.5 text-muted hover:bg-canvas hover:text-plum" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
      <Bell className="h-4 w-4" />
      {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[1rem] rounded-full bg-berry px-1 text-center text-[10px] font-bold leading-4 text-white">{unread > 9 ? '9+' : unread}</span>}
    </Link>
  );
}

function UserMenu() {
  const router = useRouter();
  const { data: me } = useMe();
  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }
  return (
    <DM.Root>
      <DM.Trigger className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-blush/60" aria-label="Account menu">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blush text-xs font-semibold text-berry">
          {me?.fullName
            .split(' ')
            .map((p) => p[0])
            .slice(0, 2)
            .join('')}
        </span>
        <span className="hidden text-sm text-plum sm:block">{me?.fullName}</span>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={4} className="z-50 w-56 rounded-md border border-line bg-white p-1 shadow-lg">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium text-plum">{me?.fullName}</p>
            <p className="text-xs text-muted">{me?.phone}</p>
            {me && me.platformRole !== 'USER' && <p className="mt-1 text-2xs font-medium uppercase tracking-wide text-berry">{LABELS.platformRole[me.platformRole]}</p>}
          </div>
          <DM.Separator className="my-1 h-px bg-line" />
          <DM.Item onSelect={() => router.push('/profile')} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-plum outline-none data-[highlighted]:bg-canvas">
            <UserRound className="h-4 w-4" /> Profile & security
          </DM.Item>
          <DM.Item onSelect={signOut} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-danger-ink outline-none data-[highlighted]:bg-danger-50">
            <LogOut className="h-4 w-4" /> Sign out
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/** Blocks group pages the caller's role cannot use, before they fire requests the API would refuse. */
function RouteGuard({ children }: { children: React.ReactNode }) {
  const groupId = useGroupId();
  const pathname = usePathname();
  const can = useCan();
  const { data: group, error } = useGroup();
  if (!groupId) return <>{children}</>;
  if (error) return <EmptyState title="This Chama is not available" description="You may not be a member, or your access has ended." />;
  if (!group) return <LoadingRows />;
  const section = pathname.split('/')[3];
  const item = GROUP_NAV.find((i) => i.href === section);
  if (item && !allowed(can, item.permission)) {
    return <EmptyState title={`${item.label} is not available for your role`} description={`You are ${LABELS.groupRole[group.myMembership.role].toLowerCase()} in ${group.name}. Ask the chairperson if you need access.`} />;
  }
  return <>{children}</>;
}

function MaintenanceNotice() {
  const { data } = useQuery({ queryKey: ['platform-notice'], queryFn: () => api<{ maintenanceNotice: string | null }>('platform-notice'), staleTime: 5 * 60_000 });
  if (!data?.maintenanceNotice) return null;
  return <div className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-900" role="status">{data.maintenanceNotice}</div>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const groupId = useGroupId();
  const router = useRouter();
  const me = useMe();
  // A signed-in account whose phone is not verified yet: the API refuses everything until it is.
  const unverified = me.data?.phoneVerified === false || (me.error instanceof ApiError && me.error.status === 403 && (me.error.details as { code?: string } | undefined)?.code === 'PHONE_NOT_VERIFIED');
  useEffect(() => {
    if (unverified) router.replace('/verify');
  }, [unverified, router]);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-plum/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
          <button className="absolute left-[16.5rem] top-3 rounded bg-white p-1" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-white/95 px-4 backdrop-blur">
          <button className="rounded p-1 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <MaintenanceNotice />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 lg:px-6">
          <RouteGuard>{children}</RouteGuard>
        </main>
      </div>
    </div>
  );
}
