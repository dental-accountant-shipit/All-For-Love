/**
 * Firebase client initialisation.
 *
 * Every value comes from the environment. Nothing here is a secret — the web
 * config identifies the project to the browser and is protected by security
 * rules, not by obscurity — but it still does not belong in source, because
 * dev and production must never be one edit away from each other.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';

const REQUIRED_KEYS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
] as const;

/**
 * Next inlines NEXT_PUBLIC_* at build time, so these must be read as whole
 * literals rather than looked up dynamically.
 */
const CONFIG: Record<(typeof REQUIRED_KEYS)[number], string | undefined> = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/**
 * Running against the local emulators.
 *
 * The emulators do not check the web config at all — any project id will do —
 * so this also switches off the "you have not configured Firebase" screen.
 * Somebody running locally has nothing to configure, and telling them to go
 * and fetch six values from a console they may not even have access to would
 * be the wrong instruction entirely.
 */
export const usingEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true';

/** Which values are still missing. Empty means the app can start. */
export function missingFirebaseConfig(): string[] {
  if (usingEmulators) return [];
  return REQUIRED_KEYS.filter((key) => !CONFIG[key]);
}

export function isFirebaseConfigured(): boolean {
  return missingFirebaseConfig().length === 0;
}

function required(name: (typeof REQUIRED_KEYS)[number]): string {
  const value = CONFIG[name];
  // The emulators accept anything. A placeholder here is not a fallback that
  // could reach production — production has no emulator to connect to, so a
  // build with this flag set would fail on its first read rather than write
  // somewhere unexpected.
  if (!value && useEmulators) return 'emulator';
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill it in — ` +
        `see docs/FIREBASE-NEXT-STEPS.md.`,
    );
  }
  return value;
}

const useEmulators = usingEmulators;

let app: FirebaseApp | undefined;
let db: Firestore | undefined;

export function firebaseApp(): FirebaseApp {
  if (app) return app;
  app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: required('NEXT_PUBLIC_FIREBASE_API_KEY'),
        authDomain: required('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
        projectId: required('NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
        storageBucket: required('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'),
        messagingSenderId: required('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
        appId: required('NEXT_PUBLIC_FIREBASE_APP_ID'),
      });
  return app;
}

/**
 * Offline persistence is on deliberately. Budgets get edited on venue wifi and
 * in transit; a cell edit that fails because the connection dropped for four
 * seconds is the fastest way to lose a user's trust. Writes queue locally and
 * flush on reconnect.
 */
export function firestore(): Firestore {
  if (db) return db;
  db = initializeFirestore(firebaseApp(), {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  if (useEmulators) connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return db;
}

let authInstance: Auth | undefined;

export function auth(): Auth {
  if (authInstance) return authInstance;
  authInstance = getAuth(firebaseApp());
  // Connecting twice throws, and `auth()` is called from several places on
  // every render path.
  if (useEmulators) {
    connectAuthEmulator(authInstance, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  return authInstance;
}

let storageInstance: FirebaseStorage | undefined;

export function storage(): FirebaseStorage {
  if (storageInstance) return storageInstance;
  storageInstance = getStorage(firebaseApp());
  if (useEmulators) connectStorageEmulator(storageInstance, '127.0.0.1', 9199);
  return storageInstance;
}
