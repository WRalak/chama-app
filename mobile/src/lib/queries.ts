import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { Alert } from 'react-native';
import type { GroupDetail, GroupMembershipSummary, PersonalDashboard } from '@chamahub/shared';
import { api, errorText } from './api';

export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => api<PersonalDashboard>('me/dashboard') });
export const useMyGroups = () => useQuery({ queryKey: ['groups'], queryFn: () => api<GroupMembershipSummary[]>('groups') });
export const useGroup = (groupId: string) => useQuery({ queryKey: ['group', groupId], queryFn: () => api<GroupDetail>(`groups/${groupId}`), enabled: !!groupId });

export class OfflineError extends Error {
  constructor() {
    super('You are offline. Nothing was sent or recorded. Try again when you are back online.');
  }
}

/**
 * Every action changes records on the server, so none is queued offline: an
 * action either reaches the server and is recorded there, or visibly fails.
 */
/** False only when the device reports no connection; unknown counts as online. */
export async function isOnline() {
  try {
    return (await Network.getNetworkStateAsync()).isConnected !== false;
  } catch {
    return true;
  }
}

async function requireOnline() {
  try {
    const s = await Network.getNetworkStateAsync();
    if (s.isConnected === false) throw new OfflineError();
  } catch (e) {
    if (e instanceof OfflineError) throw e;
  }
}

/** Mutation with an online check, alert-based error feedback and cache refresh. */
export function useAct<V, R = unknown>(fn: (v: V) => Promise<R>, opts: { invalidate?: unknown[][]; onSuccess?: (r: R) => void; successMessage?: string } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: V) => {
      await requireOnline();
      return fn(v);
    },
    onSuccess: async (r) => {
      await Promise.all((opts.invalidate ?? [['dashboard'], ['groups']]).map((k) => qc.invalidateQueries({ queryKey: k })));
      if (opts.successMessage) Alert.alert('Done', opts.successMessage);
      opts.onSuccess?.(r);
    },
    onError: (e) => Alert.alert(e instanceof OfflineError ? 'You are offline' : 'Something went wrong', errorText(e)),
  });
}
