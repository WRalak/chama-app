'use client';

import { QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MemberRow } from '@chamahub/shared';
import { api, ApiError, errorMessage } from './api';
import { useGroupId } from './session';

/** Mutation with toast feedback and cache invalidation. */
export function useAction<V, R = unknown>(fn: (vars: V) => Promise<R>, opts: { success?: string | ((r: R) => string); invalidate?: QueryKey[]; onSuccess?: (r: R) => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      await Promise.all((opts.invalidate ?? []).map((k) => qc.invalidateQueries({ queryKey: k })));
      opts.onSuccess?.(r);
    },
    onError: (err) => {
      // A paid feature the group's plan does not include: say so and offer the plans page.
      const groupId = typeof window !== 'undefined' ? /^\/g\/([^/]+)/.exec(window.location.pathname)?.[1] : undefined;
      if (err instanceof ApiError && err.status === 402 && groupId) {
        toast.error(errorMessage(err), { action: { label: 'See plans', onClick: () => window.location.assign(`/g/${groupId}/billing`) }, duration: 10_000 });
      } else toast.error(errorMessage(err));
    },
  });
}

export function useMembers(status?: string) {
  const groupId = useGroupId();
  return useQuery({ queryKey: ['members', groupId, status ?? 'current'], queryFn: () => api<MemberRow[]>(`groups/${groupId}/members`, { query: { status } }), enabled: !!groupId });
}
