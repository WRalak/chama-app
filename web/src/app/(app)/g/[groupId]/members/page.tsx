'use client';

import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { useEffect, useMemo, useState } from 'react';
import { formatKenyanPhone, GROUP_ROLES, GroupRole, InvitationRow, LABELS, MemberRow, normalizeKenyanPhone, ObligationItem, Permission, SPECIAL_ROLE_INFO, SPECIAL_ROLES, SpecialRole } from '@chamahub/shared';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent, Sheet } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { KeyValues, PageHeader, Panel, Toolbar } from '@/components/ui/layout-parts';
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs';
import { LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction, useMembers } from '@/lib/hooks';
import { useCan, useGroupId } from '@/lib/session';
import { date, downloadCsv, kes } from '@/lib/utils';

interface Profile {
  membershipId: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: GroupRole;
  status: string;
  shares: number;
  joinedAt: string;
  balances?: { contributedCents: number; outstandingCents: number; loanBalanceCents: number; finesOutstandingCents: number };
  obligations: ObligationItem[];
  loans: { id: string; principalCents: number; interestCents: number; status: string; appliedAt: string; disbursedAt: string | null }[];
  fines: { id: string; amountCents: number; paidCents: number; reason: string; status: string; issuedOn: string }[];
  payments: { id: string; amountCents: number; purpose: string; method: string; status: string; reference: string | null; paidAt: string }[];
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const groupId = useGroupId();
  const can = useCan();
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<GroupRole>('MEMBER');
  const invite = useAction(() => api(`groups/${groupId}/invitations`, { body: { phone, fullName: fullName || undefined, role } }), {
    success: 'Invitation sent. They accept it in the mobile app using this phone number.',
    invalidate: [['invitations', groupId]],
    onSuccess: () => {
      onOpenChange(false);
      setPhone('');
      setFullName('');
    },
  });
  const valid = !!normalizeKenyanPhone(phone);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Invite a member" description="The invitation is tied to this phone number and expires in 14 days.">
        <div className="space-y-3">
          <Field label="Phone number" htmlFor="inv-phone" error={phone && !valid ? 'Enter a valid Kenyan mobile number' : undefined}>
            <Input id="inv-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
          </Field>
          <Field label="Name (optional)" htmlFor="inv-name">
            <Input id="inv-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Role" htmlFor="inv-role" hint={can(Permission.ROLES_ASSIGN) ? undefined : 'Only members can be invited with your role.'}>
            <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as GroupRole)} disabled={!can(Permission.ROLES_ASSIGN)}>
              {GROUP_ROLES.map((r) => (
                <option key={r} value={r}>
                  {LABELS.groupRole[r]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => invite.mutate(undefined)} loading={invite.isPending} disabled={!valid}>
              Send invitation
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MemberDrawer({ member, onClose }: { member: MemberRow | null; onClose: () => void }) {
  const groupId = useGroupId();
  const can = useCan();
  const profile = useQuery({ queryKey: ['member', groupId, member?.membershipId], queryFn: () => api<Profile>(`groups/${groupId}/members/${member!.membershipId}`), enabled: !!member && can(Permission.MEMBERS_VIEW_FINANCIALS) });
  const [role, setRole] = useState<GroupRole | ''>('');
  const [status, setStatus] = useState('');
  const [shares, setShares] = useState('');
  const [reason, setReason] = useState('');
  const invalidate = [['members', groupId], ['member', groupId, member?.membershipId]];
  const changeRole = useAction(() => api(`groups/${groupId}/members/${member!.membershipId}/role`, { method: 'PATCH', body: { role, reason } }), { success: 'Role updated', invalidate, onSuccess: () => setReason('') });
  const changeStatus = useAction(() => api(`groups/${groupId}/members/${member!.membershipId}/status`, { method: 'PATCH', body: { status, reason } }), { success: 'Membership status updated', invalidate, onSuccess: () => setReason('') });
  const [special, setSpecial] = useState<SpecialRole[]>(member?.specialRoles ?? []);
  useEffect(() => setSpecial(member?.specialRoles ?? []), [member]);
  const changeSpecial = useAction(() => api(`groups/${groupId}/members/${member!.membershipId}/special-roles`, { method: 'PUT', body: { specialRoles: special, reason } }), { success: 'Optional roles updated', invalidate, onSuccess: () => setReason('') });
  const changeShares = useAction(() => api(`groups/${groupId}/members/${member!.membershipId}/shares`, { method: 'PUT', body: { shares: Number(shares), reason } }), { success: 'Shares updated', invalidate, onSuccess: () => setReason('') });
  if (!member) return null;
  const p = profile.data;
  return (
    <Sheet open={!!member} onOpenChange={(o) => !o && onClose()} title={member.fullName} subtitle={`${LABELS.groupRole[member.role]} · joined ${date(member.joinedAt)}`} width="max-w-2xl">
      <KeyValues items={[['Phone', member.phone], ['Status', <StatusBadge key="s" status={member.status} />], ['Shares', member.shares], ['Optional roles', member.specialRoles.length ? member.specialRoles.map((r) => SPECIAL_ROLE_INFO[r].label).join(', ') : '—'], ...(member.isFounder ? [['Founder', 'Created this group (no special control)'] as [string, string]] : [])]} />
      {profile.isLoading && <LoadingRows rows={3} />}
      {p?.balances && (
        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
          {[
            ['Contributed', p.balances.contributedCents],
            ['Arrears', p.balances.outstandingCents],
            ['Loan balance', p.balances.loanBalanceCents],
            ['Fines due', p.balances.finesOutstandingCents],
          ].map(([l, v]) => (
            <div key={l as string} className="bg-white px-3 py-2">
              <p className="text-2xs text-muted">{l}</p>
              <p className="text-sm font-semibold tabular-nums">{kes(v as number)}</p>
            </div>
          ))}
        </div>
      )}
      {p && (
        <Tabs defaultValue="contrib" className="mt-5">
          <TabsList tabs={[{ value: 'contrib', label: 'Contributions' }, { value: 'payments', label: 'Payments' }, { value: 'loans', label: 'Loans' }, { value: 'fines', label: 'Fines' }]} />
          <TabsContent value="contrib">
            <table className="w-full text-sm">
              <tbody>
                {p.obligations.slice(-24).reverse().map((o) => (
                  <tr key={o.id} className="border-b border-line">
                    <td className="py-1.5">{o.periodLabel}<p className="text-xs text-muted">{o.scheduleName} · due {date(o.dueDate)}</p></td>
                    <td className="py-1.5 text-right tabular-nums">{kes(o.paidCents)} / {kes(o.amountCents)}</td>
                    <td className="py-1.5 pl-3 text-right"><StatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>
          <TabsContent value="payments">
            <table className="w-full text-sm">
              <tbody>
                {p.payments.map((x) => (
                  <tr key={x.id} className="border-b border-line">
                    <td className="py-1.5">{date(x.paidAt)}<p className="text-xs text-muted">{x.purpose.replace('_', ' ').toLowerCase()} · {x.reference ?? x.method}</p></td>
                    <td className="py-1.5 text-right tabular-nums">{kes(x.amountCents)}</td>
                    <td className="py-1.5 pl-3 text-right"><StatusBadge status={x.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>
          <TabsContent value="loans">
            {p.loans.length === 0 ? <p className="text-sm text-muted">No loans.</p> : (
              <table className="w-full text-sm"><tbody>
                {p.loans.map((l) => (
                  <tr key={l.id} className="border-b border-line">
                    <td className="py-1.5">Applied {date(l.appliedAt)}<p className="text-xs text-muted">Disbursed {date(l.disbursedAt)}</p></td>
                    <td className="py-1.5 text-right tabular-nums">{kes(l.principalCents)} + {kes(l.interestCents)}</td>
                    <td className="py-1.5 pl-3 text-right"><StatusBadge status={l.status} /></td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </TabsContent>
          <TabsContent value="fines">
            {p.fines.length === 0 ? <p className="text-sm text-muted">No fines.</p> : (
              <table className="w-full text-sm"><tbody>
                {p.fines.map((f) => (
                  <tr key={f.id} className="border-b border-line">
                    <td className="py-1.5">{f.reason}<p className="text-xs text-muted">{date(f.issuedOn)}</p></td>
                    <td className="py-1.5 text-right tabular-nums">{kes(f.paidCents)} / {kes(f.amountCents)}</td>
                    <td className="py-1.5 pl-3 text-right"><StatusBadge status={f.status} /></td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </TabsContent>
        </Tabs>
      )}
      {(can(Permission.ROLES_ASSIGN) || can(Permission.MEMBERS_MANAGE)) && (
        <div className="mt-6 space-y-3 rounded-md border border-line bg-canvas p-3">
          <h3 className="text-sm font-semibold text-navy">Change membership</h3>
          <Field label="Reason (recorded in the audit log)" htmlFor="m-reason">
            <Textarea id="m-reason" rows={2} className="min-h-0 bg-white" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Elected treasurer at the AGM on 12 March" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            {can(Permission.ROLES_ASSIGN) && (
              <div className="space-y-1.5">
                <Select value={role} onChange={(e) => setRole(e.target.value as GroupRole)} aria-label="New role">
                  <option value="">New role…</option>
                  {GROUP_ROLES.map((r) => <option key={r} value={r}>{LABELS.groupRole[r]}</option>)}
                </Select>
                <Button size="sm" variant="secondary" className="w-full" disabled={!role || reason.length < 5} loading={changeRole.isPending} onClick={() => changeRole.mutate(undefined)}>Update role</Button>
              </div>
            )}
            {can(Permission.MEMBERS_MANAGE) && (
              <>
                <div className="space-y-1.5">
                  <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="New status">
                    <option value="">New status…</option>
                    <option value="ACTIVE">Active</option>
                    <option value="SUSPENDED">Suspended</option>
                    <option value="EXITED">Exited</option>
                  </Select>
                  <Button size="sm" variant="secondary" className="w-full" disabled={!status || reason.length < 5} loading={changeStatus.isPending} onClick={() => changeStatus.mutate(undefined)}>Update status</Button>
                </div>
                <div className="space-y-1.5">
                  <Input type="number" min={0} value={shares} onChange={(e) => setShares(e.target.value)} placeholder={`Shares (${member.shares})`} aria-label="Shares" />
                  <Button size="sm" variant="secondary" className="w-full" disabled={shares === '' || reason.length < 5} loading={changeShares.isPending} onClick={() => changeShares.mutate(undefined)}>Set shares</Button>
                </div>
              </>
            )}
          </div>
          {can(Permission.ROLES_ASSIGN) && (
            <div className="border-t border-line pt-3">
              <p className="mb-1.5 text-xs font-medium">Optional roles</p>
              <div className="flex flex-wrap gap-3">
                {SPECIAL_ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-1.5 text-sm" title={SPECIAL_ROLE_INFO[r].description}>
                    <input type="checkbox" checked={special.includes(r)} onChange={(e) => setSpecial(e.target.checked ? [...special, r] : special.filter((x) => x !== r))} />
                    {SPECIAL_ROLE_INFO[r].label}
                  </label>
                ))}
              </div>
              <Button size="sm" variant="secondary" className="mt-2" disabled={reason.length < 5} loading={changeSpecial.isPending} onClick={() => changeSpecial.mutate(undefined)}>Save optional roles</Button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

export default function MembersPage() {
  const groupId = useGroupId();
  const can = useCan();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [invite, setInvite] = useState(false);
  const [selected, setSelected] = useState<MemberRow | null>(null);
  const members = useMembers(status || undefined);
  const invitations = useQuery({ queryKey: ['invitations', groupId], queryFn: () => api<InvitationRow[]>(`groups/${groupId}/invitations`), enabled: can(Permission.MEMBERS_INVITE) });
  const revoke = useAction((id: string) => api(`groups/${groupId}/invitations/${id}`, { method: 'DELETE' }), { success: 'Invitation revoked', invalidate: [['invitations', groupId]] });
  const financial = members.data?.some((m) => m.financials);

  const columns = useMemo<ColumnDef<MemberRow, unknown>[]>(
    () => [
      { accessorKey: 'fullName', header: 'Member', cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span> },
      { accessorKey: 'phone', header: 'Phone', enableSorting: false, cell: ({ row }) => <span className="tabular-nums">{row.original.phone.startsWith('+') ? formatKenyanPhone(row.original.phone) : row.original.phone}</span> },
      { accessorKey: 'role', header: 'Role', cell: ({ row }) => <span className="flex flex-wrap gap-1"><Badge tone={row.original.role === 'MEMBER' ? 'neutral' : 'green'}>{LABELS.groupRole[row.original.role]}</Badge>{row.original.specialRoles.map((r) => <Badge key={r} tone={r === 'READ_ONLY' ? 'neutral' : 'blue'}>{SPECIAL_ROLE_INFO[r].label}</Badge>)}{row.original.isFounder && <Badge tone="neutral">Founder</Badge>}</span> },
      { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { accessorKey: 'joinedAt', header: 'Joined', cell: ({ row }) => date(row.original.joinedAt) },
      { accessorKey: 'shares', header: 'Shares', meta: { align: 'right' } },
      ...(financial
        ? ([
            { id: 'contributed', header: 'Contributed', accessorFn: (r) => r.financials?.contributedCents ?? 0, cell: ({ getValue }) => kes(getValue() as number), meta: { align: 'right' } },
            { id: 'arrears', header: 'Arrears', accessorFn: (r) => r.financials?.outstandingCents ?? 0, cell: ({ getValue }) => <span className={(getValue() as number) > 0 ? 'text-danger' : ''}>{kes(getValue() as number)}</span>, meta: { align: 'right' } },
            { id: 'loan', header: 'Loan balance', accessorFn: (r) => r.financials?.loanBalanceCents ?? 0, cell: ({ getValue }) => kes(getValue() as number), meta: { align: 'right' } },
          ] as ColumnDef<MemberRow, unknown>[])
        : []),
    ],
    [financial],
  );

  return (
    <>
      <PageHeader
        title="Members"
        description="Member directory, roles and financial standing."
        actions={
          <>
            <Button variant="secondary" onClick={() => downloadCsv('members.csv', ['Name', 'Phone', 'Role', 'Status', 'Joined', 'Shares', 'Contributed', 'Arrears', 'Loan balance'], (members.data ?? []).map((m) => [m.fullName, m.phone, m.role, m.status, m.joinedAt.slice(0, 10), m.shares, (m.financials?.contributedCents ?? 0) / 100, (m.financials?.outstandingCents ?? 0) / 100, (m.financials?.loanBalanceCents ?? 0) / 100]))}>
              Export CSV
            </Button>
            {can(Permission.MEMBERS_INVITE) && <Button onClick={() => setInvite(true)}>Invite member</Button>}
          </>
        }
      />
      <Tabs defaultValue="directory">
        <TabsList tabs={[{ value: 'directory', label: `Directory${members.data ? ` (${members.data.length})` : ''}` }, ...(can(Permission.MEMBERS_INVITE) ? [{ value: 'invitations', label: 'Invitations' }] : [])]} />
        <TabsContent value="directory">
          <Panel flush>
            <Toolbar>
              <Input className="max-w-xs" placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search members" />
              <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
                <option value="">Current members</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="EXITED">Exited</option>
              </Select>
            </Toolbar>
            <DataTable columns={columns} data={members.data} loading={members.isLoading} error={members.error} onRetry={members.refetch} globalFilter={q} onRowClick={setSelected} empty="No members match" />
          </Panel>
        </TabsContent>
        <TabsContent value="invitations">
          <Panel flush>
            <DataTable<InvitationRow>
              data={invitations.data}
              loading={invitations.isLoading}
              error={invitations.error}
              empty="No invitations sent yet"
              columns={[
                { accessorKey: 'phone', header: 'Phone' },
                { accessorKey: 'fullName', header: 'Name', cell: ({ row }) => row.original.fullName ?? '—' },
                { accessorKey: 'role', header: 'Role', cell: ({ row }) => LABELS.groupRole[row.original.role] },
                { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
                { accessorKey: 'invitedByName', header: 'Invited by' },
                { accessorKey: 'expiresAt', header: 'Expires', cell: ({ row }) => date(row.original.expiresAt) },
                { id: 'actions', header: '', cell: ({ row }) => row.original.status === 'PENDING' ? <Button size="sm" variant="ghost" onClick={() => revoke.mutate(row.original.id)}>Revoke</Button> : null },
              ]}
            />
          </Panel>
        </TabsContent>
      </Tabs>
      <InviteDialog open={invite} onOpenChange={setInvite} />
      <MemberDrawer member={selected} onClose={() => setSelected(null)} />
    </>
  );
}
