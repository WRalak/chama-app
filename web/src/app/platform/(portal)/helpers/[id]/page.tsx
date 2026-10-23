'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { Paginated, PlatformPermission, PlatformRoleRow, StaffRow } from '@chamahub/shared';
import { ConfirmAction, OneTimeLink } from '@/components/platform/confirm-action';
import { PermissionPicker } from '@/components/platform/permission-picker';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { KeyValues, PageHeader, Panel } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { usePlatformMe } from '@/lib/platform-session';
import { date, dateTime } from '@/lib/utils';

interface ActivityRow { id: string; at: string; actor: string | null; action: string; outcome: string; reason: string | null; targetType: string | null; targetId: string | null }

export default function HelperDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = usePlatformMe();
  const staff = useQuery({ queryKey: ['platform-staff', id], queryFn: () => api<StaffRow>(`platform/staff/${id}`) });
  const [page, setPage] = useState(1);
  const activity = useQuery({ queryKey: ['platform-staff', id, 'activity', page], queryFn: () => api<Paginated<ActivityRow>>(`platform/staff/${id}/activity`, { query: { page, pageSize: 20 } }), placeholderData: (p) => p });
  const [link, setLink] = useState<{ url: string; what: string } | null>(null);
  const inv = [['platform-staff']];
  const suspend = useAction((reason: string) => api(`platform/staff/${id}/suspend`, { body: { reason } }), { success: 'Suspended; their sessions ended', invalidate: inv });
  const reactivate = useAction((reason: string) => api(`platform/staff/${id}/reactivate`, { body: { reason } }), { success: 'Reactivated', invalidate: inv });
  const deactivate = useAction((reason: string) => api(`platform/staff/${id}/deactivate`, { body: { reason } }), { success: 'Deactivated', invalidate: inv });
  const revoke = useAction((reason: string) => api<{ revoked: number }>(`platform/staff/${id}/revoke-sessions`, { body: { reason } }), { success: (r) => `${r.revoked} session(s) ended`, invalidate: inv });
  const resend = useAction(() => api<{ delivery: { sent: boolean; error?: string }; inviteUrl?: string }>(`platform/staff/${id}/resend-invite`, { body: {} }), {
    success: (r) => (r.delivery.sent ? 'New invitation e-mailed; the old link no longer works' : 'New link created; e-mail not sent'),
    invalidate: inv,
    onSuccess: (r) => setLink(r.inviteUrl ? { url: r.inviteUrl, what: 'invitation' } : null),
  });
  const reset = useAction((reason: string) => api<{ delivery: { sent: boolean; error?: string }; resetUrl?: string }>(`platform/staff/${id}/password-reset`, { body: { reason } }), {
    success: (r) => (r.delivery.sent ? 'Reset link e-mailed to them' : 'Reset link created; e-mail not sent'),
    onSuccess: (r) => setLink(r.resetUrl ? { url: r.resetUrl, what: 'password reset' } : null),
  });

  if (staff.error) return <Panel><ErrorState error={staff.error} onRetry={() => staff.refetch()} /></Panel>;
  if (!staff.data) return <Panel><LoadingRows rows={6} /></Panel>;
  const s = staff.data;
  const self = me.data?.id === s.id;

  return (
    <>
      <PageHeader
        title={s.fullName}
        description={<span className="inline-flex flex-wrap items-center gap-2">{s.email} <StatusBadge status={s.status} /></span>}
        actions={<Link href="/platform/helpers" className="text-sm text-berry hover:underline">All helpers</Link>}
      />
      {link && <div className="mb-5"><OneTimeLink url={link.url} what={link.what} /></div>}
      {self && <p className="mb-5 rounded-lg bg-blush/50 px-3 py-2 text-sm text-plum">This is your own account. Another administrator must change your access or status; use My Profile and Security Settings for your own details.</p>}
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Account" className="lg:col-span-2" actions={!self && <EditDetails staff={s} />}>
          <KeyValues
            items={[
              ['Roles', s.roles.map((r) => r.name).join(', ') || 'None'],
              ['Extra permissions', s.extraPermissions.length ? s.extraPermissions.join(', ') : 'None'],
              ['Team', s.team ?? '—'],
              ['Invitation', s.invitation ? s.invitation.toLowerCase() : '—'],
              ['Two-step sign-in', s.mfaEnabled ? 'On' : 'Off'],
              ['Open cases', s.openCases],
              ['Last sign-in', s.lastLoginAt ? dateTime(s.lastLoginAt) : 'Never'],
              ['Access ends', s.expiresAt ? date(s.expiresAt) : 'No end date'],
              ['Created', `${date(s.createdAt)}${s.createdBy ? ` by ${s.createdBy}` : ''}`],
            ]}
          />
        </Panel>
        {!self && (
          <Panel title="Actions">
            <div className="flex flex-col gap-2">
              <AccessDialog staff={s} />
              {s.status === 'INVITED' && <Button variant="secondary" loading={resend.isPending} onClick={() => resend.mutate(undefined)}>Resend invitation</Button>}
              {s.status === 'ACTIVE' && (
                <ConfirmAction trigger={(open) => <Button variant="secondary" onClick={open}>Send password reset</Button>} title="Send a password reset?" description="They get a single-use link by e-mail and choose a new password themselves. You never see it." confirmLabel="Send reset link" busy={reset.isPending} onConfirm={(r) => reset.mutateAsync(r)} />
              )}
              <ConfirmAction trigger={(open) => <Button variant="secondary" onClick={open}>Sign out everywhere</Button>} title="End all their sessions?" description="Every device they are signed in on is signed out at once." confirmLabel="End sessions" busy={revoke.isPending} onConfirm={(r) => revoke.mutateAsync(r)} />
              {s.status === 'SUSPENDED' ? (
                <ConfirmAction trigger={(open) => <Button onClick={open}>Reactivate</Button>} title="Reactivate this account?" description="They can sign in again with their existing password." confirmLabel="Reactivate" busy={reactivate.isPending} onConfirm={(r) => reactivate.mutateAsync(r)} />
              ) : s.status !== 'DEACTIVATED' ? (
                <ConfirmAction trigger={(open) => <Button variant="danger" onClick={open}>Suspend</Button>} danger title={`Suspend ${s.fullName}?`} description="They are signed out immediately and cannot sign in until reactivated. Their case history stays." confirmLabel="Suspend" busy={suspend.isPending} onConfirm={(r) => suspend.mutateAsync(r)} />
              ) : null}
              {s.status !== 'DEACTIVATED' && (
                <ConfirmAction trigger={(open) => <Button variant="ghost" className="text-danger-ink" onClick={open}>Deactivate permanently</Button>} danger title="Deactivate permanently?" description="Use this when someone leaves. The account cannot be reactivated; invite them again if they return. The audit history stays." confirmLabel="Deactivate" busy={deactivate.isPending} onConfirm={(r) => deactivate.mutateAsync(r)} />
              )}
            </div>
          </Panel>
        )}
      </div>
      <Panel title="Activity" flush className="mt-5">
        <DataTable<ActivityRow>
          data={activity.data?.items}
          loading={activity.isLoading}
          error={activity.error}
          empty="No activity yet"
          server={activity.data ? { page, pageSize: 20, total: activity.data.total, onPageChange: setPage } : undefined}
          columns={[
            { accessorKey: 'at', header: 'When', enableSorting: false, cell: ({ row }) => dateTime(row.original.at) },
            { accessorKey: 'actor', header: 'By', enableSorting: false, cell: ({ row }) => row.original.actor ?? '—' },
            { accessorKey: 'action', header: 'Action', enableSorting: false, cell: ({ row }) => <code className="text-xs">{row.original.action.replace(/^platform\./, '')}</code> },
            { accessorKey: 'outcome', header: 'Outcome', enableSorting: false, cell: ({ row }) => <StatusBadge status={row.original.outcome === 'SUCCESS' ? 'COMPLETED' : row.original.outcome === 'DENIED' ? 'REJECTED' : 'FAILED'} /> },
            { accessorKey: 'reason', header: 'Reason', enableSorting: false, cell: ({ row }) => row.original.reason ?? '' },
          ]}
        />
      </Panel>
    </>
  );
}

