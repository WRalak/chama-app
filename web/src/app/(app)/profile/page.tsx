'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { formatKenyanPhone, LOCALE_CODES, LOCALES, passwordSchema, type IntegrationStatus, type NotificationPreferences, type SessionInfo } from '@chamahub/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { LoadingRows } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs';
import { api, fileUrl } from '@/lib/api';
import { HelpCenter } from '@/components/domain/help-center';
import { useAction } from '@/lib/hooks';
import { useMe } from '@/lib/session';
import { date, dateTime } from '@/lib/utils';

const CHANNELS: [keyof NotificationPreferences, string, keyof IntegrationStatus][] = [['sms', 'SMS', 'sms'], ['whatsapp', 'WhatsApp', 'whatsapp'], ['email', 'Email', 'email']];
const TOPICS: [keyof NotificationPreferences, string][] = [['contributionReminders', 'Contribution reminders'], ['loanReminders', 'Loan repayment reminders'], ['meetingReminders', 'Meeting reminders'], ['announcements', 'Group announcements']];

function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2.5">
      <span><span className="block text-sm text-plum">{label}</span>{description && <span className="block text-xs text-muted">{description}</span>}</span>
      <input type="checkbox" role="switch" className="h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-line transition before:block before:h-4 before:w-4 before:translate-x-0.5 before:rounded-full before:bg-white before:shadow before:transition checked:bg-rose checked:before:translate-x-[18px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose disabled:opacity-50" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** The signed-in person's own account: details, security, notifications, privacy and help. Same settings as the mobile app. */
export default function ProfilePage() {
  const me = useMe();
  return (
    <>
      <PageHeader title="Profile & security" description={me.data ? `${me.data.fullName} · ${formatKenyanPhone(me.data.phone)}` : undefined} />
      {!me.data ? <LoadingRows /> : (
        <Tabs defaultValue="personal">
          <TabsList tabs={[{ value: 'personal', label: 'Personal details' }, { value: 'security', label: 'Security' }, { value: 'notifications', label: 'Notifications' }, { value: 'privacy', label: 'Privacy' }, { value: 'help', label: 'Help' }]} />
          <TabsContent value="personal"><Personal /></TabsContent>
          <TabsContent value="security"><Security /></TabsContent>
          <TabsContent value="notifications"><Notifications /></TabsContent>
          <TabsContent value="privacy"><Privacy /></TabsContent>
          <TabsContent value="help"><Help /></TabsContent>
        </Tabs>
      )}
    </>
  );
}

function Personal() {
  const { data: me } = useMe();
  const [fullName, setFullName] = useState(me!.fullName);
  const [email, setEmail] = useState(me!.email ?? '');
  const [locale, setLocale] = useState(me!.locale ?? 'en');
  const save = useAction(() => api('me', { method: 'PATCH', body: { fullName: fullName.trim(), email: email.trim() || null, locale } }), { success: 'Your details were saved', invalidate: [['me']] });
  return (
    <Panel className="max-w-xl">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <Field label="Full name" htmlFor="p-name"><Input id="p-name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        <Field label="Phone number" htmlFor="p-phone" hint="Your phone number is your sign-in. Contact support to change it."><Input id="p-phone" value={formatKenyanPhone(me!.phone)} disabled /></Field>
        <Field label="Email (optional)" htmlFor="p-email"><Input id="p-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Language / Lugha" htmlFor="p-lang" hint="Menus and statuses are translated first; more of the app follows. Kiswahili text is being reviewed.">
          <Select id="p-lang" value={locale} onChange={(e) => setLocale(e.target.value)}>
            {LOCALE_CODES.map((l) => <option key={l} value={l}>{LOCALES[l].nativeName}</option>)}
          </Select>
        </Field>
        <Button type="submit" loading={save.isPending} disabled={fullName.trim().length < 3}>Save</Button>
      </form>
    </Panel>
  );
}

