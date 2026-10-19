'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import type { GroupDetail, GroupMembershipSummary, MeResponse, Permission, PlatformPermission } from '@chamahub/shared';
import { platformRoleHas } from '@chamahub/shared';
import { api } from './api';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('me'), staleTime: 5 * 60_000 });
}

export function useMyGroups() {
  return useQuery({ queryKey: ['groups'], queryFn: () => api<GroupMembershipSummary[]>('groups') });
}

export function useGroupId() {
  const params = useParams<{ groupId?: string }>();
  return params.groupId ?? '';
}

export function useGroup() {
  const groupId = useGroupId();
  return useQuery({ queryKey: ['group', groupId], queryFn: () => api<GroupDetail>(`groups/${groupId}`), enabled: !!groupId });
}

/** Permission check for the active group. The API enforces the same rule; this only hides actions. */
export function useCan() {
  const { data } = useGroup();
  const perms = data?.myMembership.permissions ?? [];
  return (p: Permission) => perms.includes(p);
}

export function usePlatformCan() {
  const { data } = useMe();
  return (p: PlatformPermission) => (data ? platformRoleHas(data.platformRole, p) : false);
}
