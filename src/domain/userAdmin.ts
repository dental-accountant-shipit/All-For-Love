/**
 * The rules about changing who may do what.
 *
 * Granting access is the one power that can destroy access, so the awkward
 * cases are written down here, pure and tested, rather than being remembered
 * inside a Cloud Function.
 *
 * The one that matters: there must always be at least one owner. Without that
 * rule the last owner can demote themselves — reasonably, by tidying up — and
 * nobody can ever grant a role again. The only way back is a service-account
 * key and a script, which is precisely what this screen exists to avoid.
 */

import type { Role } from './types';

export interface Person {
  uid: string;
  email: string | null;
  role: Role | null;
}

export type RoleChangeRefusal =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * May `actor` change `subject` to `next`?
 *
 * `people` is everyone, as they are now — the decision depends on the shape of
 * the whole list, not just the two accounts involved.
 */
export function canChangeRole(
  people: Person[],
  actorUid: string,
  subjectUid: string,
  next: Role | null,
): RoleChangeRefusal {
  const actor = people.find((person) => person.uid === actorUid);
  const subject = people.find((person) => person.uid === subjectUid);

  if (!actor || actor.role !== 'owner') {
    return { allowed: false, reason: 'Only an owner can change what somebody may do.' };
  }
  if (!subject) {
    return { allowed: false, reason: 'That person is not on the list.' };
  }

  // Losing the last owner is unrecoverable from inside the application.
  const owners = people.filter((person) => person.role === 'owner');
  const losingAnOwner = subject.role === 'owner' && next !== 'owner';

  // Note that this can only ever be the actor demoting themselves: only an
  // owner gets this far, and if there is just one owner then that owner is the
  // actor. The wording says so plainly rather than hedging about who it is.
  if (losingAnOwner && owners.length <= 1) {
    return {
      allowed: false,
      reason:
        'You are the only owner. Make somebody else an owner first, or there would be nobody left who can grant access.',
    };
  }

  return { allowed: true };
}

/**
 * May `actor` remove `subject`'s access entirely?
 *
 * Same rule, expressed as what it is: removing access is setting the role to
 * nothing.
 */
export function canRemoveAccess(
  people: Person[],
  actorUid: string,
  subjectUid: string,
): RoleChangeRefusal {
  return canChangeRole(people, actorUid, subjectUid, null);
}

/**
 * Is this something we can send an invitation to?
 *
 * Deliberately loose. An address either reaches somebody or it does not, and a
 * clever pattern that rejects a real address is worse than a simple one that
 * lets a typo through — the typo shows up as an email nobody receives, which is
 * obvious, while a rejection is a dead end with no explanation.
 */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/** Already here? Compared without case, because addresses are. */
export function alreadyInvited(people: Person[], email: string): Person | undefined {
  const wanted = email.trim().toLowerCase();
  return people.find((person) => (person.email ?? '').toLowerCase() === wanted);
}
