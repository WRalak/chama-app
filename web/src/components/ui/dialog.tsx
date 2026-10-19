'use client';

import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-navy/40" />
      <D.Content className={cn('fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-5 shadow-xl focus:outline-none', className)}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <D.Title className="text-base font-semibold text-navy">{title}</D.Title>
            {description ? <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="rounded p-1 text-muted hover:bg-canvas" aria-label="Close">
            <X className="h-4 w-4" />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}

/** Right-hand detail drawer for records. */
export function Sheet({ open, onOpenChange, title, subtitle, children, width = 'max-w-xl' }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; subtitle?: React.ReactNode; children: React.ReactNode; width?: string }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-navy/20" />
        <D.Content className={cn('fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-drawer focus:outline-none', width)}>
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <D.Title className="truncate text-base font-semibold text-navy">{title}</D.Title>
              <D.Description asChild>
                <div className="mt-0.5 text-sm text-muted">{subtitle ?? ' '}</div>
              </D.Description>
            </div>
            <D.Close className="rounded p-1 text-muted hover:bg-canvas" aria-label="Close">
              <X className="h-4 w-4" />
            </D.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
