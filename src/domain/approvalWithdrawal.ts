/**
 * Taking an approval back.
 *
 * Approving a budget is the one action in this system that freezes something.
 * It writes an immutable snapshot of every line, supersedes the version before
 * it, and pins each cost item's approved figures — which is why every screen
 * can say what a budget said in March and be believed.
 *
 * That is worth protecting, and it is not worth being absolute about. A budget
 * approved by mistake — the wrong draft, the wrong day, one line still being
 * argued about — is not history. It is a mistake wearing history's clothes, and
 * a system that cannot undo it teaches people to work outside it.
 *
 * So an approval can be withdrawn, and what makes that safe is the shape of it:
 *
 *   · only the most recent approval, so the trail unwinds from the top rather
 *     than developing holes in the middle;
 *   · never while a draft is open, because the draft was started from the
 *     approval being removed;
 *   · the version before it becomes current again and every line is re-pinned
 *     from that version's frozen snapshot, so the project is left in a state
 *     the system could have reached by approving normally;
 *   · the working budget is untouched. Withdrawal takes back a decision, not
 *     somebody's afternoon of editing.
 *
 * The decision lives here, pure, because it is the kind of rule that is
 * remembered wrongly six months later if it only exists inside a function.
 */

import type { BudgetVersion } from './types';

export type Withdrawal =
  | { allowed: true; version: BudgetVersion; fallingBackTo: BudgetVersion | null }
  | { allowed: false; reason: string };

interface ProjectState {
  currentApprovedVersionId: string | null;
  openDraftVersionId: string | null;
}

/**
 * May this version's approval be taken back?
 *
 * `versions` is every version of the project, in any order.
 */
export function canWithdrawApproval(
  versions: BudgetVersion[],
  project: ProjectState,
  versionId: string,
): Withdrawal {
  const version = versions.find((candidate) => candidate.id === versionId);
  if (!version) {
    return { allowed: false, reason: 'That version is not part of this project.' };
  }

  if (version.status === 'draft') {
    return {
      allowed: false,
      reason: 'That version has never been approved. A draft is abandoned, not withdrawn.',
    };
  }

  if (project.currentApprovedVersionId !== versionId) {
    return {
      allowed: false,
      reason:
        'Only the current approved version can be withdrawn. Taking one out of the middle would leave the versions after it pinned to a budget that no longer exists.',
    };
  }

  if (project.openDraftVersionId) {
    return {
      allowed: false,
      reason:
        'There is an open draft, which was started from this approval. Approve it or abandon it first.',
    };
  }

  return { allowed: true, version, fallingBackTo: previousApproved(versions, version) };
}

/**
 * The version that becomes current again, or null when this was the first.
 *
 * Chosen by version number rather than by date: two versions approved in the
 * same second is unlikely, and a clock that went backwards is not. The number
 * is the thing the business counts in.
 */
export function previousApproved(
  versions: BudgetVersion[],
  version: BudgetVersion,
): BudgetVersion | null {
  const earlier = versions
    .filter(
      (candidate) =>
        candidate.id !== version.id &&
        candidate.status !== 'draft' &&
        candidate.versionNo < version.versionNo,
    )
    .sort((a, b) => b.versionNo - a.versionNo);

  return earlier[0] ?? null;
}

/** What withdrawing this will do, in the words somebody needs to read. */
export function describeWithdrawal(withdrawal: Extract<Withdrawal, { allowed: true }>): string {
  const { version, fallingBackTo } = withdrawal;
  return fallingBackTo
    ? `Version ${version.versionNo} will be deleted and version ${fallingBackTo.versionNo} will be the approved budget again. Every line goes back to the figures version ${fallingBackTo.versionNo} approved.`
    : `Version ${version.versionNo} will be deleted and this project will have no approved budget at all, as though it had never been approved. The lines you are working on are not changed.`;
}
