'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { AiCard, AiChatResponse, AiLink, AiStatus, AiUsageSummary, Permission } from '@chamahub/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { PageHeader, Panel, StatStrip } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs';
import { api, errorMessage } from '@/lib/api';
import { useCan, useGroupId } from '@/lib/session';
import { dateTime } from '@/lib/utils';

const HREF: Record<AiLink['target'], (g: string, id?: string) => string> = {
  payment: (g) => `/g/${g}/collections`,
  loan: (g) => `/g/${g}/loans`,
  'my-contributions': (g) => `/g/${g}/contributions`,
  contributions: (g) => `/g/${g}/collections`,
  rotation: (g) => `/g/${g}/rotations`,
  payouts: (g) => `/g/${g}/rotations`,
  meeting: (g) => `/g/${g}/meetings`,
  'statement-import': (g) => `/g/${g}/statement-imports`,
  reports: (g) => `/g/${g}/reports`,
  'how-to-pay': (g) => `/g/${g}/payment-destinations`,
  destinations: (g) => `/g/${g}/payment-destinations`,
};

/** Figures from ChamaHub's records, visibly separate from anything the AI wrote. */
function CardView({ card, groupId }: { card: AiCard; groupId: string }) {
  const draft = card.kind === 'DRAFT';
  return (
    <div className={`mt-2 rounded-md border bg-white p-3 ${draft ? 'border-amber-300' : 'border-line'}`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-plum">{card.title}</h4>
        <Badge tone={draft ? 'amber' : 'green'}>{draft ? 'Draft — review before sharing' : 'From records'}</Badge>
      </div>
      <p className="mb-2 text-xs text-muted">{card.period ? `Period ${card.period.from} – ${card.period.to} · ` : ''}read {dateTime(card.asOf)} · source: ChamaHub records</p>
      {card.facts.length > 0 && (
        <dl className="grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-4 gap-y-0.5 text-sm">
          {card.facts.map((f, i) => (
            <div key={i} className="contents"><dt className="text-muted">{f.label}</dt><dd className="tabular-nums">{f.value}</dd></div>
          ))}
        </dl>
      )}
      {card.table && card.table.rows.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr>{card.table.columns.map((c) => <th key={c} className="border-b border-line px-2 py-1 text-left font-semibold text-muted">{c}</th>)}</tr></thead>
            <tbody>{card.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border-b border-line/60 px-2 py-1 tabular-nums">{c}</td>)}</tr>)}</tbody>
          </table>
          {card.table.truncated && <p className="mt-1 text-xs text-muted">Showing the first rows only.</p>}
        </div>
      )}
      {card.text && <pre className="mt-2 whitespace-pre-wrap rounded bg-canvas p-2 font-sans text-sm">{card.text}</pre>}
      {card.notes.filter(Boolean).map((n) => <p key={n} className="mt-1 text-xs text-muted">{n}</p>)}
      <div className="mt-2 flex flex-wrap gap-3">
        {card.text && draft && (
          <>
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(card.text!).then(() => toast.success('Copied'))}>Copy</Button>
            <Button size="sm" variant="secondary" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(card.text!)}`, '_blank')}>Open in WhatsApp</Button>
          </>
        )}
        {card.links.map((l, i) => <Link key={i} href={HREF[l.target](groupId, l.id)} className="text-xs font-medium text-berry hover:underline">{l.label} ›</Link>)}
      </div>
    </div>
  );
}

interface Turn { role: 'user' | 'assistant' | 'records' | 'error'; text: string; cards: AiCard[]; refused: string[] }

function Chat({ status }: { status: AiStatus }) {
  const groupId = useGroupId();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string>();
  const end = useRef<HTMLDivElement>(null);
  const add = (t: Turn) => { setTurns((x) => [...x, t]); setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth' }), 50); };
  const chatOn = status.chatAvailable;

  const quick = async (tool: string, label: string, args?: Record<string, unknown>) => {
    add({ role: 'user', text: label, cards: [], refused: [] });
    setBusy(true);
    try {
      const r = await api<{ cards: AiCard[] }>(`groups/${groupId}/ai/tools/${tool}`, { body: { args: args ?? {} } });
      add({ role: 'records', text: '', cards: r.cards, refused: [] });
    } catch (e) {
      add({ role: 'error', text: errorMessage(e), cards: [], refused: [] });
    } finally {
      setBusy(false);
    }
  };
  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    setDraft('');
    add({ role: 'user', text: q.trim(), cards: [], refused: [] });
    setBusy(true);
    try {
      const r = await api<AiChatResponse>(`groups/${groupId}/ai/chat`, { body: { conversationId, message: q.trim(), locale: 'en' } });
      setConversationId(r.conversationId);
      add({ role: 'assistant', text: r.message.text, cards: r.message.cards, refused: r.message.refused });
    } catch (e) {
      add({ role: 'error', text: errorMessage(e), cards: [], refused: [] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
      <Panel title={<span className="flex items-center gap-2">Conversation <Badge tone={chatOn ? 'green' : 'neutral'}>{chatOn ? 'AI on' : 'Quick answers only'}</Badge></span>} actions={turns.length > 0 && <Button size="sm" variant="ghost" onClick={() => { setTurns([]); setConversationId(undefined); }}>New conversation</Button>}>
        {!chatOn && status.reason && <p className="mb-3 rounded bg-canvas px-3 py-2 text-sm text-muted">{status.reason}</p>}
        {turns.length === 0 && <p className="text-sm text-muted">Ask about this group’s records. Answers use only what your role may see; every figure comes from ChamaHub’s records, and the assistant cannot move money, approve anything or change rules. Conversations are kept for {status.retentionDays} days.</p>}
        <div className="space-y-4" aria-live="polite">
          {turns.map((t, i) => (
            <div key={i} className={t.role === 'user' ? 'flex justify-end' : ''}>
              {t.role === 'user' ? <p className="max-w-[80%] rounded-lg bg-berry px-3 py-2 text-sm text-white">{t.text}</p>
                : t.role === 'error' ? <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{t.text}</p>
                : (
                  <div>
                    {t.role === 'assistant' && (
                      <div className="rounded-lg border border-line bg-white p-3">
                        <p className="mb-1 text-xs font-semibold text-sky-700">AI answer — check it against the records below</p>
                        <p className="whitespace-pre-wrap text-sm">{t.text}</p>
                        {t.refused.length > 0 && <p className="mt-1 text-xs text-muted">Some information was not available to your role.</p>}
                      </div>
                    )}
                    {t.role === 'records' && <p className="text-xs font-semibold text-muted">From the group’s records</p>}
                    {t.cards.map((c, j) => <CardView key={j} card={c} groupId={groupId} />)}
                  </div>
                )}
            </div>
          ))}
          {busy && <p className="text-sm text-muted">Checking the records…</p>}
          <div ref={end} />
        </div>
        {chatOn && (
          <form className="mt-4 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
            <Textarea rows={2} className="min-h-0 flex-1" value={draft} maxLength={2000} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about contributions, payouts, loans, reports…" aria-label="Question for the assistant" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft); } }} />
            <Button type="submit" disabled={!draft.trim() || busy}>Ask</Button>
          </form>
        )}
      </Panel>
      <Panel title={chatOn ? 'Suggested questions' : 'Quick answers'}>
        <ul className="space-y-1.5">
          {status.suggestions.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-2">
              <button className="text-left text-sm text-plum hover:text-berry disabled:opacity-50" disabled={busy} onClick={() => (chatOn ? ask(s.prompt) : quick(s.tool, s.label, s.args))}>{chatOn ? s.prompt : s.label}</button>
              {chatOn && <button className="shrink-0 text-2xs uppercase text-muted hover:text-berry" disabled={busy} onClick={() => quick(s.tool, s.label, s.args)} title="Show the records without the AI">records</button>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">{status.limits.requestsLeftToday ?? '—'} questions left today.</p>
      </Panel>
    </div>
  );
}

function Usage() {
  const groupId = useGroupId();
  const q = useQuery({ queryKey: ['ai-usage', groupId], queryFn: () => api<AiUsageSummary>(`groups/${groupId}/ai/usage`) });
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data) return <LoadingRows rows={3} />;
  const u = q.data;
  return (
    <>
      <StatStrip
        stats={[
          { label: 'Questions this month', value: String(u.requests) },
          { label: 'Failed', value: String(u.failed), tone: u.failed ? 'warning' : 'default' },
          { label: 'Refused by limits', value: String(u.limited) },
          { label: 'Cost (USD)', value: `$${u.costUsd.toFixed(2)} of $${u.budgetUsd.toFixed(2)}`, tone: u.costUsd >= u.budgetUsd ? 'danger' : 'default' },
          { label: 'Tokens in / out', value: `${u.inputTokens.toLocaleString()} / ${u.outputTokens.toLocaleString()}` },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Tool calls" flush>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="px-4 py-2">Tool</th><th>OK</th><th>Not allowed</th><th>Invalid</th><th>Errors</th></tr></thead>
            <tbody>{u.toolCalls.map((t) => <tr key={t.tool} className="border-t border-line"><td className="px-4 py-1.5 font-mono text-xs">{t.tool}</td><td>{t.ok}</td><td>{t.denied}</td><td>{t.invalid}</td><td>{t.error}</td></tr>)}</tbody>
          </table>
          {u.toolCalls.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No tool calls yet this month.</p>}
        </Panel>
        <Panel title="Recent problems" flush>
          {u.recentErrors.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">None this month.</p> : (
            <ul className="divide-y divide-line text-sm">{u.recentErrors.map((e, i) => <li key={i} className="flex justify-between px-4 py-2"><span>{e.status.replace(/_/g, ' ').toLowerCase()}{e.errorCode ? ` · ${e.errorCode}` : ''}</span><span className="text-xs text-muted">{dateTime(e.at)}</span></li>)}</ul>
          )}
        </Panel>
      </div>
      <p className="mt-3 text-xs text-muted">“Not allowed” counts requests for information outside the asker’s role; they were refused by the server. Usage records are kept separately from the group’s financial records.</p>
    </>
  );
}

export default function AssistantPage() {
  const groupId = useGroupId();
  const can = useCan();
  const status = useQuery({ queryKey: ['ai-status', groupId], queryFn: () => api<AiStatus>(`groups/${groupId}/ai/status`) });
  return (
    <>
      <PageHeader title="AI Assistant" description="Answers, summaries and WhatsApp drafts built from the group’s records. Every figure is calculated by ChamaHub; the AI only explains and drafts." />
      {status.error ? <ErrorState error={status.error} onRetry={status.refetch} /> : !status.data ? <LoadingRows rows={4} /> : can(Permission.GROUP_CONFIGURE) ? (
        <Tabs defaultValue="chat">
          <TabsList tabs={[{ value: 'chat', label: 'Assistant' }, { value: 'usage', label: 'Usage & errors' }]} />
          <TabsContent value="chat" className="mt-4"><Chat status={status.data} /></TabsContent>
          <TabsContent value="usage" className="mt-4"><Usage /></TabsContent>
        </Tabs>
      ) : <Chat status={status.data} />}
    </>
  );
}
