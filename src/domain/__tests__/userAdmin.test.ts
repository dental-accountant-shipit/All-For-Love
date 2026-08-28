/**
 * The rules about who may change what somebody else can do.
 *
 * The test that earns its place is the last-owner one. Everything else here is
 * ordinary permission checking; that one is the difference between a mistake
 * you can undo from the screen and a mistake that needs a service-account key
 * and a script.
 */

import { describe, expect, it } from 'vitest';

import {
  alreadyInvited,
  canChangeRole,
  canRemoveAccess,
  looksLikeEmail,
  type Person,
} from '../userAdmin';

const person = (uid: string, role: Person['role'], email = `${uid}@example.com`): Person => ({
  uid,
  email,
  role,
});

describe('changing somebody’s role', () => {
  it('lets an owner change somebody else', () => {
    const people = [person('khyam', 'owner'), person('sam', 'producer')];
    expect(canChangeRole(people, 'khyam', 'sam', 'finance')).toEqual({ allowed: true });
  });

  it('refuses anybody who is not an owner', () => {
    const people = [person('khyam', 'owner'), person('sam', 'director')];
    const decision = canChangeRole(people, 'sam', 'khyam', 'viewer');
    expect(decision.allowed).toBe(false);
  });

  it('refuses the retired admin role too', () => {
    // `admin` still exists as a claim so old accounts keep working, but it was
    // never meant to hand out access.
    const people = [person('old', 'admin'), person('sam', 'producer')];
    expect(canChangeRole(people, 'old', 'sam', 'director').allowed).toBe(false);
  });

  it('refuses when the actor is not on the list at all', () => {
    const people = [person('sam', 'producer')];
    expect(canChangeRole(people, 'ghost', 'sam', 'viewer').allowed).toBe(false);
  });

  it('refuses when the subject is not on the list', () => {
    const people = [person('khyam', 'owner')];
    const decision = canChangeRole(people, 'khyam', 'ghost', 'viewer');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/not on the list/i);
  });
});

describe('the last owner', () => {
  it('cannot demote themselves', () => {
    const people = [person('khyam', 'owner'), person('sam', 'producer')];
    const decision = canChangeRole(people, 'khyam', 'khyam', 'director');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/only owner/i);
  });

  it('cannot have their access removed', () => {
    const people = [person('khyam', 'owner')];
    expect(canRemoveAccess(people, 'khyam', 'khyam').allowed).toBe(false);
  });

  it('can demote themselves once there is a second owner', () => {
    const people = [person('khyam', 'owner'), person('sam', 'owner')];
    expect(canChangeRole(people, 'khyam', 'khyam', 'director')).toEqual({ allowed: true });
  });

  it('can be demoted by another owner once there are two', () => {
    const people = [person('khyam', 'owner'), person('sam', 'owner')];
    expect(canChangeRole(people, 'khyam', 'sam', 'viewer')).toEqual({ allowed: true });
  });

  it('can only ever be refused to the owner themselves', () => {
    // Only an owner may change roles, so if there is exactly one owner, the
    // person being demoted is always the person doing it. The refusal says
    // "you" for that reason, and this test is what keeps that true.
    const alone = [person('khyam', 'owner'), person('sam', 'producer')];
    const decision = canChangeRole(alone, 'khyam', 'khyam', 'viewer');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/^You are the only owner/);
  });

  it('is not blocked when the owner is being left as an owner', () => {
    // Re-setting the only owner to owner changes nothing and must not trip the
    // guard.
    const people = [person('khyam', 'owner')];
    expect(canChangeRole(people, 'khyam', 'khyam', 'owner')).toEqual({ allowed: true });
  });

  it('lets an owner promote a second owner', () => {
    const people = [person('khyam', 'owner'), person('sam', 'producer')];
    expect(canChangeRole(people, 'khyam', 'sam', 'owner')).toEqual({ allowed: true });
  });
});

describe('removing access', () => {
  it('is allowed for anybody who is not the last owner', () => {
    const people = [person('khyam', 'owner'), person('sam', 'producer')];
    expect(canRemoveAccess(people, 'khyam', 'sam')).toEqual({ allowed: true });
  });

  it('is refused to somebody who is not an owner', () => {
    const people = [person('khyam', 'owner'), person('sam', 'director')];
    expect(canRemoveAccess(people, 'sam', 'khyam').allowed).toBe(false);
  });

  it('works on somebody who has no role yet', () => {
    // An invited account that has never been given a role can still be removed.
    const people = [person('khyam', 'owner'), person('new', null)];
    expect(canRemoveAccess(people, 'khyam', 'new')).toEqual({ allowed: true });
  });
});

describe('an address we can invite', () => {
  it('accepts ordinary addresses', () => {
    expect(looksLikeEmail('sam@allforlove.london')).toBe(true);
    expect(looksLikeEmail('  sam.jones+events@sub.example.co.uk  ')).toBe(true);
  });

  it('rejects things that are plainly not addresses', () => {
    expect(looksLikeEmail('')).toBe(false);
    expect(looksLikeEmail('sam')).toBe(false);
    expect(looksLikeEmail('sam@')).toBe(false);
    expect(looksLikeEmail('sam@example')).toBe(false);
    expect(looksLikeEmail('sam jones@example.com')).toBe(false);
  });
});

describe('spotting somebody who is already here', () => {
  it('matches regardless of case or surrounding space', () => {
    const people = [person('khyam', 'owner', 'Khyam@AllForLove.London')];
    expect(alreadyInvited(people, '  khyam@allforlove.london ')?.uid).toBe('khyam');
  });

  it('returns nothing for a new address', () => {
    const people = [person('khyam', 'owner')];
    expect(alreadyInvited(people, 'sam@allforlove.london')).toBeUndefined();
  });

  it('does not match an account with no address on it', () => {
    const people = [person('mystery', 'viewer', null as unknown as string)];
    expect(alreadyInvited(people, 'sam@allforlove.london')).toBeUndefined();
  });
});
