import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { DESTINATION_LABELS, DESTINATION_TYPES, DestinationType, MemberRow, Permission } from '@chamahub/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Chips, Field, NoAccess, Notice, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useDestinations } from '@/lib/collections';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { space } from '@/theme';

const NUMBER_LABEL: Partial<Record<DestinationType, string>> = { PERSONAL_MPESA: 'M-Pesa phone number', OTHER_MOBILE_MONEY: 'Phone number', PAYBILL: 'Paybill number', TILL: 'Till number', BANK_ACCOUNT: 'Account number' };
const USES = [{ value: 'CONTRIBUTION', label: 'Contributions' }, { value: 'LOAN_REPAYMENT', label: 'Loan repayments' }, { value: 'FINE', label: 'Fines' }] as const;

/** Propose a new destination, or new details that replace an existing one. Nothing changes for members until another officer approves. */
export default function NewDestination() {
  const { groupId, can, myMembershipId } = useGroupAccess();
  const params = useLocalSearchParams<{ replacesId?: string; type?: DestinationType }>();
  const existing = useDestinations(groupId);
  const replacing = existing.data?.find((d) => d.id === params.replacesId);
  const members = useQuery({ queryKey: ['members', groupId, 'ACTIVE'], queryFn: () => api<MemberRow[]>(`groups/${groupId}/members`, { query: { status: 'ACTIVE' } }), enabled: can(Permission.MEMBERS_VIEW) });
  const [type, setType] = useState<DestinationType>(params.type ?? 'PAYBILL');
  const [f, setF] = useState({ displayName: '', provider: '', accountNumber: '', accountReference: '', accountName: '', branch: '', instructions: '', reason: '' });
  const [uses, setUses] = useState<string[]>([]);
  const [responsible, setResponsible] = useState<string>(myMembershipId);
  const [verification, setVerification] = useState<'MANUAL_REVIEW' | 'STATEMENT_IMPORT'>('MANUAL_REVIEW');
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const opt = (v: string) => v.trim() || undefined;
  const submit = useAct(
    () => api(`groups/${groupId}/payment-destinations`, { body: { type, displayName: f.displayName.trim(), provider: opt(f.provider), accountNumber: opt(f.accountNumber), accountReference: opt(f.accountReference), accountName: opt(f.accountName), branch: opt(f.branch), instructions: opt(f.instructions), intendedUse: uses, responsibleMemberId: responsible || undefined, verification, replacesId: params.replacesId, reason: f.reason.trim() } }),
    { invalidate: [['destinations', groupId]], successMessage: 'Sent for approval. Members keep the current details until another officer approves.', onSuccess: () => router.back() },
  );
  if (!can(Permission.DESTINATIONS_MANAGE)) return <NoAccess what="payment destinations" />;
  const needsNumber = !!NUMBER_LABEL[type];
  return (
    <Screen keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: replacing ? 'Change payment details' : 'Add payment destination' }} />
      {replacing && <Notice tone="amber" icon="swap-horizontal-outline">{`Replacing “${replacing.displayName}”. It stays in use until the new details are approved, then it is marked no longer valid and every member is told.`}</Notice>}
      <Notice tone="neutral" icon="lock-closed-outline">Never enter a PIN, password or OTP here. ChamaHub only needs the details members pay to.</Notice>
      <T variant="label" style={{ marginBottom: space.xs }}>Type</T>
      <Chips value={type} onChange={setType} options={DESTINATION_TYPES.map((t) => ({ value: t, label: DESTINATION_LABELS.type[t] }))} />
      <Field label="Name members will see" value={f.displayName} onChangeText={set('displayName')} placeholder={type === 'PAYBILL' ? 'e.g. Upendo Paybill' : type === 'PERSONAL_MPESA' ? 'e.g. Treasurer’s M-Pesa (Joyce)' : 'e.g. Equity group account'} />
      {['BANK_ACCOUNT', 'OTHER_MOBILE_MONEY', 'PROVIDER', 'BANK_TRANSFER'].includes(type) && <Field label={type === 'BANK_ACCOUNT' || type === 'BANK_TRANSFER' ? 'Bank' : 'Provider'} value={f.provider} onChangeText={set('provider')} />}
      {needsNumber && <Field label={NUMBER_LABEL[type]!} value={f.accountNumber} onChangeText={set('accountNumber')} keyboardType={type === 'BANK_ACCOUNT' ? 'default' : 'number-pad'} />}
      {type === 'PAYBILL' && <Field label="Account number members enter" value={f.accountReference} onChangeText={set('accountReference')} hint="e.g. UPENDO-<your phone>. Matching uses it to recognise members." autoCapitalize="characters" />}
      {['PERSONAL_MPESA', 'OTHER_MOBILE_MONEY', 'BANK_ACCOUNT', 'PAYBILL', 'TILL'].includes(type) && <Field label="Registered name members will see when paying" value={f.accountName} onChangeText={set('accountName')} autoCapitalize="characters" hint="Members check this name before confirming on M-Pesa." />}
      {type === 'BANK_ACCOUNT' && <Field label="Branch" value={f.branch} onChangeText={set('branch')} />}
      <Field label={['BANK_TRANSFER', 'PROVIDER', 'OTHER', 'CASH'].includes(type) ? 'How members should pay' : 'Extra instructions (optional)'} value={f.instructions} onChangeText={set('instructions')} multiline />
      <Section title="Use for">
        <View style={{ padding: space.lg }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {USES.map((u) => <Button key={u.value} title={`${uses.includes(u.value) ? '✓ ' : ''}${u.label}`} variant={uses.includes(u.value) ? 'primary' : 'secondary'} onPress={() => setUses((x) => (x.includes(u.value) ? x.filter((y) => y !== u.value) : [...x, u.value]))} />)}
          </View>
          <T variant="small" style={{ marginTop: space.xs }}>Leave all unselected to accept any payment.</T>
        </View>
      </Section>
      <T variant="label" style={{ marginBottom: space.xs }}>How payments here are confirmed</T>
      <Chips value={verification} onChange={setVerification} options={[{ value: 'MANUAL_REVIEW', label: 'Officer checks each one' }, { value: 'STATEMENT_IMPORT', label: 'Imported statements' }]} />
      {members.data && (
        <>
          <T variant="label" style={{ marginBottom: space.xs }}>Responsible officer</T>
          <Chips value={responsible} onChange={setResponsible} options={members.data.filter((m) => m.role !== 'MEMBER').map((m) => ({ value: m.membershipId, label: m.fullName }))} />
        </>
      )}
      <Field label="Reason (kept in the audit log)" value={f.reason} onChangeText={set('reason')} placeholder={replacing ? 'e.g. New treasurer elected at the AGM' : 'e.g. Group Paybill opened'} />
      <Button title="Send for approval" onPress={() => submit.mutate(undefined)} loading={submit.isPending} disabled={f.displayName.trim().length < 3 || f.reason.trim().length < 5 || (needsNumber && !f.accountNumber.trim())} />
    </Screen>
  );
}
