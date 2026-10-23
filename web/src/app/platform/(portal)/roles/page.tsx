'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PLATFORM_PERMISSION_INFO, PlatformPermission, type PlatformRoleRow } from '@chamahub/shared';
import { ConfirmAction } from '@/components/platform/confirm-action';
import { PermissionPicker } from '@/components/platform/permission-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { usePlatformCan, usePlatformMe } from '@/lib/platform-session';

export default function RolesPage() {
  const can = usePlatformCan();
  const roles = useQuery({ queryKey: ['platform-roles'], queryFn: () => api<PlatformRoleRow[]>('platform/roles') });
  const manage = can(PlatformPermission.PLATFORM_MANAGE_ROLES);
  return (
    <>
      <PageHeader title="Roles & Permissions" description="Staff roles are separate from Chama roles: being a treasurer in a Chama gives no portal access." actions={manage && <RoleEditor />} />
      {roles.error ? <Panel><ErrorState error={roles.error} onRetry={() => roles.refetch()} /></Panel> : !roles.data ? <Panel><LoadingRows /></Panel> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {roles.data.map((r) => (
            <Panel key={r.id} title={<span className="inline-flex items-center gap-2">{r.name}{r.system && <Badge tone="neutral" icon={false}>Built-in</Badge>}</span>} actions={manage && r.code !== 'OWNER' && <div className="flex gap-1"><RoleEditor role={r} />{!r.system && <DeleteRole role={r} />}</div>}>
              <p className="mb-2 text-sm text-muted">{r.description ?? '—'}</p>
              <p className="mb-2 text-xs text-muted">{r.accounts} account(s) · code <code>{r.code}</code></p>
              <ul className="flex flex-wrap gap-1">
                {r.permissions.map((p) => <li key={p}><Badge tone="rose" icon={false}>{PLATFORM_PERMISSION_INFO[p]?.label ?? p}</Badge></li>)}
              </ul>
              {r.code === 'OWNER' && <p className="mt-2 text-xs text-muted">The owner role always holds every permission, and the last active owner cannot be removed.</p>}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

function RoleEditor({ role }: { role?: PlatformRoleRow }) {
  const me = usePlatformMe();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: role?.code ?? '', name: role?.name ?? '', description: role?.description ?? '' });
  const [perms, setPerms] = useState<PlatformPermission[]>(role?.permissions ?? []);
  const save = useAction(() => api('platform/roles', { method: 'PUT', body: { ...form, description: form.description || undefined, permissions: perms } }), { success: 'Role saved; it applies to everyone holding it now', invalidate: [['platform-roles']], onSuccess: () => setOpen(false) });
  return (
    <>
      <Button size={role ? 'sm' : 'md'} variant={role ? 'secondary' : 'primary'} onClick={() => setOpen(true)}>{role ? 'Edit' : 'New role'}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={role ? `Edit ${role.name}` : 'New role'} description="You can only include permissions you hold yourself." className="max-w-2xl">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Code" htmlFor="r-code" hint="Capitals, digits and _"><Input id="r-code" value={form.code} disabled={!!role} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></Field>
              <Field label="Name" htmlFor="r-name"><Input id="r-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            </div>
            <Field label="Description" htmlFor="r-desc"><Textarea id="r-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <PermissionPicker value={perms} onChange={setPerms} held={me.data?.permissions ?? []} />
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={save.isPending} disabled={!form.code || !form.name || !perms.length}>Save role</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DeleteRole({ role }: { role: PlatformRoleRow }) {
  const del = useAction(() => api(`platform/roles/${role.code}`, { method: 'DELETE' }), { success: 'Role deleted', invalidate: [['platform-roles']] });
  return <ConfirmAction trigger={(open) => <Button size="sm" variant="ghost" onClick={open}>Delete</Button>} danger reason={false} title={`Delete ${role.name}?`} description={role.accounts ? 'Move everyone off this role first.' : 'Nobody holds this role.'} confirmLabel="Delete role" busy={del.isPending} onConfirm={() => del.mutateAsync(undefined)} />;
}
