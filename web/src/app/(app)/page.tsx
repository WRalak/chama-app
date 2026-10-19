'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { platformRoleHas } from '@chamahub/shared';
import { LoadingRows } from '@/components/ui/states';
import { useMe, useMyGroups } from '@/lib/session';

/** Sends officers to their first group they manage, platform staff to the platform overview. */
export default function Home() {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: groups } = useMyGroups();
  useEffect(() => {
    if (!me || !groups) return;
    const managed = groups.find((g) => g.role !== 'MEMBER') ?? groups[0];
    if (managed) router.replace(`/g/${managed.groupId}/overview`);
    else if (platformRoleHas(me.platformRole, 'platform.view_stats')) router.replace('/platform');
    else if (platformRoleHas(me.platformRole, 'platform.support')) router.replace('/platform/support');
    else router.replace('/chamas');
  }, [me, groups, router]);
  return <LoadingRows rows={4} />;
}
