/**
 * Taking an approval back.
 *
 * The refusals are the substance here. Withdrawing the newest approval leaves a
 * project in a state it could have reached normally; withdrawing one from the
 * middle leaves every later version pinned to a budget that no longer exists,
 * which is a hole nothing later can be reasoned about across.
 */

import { describe, expect, it } from 'vitest';

import {
  canWithdrawApproval,
  describeWithdrawal,
  previousApproved,
} from '../approvalWithdrawal';
import type { BudgetVersion } from '../types';

const version = (
  versionNo: number,
  status: BudgetVersion['status'],
): BudgetVersion =>
  ({
    id: `v${versionNo}`,
    projectId: 'p1',
    versionNo,
    status,
    note: null,
    approvedBy: status === 'draft' ? null : 'uid_director',
    approvedAt: status === 'draft' ? null : '2026-03-01T00:00:00.000Z',
    supersededAt: status === 'superseded' ? '2026-04-01T00:00:00.000Z' : null,
    clientApproval: {
      status: 'not_sent',
      sentAt: null,
      decidedAt: null,
      method: null,
      reference: null,
      notes: null,
      recordedBy: null,
      recordedAt: null,
    },
    totals: { budgetCost: 0, budgetCostKnown: true, linesWithoutBudget: 0, clientPrice: 0 },
    audit: {
      createdAt: '2026-03-01T00:00:00.000Z',
      createdBy: 'uid_director',
      updatedAt: '2026-03-01T00:00:00.000Z',
      updatedBy: 'uid_director',
    },
  }) satisfies BudgetVersion;

const project = (currentApprovedVersionId: string | null, openDraftVersionId: string | null = null) => ({
  currentApprovedVersionId,
  openDraftVersionId,
});

describe('withdrawing the current approval', () => {
  it('is allowed, and names the version it falls back to', () => {
    const versions = [version(1, 'superseded'), version(2, 'approved')];
    const decision = canWithdrawApproval(versions, project('v2'), 'v2');
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.version.versionNo).toBe(2);
      expect(decision.fallingBackTo?.versionNo).toBe(1);
    }
  });

  it('is allowed on a first approval, falling back to nothing', () => {
    const decision = canWithdrawApproval([version(1, 'approved')], project('v1'), 'v1');
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.fallingBackTo).toBeNull();
  });
});

describe('what it refuses', () => {
  it('refuses a version from the middle of the trail', () => {
    // v1 superseded, v2 current. Removing v1 would leave v2 pinned to lines
    // frozen against a budget that no longer exists.
    const versions = [version(1, 'superseded'), version(2, 'approved')];
    const decision = canWithdrawApproval(versions, project('v2'), 'v1');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/current approved version/i);
  });

  it('refuses while a draft is open', () => {
    // The draft was started from this approval.
    const versions = [version(1, 'approved'), version(2, 'draft')];
    const decision = canWithdrawApproval(versions, project('v1', 'v2'), 'v1');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/open draft/i);
  });

  it('refuses a draft, which is abandoned rather than withdrawn', () => {
    const decision = canWithdrawApproval([version(1, 'draft')], project(null), 'v1');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/never been approved/i);
  });

  it('refuses a version that is not part of the project', () => {
    const decision = canWithdrawApproval([version(1, 'approved')], project('v1'), 'v9');
    expect(decision.allowed).toBe(false);
  });
});

describe('finding the version to fall back to', () => {
  it('takes the highest earlier number, not the most recent write', () => {
    const versions = [version(3, 'approved'), version(1, 'superseded'), version(2, 'superseded')];
    expect(previousApproved(versions, version(3, 'approved'))?.versionNo).toBe(2);
  });

  it('ignores drafts', () => {
    // A draft numbered below an approval should not be mistaken for history.
    const versions = [version(1, 'superseded'), version(2, 'draft'), version(3, 'approved')];
    expect(previousApproved(versions, version(3, 'approved'))?.versionNo).toBe(1);
  });

  it('returns nothing when there is no earlier version', () => {
    expect(previousApproved([version(1, 'approved')], version(1, 'approved'))).toBeNull();
  });
});

describe('saying what will happen', () => {
  it('names both versions when there is one to go back to', () => {
    const decision = canWithdrawApproval(
      [version(1, 'superseded'), version(2, 'approved')],
      project('v2'),
      'v2',
    );
    if (!decision.allowed) throw new Error('should be allowed');
    const said = describeWithdrawal(decision);
    expect(said).toContain('Version 2 will be deleted');
    expect(said).toContain('version 1 will be the approved budget again');
  });

  it('is explicit that a first approval leaves nothing approved', () => {
    const decision = canWithdrawApproval([version(1, 'approved')], project('v1'), 'v1');
    if (!decision.allowed) throw new Error('should be allowed');
    const said = describeWithdrawal(decision);
    expect(said).toMatch(/no approved budget at all/);
    // And that the working budget survives, which is the thing people fear.
    expect(said).toMatch(/lines you are working on are not changed/);
  });
});