function Security() {
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<SessionInfo[]>('auth/sessions') });
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const pw = passwordSchema.safeParse(next);
  const change = useAction(() => api('auth/password/change', { body: { currentPassword: current, newPassword: next } }), { success: 'Password changed. Other devices were signed out.', invalidate: [['sessions']], onSuccess: () => { setCurrent(''); setNext(''); } });
  const revoke = useAction((id: string) => api(`auth/sessions/${id}`, { method: 'DELETE' }), { success: 'Device signed out', invalidate: [['sessions']] });
  const revokeOthers = useAction(() => api('auth/sessions/revoke-others', { method: 'POST' }), { success: 'Other devices were signed out', invalidate: [['sessions']] });
  return (
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <Panel title="Change password">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); change.mutate(undefined); }}>
          <Field label="Current password" htmlFor="s-cur"><Input id="s-cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
          <Field label="New password" htmlFor="s-new" error={next && !pw.success ? pw.error.issues[0].message : undefined} hint="At least 8 characters, including a letter and a number."><Input id="s-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <Button type="submit" loading={change.isPending} disabled={!current || !pw.success}>Change password</Button>
        </form>
      </Panel>
      <Panel title="Signed-in devices" actions={(sessions.data?.length ?? 0) > 1 ? <Button size="sm" variant="ghost" onClick={() => revokeOthers.mutate(undefined)}>Sign out others</Button> : null} flush>
        {!sessions.data ? <LoadingRows rows={3} /> : (
          <ul className="divide-y divide-line">
            {sessions.data.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate text-plum">{s.deviceName ?? 'Unknown device'} {s.current && <Badge tone="green">This device</Badge>}</span>
                  <span className="text-xs text-muted">Last used {dateTime(s.lastUsedAt)}{s.ipAddress ? ` · ${s.ipAddress}` : ''}</span>
                </span>
                {!s.current && <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>Sign out</Button>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Notifications() {
  const { data: me } = useMe();
  const status = useQuery({ queryKey: ['integrations'], queryFn: () => api<IntegrationStatus>('integrations/status'), staleTime: 5 * 60_000 });
  const save = useAction((p: NotificationPreferences) => api('me/preferences', { method: 'PUT', body: p }), { invalidate: [['me']] });
  const prefs = save.variables ?? me!.preferences;
  const set = (k: keyof NotificationPreferences, v: boolean) => save.mutate({ ...prefs, [k]: v });
  return (
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <Panel title="Channels">
        <p className="mb-1 text-xs text-muted">In-app notifications are always on. Choose how else we reach you.</p>
        <div className="divide-y divide-line">
          {CHANNELS.map(([k, label, integ]) => {
            const off = status.data && !status.data[integ].configured;
            return <Toggle key={k} label={label} description={off ? 'Not yet available on ChamaHub' : undefined} checked={!!prefs[k]} onChange={(v) => set(k, v)} />;
          })}
          <Toggle label="Push notifications (mobile app)" checked={!!prefs.push} onChange={(v) => set('push', v)} />
        </div>
      </Panel>
      <Panel title="What to send">
        <div className="divide-y divide-line">{TOPICS.map(([k, label]) => <Toggle key={k} label={label} checked={!!prefs[k]} onChange={(v) => set(k, v)} />)}</div>
        <p className="mt-2 text-xs text-muted">Payment confirmations, loan decisions and invitations are always sent.</p>
      </Panel>
    </div>
  );
}

function Privacy() {
  const { data: me } = useMe();
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const prefs = useAction((hide: boolean) => api('me/preferences', { method: 'PUT', body: { ...me!.preferences, hidePhoneFromMembers: hide } }), { invalidate: [['me']] });
  const request = useAction(() => api('me/deletion-request', { body: { reason: reason.trim() || undefined } }), { success: 'Deletion requested. Our team will contact you.', invalidate: [['me']] });
  const cancel = useAction(() => api('me/deletion-request', { method: 'DELETE' }), { success: 'Deletion request cancelled', invalidate: [['me']] });
  useEffect(() => setConfirming(false), [me?.deletionRequestedAt]);
  return (
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <Panel title="Who sees what">
        <Toggle label="Hide my phone number from ordinary members" description="Officers of your groups can always see it." checked={prefs.variables ?? me!.preferences.hidePhoneFromMembers} onChange={(v) => prefs.mutate(v)} />
        <p className="mt-2 text-xs text-muted">Members cannot see each other’s balances unless your group turns this on. ChamaHub staff cannot see group finances unless your chairperson approves a time-limited, audited support request.</p>
      </Panel>
      <Panel title="Download my data">
        <p className="text-sm text-muted">A copy of everything ChamaHub holds about you — your profile, memberships, your own payments and loans, notifications, devices and AI conversations — as a JSON file. Other members’ records are not included.</p>
        <Button asChild variant="secondary" className="mt-3"><a href={fileUrl('me/export')} download>Download my data</a></Button>
      </Panel>
      <Panel title="Delete my account">
        {me!.deletionRequestedAt ? (
          <div className="space-y-3">
            <p className="text-sm text-plum">You asked to delete your account on {date(me!.deletionRequestedAt)}. Our team will contact you.</p>
            <Button variant="secondary" onClick={() => cancel.mutate(undefined)} loading={cancel.isPending}>Cancel deletion request</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">Your personal details will be removed. Group financial records you were part of must be kept for your Chamas’ books, so they are anonymised rather than deleted. Settle any loans first.</p>
            <Field label="Reason (optional)" htmlFor="del-reason"><Input id="del-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            {confirming ? (
              <div className="flex gap-2">
                <Button variant="danger" onClick={() => request.mutate(undefined)} loading={request.isPending}>Yes, request deletion</Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>Keep my account</Button>
              </div>
            ) : <Button variant="danger" onClick={() => setConfirming(true)}>Request account deletion</Button>}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Help() {
  return (
    <div className="space-y-3">
      <HelpCenter />
      <p className="text-xs text-muted">
        Read our <a href="/privacy" target="_blank" className="text-berry hover:underline">Privacy Policy</a> and <a href="/terms" target="_blank" className="text-berry hover:underline">Terms of Use</a>.
      </p>
    </div>
  );
}
