'use client';

import { Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  ALL_PERMISSIONS,
  GROUP_ROLES,
  GroupRole,
  LABELS,
  Permission,
  PERMISSION_INFO,
  PERMISSION_SAFEGUARDS,
  resolvePermissions,
  RolePolicy,
  SPECIAL_ROLE_INFO,
  SPECIAL_ROLES,
} from '@chamahub/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useGroup, useGroupId } from '@/lib/session';
import { cn } from '@/lib/utils';

const AREAS = [...new Set(Object.values(PERMISSION_INFO).map((i) => i.area))];

export default function RolesPage() {
  const groupId = useGroupId();
  const group = useGroup();
  const rawPolicy = group.data?.rolePolicy;
  const policy = useMemo(() => (rawPolicy ?? {}) as RolePolicy, [rawPolicy]);
  const [role, setRole] = useState<GroupRole>('TREASURER');
  const current = useMemo(() => resolvePermissions(role, policy), [role, policy]);
  const [draft, setDraft] = useState<Permission[]>(current);
  const [reason, setReason] = useState('');
  useEffect(() => setDraft(current), [current]);
  const guard = PERMISSION_SAFEGUARDS[role];
  const save = useAction((perms: Permission[] | null) => api(`groups/${groupId}/role-policy`, { method: 'PUT', body: { role, permissions: perms, reason } }), {
    success: 'Role permissions updated. Officers were notified.',
    invalidate: [['group', groupId], ['groups']],
    onSuccess: () => setReason(''),
  });
  if (!group.data) return <LoadingRows />;
  const customised = !!policy[role];
  const changed = draft.length !== current.length || draft.some((p) => !current.includes(p));

  return (
    <>
      <PageHeader title="Roles & Permissions" description="Each member holds one role per Chama. Adjust what each role can do in this group. Platform safeguards keep approvals independent and auditors read-only." />
      <div className="grid gap-5 xl:grid-cols-[220px_1fr]">
        <nav className="space-y-0.5" aria-label="Roles">
          {GROUP_ROLES.map((r) => (
            <button key={r} onClick={() => setRole(r)} className={cn('flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-white', role === r && 'bg-white font-medium text-berry shadow-sm')}>
              {LABELS.groupRole[r]}
              {policy[r] && <Badge tone="amber">custom</Badge>}
            </button>
          ))}
        </nav>
        <div className="space-y-5">
          <Panel
            title={`${LABELS.groupRole[role]} permissions`}
            actions={
              <div className="flex gap-2">
                {customised && <Button size="sm" variant="ghost" onClick={() => save.mutate(null)} disabled={reason.trim().length < 5} loading={save.isPending}>Restore default</Button>}
                <Button size="sm" onClick={() => save.mutate(draft)} disabled={!changed || reason.trim().length < 5} loading={save.isPending}>Save changes</Button>
              </div>
            }
          >
            <div className="grid gap-6 md:grid-cols-2">
              {AREAS.map((area) => (
                <fieldset key={area}>
                  <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{area}</legend>
                  <ul className="space-y-1.5">
                    {ALL_PERMISSIONS.filter((p) => PERMISSION_INFO[p].area === area).map((p) => {
                      const locked = guard.locked.includes(p);
                      const blocked = !guard.allowed.includes(p);
                      return (
                        <li key={p}>
                          <label className={cn('flex items-center gap-2 text-sm', blocked && 'text-muted')} title={blocked ? 'Platform safeguard: not available for this role' : locked ? 'Always on for this role' : undefined}>
                            <input
                              type="checkbox"
                              checked={draft.includes(p)}
                              disabled={locked || blocked}
                              onChange={(e) => setDraft(e.target.checked ? [...draft, p] : draft.filter((x) => x !== p))}
                            />
                            {PERMISSION_INFO[p].label}
                            {locked && <Lock className="h-3 w-3 text-muted" aria-label="Locked" />}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              ))}
            </div>
            <Field label="Reason for the change (recorded in the audit log)" htmlFor="r-reason" className="mt-6">
              <Textarea id="r-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Resolution 4 of the AGM on 12 March" />
            </Field>
          </Panel>
          <Panel title="Safeguards that no group setting can override">
            <ul className="list-disc space-y-1 pl-5 text-sm text-plum">
              <li>Whoever records a payment cannot verify it; nobody verifies their own payment.</li>
              <li>Members never approve their own loan; whoever prepares a loan cannot approve it.</li>
              <li>Expenses, payouts and distributions need approval by someone other than who prepared them.</li>
              <li>Completed transactions are never edited — only reversed with a reason, and every change is audited.</li>
              <li>Auditors stay read-only; ordinary members cannot be given write access to group records.</li>
              <li>The chairperson always keeps settings and role assignment, so the group cannot lock itself out.</li>
            </ul>
          </Panel>
          <Panel title="Optional roles" flush>
            <p className="border-b border-line px-4 py-2 text-xs text-muted">Add these to individual members from Members → member → Change membership.</p>
            <ul className="divide-y divide-line text-sm">
              {SPECIAL_ROLES.map((s) => (
                <li key={s} className="px-4 py-2.5">
                  <p className="font-medium">{SPECIAL_ROLE_INFO[s].label}</p>
                  <p className="text-muted">{SPECIAL_ROLE_INFO[s].description}</p>
                </li>
              ))}
              <li className="px-4 py-2.5">
                <p className="font-medium">Group Founder</p>
                <p className="text-muted">{group.data.founderName ?? '—'} created this group. Founding gives no lasting control; leadership changes through role assignment.</p>
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
