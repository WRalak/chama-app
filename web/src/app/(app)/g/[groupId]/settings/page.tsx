'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FREQUENCIES, GROUP_TYPES, GroupDetail, GroupSettingsInput, INTEREST_METHODS, IntegrationStatus, LABELS, LoanPolicyInput } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useGroup, useGroupId } from '@/lib/session';
import { dateTime } from '@/lib/utils';

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
    </label>
  );
}

export default function SettingsPage() {
  const groupId = useGroupId();
  const group = useGroup();
  const [profile, setProfile] = useState<Partial<GroupDetail>>({});
  const [settings, setSettings] = useState<GroupSettingsInput | null>(null);
  const [policy, setPolicy] = useState<LoanPolicyInput | null>(null);
  useEffect(() => {
    if (group.data) {
      setProfile(group.data);
      setSettings(group.data.settings);
      setPolicy(group.data.loanPolicy);
    }
  }, [group.data]);
  const integrations = useQuery({ queryKey: ['integrations'], queryFn: () => api<IntegrationStatus>('integrations/status') });
  const grants = useQuery({ queryKey: ['support-grants', groupId], queryFn: () => api<{ id: string; requestedBy: string; purpose: string; hours: number; status: string; expiresAt: string | null; createdAt: string }[]>(`groups/${groupId}/support-access`) });
  const inv = [['group', groupId], ['groups']];
  const save = useAction((body: object) => api(`groups/${groupId}`, { method: 'PATCH', body }), { success: 'Settings saved and recorded in the audit log', invalidate: inv });
  const rotate = useAction((disable: boolean) => api<{ inviteCode: string | null }>(`groups/${groupId}/invite-code`, { method: 'POST', query: { disable: disable || undefined } }), { success: 'Invite code updated', invalidate: inv });
  const decideGrant = useAction(({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) => api(`groups/${groupId}/support-access/${id}/decision`, { body: { decision } }), { success: 'Decision recorded', invalidate: [['support-grants', groupId]] });
  const revokeGrant = useAction((id: string) => api(`groups/${groupId}/support-access/${id}/revoke`, { method: 'POST' }), { success: 'Access revoked', invalidate: [['support-grants', groupId]] });
  if (!group.data || !settings || !policy) return <LoadingRows />;

  return (
    <>
      <PageHeader title="Settings" description="Group profile, contribution rules and loan policy. Every change is audited." />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Group profile" actions={<Button size="sm" onClick={() => save.mutate({ name: profile.name, type: profile.type, description: profile.description ?? undefined, county: profile.county ?? undefined, registrationNumber: profile.registrationNumber ?? undefined })} loading={save.isPending}>Save</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="p-n" className="sm:col-span-2"><Input id="p-n" value={profile.name ?? ''} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
            <Field label="Type" htmlFor="p-t"><Select id="p-t" value={profile.type} onChange={(e) => setProfile({ ...profile, type: e.target.value as GroupDetail['type'] })}>{GROUP_TYPES.map((t) => <option key={t} value={t}>{LABELS.groupType[t]}</option>)}</Select></Field>
            <Field label="County" htmlFor="p-c"><Input id="p-c" value={profile.county ?? ''} onChange={(e) => setProfile({ ...profile, county: e.target.value })} /></Field>
            <Field label="Registration number" htmlFor="p-r"><Input id="p-r" value={profile.registrationNumber ?? ''} onChange={(e) => setProfile({ ...profile, registrationNumber: e.target.value })} /></Field>
            <Field label="Description" htmlFor="p-d" className="sm:col-span-2"><Textarea id="p-d" rows={2} value={profile.description ?? ''} onChange={(e) => setProfile({ ...profile, description: e.target.value })} /></Field>
          </div>
        </Panel>
        <Panel title="Contribution rules & approvals" actions={<Button size="sm" onClick={() => save.mutate({ settings })} loading={save.isPending}>Save</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Approvals needed for expenses, payouts, distributions" htmlFor="s-a"><Input id="s-a" type="number" min={1} max={5} value={settings.requiredFinancialApprovals} onChange={(e) => setSettings({ ...settings, requiredFinancialApprovals: Number(e.target.value) })} /></Field>
            <Field label="Grace period (days) before overdue" htmlFor="s-g"><Input id="s-g" type="number" min={0} max={60} value={settings.graceDays} onChange={(e) => setSettings({ ...settings, graceDays: Number(e.target.value) })} /></Field>
            <Field label="Automatic late-contribution fine" htmlFor="s-f" hint="0 disables automatic fines."><MoneyInput id="s-f" value={settings.lateContributionFineCents} onChange={(v) => setSettings({ ...settings, lateContributionFineCents: v ?? 0 })} /></Field>
            <Field label="M-Pesa account reference prefix" htmlFor="s-p" hint="Used to route paybill payments to this group."><Input id="s-p" value={settings.accountReferencePrefix ?? ''} onChange={(e) => setSettings({ ...settings, accountReferencePrefix: e.target.value.toUpperCase() || null })} /></Field>
            <Field label="Paybill number" htmlFor="s-pb"><Input id="s-pb" value={settings.paybillNumber ?? ''} onChange={(e) => setSettings({ ...settings, paybillNumber: e.target.value || null })} /></Field>
            <div className="sm:col-span-2"><Toggle label="Members can see other members' balances" hint="Off by default. Officers always can." checked={settings.membersCanViewMemberBalances} onChange={(v) => setSettings({ ...settings, membersCanViewMemberBalances: v })} /></div>
            <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted sm:col-span-2">Rotation payouts</p>
            <Field label="If a round is not fully collected" htmlFor="s-mc" className="sm:col-span-2">
              <Select id="s-mc" value={settings.missedContributionPolicy} onChange={(e) => setSettings({ ...settings, missedContributionPolicy: e.target.value as GroupSettingsInput['missedContributionPolicy'] })}>
                <option value="PAY_CONFIRMED_WITH_REASON">Pay what is confirmed, with a recorded reason</option>
                <option value="HOLD_UNTIL_COMPLETE">Hold the payout until the round is fully collected</option>
              </Select>
            </Field>
            <div className="sm:col-span-2"><Toggle label="Allow payouts before the scheduled date" hint="Off by default: a round is paid on or after its date." checked={settings.allowEarlyPayout} onChange={(v) => setSettings({ ...settings, allowEarlyPayout: v })} /></div>
            <div className="sm:col-span-2"><Toggle label="Hold a payout while the recipient is in arrears" hint="Overdue contributions, unpaid fines or overdue loan installments in this group. When off, approvers still see the arrears." checked={settings.holdPayoutWhenRecipientInArrears} onChange={(v) => setSettings({ ...settings, holdPayoutWhenRecipientInArrears: v })} /></div>
            <div className="sm:col-span-2"><Toggle label="Require a Joint Signatory" hint="Expenses, payouts, distributions and loans need one approval from a member holding the Joint Signatory role, on top of the approvals above. Assign the role on the Members page first." checked={settings.requireJointSignatory} onChange={(v) => setSettings({ ...settings, requireJointSignatory: v })} /></div>
          </div>
        </Panel>
        <Panel title="Loan policy" actions={<Button size="sm" onClick={() => save.mutate({ loanPolicy: policy })} loading={save.isPending}>Save</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Toggle label="This group offers loans" checked={policy.enabled} onChange={(v) => setPolicy({ ...policy, enabled: v })} /></div>
            <Field label="Interest method" htmlFor="l-m"><Select id="l-m" value={policy.interestMethod} onChange={(e) => setPolicy({ ...policy, interestMethod: e.target.value as LoanPolicyInput['interestMethod'] })}>{INTEREST_METHODS.map((m) => <option key={m} value={m}>{LABELS.interestMethod[m]}</option>)}</Select></Field>
            <Field label={policy.interestMethod === 'ONE_OFF' ? 'Interest rate (total %)' : 'Interest rate (% per period)'} htmlFor="l-r"><Input id="l-r" type="number" step="0.01" min={0} value={policy.rateBps / 100} onChange={(e) => setPolicy({ ...policy, rateBps: Math.round(Number(e.target.value) * 100) })} /></Field>
            <Field label="Repayment frequency" htmlFor="l-f"><Select id="l-f" value={policy.repaymentFrequency} onChange={(e) => setPolicy({ ...policy, repaymentFrequency: e.target.value as LoanPolicyInput['repaymentFrequency'] })}>{FREQUENCIES.map((f) => <option key={f} value={f}>{LABELS.frequency[f]}</option>)}</Select></Field>
            <Field label="Maximum installments" htmlFor="l-n"><Input id="l-n" type="number" min={1} max={120} value={policy.maxInstallments} onChange={(e) => setPolicy({ ...policy, maxInstallments: Number(e.target.value) })} /></Field>
            <Field label="Limit as multiple of savings" htmlFor="l-x" hint="e.g. 3 = three times confirmed savings. 0 = no limit."><Input id="l-x" type="number" step="0.5" min={0} value={policy.maxMultipleOfSavingsBps / 10000} onChange={(e) => setPolicy({ ...policy, maxMultipleOfSavingsBps: Math.round(Number(e.target.value) * 10000) })} /></Field>
            <Field label="Maximum loan amount" htmlFor="l-max" hint="0 = no fixed cap."><MoneyInput id="l-max" value={policy.maxPrincipalCents} onChange={(v) => setPolicy({ ...policy, maxPrincipalCents: v ?? 0 })} /></Field>
            <Field label="Approvals required" htmlFor="l-a"><Input id="l-a" type="number" min={1} max={5} value={policy.requiredApprovals} onChange={(e) => setPolicy({ ...policy, requiredApprovals: Number(e.target.value) })} /></Field>
            <div className="sm:col-span-2"><Toggle label="Allow officers to approve their own loans" hint="Not recommended. When on, at least one independent officer approval is still required." checked={policy.allowSelfApproval} onChange={(v) => setPolicy({ ...policy, allowSelfApproval: v })} /></div>
          </div>
        </Panel>
        <div className="space-y-5">
          <Panel title="Invite code">
            <p className="text-sm text-muted">Members can join with this code from the mobile app. Rotate it if it was shared too widely.</p>
            <p className="my-3 font-mono text-2xl tracking-widest text-plum">{group.data.inviteCode ?? 'Disabled'}</p>
            <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => rotate.mutate(false)}>New code</Button>{group.data.inviteCode && <Button size="sm" variant="ghost" onClick={() => rotate.mutate(true)}>Disable</Button>}</div>
          </Panel>
          <Panel title="Integrations">
            <ul className="space-y-1.5 text-sm">
              {integrations.data && [
                ['M-Pesa (Daraja)', integrations.data.mpesa.configured],
                ['SMS reminders', integrations.data.sms.configured],
                ['WhatsApp', integrations.data.whatsapp.configured],
                ['Email', integrations.data.email.configured],
              ].map(([k, v]) => <li key={k as string} className="flex justify-between"><span>{k}</span><StatusBadge status={v ? 'ACTIVE' : 'DRAFT'} /></li>)}
            </ul>
            <p className="mt-2 text-xs text-muted">Integrations are configured by the ChamaHub platform team. Until M-Pesa is enabled, officers record payments manually.</p>
          </Panel>
          <Panel title="ChamaHub support access" flush>
            <p className="border-b border-line px-4 py-2 text-xs text-muted">ChamaHub staff cannot see your group’s finances unless you approve a time-limited, read-only request. Every view is audited.</p>
            {grants.data?.length ? (
              <ul className="divide-y divide-line text-sm">
                {grants.data.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <div><p>{g.purpose}</p><p className="text-xs text-muted">{g.requestedBy} · {g.hours}h · {g.expiresAt ? `expires ${dateTime(g.expiresAt)}` : dateTime(g.createdAt)}</p></div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={g.status} />
                      {g.status === 'PENDING' && <><Button size="sm" onClick={() => decideGrant.mutate({ id: g.id, decision: 'APPROVE' })}>Approve</Button><Button size="sm" variant="ghost" onClick={() => decideGrant.mutate({ id: g.id, decision: 'REJECT' })}>Reject</Button></>}
                      {g.status === 'APPROVED' && <Button size="sm" variant="ghost" onClick={() => revokeGrant.mutate(g.id)}>Revoke</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 py-6 text-center text-sm text-muted">No support requests.</p>}
          </Panel>
        </div>
      </div>
    </>
  );
}
