'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { MeetingDetail, MeetingRow, Permission } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent, Sheet } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { PageHeader, Panel, Toolbar } from '@/components/ui/layout-parts';
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs';
import { LoadingRows } from '@/components/ui/states';
import { MemberSelect } from '@/components/domain/member-select';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroupId } from '@/lib/session';
import { date, dateTime, kes } from '@/lib/utils';

function MeetingDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const groupId = useGroupId();
  const can = useCan();
  const m = useQuery({ queryKey: ['meeting', groupId, id], queryFn: () => api<MeetingDetail>(`groups/${groupId}/meetings/${id}`), enabled: !!id });
  const [register, setRegister] = useState<Record<string, string>>({});
  const [minutes, setMinutes] = useState('');
  const [res, setRes] = useState({ title: '', details: '', isFinancial: false, amountCents: undefined as number | undefined });
  const [act, setAct] = useState({ description: '', assigneeMemberId: '', dueDate: '' });
  useEffect(() => {
    if (m.data) {
      setRegister(Object.fromEntries(m.data.attendance.map((a) => [a.membershipId, ['PRESENT', 'ABSENT', 'APOLOGY'].includes(a.status ?? '') ? (a.status as string) : a.status === 'DECLINED' ? 'APOLOGY' : 'ABSENT'])));
      setMinutes(m.data.minutes?.body ?? '');
    }
  }, [m.data]);
  const inv = [['meeting', groupId, id], ['meetings', groupId]];
  const saveRegister = useAction(() => api(`groups/${groupId}/meetings/${id}/attendance`, { method: 'PUT', body: { entries: Object.entries(register).map(([memberId, status]) => ({ memberId, status })) } }), { success: 'Attendance register saved', invalidate: inv });
  const saveMinutes = useAction(() => api(`groups/${groupId}/meetings/${id}/minutes`, { method: 'PUT', body: { body: minutes } }), { success: 'Draft minutes saved', invalidate: inv });
  const approve = useAction(() => api(`groups/${groupId}/meetings/${id}/minutes/approve`, { method: 'POST' }), { success: 'Minutes approved and published to members', invalidate: inv });
  const addRes = useAction(() => api(`groups/${groupId}/meetings/${id}/resolutions`, { body: { ...res, details: res.details || undefined, amountCents: res.isFinancial ? res.amountCents : undefined } }), { success: 'Resolution added', invalidate: inv, onSuccess: () => setRes({ title: '', details: '', isFinancial: false, amountCents: undefined }) });
  const addAct = useAction(() => api(`groups/${groupId}/meetings/${id}/actions`, { body: { description: act.description, assigneeMemberId: act.assigneeMemberId || undefined, dueDate: act.dueDate || undefined } }), { success: 'Action assigned', invalidate: inv, onSuccess: () => setAct({ description: '', assigneeMemberId: '', dueDate: '' }) });
  const toggle = useAction(({ actionId, done }: { actionId: string; done: boolean }) => api(`groups/${groupId}/meetings/${id}/actions/${actionId}`, { method: 'PATCH', body: { done } }), { invalidate: inv });
  const status = useAction((s: 'CANCELLED' | 'SCHEDULED') => api(`groups/${groupId}/meetings/${id}`, { method: 'PATCH', body: { status: s } }), { success: 'Meeting updated', invalidate: inv });
  const d = m.data;
  const manage = can(Permission.MEETINGS_MANAGE);
  const final = d?.minutes?.status === 'APPROVED';
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()} title={d?.title ?? 'Meeting'} subtitle={d && <span className="flex items-center gap-2"><StatusBadge status={d.status} /> {dateTime(d.scheduledAt)} · {d.location ?? d.virtualLink ?? 'No location'}</span>} width="max-w-3xl">
      {!d ? <LoadingRows /> : (
        <Tabs defaultValue="attendance">
          <TabsList tabs={[{ value: 'attendance', label: 'Attendance' }, { value: 'agenda', label: 'Agenda & minutes' }, { value: 'resolutions', label: `Resolutions (${d.resolutions.length})` }, { value: 'actions', label: `Actions (${d.actions.length})` }]} />
          <TabsContent value="attendance">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-medium">Member</th><th className="font-medium">RSVP</th><th className="font-medium">Register</th></tr></thead>
              <tbody>
                {d.attendance.map((a) => (
                  <tr key={a.membershipId} className="border-t border-line">
                    <td className="py-1.5">{a.name}</td>
                    <td>{a.status ? <StatusBadge status={a.status} /> : <span className="text-xs text-muted">No reply</span>}</td>
                    <td className="py-1">
                      <Select className="h-8 w-32" value={register[a.membershipId] ?? 'ABSENT'} onChange={(e) => setRegister({ ...register, [a.membershipId]: e.target.value })} disabled={!manage} aria-label={`Attendance for ${a.name}`}>
                        <option value="PRESENT">Present</option>
                        <option value="ABSENT">Absent</option>
                        <option value="APOLOGY">Apology</option>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {manage && <div className="mt-3 flex gap-2"><Button onClick={() => saveRegister.mutate(undefined)} loading={saveRegister.isPending}>Save register</Button>{d.status === 'SCHEDULED' && <Button variant="ghost" onClick={() => status.mutate('CANCELLED')}>Cancel meeting</Button>}</div>}
          </TabsContent>
          <TabsContent value="agenda">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Agenda</h3>
            <ol className="mb-4 list-decimal space-y-0.5 pl-5 text-sm">{d.agenda.map((a, i) => <li key={i}>{a}</li>)}</ol>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Minutes</h3>
              {d.minutes && <StatusBadge status={d.minutes.status} />}
            </div>
            {final ? (
              <div className="whitespace-pre-wrap rounded-md border border-line bg-canvas p-3 text-sm">{d.minutes!.body}<p className="mt-3 text-xs text-muted">Approved by {d.minutes!.approvedByName} · {dateTime(d.minutes!.approvedAt)}</p></div>
            ) : manage || can(Permission.MINUTES_APPROVE) ? (
              <>
                <Textarea rows={10} value={minutes} onChange={(e) => setMinutes(e.target.value)} disabled={!manage} placeholder="Record what was discussed and decided…" aria-label="Minutes" />
                <div className="mt-2 flex gap-2">
                  {manage && <Button variant="secondary" onClick={() => saveMinutes.mutate(undefined)} loading={saveMinutes.isPending} disabled={minutes.trim().length < 10}>Save draft</Button>}
                  {can(Permission.MINUTES_APPROVE) && d.minutes && <Button onClick={() => approve.mutate(undefined)} loading={approve.isPending}>Approve & publish</Button>}
                </div>
                <p className="mt-1 text-xs text-muted">Minutes must be approved by someone other than the person who wrote them. Approved minutes cannot be edited.</p>
              </>
            ) : <p className="text-sm text-muted">Minutes will appear here once approved.</p>}
          </TabsContent>
          <TabsContent value="resolutions">
            <ul className="mb-4 divide-y divide-line rounded-md border border-line text-sm">
              {d.resolutions.length === 0 && <li className="px-3 py-4 text-center text-muted">No resolutions recorded.</li>}
              {d.resolutions.map((r) => <li key={r.id} className="px-3 py-2"><p className="font-medium">{r.title}{r.isFinancial && <span className="ml-2 text-xs text-berry">Financial · {kes(r.amountCents)}</span>}</p>{r.details && <p className="text-muted">{r.details}</p>}</li>)}
            </ul>
            {manage && !final && (
              <div className="space-y-2 rounded-md border border-line bg-canvas p-3">
                <Input placeholder="Resolution" value={res.title} onChange={(e) => setRes({ ...res, title: e.target.value })} aria-label="Resolution title" className="bg-white" />
                <Textarea rows={2} className="min-h-0 bg-white" placeholder="Details (optional)" value={res.details} onChange={(e) => setRes({ ...res, details: e.target.value })} />
                <div className="flex items-center gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={res.isFinancial} onChange={(e) => setRes({ ...res, isFinancial: e.target.checked })} /> Financial decision</label>{res.isFinancial && <MoneyInput className="w-48 bg-white" value={res.amountCents} onChange={(v) => setRes({ ...res, amountCents: v })} />}</div>
                <Button size="sm" onClick={() => addRes.mutate(undefined)} loading={addRes.isPending} disabled={res.title.length < 3}>Add resolution</Button>
              </div>
            )}
          </TabsContent>
          <TabsContent value="actions">
            <ul className="mb-4 divide-y divide-line rounded-md border border-line text-sm">
              {d.actions.length === 0 && <li className="px-3 py-4 text-center text-muted">No actions assigned.</li>}
              {d.actions.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                  <input type="checkbox" checked={a.done} onChange={(e) => toggle.mutate({ actionId: a.id, done: e.target.checked })} aria-label="Done" />
                  <div className="flex-1"><p className={a.done ? 'text-muted line-through' : ''}>{a.description}</p><p className="text-xs text-muted">{a.assigneeName ?? 'Unassigned'} · due {date(a.dueDate)}</p></div>
                </li>
              ))}
            </ul>
            {manage && (
              <div className="grid gap-2 rounded-md border border-line bg-canvas p-3 sm:grid-cols-[1fr_180px_150px_auto]">
                <Input className="bg-white" placeholder="Action" value={act.description} onChange={(e) => setAct({ ...act, description: e.target.value })} aria-label="Action" />
                <MemberSelect value={act.assigneeMemberId} onChange={(v) => setAct({ ...act, assigneeMemberId: v })} placeholder="Assignee" />
                <Input className="bg-white" type="date" value={act.dueDate} onChange={(e) => setAct({ ...act, dueDate: e.target.value })} aria-label="Due" />
                <Button onClick={() => addAct.mutate(undefined)} loading={addAct.isPending} disabled={act.description.length < 3}>Assign</Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </Sheet>
  );
}

export default function MeetingsPage() {
  const groupId = useGroupId();
  const can = useCan();
  const [scope, setScope] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [f, setF] = useState({ title: '', date: '', time: '14:00', location: '', virtualLink: '', agenda: '', requiresRsvp: true });
  const meetings = useQuery({ queryKey: ['meetings', groupId, scope], queryFn: () => api<MeetingRow[]>(`groups/${groupId}/meetings`, { query: { scope } }) });
  const create = useAction(
    () => api<MeetingDetail>(`groups/${groupId}/meetings`, { body: { title: f.title, scheduledAt: `${f.date}T${f.time}:00+03:00`, location: f.location || undefined, virtualLink: f.virtualLink || undefined, agenda: f.agenda.split('\n').map((s) => s.trim()).filter(Boolean), requiresRsvp: f.requiresRsvp } }),
    { success: 'Meeting scheduled and members notified', invalidate: [['meetings', groupId]], onSuccess: () => setOpen(false) },
  );
  return (
    <>
      <PageHeader title="Meetings" description="Schedule meetings, keep the register, and publish approved minutes." actions={can(Permission.MEETINGS_MANAGE) && <Button onClick={() => setOpen(true)}>Schedule meeting</Button>} />
      <Panel flush>
        <Toolbar>
          <Select className="w-40" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} aria-label="Scope">
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
            <option value="all">All</option>
          </Select>
        </Toolbar>
        <DataTable<MeetingRow>
          data={meetings.data}
          loading={meetings.isLoading}
          error={meetings.error}
          onRowClick={(m) => setSel(m.id)}
          empty={scope === 'upcoming' ? 'No upcoming meetings' : 'No meetings'}
          columns={[
            { accessorKey: 'scheduledAt', header: 'When', cell: ({ row }) => dateTime(row.original.scheduledAt) },
            { accessorKey: 'title', header: 'Meeting' },
            { accessorKey: 'location', header: 'Where', cell: ({ row }) => row.original.location ?? (row.original.virtualLink ? 'Online' : '—') },
            { id: 'rsvp', header: 'Confirmed', cell: ({ row }) => row.original.attendanceCounts.CONFIRMED ?? 0, meta: { align: 'right' } },
            { id: 'present', header: 'Present', cell: ({ row }) => row.original.attendanceCounts.PRESENT ?? '—', meta: { align: 'right' } },
            { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
            { accessorKey: 'minutesStatus', header: 'Minutes', cell: ({ row }) => (row.original.minutesStatus ? <StatusBadge status={row.original.minutesStatus} /> : '—') },
          ]}
        />
      </Panel>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Schedule a meeting" description="Members are notified and can confirm attendance in the app.">
          <div className="space-y-3">
            <Field label="Title" htmlFor="mt-t"><Input id="mt-t" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Monthly meeting" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" htmlFor="mt-d"><Input id="mt-d" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
              <Field label="Time (EAT)" htmlFor="mt-tm"><Input id="mt-tm" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
              <Field label="Location" htmlFor="mt-l"><Input id="mt-l" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
              <Field label="Online link" htmlFor="mt-v"><Input id="mt-v" value={f.virtualLink} onChange={(e) => setF({ ...f, virtualLink: e.target.value })} placeholder="https://" /></Field>
            </div>
            <Field label="Agenda (one item per line)" htmlFor="mt-a"><Textarea id="mt-a" rows={4} value={f.agenda} onChange={(e) => setF({ ...f, agenda: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requiresRsvp} onChange={(e) => setF({ ...f, requiresRsvp: e.target.checked })} /> Ask members to confirm attendance</label>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => create.mutate(undefined)} loading={create.isPending} disabled={f.title.length < 3 || !f.date}>Schedule</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <MeetingDrawer id={sel} onClose={() => setSel(null)} />
    </>
  );
}
