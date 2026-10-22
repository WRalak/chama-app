'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CURRENCY_CODES, PlatformPermission, type ProviderHealthRow } from '@chamahub/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { usePlatformCan } from '@/lib/session';
import { dateTime } from '@/lib/utils';

interface RegionRow { countryCode: string; name: string; defaultCurrency: string; defaultTimezone: string; defaultLocale: string; available: boolean; billingAvailable: boolean; notes: string | null; groups: number; launchReady: boolean }
type Availability = { provider: string; countryCode: string; currency: string; methods: string[]; recurring: boolean; refunds: boolean; enabled: boolean };

/** Where ChamaHub operates, and which payment provider serves which country and currency. */
export default function RegionsPage() {
  const can = usePlatformCan();
  const edit = can(PlatformPermission.PLATFORM_CONFIGURE);
  const regions = useQuery({ queryKey: ['regions'], queryFn: () => api<RegionRow[]>('platform/regions') });
  const providers = useQuery({ queryKey: ['billing-providers'], queryFn: () => api<ProviderHealthRow[]>('platform/billing/providers') });
  const [region, setRegion] = useState<Omit<RegionRow, 'groups' | 'launchReady'> | null>(null);
  const [avail, setAvail] = useState<(Availability & { methodsText: string }) | null>(null);
  const saveRegion = useAction(() => api(`platform/regions/${region!.countryCode}`, { method: 'PUT', body: region }), { success: 'Region saved', invalidate: [['regions']], onSuccess: () => setRegion(null) });
  const saveAvail = useAction(() => api('platform/billing/providers/availability', { method: 'PUT', body: { ...avail, methods: avail!.methodsText.split(',').map((m) => m.trim().toUpperCase()).filter(Boolean) } }), { success: 'Availability saved', invalidate: [['billing-providers']], onSuccess: () => setAvail(null) });
  return (
    <>
      <PageHeader title="Regions & payment providers" description="Opening a country also needs legal, tax, privacy and consumer-protection review for that market; these switches only control the software." />
      <Panel title="Regions" flush actions={edit ? <Button size="sm" onClick={() => setRegion({ countryCode: '', name: '', defaultCurrency: 'KES', defaultTimezone: 'Africa/Nairobi', defaultLocale: 'en-KE', available: false, billingAvailable: false, notes: '' })}>Add region</Button> : null}>
        {regions.error ? <ErrorState error={regions.error} onRetry={regions.refetch} /> : !regions.data ? <LoadingRows /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line bg-canvas/60 text-left text-xs text-muted"><th className="px-4 py-2 font-medium">Country</th><th className="px-4 py-2 font-medium">Defaults</th><th className="px-4 py-2 font-medium">New groups</th><th className="px-4 py-2 font-medium">Subscriptions</th><th className="px-4 py-2 font-medium">Groups</th><th /></tr></thead>
              <tbody>{regions.data.map((r) => (
                <tr key={r.countryCode} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5"><span className="font-medium text-plum">{r.name}</span> <span className="text-muted">{r.countryCode}</span>{r.notes && <span className="block text-xs text-muted">{r.notes}</span>}</td>
                  <td className="px-4 py-2.5 text-xs">{r.defaultCurrency} · {r.defaultTimezone} · {r.defaultLocale}{!r.launchReady && <span className="block text-pending-ink">{r.defaultCurrency} not launch-ready</span>}</td>
                  <td className="px-4 py-2.5">{r.available ? <Badge tone="green">Open</Badge> : <Badge tone="neutral">Closed</Badge>}</td>
                  <td className="px-4 py-2.5">{r.billingAvailable ? <Badge tone="green">Sold</Badge> : <Badge tone="neutral">Not sold</Badge>}</td>
                  <td className="px-4 py-2.5 tabular-nums">{r.groups}</td>
                  <td className="px-4 py-2.5 text-right">{edit && <Button size="sm" variant="ghost" onClick={() => setRegion({ countryCode: r.countryCode, name: r.name, defaultCurrency: r.defaultCurrency, defaultTimezone: r.defaultTimezone, defaultLocale: r.defaultLocale, available: r.available, billingAvailable: r.billingAvailable, notes: r.notes ?? '' })}>Edit</Button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-muted">Payment providers</h2>
      {providers.error ? <ErrorState error={providers.error} onRetry={providers.refetch} /> : !providers.data ? <LoadingRows /> : (
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          {providers.data.map((p) => (
            <Panel key={p.code} title={<span className="flex items-center gap-2">{p.name}{p.configured ? <Badge tone={p.environment === 'live' ? 'green' : 'amber'}>{p.environment === 'live' ? 'Configured · live' : 'Configured · test'}</Badge> : <Badge tone="neutral">Not configured</Badge>}</span>} actions={edit ? <Button size="sm" variant="ghost" onClick={() => setAvail({ provider: p.code, countryCode: 'KE', currency: 'KES', methods: [], methodsText: '', recurring: false, refunds: false, enabled: false })}>Add country</Button> : null}>
              <p className="text-sm text-muted">{p.note}</p>
              <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted">Pending</dt><dd>{p.pending}</dd>
                <dt className="text-muted">Paid / failed (7 days)</dt><dd>{p.succeeded7d} / {p.failed7d}</dd>
                <dt className="text-muted">Rejected webhooks (7 days)</dt><dd className={p.rejectedWebhooks7d ? 'text-danger-ink' : ''}>{p.rejectedWebhooks7d}</dd>
                <dt className="text-muted">Last webhook</dt><dd>{p.lastWebhookAt ? dateTime(p.lastWebhookAt) : '—'}</dd>
                <dt className="text-muted">Last successful payment</dt><dd>{p.lastSuccessAt ? dateTime(p.lastSuccessAt) : '—'}</dd>
              </dl>
              {p.availability.length > 0 && (
                <ul className="mt-3 divide-y divide-line rounded-md border border-line text-sm">
                  {p.availability.map((a) => (
                    <li key={`${a.countryCode}-${a.currency}`} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span>{a.countryCode} · {a.currency}<span className="block text-xs text-muted">{a.methods.join(', ')}{a.recurring ? ' · recurring' : ''}{a.refunds ? ' · refunds' : ''}</span></span>
                      <span className="flex items-center gap-2">{a.enabled ? <Badge tone="green" icon={false}>enabled</Badge> : <Badge tone="neutral" icon={false}>off</Badge>}{edit && <Button size="sm" variant="ghost" onClick={() => setAvail({ provider: p.code, ...a, methodsText: a.methods.join(', ') })}>Edit</Button>}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ))}
        </div>
      )}

      <Dialog open={!!region} onOpenChange={(o) => !o && setRegion(null)}>
        {region && (
          <DialogContent title={region.name || 'New region'} description="A region can only open once its currency is launch-ready and, to sell subscriptions, a provider is enabled there.">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Country code" htmlFor="rg-c"><Input id="rg-c" value={region.countryCode} onChange={(e) => setRegion({ ...region, countryCode: e.target.value.toUpperCase().slice(0, 2) })} /></Field>
                <Field label="Name" htmlFor="rg-n"><Input id="rg-n" value={region.name} onChange={(e) => setRegion({ ...region, name: e.target.value })} /></Field>
                <Field label="Currency" htmlFor="rg-cur"><Select id="rg-cur" value={region.defaultCurrency} onChange={(e) => setRegion({ ...region, defaultCurrency: e.target.value })}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
                <Field label="Time zone" htmlFor="rg-tz"><Input id="rg-tz" value={region.defaultTimezone} onChange={(e) => setRegion({ ...region, defaultTimezone: e.target.value })} /></Field>
                <Field label="Language" htmlFor="rg-l"><Input id="rg-l" value={region.defaultLocale} onChange={(e) => setRegion({ ...region, defaultLocale: e.target.value })} /></Field>
              </div>
              <Field label="Notes (legal, tax, payment readiness)" htmlFor="rg-notes"><Textarea id="rg-notes" rows={2} value={region.notes ?? ''} onChange={(e) => setRegion({ ...region, notes: e.target.value })} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[#B83270]" checked={region.available} onChange={(e) => setRegion({ ...region, available: e.target.checked })} />Groups can be created here</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[#B83270]" checked={region.billingAvailable} onChange={(e) => setRegion({ ...region, billingAvailable: e.target.checked })} />Subscriptions are sold here</label>
              <Button onClick={() => saveRegion.mutate(undefined)} loading={saveRegion.isPending} disabled={region.countryCode.length !== 2 || region.name.trim().length < 2}>Save region</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={!!avail} onOpenChange={(o) => !o && setAvail(null)}>
        {avail && (
          <DialogContent title={`${avail.provider} availability`} description="Only enable what the provider supports in that country. Recurring charges are not automated yet; renewals are paid by the group.">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Country code" htmlFor="av-c"><Input id="av-c" value={avail.countryCode} onChange={(e) => setAvail({ ...avail, countryCode: e.target.value.toUpperCase().slice(0, 2) })} /></Field>
                <Field label="Currency" htmlFor="av-cur"><Select id="av-cur" value={avail.currency} onChange={(e) => setAvail({ ...avail, currency: e.target.value })}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
              </div>
              <Field label="Methods (comma-separated)" htmlFor="av-m" hint="e.g. CARD, MPESA, BANK_TRANSFER"><Input id="av-m" value={avail.methodsText} onChange={(e) => setAvail({ ...avail, methodsText: e.target.value })} /></Field>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-[#B83270]" checked={avail.refunds} onChange={(e) => setAvail({ ...avail, refunds: e.target.checked })} />Refunds via API</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-[#B83270]" checked={avail.recurring} onChange={(e) => setAvail({ ...avail, recurring: e.target.checked })} />Supports recurring</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-[#B83270]" checked={avail.enabled} onChange={(e) => setAvail({ ...avail, enabled: e.target.checked })} />Enabled</label>
              </div>
              <Button onClick={() => saveAvail.mutate(undefined)} loading={saveAvail.isPending} disabled={!avail.methodsText.trim() || avail.countryCode.length !== 2}>Save</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
