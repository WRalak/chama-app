'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';

/**
 * Confirmation for sensitive actions. When `reason` is required the action cannot run without one;
 * the reason is stored in the audit log.
 */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  danger,
  reason = true,
  onConfirm,
  busy,
}: {
  trigger: (open: () => void) => React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  reason?: boolean;
  onConfirm: (reason: string) => Promise<unknown> | void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const ok = !reason || text.trim().length >= 5;
  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setText(''); }}>
        <DialogContent title={title}>
          <div className="space-y-4">
            <div className="text-sm text-plum">{description}</div>
            {reason && (
              <Field label="Reason (kept in the audit log)" htmlFor="confirm-reason" hint="At least 5 characters">
                <Textarea id="confirm-reason" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                variant={danger ? 'danger' : 'primary'}
                disabled={!ok}
                loading={busy}
                onClick={async () => {
                  try {
                    await onConfirm(text.trim());
                    setOpen(false);
                    setText('');
                  } catch {
                    /* the action's own toast explains the failure; keep the dialog open */
                  }
                }}
              >
                {confirmLabel}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A single-use link shown once, only when e-mail could not be sent. */
export function OneTimeLink({ url, what }: { url: string; what: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-lg border border-pending/40 bg-pending-50 p-3">
      <p className="text-sm font-semibold text-pending-ink">E-mail could not be sent. Share this {what} link yourself.</p>
      <p className="text-xs text-pending-ink">It is shown only now, works once and expires. Send it only to the person, over a secure channel. Do not paste it into tickets or group chats.</p>
      <div className="flex gap-2">
        <input readOnly value={url} className="h-9 min-w-0 flex-1 rounded-md border border-line bg-white px-2 font-mono text-xs text-plum" aria-label={`${what} link`} onFocus={(e) => e.currentTarget.select()} />
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(url).catch(() => undefined);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}
