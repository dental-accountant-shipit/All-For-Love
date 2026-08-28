/**
 * What each role may do.
 *
 * Pure and testable, and deliberately duplicated in `firestore.rules` — the
 * rules are the real enforcement, this is what stops the interface offering a
 * button that would be refused. If the two ever disagree, the rules win and
 * this file is the bug.
 *
 * Roles arrive as a Firebase custom claim, not as a document, so a rule
 * evaluation never costs a read.
 */

import type { Role } from '../../domain/types';

export type Capability =
  | 'viewProjects'
  | 'createProject'
  | 'editBudget'
  | 'startRevision'
  | 'approveBudget'
  | 'recordCommitment'
  | 'recordCost'
  | 'manageSuppliers'
  | 'viewProfit'
  | 'viewCommission'
  | 'editCommission'
  | 'recordClientApproval'
  | 'adminImport'
  /** Invite people and set what they may do. The one that can grant itself. */
  | 'manageUsers';

const DIRECTOR: Capability[] = [
  'viewProjects',
  'createProject',
  'editBudget',
  'startRevision',
  'approveBudget',
  'recordCommitment',
  'recordCost',
  'manageSuppliers',
  'viewProfit',
  'viewCommission',
  'editCommission',
  'recordClientApproval',
];

const MATRIX: Record<Role, Capability[]> = {
  // Everything a director does, and the two things that are about the system
  // rather than about events: who may use it, and loading a past project from
  // a workbook.
  owner: [...DIRECTOR, 'manageUsers', 'adminImport'],
  director: DIRECTOR,
  producer: [
    'viewProjects',
    'createProject',
    'editBudget',
    'startRevision',
    'recordCommitment',
    'recordCost',
    'manageSuppliers',
    'viewProfit',
    'recordClientApproval',
  ],
  finance: [
    'viewProjects',
    'recordCommitment',
    'recordCost',
    'manageSuppliers',
    'viewProfit',
    'viewCommission',
  ],
  viewer: ['viewProjects'],
  // Admin exists for the import pathway alone. It is deliberately not a
  // superset of director: the import runs server-side through a Cloud
  // Function, and no admin can edit a budget through the application.
  admin: ['viewProjects', 'adminImport'],
};

export function can(role: Role | null, capability: Capability): boolean {
  if (!role) return false;
  return MATRIX[role]?.includes(capability) ?? false;
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  director: 'Director',
  producer: 'Producer',
  finance: 'Finance',
  viewer: 'Viewer',
  admin: 'Administrator (retired)',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Everything, and decides who else may do what.',
  director: 'Everything, including commission and margin.',
  producer: 'Project financials and budgets. Does not see commission.',
  finance: 'Costs, suppliers and billing. Does not edit budgets.',
  viewer: 'Assigned projects. No profit figures.',
  admin: 'Retired. The workbook import only; could not read a budget.',
};

/** The roles that may be given out. 'admin' is retired and not offered. */
export const ASSIGNABLE_ROLES: Role[] = ['owner', 'director', 'producer', 'finance', 'viewer'];

/** Every role the system understands, including the retired one. */
export const ALL_ROLES: Role[] = [...ASSIGNABLE_ROLES, 'admin'];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ALL_ROLES as string[]).includes(value);
}
