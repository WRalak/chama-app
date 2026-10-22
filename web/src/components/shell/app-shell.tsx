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
  Gavel,
  HandCoins,
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
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { LABELS, Permission, PlatformPermission } from '@chamahub/shared';
import { cn } from '@/lib/utils';
import { useCan, useGroup, useGroupId, useMe, useMyGroups, usePlatformCan } from '@/lib/session';
import { EmptyState, LoadingRows } from '@/components/ui/states';
import { Brand } from './brand';

/** `permission` may be a list: the item shows if the role holds ANY of them. */
type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; permission?: Permission | Permission[] };

const GROUP_NAV: NavItem[] = [
  { href: 'overview', label: 'Overview', icon: LayoutDashboard },
  { href: 'members', label: 'Members', icon: Users, permission: Permission.MEMBERS_VIEW },
  { href: 'contributions', label: 'Contributions', icon: Wallet, permission: Permission.CONTRIBUTIONS_VIEW_ALL },
  { href: 'collections', label: 'Collections', icon: ArrowLeftRight, permission: Permission.RECONCILIATION_MANAGE },
  { href: 'statement-imports', label: 'Statement import', icon: FileSearch, permission: [Permission.RECONCILIATION_MANAGE, Permission.AUDIT_VIEW] },
  { href: 'payment-destinations', label: 'Payment destinations', icon: Landmark },
  { href: 'loans', label: 'Loans', icon: HandCoins, permission: Permission.LOANS_VIEW_ALL },
  { href: 'repayments', label: 'Repayments', icon: RefreshCcw, permission: Permission.LOANS_VIEW_ALL },
  { href: 'expenses', label: 'Expenses', icon: Receipt, permission: Permission.EXPENSES_VIEW },
  { href: 'fines', label: 'Fines', icon: Gavel, permission: Permission.FINES_VIEW_ALL },
  { href: 'rotations', label: 'Payout Rotations', icon: CircleDollarSign, permission: Permission.ROTATIONS_VIEW },
  { href: 'distributions', label: 'Distributions', icon: PieChart, permission: Permission.REPORTS_VIEW },
  { href: 'meetings', label: 'Meetings', icon: CalendarDays, permission: Permission.MEETINGS_VIEW },
  { href: 'reports', label: 'Financial Reports', icon: BarChart3, permission: Permission.REPORTS_VIEW },
  { href: 'decisions', label: 'Decisions & Votes', icon: Vote },
  { href: 'imports', label: 'Imports and Migration', icon: FileSpreadsheet, permission: [Permission.IMPORTS_MANAGE, Permission.IMPORTS_APPROVE] },
  { href: 'audit', label: 'Audit Logs', icon: ScrollText },
  { href: 'findings', label: 'Audit Findings', icon: SearchCheck, permission: [Permission.FINDINGS_RAISE, Permission.FINDINGS_RESOLVE, Permission.AUDIT_VIEW] },
  { href: 'notifications', label: 'Notifications', icon: Bell },
  { href: 'roles', label: 'Roles & Permissions', icon: KeyRound, permission: Permission.PERMISSIONS_CONFIGURE },
  { href: 'settings', label: 'Settings', icon: Settings, permission: Permission.GROUP_CONFIGURE },
];

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

function NavLink({ href, label, icon: Icon, active, onClick }: { href: string; label: string; icon: NavItem['icon']; active: boolean; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick} aria-current={active ? 'page' : undefined} className={cn('flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white', active && 'bg-white/10 font-medium text-white')}>
      <Icon className="h-4 w-4 shrink-0" />
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
      <DM.Trigger className="flex w-full items-center justify-between gap-2 rounded-md border border-white/10 px-2.5 py-2 text-left hover:bg-white/5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{current?.name ?? 'Select a Chama'}</p>
          <p className="truncate text-2xs text-slate-400">{current ? `${LABELS.groupRole[current.role]}${current.specialRoles.length ? ' +' : ''} · ${LABELS.groupType[current.type]}` : `${groups?.length ?? 0} Chamas`}</p>
        </div>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="start" sideOffset={4} className="z-50 w-64 rounded-md border border-line bg-white p-1 shadow-lg">
          {groups?.map((g) => (
            <DM.Item key={g.groupId} onSelect={() => router.push(`/g/${g.groupId}/${section}`)} className={cn('cursor-pointer rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-canvas', g.groupId === groupId && 'font-medium text-forest')}>
              <p className="truncate">{g.name}</p>
              <p className="text-2xs text-muted">{LABELS.groupRole[g.role]}</p>
            </DM.Item>
          ))}
          <DM.Separator className="my-1 h-px bg-line" />
          <DM.Item onSelect={() => router.push('/chamas')} className="cursor-pointer rounded px-2 py-1.5 text-sm text-forest outline-none data-[highlighted]:bg-canvas">
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
    <nav className="flex h-full flex-col gap-4 overflow-y-auto bg-navy px-3 py-4" aria-label="Main">
      <div className="px-1 [&_p:first-child]:text-white">
        <Brand />
      </div>
      {(groups?.length ?? 0) > 0 && <GroupSwitcher />}
      <div className="space-y-0.5">
        <NavLink href="/chamas" label="Chamas" icon={ClipboardList} active={pathname === '/chamas'} onClick={onNavigate} />
        {groupId &&
          GROUP_NAV.filter((i) => allowed(can, i.permission)).map((i) => (
            <NavLink key={i.href} href={`/g/${groupId}/${i.href}`} label={i.label} icon={i.icon} active={pathname.startsWith(`/g/${groupId}/${i.href}`)} onClick={onNavigate} />
          ))}
      </div>
      {platformItems.length > 0 && (
        <div className="space-y-0.5">
          <p className="px-2.5 pb-1 text-2xs font-medium uppercase tracking-wider text-slate-500">Platform</p>
          {platformItems.map((i) => (
            <NavLink key={i.href} href={i.href} label={i.label} icon={i.icon} active={i.href === '/platform' ? pathname === '/platform' : pathname.startsWith(i.href)} onClick={onNavigate} />
          ))}
        </div>
      )}
    </nav>
  );
}

function UserMenu() {
  const { data: me } = useMe();
  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }
  return (
    <DM.Root>
      <DM.Trigger className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-canvas" aria-label="Account menu">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-forest-50 text-xs font-semibold text-forest">
          {me?.fullName
            .split(' ')
            .map((p) => p[0])
            .slice(0, 2)
            .join('')}
        </span>
        <span className="hidden text-sm text-navy sm:block">{me?.fullName}</span>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={4} className="z-50 w-56 rounded-md border border-line bg-white p-1 shadow-lg">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium text-navy">{me?.fullName}</p>
            <p className="text-xs text-muted">{me?.phone}</p>
            {me && me.platformRole !== 'USER' && <p className="mt-1 text-2xs font-medium uppercase tracking-wide text-forest">{LABELS.platformRole[me.platformRole]}</p>}
          </div>
          <DM.Separator className="my-1 h-px bg-line" />
          <DM.Item onSelect={signOut} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-danger outline-none data-[highlighted]:bg-red-50">
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
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
          <button className="absolute left-[16.5rem] top-3 rounded bg-white p-1" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b border-line bg-white/95 px-4 backdrop-blur">
          <button className="rounded p-1 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            {groupId && (
              <Link href={`/g/${groupId}/notifications`} className="rounded p-1.5 text-muted hover:bg-canvas hover:text-navy" aria-label="Notifications">
                <Bell className="h-4 w-4" />
              </Link>
            )}
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
