'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CURRENCY_CODES, OPERATING_COST_CATEGORIES, PlatformPermission, todayInNairobi } from '@chamahub/shared';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Field, Input, Select } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { usePlatformCan } from '@/lib/session';
import { date, money } from '@/lib/utils';

interface Cost { id: string; category: string; description: string; currency: string; amountMinor: number; incurredOn: string; source: string | null; recordedBy: string }
interface Rate { id: string; baseCurrency: string; quoteCurrency: string; rate: string; asOf: string; source: string; createdBy: string }

/** Operating costs and exchange rates used by the revenue report. Both are append-only: correct by adding a new entry. */
export default function FinancePage() {
  const can = usePlatformCan();
  const write = can(PlatformPermission.PLATFORM_MANAGE_FINANCE);
  const today = todayInNairobi();
  const costs = useQuery({ queryKey: ['costs'], queryFn: () => api<Cost[]>('platform/finance/costs') });
  const rates = useQuery({ queryKey: ['rates'], queryFn: () => api<Rate[]>('platform/finance/exchange-rates') });
  const [cost, setCost] = useState({ category: 'INFRASTRUCTURE', description: '', currency: 'USD', amountMinor: undefined as number | undefined, incurredOn: today, source: '' });
  const [rate, setRate] = useState({ baseCurrency: 'USD', quoteCurrency: 'KES', rate: '', asOf: today, source: '' });
  const addCost = useAction(() => api('platform/finance/costs', { body: { ...cost, source: cost.source || undefined } }), { success: 'Cost recorded', invalidate: [['costs'], ['revenue']], onSuccess: () => setCost({ ...cost, description: '', amountMinor: undefined, source: '' }) });
  const addRate = useAction(() => api('platform/finance/exchange-rates', { body: rate }), { success: 'Rate recorded', invalidate: [['rates'], ['revenue']], onSuccess: () => setRate({ ...rate, rate: '', source: '' }) });
  return (
    <>
      <PageHeader title="Costs & exchange rates" description="What the revenue report subtracts and how it converts currencies. Entries cannot be edited or deleted; record a correcting entry instead." />
      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Panel title="Operating costs" flush>
          {write && (
            <form className="grid gap-3 border-b border-line p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); addCost.mutate(undefined); }}>
              <Field label="Category" htmlFor="c-cat"><Select id="c-cat" value={cost.category} onChange={(e) => setCost({ ...cost, category: e.target.value })}>{OPERATING_COST_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ').toLowerCase()}</option>)}</Select></Field>
              <Field label="Date" htmlFor="c-date"><Input id="c-date" type="date" value={cost.incurredOn} max={today} onChange={(e) => setCost({ ...cost, incurredOn: e.target.value })} /></Field>
              <Field label="Description" htmlFor="c-desc" className="sm:col-span-2"><Input id="c-desc" value={cost.description} onChange={(e) => setCost({ ...cost, description: e.target.value })} placeholder="e.g. Database hosting, October" /></Field>
              <Field label="Currency" htmlFor="c-cur"><Select id="c-cur" value={cost.currency} onChange={(e) => setCost({ ...cost, currency: e.target.value })}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <Field label="Amount" htmlFor="c-amt"><MoneyInput id="c-amt" value={cost.amountMinor} onChange={(v) => setCost({ ...cost, amountMinor: v })} /></Field>
              <Field label="Source (invoice no.)" htmlFor="c-src" className="sm:col-span-2"><Input id="c-src" value={cost.source} onChange={(e) => setCost({ ...cost, source: e.target.value })} /></Field>
              <Button type="submit" loading={addCost.isPending} disabled={!cost.amountMinor || cost.description.trim().length < 3}>Record cost</Button>
            </form>
          )}
          <DataTable<Cost> data={costs.data} loading={costs.isLoading} error={costs.error} empty="No costs recorded" columns={[
            { accessorKey: 'incurredOn', header: 'Date', cell: ({ row }) => date(row.original.incurredOn) },
            { accessorKey: 'category', header: 'Category', cell: ({ row }) => row.original.category.replace(/_/g, ' ').toLowerCase() },
            { accessorKey: 'description', header: 'Description', cell: ({ row }) => <span>{row.original.description}<span className="block text-xs text-muted">{row.original.source ?? ''} · {row.original.recordedBy}</span></span> },
            { accessorKey: 'amountMinor', header: 'Amount', meta: { align: 'right' }, cell: ({ row }) => money(row.original.amountMinor, row.original.currency) },
          ]} />
        </Panel>
        <Panel title="Exchange rates" flush>
          {write && (
            <form className="grid gap-3 border-b border-line p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); addRate.mutate(undefined); }}>
              <Field label="1 unit of" htmlFor="r-b"><Select id="r-b" value={rate.baseCurrency} onChange={(e) => setRate({ ...rate, baseCurrency: e.target.value })}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <Field label="equals, in" htmlFor="r-q"><Select id="r-q" value={rate.quoteCurrency} onChange={(e) => setRate({ ...rate, quoteCurrency: e.target.value })}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <Field label="Rate" htmlFor="r-r" hint="Exact decimal, up to 10 places"><Input id="r-r" inputMode="decimal" value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value.replace(/[^\d.]/g, '') })} placeholder="129.45" /></Field>
              <Field label="As of" htmlFor="r-d"><Input id="r-d" type="date" value={rate.asOf} max={today} onChange={(e) => setRate({ ...rate, asOf: e.target.value })} /></Field>
              <Field label="Source" htmlFor="r-s" className="sm:col-span-2"><Input id="r-s" value={rate.source} onChange={(e) => setRate({ ...rate, source: e.target.value })} placeholder="e.g. Central Bank of Kenya indicative rate" /></Field>
              <Button type="submit" loading={addRate.isPending} disabled={!/^\d+(\.\d+)?$/.test(rate.rate) || rate.source.trim().length < 2 || rate.baseCurrency === rate.quoteCurrency}>Record rate</Button>
            </form>
          )}
          <DataTable<Rate> data={rates.data} loading={rates.isLoading} error={rates.error} empty="No rates recorded: consolidated reports leave other currencies out" columns={[
            { accessorKey: 'asOf', header: 'As of', cell: ({ row }) => date(row.original.asOf) },
            { id: 'pair', header: 'Rate', cell: ({ row }) => <span className="tabular-nums">1 {row.original.baseCurrency} = {row.original.rate.replace(/\.?0+$/, '')} {row.original.quoteCurrency}</span> },
            { accessorKey: 'source', header: 'Source', cell: ({ row }) => <span>{row.original.source}<span className="block text-xs text-muted">{row.original.createdBy}</span></span> },
          ]} />
        </Panel>
      </div>
    </>
  );
}
