'use client';

import * as T from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ tabs }: { tabs: { value: string; label: React.ReactNode }[] }) {
  return (
    <T.List className="mb-4 flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <T.Trigger key={t.value} value={t.value} className={cn('-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-navy data-[state=active]:border-forest data-[state=active]:font-medium data-[state=active]:text-navy')}>
          {t.label}
        </T.Trigger>
      ))}
    </T.List>
  );
}
