import { cn } from '@/lib/utils';

const tones = {
  neutral: 'bg-slate-100 text-slate-700',
  green: 'bg-forest-50 text-forest',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  blue: 'bg-sky-50 text-sky-700',
  navy: 'bg-navy text-white',
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide', tones[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  CONFIRMED: 'green', PAID: 'green', APPROVED: 'green', COMPLETED: 'green', ACTIVE: 'green', REPAID: 'green', DISBURSED: 'blue', MATCHED: 'green', HELD: 'green', RESOLVED: 'green', VALIDATED: 'green', COMMITTED: 'green', SUCCEEDED: 'green', PRESENT: 'green', READY: 'green',
  PENDING: 'amber', PENDING_APPROVAL: 'amber', PARTIAL: 'amber', DUE: 'amber', COLLECTING: 'amber', UNMATCHED: 'amber', OUTSTANDING: 'amber', TRIALING: 'blue', SCHEDULED: 'neutral', UPCOMING: 'neutral', DRAFT: 'neutral', OPEN: 'amber', CONFIRMED_RSVP: 'green', APOLOGY: 'amber',
  FAILED: 'red', REVERSED: 'red', REJECTED: 'red', OVERDUE: 'red', DISPUTED: 'red', DEFAULTED: 'red', HAS_ERRORS: 'red', SUSPENDED: 'red', CANCELLED: 'neutral', EXITED: 'neutral', WAIVED: 'neutral', DISCARDED: 'neutral', IGNORED: 'neutral', DEFERRED: 'neutral', PAST_DUE: 'red', ABSENT: 'red', DECLINED: 'neutral', EXPIRED: 'neutral', REVOKED: 'neutral', DUPLICATE: 'red',
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{status.replace(/_/g, ' ').toLowerCase()}</Badge>;
}
