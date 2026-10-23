'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CURRENCY_CODES, PlatformSettings } from '@chamahub/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';

export default function PlatformSettingsPage() {
  const q = useQuery({ queryKey: ['platform-settings'], queryFn: () => api<PlatformSettings>('platform/settings') });
  const [s, setS] = useState<PlatformSettings | null>(null);
  useEffect(() => setS(q.data ?? null), [q.data]);
  const save = useAction(() => api('platform/settings', { method: 'PATCH', body: s }), { success: 'Platform settings saved and audited', invalidate: [['platform-settings']] });
  if (!s) return <LoadingRows />;
  const toggle = (k: 'smsEnabled' | 'whatsappEnabled' | 'emailEnabled' | 'trialEnabled', label: string, hint: string) => (
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.checked })} /><span>{label}<span className="block text-xs text-muted">{hint}</span></span></label>
  );
  return (
    <>
      <PageHeader title="Feature Settings" description="System-wide configuration. Changes take effect within a minute and are recorded in the security log." actions={<Button onClick={() => save.mutate(undefined)} loading={save.isPending}>Save settings</Button>} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Notification channels">
          <div className="space-y-3">
            {toggle('smsEnabled', 'SMS delivery', 'Turn off to stop all SMS if the provider misbehaves. In-app notifications continue.')}
            {toggle('whatsappEnabled', 'WhatsApp delivery', 'Requires an approved WhatsApp Business account.')}
            {toggle('emailEnabled', 'Email delivery', 'Requires the email relay to be configured.')}
          </div>
        </Panel>
        <Panel title="Access policies">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Longest support access (hours)" htmlFor="ps-h" hint="Chairpersons can approve read-only support access up to this limit."><Input id="ps-h" type="number" min={1} max={72} value={s.maxSupportAccessHours} onChange={(e) => setS({ ...s, maxSupportAccessHours: Number(e.target.value) })} /></Field>
          </div>
        </Panel>
        <Panel title="Subscriptions" className="xl:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {toggle('trialEnabled', 'Free trial for new Chamas', 'New groups start a trial of the plan below.')}
            <Field label="Trial plan code" htmlFor="ps-tp"><Input id="ps-tp" value={s.trialPlanCode} onChange={(e) => setS({ ...s, trialPlanCode: e.target.value.toUpperCase() })} /></Field>
            <Field label="Trial length (days)" htmlFor="ps-t"><Input id="ps-t" type="number" min={0} max={180} value={s.trialDays} onChange={(e) => setS({ ...s, trialDays: Number(e.target.value) })} /></Field>
            <Field label="Grace period after a missed renewal (days)" htmlFor="ps-g" hint="Paid features keep working; then the group moves to Free."><Input id="ps-g" type="number" min={0} max={60} value={s.graceDays} onChange={(e) => setS({ ...s, graceDays: Number(e.target.value) })} /></Field>
            <Field label="Renewal reminders (days before, comma-separated)" htmlFor="ps-r"><Input id="ps-r" value={s.renewalReminderDays.join(', ')} onChange={(e) => setS({ ...s, renewalReminderDays: e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0 && x <= 60).slice(0, 5) })} /></Field>
            <Field label="Reporting currency" htmlFor="ps-rc" hint="Consolidated revenue only; source amounts stay visible."><Select id="ps-rc" value={s.reportingCurrency} onChange={(e) => setS({ ...s, reportingCurrency: e.target.value })}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          </div>
        </Panel>
        <Panel title="Maintenance notice" className="xl:col-span-2">
          <Field label="Shown to all users in the app and dashboard (leave blank for none)" htmlFor="ps-n"><Textarea id="ps-n" rows={2} value={s.maintenanceNotice ?? ''} onChange={(e) => setS({ ...s, maintenanceNotice: e.target.value || null })} placeholder="e.g. M-Pesa payments are delayed. Treasurers can still record cash." /></Field>
        </Panel>
      </div>
    </>
  );
}
