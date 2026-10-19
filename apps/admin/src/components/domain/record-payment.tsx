'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { FineRow, LABELS, LoanSummary, PAYMENT_METHODS, todayInNairobi } from '@chamahub/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useGroupId } from '@/lib/session';
import { kes, newIdempotencyKey } from '@/lib/utils';
import { MemberSelect } from './member-select';

type Purpose = 'CONTRIBUTION' | 'LOAN_REPAYMENT' | 'FINE';

const schema = z
  .object({
    memberId: z.string().min(1, 'Select a member'),
    amountCents: z.number({ invalid_type_error: 'Enter an amount' }).int('Enter a valid amount (max 2 decimals)').positive('Amount must be greater than zero'),
    method: z.enum(PAYMENT_METHODS),
    reference: z.string().trim().max(60).optional(),
    paidAt: z.string().refine((v) => v <= todayInNairobi(), 'Date cannot be in the future'),
    targetId: z.string().optional(),
    notes: z.string().max(500).optional(),
  })
  .refine((v) => v.method === 'CASH' || v.method === 'OTHER' || !!v.reference, { message: 'Enter the transaction reference', path: ['reference'] });
type Form = z.infer<typeof schema>;

/**
 * Manual payment recording by an officer. The payment is saved as PENDING
 * and only counts once a second officer verifies it.
 */
export function RecordPaymentDialog({ open, onOpenChange, purpose = 'CONTRIBUTION', memberId, targetId }: { open: boolean; onOpenChange: (o: boolean) => void; purpose?: Purpose; memberId?: string; targetId?: string }) {
  const groupId = useGroupId();
  const [key, setKey] = useState(newIdempotencyKey);
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { method: 'MPESA', paidAt: todayInNairobi(), memberId: memberId ?? '', targetId } });
  const member = form.watch('memberId');
  useEffect(() => {
    if (open) {
      form.reset({ method: 'MPESA', paidAt: todayInNairobi(), memberId: memberId ?? '', targetId, amountCents: undefined as unknown as number });
      setKey(newIdempotencyKey());
    }
  }, [open, memberId, targetId, form]);

  const targets = useQuery({
    queryKey: ['payment-targets', groupId, purpose, member],
    enabled: open && !!member,
    queryFn: async () => {
      if (purpose === 'LOAN_REPAYMENT') {
        const loans = await api<LoanSummary[]>(`groups/${groupId}/loans`, { query: { memberId: member, status: 'DISBURSED' } });
        return loans.map((l) => ({ id: l.id, label: `${kes(l.principalCents)} loan · balance ${kes(l.outstandingCents)}`, owed: l.outstandingCents }));
      }
      if (purpose === 'FINE') {
        const fines = await api<FineRow[]>(`groups/${groupId}/fines`);
        return fines.filter((f) => f.membershipId === member && ['OUTSTANDING', 'PARTIAL'].includes(f.status)).map((f) => ({ id: f.id, label: `${f.reason} · ${kes(f.amountCents - f.paidCents)}`, owed: f.amountCents - f.paidCents }));
      }
      const ledger = await api<{ items: { obligationId: string; period: string; outstandingCents: number; membershipId: string }[] }>(`groups/${groupId}/contributions/ledger`, { query: { memberId: member, status: 'OUTSTANDING', pageSize: 50, to: '2100-01-01' } });
      return ledger.items.map((o) => ({ id: o.obligationId, label: `${o.period} · ${kes(o.outstandingCents)} due`, owed: o.outstandingCents }));
    },
  });

  const record = useAction((v: Form) => api(`groups/${groupId}/payments`, { body: { ...v, purpose, targetId: v.targetId || undefined, reference: v.reference || undefined, idempotencyKey: key } }), {
    success: 'Payment recorded. Another officer must verify it before it counts.',
    invalidate: [['ledger', groupId], ['payments', groupId], ['overview', groupId], ['loans', groupId], ['fines', groupId], ['reconciliation', groupId]],
    onSuccess: () => onOpenChange(false),
  });
  const titles: Record<Purpose, string> = { CONTRIBUTION: 'Record contribution', LOAN_REPAYMENT: 'Record loan repayment', FINE: 'Record fine payment' };
  const requiresTarget = purpose !== 'CONTRIBUTION';
  const selected = useMemo(() => targets.data?.find((t) => t.id === form.watch('targetId')), [targets.data, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={titles[purpose]} description="Saved as pending until another officer confirms the money was received.">
        <form onSubmit={form.handleSubmit((v) => (requiresTarget && !v.targetId ? form.setError('targetId', { message: 'Select what this pays for' }) : record.mutate(v)))} className="space-y-3" noValidate>
          <Field label="Member" htmlFor="memberId" error={form.formState.errors.memberId?.message}>
            <Controller control={form.control} name="memberId" render={({ field }) => <MemberSelect id="memberId" value={field.value} onChange={(v) => { field.onChange(v); form.setValue('targetId', undefined); }} invalid={!!form.formState.errors.memberId} />} />
          </Field>
          {member && (
            <Field label={purpose === 'LOAN_REPAYMENT' ? 'Loan' : purpose === 'FINE' ? 'Fine' : 'Apply to (optional — oldest first if blank)'} htmlFor="targetId" error={form.formState.errors.targetId?.message}>
              <Select id="targetId" {...form.register('targetId')}>
                <option value="">{targets.isLoading ? 'Loading…' : requiresTarget ? 'Select…' : 'Oldest outstanding first'}</option>
                {targets.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount" htmlFor="amount" error={form.formState.errors.amountCents?.message} hint={selected ? `Owed: ${kes(selected.owed)}` : undefined}>
              <Controller control={form.control} name="amountCents" render={({ field }) => <MoneyInput id="amount" value={field.value} onChange={field.onChange} invalid={!!form.formState.errors.amountCents} />} />
            </Field>
            <Field label="Date paid" htmlFor="paidAt" error={form.formState.errors.paidAt?.message}>
              <Input id="paidAt" type="date" max={todayInNairobi()} {...form.register('paidAt')} />
            </Field>
            <Field label="Method" htmlFor="method">
              <Select id="method" {...form.register('method')}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {LABELS.paymentMethod[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reference" htmlFor="reference" error={form.formState.errors.reference?.message}>
              <Input id="reference" placeholder="e.g. QBC12XYZ9" className="uppercase" {...form.register('reference')} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="notes">
            <Textarea id="notes" rows={2} className="min-h-0" {...form.register('notes')} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={record.isPending}>
              Record payment
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
