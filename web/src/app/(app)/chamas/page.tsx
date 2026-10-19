'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { createGroupSchema, GROUP_TYPES, LABELS } from '@chamahub/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useMyGroups } from '@/lib/session';
import { date, kes } from '@/lib/utils';

type Form = z.input<typeof createGroupSchema>;

export default function ChamasPage() {
  const router = useRouter();
  const groups = useMyGroups();
  const [open, setOpen] = useState(false);
  const form = useForm<Form>({ resolver: zodResolver(createGroupSchema), defaultValues: { type: 'TABLE_BANKING', financialYearStartMonth: 1 } });
  const create = useAction((v: Form) => api<{ id: string }>('groups', { body: v }), { success: 'Chama created. You are its chairperson.', invalidate: [['groups']], onSuccess: (g) => router.push(`/g/${g.id}/settings`) });

  return (
    <>
      <PageHeader title="Chamas" description="Every group you belong to. Your role in each group decides what you can do there." actions={<Button onClick={() => setOpen(true)}>Create a Chama</Button>} />
      <Panel flush>
        {groups.error ? (
          <ErrorState error={groups.error} onRetry={groups.refetch} />
        ) : !groups.data ? (
          <LoadingRows />
        ) : groups.data.length === 0 ? (
          <EmptyState title="You are not in any Chama yet" description="Create one, or accept an invitation from the mobile app." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-canvas/60 text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Chama</th>
                <th className="px-4 py-2 font-medium">Your role</th>
                <th className="px-4 py-2 font-medium">Members</th>
                <th className="px-4 py-2 font-medium">Schedule</th>
                <th className="px-4 py-2 font-medium">Next due</th>
                <th className="px-4 py-2 text-right font-medium">Your arrears</th>
              </tr>
            </thead>
            <tbody>
              {groups.data.map((g) => (
                <tr key={g.groupId} className="border-b border-line last:border-0 hover:bg-canvas">
                  <td className="px-4 py-2.5">
                    <Link href={`/g/${g.groupId}/overview`} className="font-medium text-navy hover:text-forest">
                      {g.name}
                    </Link>
                    <p className="text-xs text-muted">{LABELS.groupType[g.type]}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={g.role === 'MEMBER' ? 'neutral' : 'green'}>{LABELS.groupRole[g.role]}</Badge>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{g.memberCount}</td>
                  <td className="px-4 py-2.5">{g.schedule ? `${kes(g.schedule.amountCents, true)} ${LABELS.frequency[g.schedule.frequency].toLowerCase()}` : '—'}</td>
                  <td className="px-4 py-2.5">{date(g.nextDueDate)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{g.outstandingCents ? <span className="text-danger">{kes(g.outstandingCents)}</span> : kes(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Create a Chama" description="You will be the chairperson. You can invite officers and members next.">
          <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-3" noValidate>
            <Field label="Group name" htmlFor="name" error={form.formState.errors.name?.message}>
              <Input id="name" {...form.register('name')} placeholder="e.g. Jitegemee Table Banking" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type" htmlFor="type">
                <Select id="type" {...form.register('type')}>
                  {GROUP_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {LABELS.groupType[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="County" htmlFor="county">
                <Input id="county" {...form.register('county')} placeholder="e.g. Kisumu" />
              </Field>
              <Field label="Registration number (optional)" htmlFor="reg">
                <Input id="reg" {...form.register('registrationNumber')} />
              </Field>
              <Field label="Financial year starts" htmlFor="fy">
                <Select id="fy" {...form.register('financialYearStartMonth', { valueAsNumber: true })}>
                  {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Description" htmlFor="desc">
              <Textarea id="desc" rows={2} className="min-h-0" {...form.register('description')} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending}>
                Create Chama
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
