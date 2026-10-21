import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { GroupSettingsInput, LABELS, parseKes, Permission } from '@chamahub/shared';
import { Button, Chips, Field, KV, Loading, Notice, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { askToConfirm } from '@/lib/confirm';
import { kes } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { colors, space } from '@/theme';

/** Every member can read the group's rules; officers with group.configure change them (audited). */
export default function GroupSettings() {
  const { groupId, group, can } = useGroupAccess();
  const editable = can(Permission.GROUP_CONFIGURE);
  const [s, setS] = useState<GroupSettingsInput | null>(null);
  const [fine, setFine] = useState('');
  useEffect(() => {
    if (group.data) {
      setS(group.data.settings);
      setFine(String(group.data.settings.lateContributionFineCents / 100));
    }
  }, [group.data]);
  let fineCents: number | null = null;
  try {
    fineCents = fine === '' ? 0 : parseKes(fine);
  } catch {
    fineCents = null;
  }
  const save = useAct(() => api(`groups/${groupId}`, { method: 'PATCH', body: { settings: { ...s, lateContributionFineCents: fineCents } } }), { invalidate: [['group', groupId], ['group-dashboard', groupId]], successMessage: 'Rules updated. The change is recorded in the audit log.' });
  if (!group.data || !s) return <Screen><Stack.Screen options={{ title: 'Group settings' }} /><Loading /></Screen>;
  const g = group.data;
  const toggle = (label: string, key: 'allowEarlyPayout' | 'holdPayoutWhenRecipientInArrears' | 'membersCanViewMemberBalances', hint: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.md }}>
      <View style={{ flex: 1 }}>
        <T variant="body">{label}</T>
        <T variant="small">{hint}</T>
      </View>
      <Switch value={s[key]} onValueChange={(v) => setS({ ...s, [key]: v })} disabled={!editable} trackColor={{ true: colors.emerald }} accessibilityLabel={label} />
    </View>
  );
  return (
    <Screen keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Group settings' }} />
      {!editable && <Notice tone="neutral">These are your group’s rules. Officers with permission to configure the group can change them.</Notice>}
      <Section title="Group">
        <KV label="Type" value={LABELS.groupType[g.type]} />
        <KV label="Members" value={String(g.memberCount)} />
        {g.registrationNumber && <KV label="Registration" value={g.registrationNumber} />}
        <KV label="Founder" value={g.founderName ?? '—'} last />
      </Section>
      <Section title="Approvals and contributions">
        {editable ? (
          <View style={{ padding: space.lg }}>
            <T variant="label" style={{ marginBottom: 6 }}>Approvals needed for payouts, expenses and distributions</T>
            <Chips value={String(s.requiredFinancialApprovals)} onChange={(v) => setS({ ...s, requiredFinancialApprovals: Number(v) })} options={['1', '2', '3'].map((v) => ({ value: v, label: v }))} />
            <Field label="Grace days before a contribution is overdue" keyboardType="number-pad" value={String(s.graceDays)} onChangeText={(v) => setS({ ...s, graceDays: Number(v.replace(/\D/g, '') || 0) })} />
            <Field label="Automatic late fine (0 = none)" prefix="KES" keyboardType="decimal-pad" value={fine} onChangeText={setFine} error={fineCents === null ? 'Invalid amount' : undefined} />
          </View>
        ) : (
          <>
            <KV label="Approvals for payouts and expenses" value={String(s.requiredFinancialApprovals)} />
            <KV label="Grace days" value={String(s.graceDays)} />
            <KV label="Late fine" value={s.lateContributionFineCents ? kes(s.lateContributionFineCents) : 'None'} last />
          </>
        )}
      </Section>
      <Section title="Payouts">
        <View style={{ padding: space.lg, paddingBottom: 0 }}>
          <T variant="label" style={{ marginBottom: 6 }}>If a round is not fully collected</T>
          <Chips value={s.missedContributionPolicy} onChange={(v) => editable && setS({ ...s, missedContributionPolicy: v })} options={[{ value: 'PAY_CONFIRMED_WITH_REASON', label: 'Pay confirmed amount, with reason' }, { value: 'HOLD_UNTIL_COMPLETE', label: 'Hold until fully collected' }]} />
        </View>
        {toggle('Allow early payouts', 'allowEarlyPayout', 'Pay a round before its scheduled date')}
        {toggle('Hold payout while recipient is in arrears', 'holdPayoutWhenRecipientInArrears', 'Overdue contributions, fines or loan installments')}
      </Section>
      <Section title="Privacy">{toggle('Members can see each other’s balances', 'membersCanViewMemberBalances', 'Officers always can')}</Section>
      <Section title="Loans">
        <KV label="Loans offered" value={g.loanPolicy.enabled ? 'Yes' : 'No'} />
        {g.loanPolicy.enabled && (
          <>
            <KV label="Interest" value={`${LABELS.interestMethod[g.loanPolicy.interestMethod]} · ${(g.loanPolicy.rateBps / 100).toFixed(2)}%`} />
            <KV label="Maximum installments" value={String(g.loanPolicy.maxInstallments)} />
            <KV label="Approvals required" value={String(g.loanPolicy.requiredApprovals)} last />
          </>
        )}
      </Section>
      {editable && (
        <>
          <Button title="Save rules" onPress={() => askToConfirm('Change the group rules?', 'The new rules apply from now on and the change is recorded with your name.', 'Save', () => save.mutate(undefined))} disabled={fineCents === null} loading={save.isPending} />
          <T variant="small" style={{ marginTop: space.sm }}>Loan policy and role permissions are edited in the web dashboard.</T>
        </>
      )}
    </Screen>
  );
}