function EditDetails({ staff }: { staff: StaffRow }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fullName: staff.fullName, team: staff.team ?? '', expiresAt: staff.expiresAt?.slice(0, 10) ?? '' });
  const save = useAction(() => api(`platform/staff/${staff.id}`, { method: 'PATCH', body: { fullName: form.fullName, team: form.team || null, expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null } }), { success: 'Saved', invalidate: [['platform-staff']], onSuccess: () => setOpen(false) });
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Edit</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Edit details">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
            <Field label="Full name" htmlFor="e-name"><Input id="e-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
            <Field label="Team" htmlFor="e-team"><Input id="e-team" value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} /></Field>
            <Field label="Access ends" htmlFor="e-exp" hint="Leave empty for no end date"><Input id="e-exp" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AccessDialog({ staff }: { staff: StaffRow }) {
  const me = usePlatformMe();
  const roles = useQuery({ queryKey: ['platform-roles'], queryFn: () => api<PlatformRoleRow[]>('platform/roles') });
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState(staff.roles.map((r) => r.code));
  const [extra, setExtra] = useState<PlatformPermission[]>(staff.extraPermissions);
  const [reason, setReason] = useState('');
  const save = useAction(() => api(`platform/staff/${staff.id}/access`, { method: 'PUT', body: { roleCodes: codes, extraPermissions: extra, reason } }), { success: 'Access updated; it applies on their next request', invalidate: [['platform-staff']], onSuccess: () => { setOpen(false); setReason(''); } });
  const held = me.data?.permissions ?? [];
  return (
    <>
      <Button onClick={() => setOpen(true)}>Change role & permissions</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Role & permissions" description="You can only grant what you hold yourself. Changes take effect immediately." className="max-w-2xl">
          <div className="space-y-4">
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs font-medium text-plum">Roles</legend>
              {roles.data?.map((r) => (
                <label key={r.code} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 accent-berry" checked={codes.includes(r.code)} disabled={!r.permissions.every((p) => held.includes(p))} onChange={(e) => setCodes(e.target.checked ? [...codes, r.code] : codes.filter((c) => c !== r.code))} />
                  <span><span className="font-medium text-plum">{r.name}</span><span className="block text-xs text-muted">{r.description}</span></span>
                </label>
              ))}
            </fieldset>
            <div>
              <p className="mb-1 text-xs font-medium text-plum">Individual permissions</p>
              <PermissionPicker value={extra} onChange={setExtra} held={held} />
            </div>
            <Field label="Reason (kept in the audit log)" htmlFor="a-reason"><Textarea id="a-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button loading={save.isPending} disabled={!codes.length || reason.trim().length < 5} onClick={() => save.mutate(undefined)}>Save access</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
