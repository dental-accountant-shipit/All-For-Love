/**
 * Talking to the three functions that decide who may use this.
 *
 * Every one of them runs server-side. A role is a Firebase custom claim, and a
 * browser that could write its own claim would not be holding a permission —
 * it would be holding a suggestion.
 *
 * The one thing that deliberately happens here rather than there: sending the
 * password email. The function creates the account with a random password it
 * never reveals, and then the browser asks Firebase to email the new person a
 * link. The result is that nobody — not the owner, not this code, not a log
 * line — ever handles somebody else's password.
 */

import { call, callableMessage } from '../functionsClient';
import type { Role } from '../../domain/types';

export interface PersonRow {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role | null;
  disabled: boolean;
  lastSignInAt: string | null;
  createdAt: string;
  awaitingFirstSignIn: boolean;
}

export async function listPeople(): Promise<PersonRow[]> {
  try {
    const { people } = await call<Record<string, never>, { people: PersonRow[] }>(
      'listPeople',
      {},
    );
    return people;
  } catch (error) {
    throw new Error(callableMessage(error, 'The list of people could not be loaded.'));
  }
}

/** `null` removes access without deleting the account or its history. */
export async function setUserRole(uid: string, role: Role | null): Promise<void> {
  try {
    await call<{ uid: string; role: Role | null }, unknown>('setUserRole', { uid, role });
  } catch (error) {
    throw new Error(callableMessage(error, 'That change could not be saved.'));
  }
}

export interface InviteResult {
  email: string;
  /** False when the address already had an account and was only given a role. */
  created: boolean;
  /**
   * False when the account was made but the email did not go out. The
   * invitation is still recoverable — they can use "forgotten password" — so
   * this is worth saying rather than treating as a failed invitation.
   */
  emailSent: boolean;
}

export async function invitePerson(email: string, role: Role): Promise<InviteResult> {
  let created: boolean;
  let address: string;
  try {
    const result = await call<{ email: string; role: Role }, { email: string; created: boolean }>(
      'invitePerson',
      { email, role },
    );
    address = result.email;
    created = result.created;
  } catch (error) {
    throw new Error(callableMessage(error, 'The invitation could not be sent.'));
  }

  // Separately, and deliberately after the account exists: ask Firebase to
  // email them. If this fails the person still has access — they just have to
  // use "forgotten password" to get in — so it does not undo the invitation.
  try {
    const { getAuth, sendPasswordResetEmail } = await import('firebase/auth');
    const { firebaseApp } = await import('../firestore/client');
    await sendPasswordResetEmail(getAuth(firebaseApp()), address);
    return { email: address, created, emailSent: true };
  } catch {
    return { email: address, created, emailSent: false };
  }
}
