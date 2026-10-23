'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { allowedNav } from '@/components/platform/platform-shell';
import { EmptyState, LoadingRows } from '@/components/ui/states';
import { usePlatformMe } from '@/lib/platform-session';

/** Opens the first section the signed-in staff member is allowed to use. */
export default function PortalHome() {
  const me = usePlatformMe();
  const router = useRouter();
  const first = me.data ? allowedNav(me.data.permissions).flatMap((s) => s.items).find((i) => !i.href.startsWith('/platform/profile') && !i.href.startsWith('/platform/account-security')) : undefined;
  useEffect(() => {
    if (first) router.replace(first.href);
  }, [first, router]);
  if (me.data && !first) return <EmptyState title="No sections assigned yet" description="Your account has no portal permissions. Ask an administrator to assign you a role." />;
  return <LoadingRows rows={4} />;
}
