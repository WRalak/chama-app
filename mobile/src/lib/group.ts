import { useLocalSearchParams } from 'expo-router';
import { LABELS, Permission } from '@chamahub/shared';
import { useGroup } from './queries';

/**
 * The caller's membership of the group in the URL. Permissions come from the
 * API for this group only, so a role in one Chama never leaks into another.
 * Hiding a control is a convenience; the API enforces every permission.
 */
export function useGroupAccess() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const group = useGroup(groupId);
  const perms = group.data?.myMembership.permissions ?? [];
  const can = (p: Permission) => perms.includes(p);
  const canAny = (...ps: Permission[]) => ps.some((p) => perms.includes(p));
  const readOnly = !!group.data?.myMembership.specialRoles.includes('READ_ONLY');
  return {
    groupId,
    group,
    can,
    canAny,
    readOnly,
    myMembershipId: group.data?.myMembership.membershipId ?? '',
    roleLabel: group.data ? LABELS.groupRole[group.data.myMembership.role] : '',
  };
}
