import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { parseKes, Permission, todayInNairobi } from '@chamahub/shared';
import { Button, Chips, Field, NoAccess, Notice, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';

const CATEGORIES = ['Meeting costs', 'Bank & M-Pesa charges', 'Transport', 'Stationery', 'Welfare support', 'Professional fees', 'Other'];

/** Records an expense for approval. It is paid (and reaches the ledger) only after another officer approves it. */
export default function ExpenseNew() {
  const { groupId, group, can } = useGroupAccess();
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [payee, setPayee] = useState('');
  const [incurredOn, setIncurredOn] = useState(todayInNairobi());
  let cents: number | null = null;
  try {
    cents = amount ? parseKes(amount) : null;
  } catch {
    cents = null;
  }
  const create = useAct(() => api(`groups/${groupId}/expenses`, { body: { category, description: description.trim(), amountCents: cents, incurredOn, payee: payee.trim() || undefined } }), { invalidate: [['expenses', groupId], ['group-dashboard', groupId]], successMessage: 'Recorded. Approvers have been notified.', onSuccess: () => router.back() });
  if (group.data && !can(Permission.EXPENSES_RECORD)) return <Screen><Stack.Screen options={{ title: 'Add expense' }} /><NoAccess what="recording expenses" /></Screen>;
  return (
    <Screen keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Add expense' }} />
      <Notice tone="neutral">The expense waits for approval by another officer; nothing is paid or posted until then.</Notice>
      <Chips value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
      <Field label="What was it for?" value={description} onChangeText={setDescription} placeholder="e.g. Venue hire for the AGM" />
      <Field label="Amount" prefix="KES" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} error={amount && cents === null ? 'Enter a valid amount' : undefined} />
      <Field label="Paid to (optional)" value={payee} onChangeText={setPayee} placeholder="e.g. Nyali Community Hall" />
      <Field label="Date incurred" value={incurredOn} onChangeText={setIncurredOn} placeholder="YYYY-MM-DD" />
      <Button title="Submit for approval" onPress={() => create.mutate(undefined)} disabled={!cents || description.trim().length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(incurredOn)} loading={create.isPending} />
    </Screen>
  );
}
