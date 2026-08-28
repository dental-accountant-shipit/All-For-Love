/**
 * One connection to the Cloud Functions, shared.
 *
 * This lived inside the import module because the import was the only thing
 * that called a function. Managing people is the second, and two modules each
 * building their own `Functions` instance — each with its own emulator wiring
 * to remember — is how one of them ends up talking to the live project from a
 * laptop.
 */

import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from 'firebase/functions';

import { firebaseApp, usingEmulators } from './firestore/client';

const REGION = 'europe-west2';

let instance: Functions | undefined;

export function functions(): Functions {
  if (instance) return instance;
  instance = getFunctions(firebaseApp(), REGION);
  // Locally the functions run in the emulator, free, so everything that needs
  // Blaze works without it.
  if (usingEmulators) connectFunctionsEmulator(instance, '127.0.0.1', 5001);
  return instance;
}

/** Call a function by name, with the argument and result types written down. */
export async function call<Args, Result>(name: string, args: Args): Promise<Result> {
  const { data } = await httpsCallable<Args, Result>(functions(), name)(args);
  return data;
}

/**
 * The message inside a callable error, or something honest if there isn't one.
 *
 * A callable's `message` is the text passed to `HttpsError` server-side, which
 * on this project is always written for the person reading it. The codes worth
 * special handling are the ones that mean "this function is not there" rather
 * than "you asked for something impossible".
 */
export function callableMessage(error: unknown, fallback: string): string {
  const code = (error as { code?: string })?.code ?? '';
  if (code.includes('not-found') || code.includes('internal') || code.includes('unavailable')) {
    return 'That part of the system is not running. It is a Cloud Function — deploy the functions and try again.';
  }
  const message = (error as { message?: string })?.message;
  return message && message !== 'INTERNAL' ? message : fallback;
}
