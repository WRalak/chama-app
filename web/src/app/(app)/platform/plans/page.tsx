'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { BILLING_INTERVALS, CURRENCY_CODES, type BillingInterval, type Entitlements, FEATURE_LABELS, FEATURES, type Feature, PlatformPermission } from '@chamahub/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { usePlatformCan } from '@/lib/session';
import { cn, date, money } from '@/lib/utils';

interface PriceRow { id: string; countryCode: string; currency: string; interval: BillingInterval; amountMinor: number; active: boolean; updatedAt: string }
interface PlanRow { id: string; code: string; name: string; description: string | null; tier: number; entitlements: Entitlements; active: boolean; isPublic: boolean; subscribers: number; prices: PriceRow[] }
type PlanForm = Omit<PlanRow, 'id' | 'subscribers' | 'prices'>;

/** Plans, what they include, and their prices by country, currency and interval. All changes are audited. */
export default function PlansPage() {
  const can = usePlatformCan();
  const edit = can(PlatformPermission.PLATFORM_MANAGE_PLANS);
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api<PlanRow[]>('platform/plans') });
  const [planForm, setPlanForm] = useState<PlanForm | null>(null);
  const [priceForm, setPriceForm] = useState<null | { planCode: string; countryCode: string; currency: string; interval: BillingInterval; amountMinor: number | undefined; active: boolean }>(null);
  const savePlan = useAction(() => api(`platform/plans/${planForm!.code}`, { method: 'PUT', body: { ...planForm, description: planForm!.description || null } }), { success: 'Plan saved', invalidate: [['platform-plans']], onSuccess: () => setPlanForm(null) });
  const savePrice = useAction(() => api('platform/plan-prices', { method: 'PUT', body: { ...priceForm, amountMinor: priceForm!.amountMinor ?? 0 } }), { success: 'Price saved. New checkouts use it; current subscriptions keep what they paid.', invalidate: [['platform-plans']], onSuccess: () => setPriceForm(null) });
  return (
    <>
      <PageHeader title="Plans & pricing" description="What each plan includes and what it costs, per country and currency. Entitlements are enforced by the API." actions={edit ? <Button onClick={() => setPlanForm({ code: '', name: '', description: '', tier: 40, entitlements: { features: [], limits: { maxMembers: 50 } }, active: false, isPublic: false })}>New plan</Button> : null} />
      <p className="mb-4 rounded-md bg-pending-50 px-3 py-2 text-sm text-pending-ink">The Kenya prices were seeded as placeholders. Confirm them before taking real payments.</p>
      {plans.error ? <ErrorState error={plans.error} onRetry={plans.refetch} /> : !plans.data ? <LoadingRows rows={6} /> : (
        <div className="space-y-4">
          {plans.data.map((p) => (
            <Panel
              key={p.id}
              title={<span className="flex flex-wrap items-center gap-2">{p.name}<span className="font-mono text-xs text-muted">{p.code}</span>{!p.active && <Badge tone="neutral" icon={false}>inactive</Badge>}{p.active && !p.isPublic && <Badge tone="amber" icon={false}>hidden</Badge>}</span>}
              actions={edit ? <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setPlanForm({ code: p.code, name: p.name, description: p.description, tier: p.tier, entitlements: p.entitlements, active: p.active, isPublic: p.isPublic })}>Edit</Button>{p.tier > 0 && <Button size="sm" variant="secondary" onClick={() => setPriceForm({ planCode: p.code, countryCode: 'KE', currency: 'KES', interval: 'MONTH', amountMinor: undefined, active: true })}>Add price</Button>}</div> : null}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="text-sm">
                  {p.description && <p className="mb-2 text-muted">{p.description}</p>}
                  <p>Tier {p.tier} · up to {p.entitlements.limits.maxMembers} members · {p.subscribers} subscription{p.subscribers === 1 ? '' : 's'}</p>
                  <ul className="mt-2 flex flex-wrap gap-1">{p.entitlements.features.length ? p.entitlements.features.map((f) => <Badge key={f} tone="green" icon={false}>{FEATURE_LABELS[f]}</Badge>) : <span className="text-muted">Core features only</span>}</ul>
                </div>
                <div>
                  {p.prices.length === 0 ? <p className="text-sm text-muted">{p.tier === 0 ? 'Free: no price.' : 'No prices: not sold anywhere.'}</p> : (
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-medium">Country</th><th className="py-1 font-medium">Interval</th><th className="py-1 text-right font-medium">Price</th><th /></tr></thead>
                      <tbody>{p.prices.map((r) => (
                        <tr key={r.id} className={cn('border-t border-line', !r.active && 'text-muted line-through')}>
                          <td className="py-1.5">{r.countryCode === '*' ? 'Any other' : r.countryCode}</td>
                          <td>{r.interval === 'YEAR' ? 'Annual' : 'Monthly'}</td>
                          <td className="text-right tabular-nums">{money(r.amountMinor, r.currency)}<span className="block text-2xs text-muted no-underline">updated {date(r.updatedAt)}</span></td>
                          <td className="text-right">{edit && <Button size="sm" variant="ghost" onClick={() => setPriceForm({ planCode: p.code, countryCode: r.countryCode, currency: r.currency, interval: r.interval, amountMinor: r.amountMinor, active: r.active })}>Change</Button>}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  )}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Dialog open={!!planForm} onOpenChange={(o) => !o && setPlanForm(null)}>
        {planForm && (
          <DialogContent title={planForm.name ? `Edit ${planForm.name}` : 'New plan'} description="Saving is audited. Features take effect for every group on this plan within a minute.">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Code" htmlFor="pl-code"><Input id="pl-code" value={planForm.code} disabled={!!plans.data?.some((p) => p.code === planForm.code)} onChange={(e) => setPlanForm({ ...planForm, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} /></Field>
                <Field label="Name" htmlFor="pl-name"><Input id="pl-name" value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} /></Field>
              </div>
              <Field label="Description" htmlFor="pl-desc"><Textarea id="pl-desc" rows={2} value={planForm.description ?? ''} onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tier (higher = more)" htmlFor="pl-tier"><Input id="pl-tier" type="number" min={0} max={100} value={planForm.tier} onChange={(e) => setPlanForm({ ...planForm, tier: Number(e.target.value) })} /></Field>
                <Field label="Member limit" htmlFor="pl-max"><Input id="pl-max" type="number" min={1} value={planForm.entitlements.limits.maxMembers} onChange={(e) => setPlanForm({ ...planForm, entitlements: { ...planForm.entitlements, limits: { maxMembers: Math.max(1, Number(e.target.value) || 1) } } })} /></Field>
              </div>
              <fieldset>
                <legend className="mb-1 text-xs font-medium text-plum">Paid features included</legend>
                <div className="grid grid-cols-2 gap-1.5 text-sm">
                  {FEATURES.map((f: Feature) => (
                    <label key={f} className="flex items-center gap-2">
                      <input type="checkbox" className="accent-[#B83270]" checked={planForm.entitlements.features.includes(f)} onChange={(e) => setPlanForm({ ...planForm, entitlements: { ...planForm.entitlements, features: e.target.checked ? [...planForm.entitlements.features, f] : planForm.entitlements.features.filter((x) => x !== f) } })} />
                      {FEATURE_LABELS[f]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-[#B83270]" checked={planForm.active} onChange={(e) => setPlanForm({ ...planForm, active: e.target.checked })} />Active</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-[#B83270]" checked={planForm.isPublic} onChange={(e) => setPlanForm({ ...planForm, isPublic: e.target.checked })} />Shown to groups</label>
              </div>
              <Button onClick={() => savePlan.mutate(undefined)} loading={savePlan.isPending} disabled={planForm.code.length < 2 || planForm.name.trim().length < 2}>Save plan</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!priceForm} onOpenChange={(o) => !o && setPriceForm(null)}>
        {priceForm && (
          <DialogContent title={`Price for ${priceForm.planCode}`} description="Groups already paying keep their price until they renew. Audited.">
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Country" htmlFor="pp-c" hint="* = any other"><Input id="pp-c" value={priceForm.countryCode} onChange={(e) => setPriceForm({ ...priceForm, countryCode: e.target.value.toUpperCase().slice(0, 2) || '*' })} /></Field>
                <Field label="Currency" htmlFor="pp-cur"><Select id="pp-cur" value={priceForm.currency} onChange={(e) => setPriceForm({ ...priceForm, currency: e.target.value })}>{CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
                <Field label="Interval" htmlFor="pp-i"><Select id="pp-i" value={priceForm.interval} onChange={(e) => setPriceForm({ ...priceForm, interval: e.target.value as BillingInterval })}>{BILLING_INTERVALS.map((i) => <option key={i} value={i}>{i === 'YEAR' ? 'Annual' : 'Monthly'}</option>)}</Select></Field>
              </div>
              <Field label={`Amount (${priceForm.currency})`} htmlFor="pp-a"><MoneyInput id="pp-a" value={priceForm.amountMinor} onChange={(v) => setPriceForm({ ...priceForm, amountMinor: v })} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[#B83270]" checked={priceForm.active} onChange={(e) => setPriceForm({ ...priceForm, active: e.target.checked })} />Active (offered at checkout)</label>
              <Button onClick={() => savePrice.mutate(undefined)} loading={savePrice.isPending} disabled={priceForm.amountMinor === undefined}>Save price</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
