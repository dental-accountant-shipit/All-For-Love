import { describe, expect, it } from 'vitest';

import { ALL_ROLES, can, isRole } from '../roles';

describe('roles', () => {
  it('lets a director approve, and nobody else', () => {
    const approvers = ALL_ROLES.filter((r) => can(r, 'approveBudget'));
    expect(approvers).toEqual(['director']);
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
