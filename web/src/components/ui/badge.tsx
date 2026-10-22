import { AlertCircle, ArrowUturnLeftIcon, Ban, CalendarDays, CheckCircle2, Circle, Clock, FileText, Flag, Info, MinusCircle, Send, Sparkles, XCircle } from './badge-icons';
import { cn } from '@/lib/utils';

const tones = {
  neutral: { cls: 'bg-[#F8F0F4] text-[#5E4A5A]', icon: Circle },
  green: { cls: 'bg-success-50 text-success-ink', icon: CheckCircle2 },
  amber: { cls: 'bg-pending-50 text-pending-ink', icon: Clock },
  red: { cls: 'bg-danger-50 text-danger-ink', icon: AlertCircle },
  blue: { cls: 'bg-[#F6EEF5] text-plum-600', icon: Info },
  rose: { cls: 'bg-blush text-berry', icon: Sparkles },
  navy: { cls: 'bg-plum text-white', icon: null },
} as const;
export type Tone = keyof typeof tones;

/** A small status pill. Tone colours always come with an icon and words, never colour alone. */
export function Badge({ tone = 'neutral', children, className, icon = true }: { tone?: Tone; children: React.ReactNode; className?: string; icon?: boolean | React.ComponentType<{ className?: string }> }) {
  const t = tones[tone];
  const Icon = typeof icon === 'function' ? icon : icon ? t.icon : null;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold', t.cls, className)}>
      {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  CONFIRMED: 'green', PAID: 'green', APPROVED: 'green', COMPLETED: 'green', ACTIVE: 'green', REPAID: 'green', DISBURSED: 'blue', MATCHED: 'green', HELD: 'green', RESOLVED: 'green', VALIDATED: 'green', COMMITTED: 'green', SUCCEEDED: 'green', PRESENT: 'green', READY: 'green', CLOSED: 'neutral',
  PENDING: 'amber', PENDING_APPROVAL: 'amber', PARTIAL: 'amber', DUE: 'amber', COLLECTING: 'amber', READINESS_CHECK: 'amber', AWAITING_APPROVAL: 'amber', PROCESSING: 'blue', UNMATCHED: 'amber', OUTSTANDING: 'amber', TRIALING: 'blue', SCHEDULED: 'neutral', UPCOMING: 'neutral', DRAFT: 'neutral', OPEN: 'amber', CONFIRMED_RSVP: 'green', APOLOGY: 'amber', REVIEWING: 'amber', REPORTED: 'blue',
  FAILED: 'red', REVERSED: 'red', REJECTED: 'red', OVERDUE: 'red', DISPUTED: 'red', DEFAULTED: 'red', HAS_ERRORS: 'red', SUSPENDED: 'red', CANCELLED: 'neutral', EXITED: 'neutral', WAIVED: 'neutral', DISCARDED: 'neutral', IGNORED: 'neutral', DEFERRED: 'neutral', PAST_DUE: 'red', ABSENT: 'red', DECLINED: 'neutral', EXPIRED: 'neutral', REVOKED: 'neutral', DUPLICATE: 'red', RETIRED: 'neutral',
};

/** Plain-language names: a reported payment is not a confirmed one. */
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Awaiting verification', REPORTED: 'Reported', PENDING_APPROVAL: 'Awaiting approval', AWAITING_APPROVAL: 'Awaiting approval', READINESS_CHECK: 'Readiness check',
  PROCESSING: 'Sent, confirming', PARTIAL: 'Part paid', READY: 'Fully collected', HAS_ERRORS: 'Has errors', PAST_DUE: 'Past due',
};

const STATUS_ICON: Partial<Record<string, React.ComponentType<{ className?: string }>>> = {
  REVERSED: ArrowUturnLeftIcon, DISPUTED: Flag, CANCELLED: XCircle, WAIVED: MinusCircle, REVOKED: Ban, SCHEDULED: CalendarDays, UPCOMING: CalendarDays, PROCESSING: Send, DISBURSED: Send, REPORTED: FileText,
};

export function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status.charAt(0) + status.slice(1).replace(/_/g, ' ').toLowerCase();
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'} icon={STATUS_ICON[status] ?? true}>{label}</Badge>;
}
