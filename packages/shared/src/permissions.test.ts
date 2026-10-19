import { describe, expect, it } from 'vitest';
import { platformRoleHas, resolvePermissions, ROLE_PERMISSIONS, sanitizeRolePermissions } from './permissions';

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
  it('scopes each platform role', () => {
    expect(platformRoleHas('SUPPORT', 'platform.support')).toBe(true);
    expect(platformRoleHas('SUPPORT', 'platform.view_stats')).toBe(false);
    expect(platformRoleHas('PLATFORM_ADMIN', 'platform.manage_plans')).toBe(true);
    expect(platformRoleHas('PLATFORM_ADMIN', 'platform.manage_admins')).toBe(false);
    expect(platformRoleHas('SUPER_ADMIN', 'platform.manage_admins')).toBe(true);
  });
});
