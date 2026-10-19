'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Paginated, PlatformPermission } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { usePlatformCan } from '@/lib/session';
import { date, kes } from '@/lib/utils';

interface Plan { id: string; code: string; name: string; priceCents: number; maxMembers: number; features: string[]; active: boolean; subscribers: number }
interface G { id: string; name: string; members: number; plan: string | null; subscriptionStatus: string | null; currentPeriodEnd: string | null }

export default function SubscriptionsPage() {
  const can = usePlatformCan();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api<Plan[]>('platform/plans') });
  const groups = useQuery({ queryKey: ['platform-groups', 'subs'], queryFn: () => api<Paginated<G>>('platform/groups', { query: { pageSize: 200 } }) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', priceCents: 0 as number | undefined, maxMembers: 30, features: '' });
  const [edit, setEdit] = useState<G | null>(null);
  const [sub, setSub] = useState({ planId: '', status: 'ACTIVE', currentPeriodEnd: '' });
  const create = useAction(() => api('platform/plans', { body: { ...form, priceCents: form.priceCents ?? 0, features: form.features.split(',').map((s) => s.trim()).filter(Boolean), active: true } }), { success: 'Plan created', invalidate: [['plans']], onSuccess: () => setOpen(false) });
  const toggle = useAction((p: Plan) => api(`platform/plans/${p.id}`, { method: 'PATCH', body: { active: !p.active } }), { success: 'Plan updated', invalidate: [['plans']] });
  const saveSub = useAction(() => api(`platform/groups/${edit!.id}/subscription`, { method: 'PATCH', body: { planId: sub.planId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd ? new Date(`${sub.currentPeriodEnd}T23:59:59+03:00`).toISOString() : undefined } }), { success: 'Subscription updated', invalidate: [['platform-groups']], onSuccess: () => setEdit(null) });
  const manage = can(PlatformPermission.PLATFORM_MANAGE_PLANS);
  return (
    <>
      <PageHeader title="Subscriptions" description="Plans and each Chama’s subscription. Subscription billing is recorded manually until a billing integration is connected." actions={manage && <Button onClick={() => setOpen(true)}>New plan</Button>} />
      <Panel title="Plans" flush className="mb-5">
        <DataTable<Plan>
          data={plans.data}
          loading={plans.isLoading}
          columns={[
            { accessorKey: 'name', header: 'Plan', cell: ({ row }) => <div>{row.original.name}<p className="font-mono text-2xs text-muted">{row.original.code}</p></div> },
            { accessorKey: 'priceCents', header: 'Price / month', cell: ({ row }) => kes(row.original.priceCents), meta: { align: 'right' } },
            { accessorKey: 'maxMembers', header: 'Max members', meta: { align: 'right' } },
            { accessorKey: 'features', header: 'Features', cell: ({ row }) => row.original.features.join(', ') },
            { accessorKey: 'subscribers', header: 'Groups', meta: { align: 'right' } },
            { accessorKey: 'active', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.active ? 'ACTIVE' : 'CANCELLED'} /> },
            { id: 'a', header: '', cell: ({ row }) => (manage ? <Button size="sm" variant="ghost" onClick={() => toggle.mutate(row.original)}>{row.original.active ? 'Retire' : 'Reactivate'}</Button> : null) },
          ]}
        />
      </Panel>
      <Panel title="Chama subscriptions" flush>
        <DataTable<G>
          data={groups.data?.items}
          loading={groups.isLoading}
          columns={[
            { accessorKey: 'name', header: 'Chama' },
            { accessorKey: 'members', header: 'Members', meta: { align: 'right' } },
            { accessorKey: 'plan', header: 'Plan', cell: ({ row }) => row.original.plan ?? '—' },
            { accessorKey: 'subscriptionStatus', header: 'Status', cell: ({ row }) => (row.original.subscriptionStatus ? <StatusBadge status={row.original.subscriptionStatus} /> : '—') },
            { accessorKey: 'currentPeriodEnd', header: 'Paid until', cell: ({ row }) => date(row.original.currentPeriodEnd) },
            { id: 'a', header: '', cell: ({ row }) => (manage ? <Button size="sm" variant="ghost" onClick={() => { setEdit(row.original); setSub({ planId: plans.data?.find((p) => p.name === row.original.plan)?.id ?? plans.data?.[0]?.id ?? '', status: row.original.subscriptionStatus ?? 'ACTIVE', currentPeriodEnd: row.original.currentPeriodEnd?.slice(0, 10) ?? '' }); }}>Change</Button> : null) },
          ]}
        />
      </Panel>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="New plan">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code" htmlFor="pl-c"><Input id="pl-c" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="GROWTH" /></Field>
            <Field label="Name" htmlFor="pl-n"><Input id="pl-n" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Price per month" htmlFor="pl-p"><MoneyInput id="pl-p" value={form.priceCents} onChange={(v) => setForm({ ...form, priceCents: v })} /></Field>
            <Field label="Max members" htmlFor="pl-m"><Input id="pl-m" type="number" value={form.maxMembers} onChange={(e) => setForm({ ...form, maxMembers: Number(e.target.value) })} /></Field>
            <Field label="Features (comma separated)" htmlFor="pl-f" className="col-span-2"><Input id="pl-f" value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} /></Field>
          </div>
          <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => create.mutate(undefined)} loading={create.isPending} disabled={!/^[A-Z0-9_]{2,30}$/.test(form.code) || form.name.length < 2}>Create plan</Button></div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent title={`Subscription · ${edit?.name}`}>
          <div className="space-y-3">
            <Field label="Plan" htmlFor="sb-p"><Select id="sb-p" value={sub.planId} onChange={(e) => setSub({ ...sub, planId: e.target.value })}>{plans.data?.map((p) => <option key={p.id} value={p.id}>{p.name} · {kes(p.priceCents)}</option>)}</Select></Field>
            <Field label="Status" htmlFor="sb-s"><Select id="sb-s" value={sub.status} onChange={(e) => setSub({ ...sub, status: e.target.value })}>{['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <Field label="Paid until" htmlFor="sb-e"><Input id="sb-e" type="date" value={sub.currentPeriodEnd} onChange={(e) => setSub({ ...sub, currentPeriodEnd: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={() => saveSub.mutate(undefined)} loading={saveSub.isPending} disabled={!sub.planId}>Save</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
