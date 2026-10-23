'use client';

import { PLATFORM_PERMISSION_INFO } from '@chamahub/shared';
import { Badge } from '@/components/ui/badge';
import { KeyValues, PageHeader, Panel } from '@/components/ui/layout-parts';
import { LoadingRows } from '@/components/ui/states';
import { usePlatformMe } from '@/lib/platform-session';
import { dateTime } from '@/lib/utils';

export default function ProfilePage() {
  const me = usePlatformMe();
  if (!me.data) return <Panel><LoadingRows /></Panel>;
  const d = me.data;
  return (
    <>
      <PageHeader title="My Profile" description="Your name, e-mail and roles are managed by an administrator." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Account">
          <KeyValues items={[['Name', d.fullName], ['E-mail', d.email], ['Team', d.team ?? '—'], ['Roles', d.roles.map((r) => r.name).join(', ') || 'None'], ['Two-step sign-in', d.mfaEnabled ? 'On' : 'Off'], ['Last sign-in', d.lastLoginAt ? dateTime(d.lastLoginAt) : '—']]} />
        </Panel>
        <Panel title="What you can do">
          <ul className="flex flex-wrap gap-1">{d.permissions.map((p) => <li key={p}><Badge tone="rose" icon={false}>{PLATFORM_PERMISSION_INFO[p]?.label ?? p}</Badge></li>)}</ul>
          {!d.permissions.length && <p className="text-sm text-muted">No permissions yet.</p>}
        </Panel>
      </div>
    </>
  );
}
