'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LoadingRows } from '@/components/ui/states';
import { useMe, useMyGroups } from '@/lib/session';

/** Sends officers to the first group they manage and members to their own home. (Platform staff use the separate portal at /platform.) */
export default function Home() {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: groups } = useMyGroups();
  useEffect(() => {
    if (!me || !groups) return;
    const managed = groups.find((g) => g.role !== 'MEMBER' || g.specialRoles.length > 0);
    if (managed) router.replace(`/g/${managed.groupId}/overview`);
    else if (groups.length) router.replace('/home');
    else router.replace('/chamas');
  }, [me, groups, router]);
  return <LoadingRows rows={4} />;
}
