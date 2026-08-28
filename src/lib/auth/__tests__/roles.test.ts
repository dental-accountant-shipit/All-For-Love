import { describe, expect, it } from 'vitest';

import { ALL_ROLES, ASSIGNABLE_ROLES, can, isRole } from '../roles';

describe('roles', () => {
  it('lets an owner and a director approve, and nobody else', () => {
    const approvers = ALL_ROLES.filter((r) => can(r, 'approveBudget'));
    expect(approvers).toEqual(['owner', 'director']);
  });

  it('keeps commission away from the producer running the project', () => {
    expect(can('producer', 'editBudget')).toBe(true);
    expect(can('producer', 'viewProfit')).toBe(true);
    expect(can('producer', 'viewCommission')).toBe(false);
    expect(can('producer', 'editCommission')).toBe(false);
  });

  it('lets finance record money without editing budgets', () => {
    expect(can('finance', 'recordCost')).toBe(true);
    expect(can('finance', 'recordCommitment')).toBe(true);
    expect(can('finance', 'editBudget')).toBe(false);
  });

  it('shows a viewer projects and no profit', () => {
    expect(can('viewer', 'viewProjects')).toBe(true);
    expect(can('viewer', 'viewProfit')).toBe(false);
    expect(can('viewer', 'editBudget')).toBe(false);
  });

  it('does not make admin a superset — the import pathway only', () => {
    // Admin exists for migration. It must never become a way to edit a budget
    // or approve history through the application, because the whole point of
    // the import being a separate server-side door is that no client role can
    // reach approved history.
    expect(can('admin', 'adminImport')).toBe(true);
    expect(can('admin', 'editBudget')).toBe(false);
    expect(can('admin', 'approveBudget')).toBe(false);
    expect(can('admin', 'recordCost')).toBe(false);
  });

  it('makes owner everything a director is, plus granting access', () => {
    // Owner is not a fifth kind of user with its own quirks — it is a director
    // who can also decide who else gets in. Anything a director may do and an
    // owner may not would be a bug, and this is the check that says so.
    for (const capability of ['viewProjects', 'editBudget', 'approveBudget', 'recordCost', 'viewCommission', 'editCommission'] as const) {
      expect(can('owner', capability), capability).toBe(can('director', capability));
    }
    expect(can('owner', 'manageUsers')).toBe(true);
    expect(can('director', 'manageUsers')).toBe(false);
  });

  it('is the only role that can grant roles', () => {
    const granters = ALL_ROLES.filter((r) => can(r, 'manageUsers'));
    expect(granters).toEqual(['owner']);
  });

  it('is the only role that can destroy a project', () => {
    // Everything else in this system refuses to delete. This is the one
    // exception, and it is not spread across everyone who can edit a budget.
    expect(ALL_ROLES.filter((r) => can(r, 'deleteProject'))).toEqual(['owner']);
    expect(can('director', 'deleteProject')).toBe(false);
  });

  it('does not offer the retired admin role when granting access', () => {
    // 'admin' still works as a claim so nobody is locked out mid-migration,
    // but it must not be something a person can be newly made.
    expect(ASSIGNABLE_ROLES).not.toContain('admin');
    expect(ASSIGNABLE_ROLES).toContain('owner');
  });

  it('gives an account with no role nothing at all', () => {
    expect(can(null, 'viewProjects')).toBe(false);
    expect(can(null, 'editBudget')).toBe(false);
  });

  it('rejects anything that is not a role', () => {
    expect(isRole('director')).toBe(true);
    expect(isRole('superuser')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
