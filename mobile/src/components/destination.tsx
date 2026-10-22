import { Pressable, View } from 'react-native';
import { DESTINATION_LABELS, PaymentDestinationRow } from '@chamahub/shared';
import { Badge, T } from './ui';
import { date } from '@/lib/format';
import { copy } from '@/lib/share';
import { colors, space } from '@/theme';

const USE: Record<string, string> = { CONTRIBUTION: 'Contributions', LOAN_REPAYMENT: 'Loan repayments', FINE: 'Fines' };

function Copyable({ label, value }: { label: string; value: string }) {
  return (
    <Pressable onPress={() => copy(value.replace(/\s+/g, ''), `${label} copied`)} accessibilityRole="button" accessibilityLabel={`Copy ${label} ${value}`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 }}>
      <View style={{ flex: 1 }}>
        <T variant="small">{label}</T>
        <T variant="label" style={{ fontSize: 18, letterSpacing: 0.5 }}>{value}</T>
      </View>
      <T variant="small" style={{ color: colors.berry, fontWeight: '600' }}>Copy</T>
    </Pressable>
  );
}

/** One place members can pay, with copyable details. Retired destinations are shown greyed out with masked details. */
export function DestinationCard({ d, last, footer }: { d: PaymentDestinationRow; last?: boolean; footer?: React.ReactNode }) {
  const live = d.validNow;
  const numberLabel = d.type === 'PAYBILL' ? 'Paybill number' : d.type === 'TILL' ? 'Till number' : d.type === 'BANK_ACCOUNT' ? 'Account number' : 'Phone number';
  return (
    <View style={{ padding: space.lg, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border, opacity: live || d.status === 'PENDING_APPROVAL' ? 1 : 0.6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <T variant="label">{d.displayName}</T>
          <T variant="small">{`${DESTINATION_LABELS.type[d.type]}${d.provider ? ` · ${d.provider}` : ''}`}</T>
        </View>
        {live ? <Badge label="Pay here" tone="green" /> : d.status === 'PENDING_APPROVAL' ? <Badge label="Awaiting approval" tone="amber" /> : d.status === 'REJECTED' ? <Badge label="Rejected" tone="red" /> : <Badge label="No longer valid" tone="red" />}
      </View>
      {live ? (
        <View style={{ marginTop: space.sm }}>
          {d.accountNumber && <Copyable label={numberLabel} value={d.accountNumber} />}
          {d.accountReference && <Copyable label="Account (enter exactly)" value={d.accountReference} />}
          {d.accountName && <T variant="small">{`Name you should see: ${d.accountName}`}</T>}
          {d.branch && <T variant="small">{`Branch: ${d.branch}`}</T>}
          {d.instructions && <T variant="body" style={{ marginTop: 4 }}>{d.instructions}</T>}
        </View>
      ) : (
        <View style={{ marginTop: 4 }}>
          {d.accountNumber && <T variant="small">{`${numberLabel}: ${d.accountNumber}`}</T>}
          {d.status === 'RETIRED' && <T variant="small" style={{ color: colors.error }}>{`Stopped ${date(d.effectiveTo)}${d.replacedByName ? ` — replaced by ${d.replacedByName}` : ''}. Do not pay here.`}</T>}
          {d.status === 'PENDING_APPROVAL' && d.accountName && <T variant="small">{`Name: ${d.accountName}`}</T>}
        </View>
      )}
      <T variant="small" style={{ marginTop: 4 }}>
        {[d.intendedUse.length ? `For: ${d.intendedUse.map((u) => USE[u]).join(', ')}` : null, d.responsibleName && `Responsible: ${d.responsibleName}`, DESTINATION_LABELS.verification[d.verification]].filter(Boolean).join(' · ')}
      </T>
      {footer}
    </View>
  );
}
