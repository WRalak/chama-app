import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import type { GroupDetail, GroupMembershipSummary, PersonalDashboard } from '@chamahub/shared';
import { api, errorText } from './api';

export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => api<PersonalDashboard>('me/dashboard') });
export const useMyGroups = () => useQuery({ queryKey: ['groups'], queryFn: () => api<GroupMembershipSummary[]>('groups') });
export const useGroup = (groupId: string) => useQuery({ queryKey: ['group', groupId], queryFn: () => api<GroupDetail>(`groups/${groupId}`), enabled: !!groupId });

/** Mutation with alert-based error feedback and cache refresh. */
export function useAct<V, R = unknown>(fn: (v: V) => Promise<R>, opts: { invalidate?: unknown[][]; onSuccess?: (r: R) => void; successMessage?: string } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      await Promise.all((opts.invalidate ?? [['dashboard'], ['groups']]).map((k) => qc.invalidateQueries({ queryKey: k })));
      if (opts.successMessage) Alert.alert('Done', opts.successMessage);
      opts.onSuccess?.(r);
    },
    onError: (e) => Alert.alert('Something went wrong', errorText(e)),
  });
}
