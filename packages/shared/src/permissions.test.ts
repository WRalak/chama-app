import { describe, expect, it } from 'vitest';
import { PRIVILEGED_PLATFORM_PERMISSIONS, resolvePermissions, SYSTEM_PLATFORM_ROLES, ROLE_PERMISSIONS, sanitizeRolePermissions } from './permissions';

describe('Chama role matrix', () => {
  it('follows the separation-of-duties defaults', () => {
    expect(ROLE_PERMISSIONS.TREASURER).toContain('contributions.record');
    expect(ROLE_PERMISSIONS.TREASURER).not.toContain('expenses.approve');
    expect(ROLE_PERMISSIONS.CHAIRPERSON).not.toContain('contributions.record');
    expect(ROLE_PERMISSIONS.SECRETARY).not.toContain('contributions.view_all');
    expect(ROLE_PERMISSIONS.MEMBER).toEqual(expect.arrayContaining(['loans.apply', 'votes.cast']));
    expect(ROLE_PERMISSIONS.AUDITOR).toEqual(expect.arrayContaining(['audit.view', 'findings.raise']));
    expect(ROLE_PERMISSIONS.AUDITOR).not.toContain('contributions.record');
  });

  it('applies group overrides within safeguards', () => {
    const r = sanitizeRolePermissions('AUDITOR', ['group.view', 'contributions.record', 'reports.view']);
    expect(r.rejected).toEqual(['contributions.record']);
    expect(r.permissions).toEqual(expect.arrayContaining(['findings.raise', 'reports.view']));
    const chair = sanitizeRolePermissions('CHAIRPERSON', ['contributions.record']);
    expect(chair.permissions).toEqual(expect.arrayContaining(['permissions.configure', 'group.configure', 'roles.assign', 'contributions.record']));
    expect(sanitizeRolePermissions('MEMBER', ['expenses.record']).rejected).toEqual(['expenses.record']);
  });

  it('adds special-role grants and strips actions for read-only members', () => {
    expect(resolvePermissions('MEMBER', null, ['LOAN_COMMITTEE'])).toContain('loans.approve');
    const ro = resolvePermissions('MEMBER', null, ['READ_ONLY']);
    expect(ro).not.toContain('loans.apply');
    expect(ro).not.toContain('votes.cast');
    expect(ro).toContain('statements.view');
    expect(resolvePermissions('TREASURER', { TREASURER: ['group.view', 'contributions.record'] })).toEqual(['group.view', 'contributions.record']);
  });
});

describe('platform roles', () => {
  const role = (code: string) => SYSTEM_PLATFORM_ROLES.find((r) => r.code === code)!.permissions;
  it('gives helpers and analysts least privilege', () => {
    expect(role('SUPPORT_HELPER')).toEqual(['platform.support', 'platform.request_group_access']);
    expect(role('ANALYST')).toEqual(['platform.view_stats']);
    for (const p of PRIVILEGED_PLATFORM_PERMISSIONS) {
      expect(role('SUPPORT_HELPER')).not.toContain(p);
      // Platform admins manage helpers (which makes their own accounts administrator-class) but hold nothing else privileged.
      if (p !== 'platform.manage_helpers') expect(role('PLATFORM_ADMIN')).not.toContain(p);
    }
    expect(PRIVILEGED_PLATFORM_PERMISSIONS).toContain('platform.manage_helpers');
    expect(role('PLATFORM_ADMIN')).not.toContain('platform.manage_admins');
  });
  it('gives the owner everything', () => {
    expect(role('OWNER')).toEqual(expect.arrayContaining([...PRIVILEGED_PLATFORM_PERMISSIONS, 'platform.manage_helpers', 'platform.view_audit']));
  });
});
