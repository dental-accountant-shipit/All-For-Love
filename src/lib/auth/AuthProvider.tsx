'use client';

/**
 * Authentication and role context.
 *
 * The role comes from a Firebase custom claim on the ID token, which is the
 * same thing the security rules read. There is no separate client-side notion
 * of permission that could drift from what the server enforces.
 *
 * Internal All for Love staff only. No sign-up, no external identity: accounts
 * are created by an administrator in the Firebase console, and self-registration
 * is turned off there.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';

import { auth, isFirebaseConfigured } from '../firestore/client';
import { can, isRole, type Capability } from './roles';
import type { Role } from '../../domain/types';

export interface AuthState {
  /** Undefined while the first token is still resolving. */
  user: User | null | undefined;
  role: Role | null;
  /** A signed-in account with no role assigned yet. */
  roleMissing: boolean;
  can: (capability: Capability) => boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [role, setRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setUser(null);
      return;
    }
    // onIdTokenChanged rather than onAuthStateChanged: a role granted while
    // someone is signed in arrives on the next token refresh, so they do not
    // have to be told to sign out and back in.
    return onIdTokenChanged(auth(), async (next) => {
      setUser(next);
      if (!next) {
        setRole(null);
        return;
      }
      const token = await next.getIdTokenResult();
      setRole(isRole(token.claims.role) ? token.claims.role : null);
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      await signInWithEmailAndPassword(auth(), email.trim(), password);
    } catch (e) {
      // Firebase returns the same code for a wrong password and an unknown
      // account, deliberately. Saying which would help someone guessing.
      const code = (e as { code?: string }).code ?? '';
      setError(
        code === 'auth/too-many-requests'
          ? 'Too many attempts. Wait a few minutes and try again.'
          : 'That email address and password do not match an account.',
      );
      throw e;
    }
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(auth());
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      role,
      roleMissing: Boolean(user) && role === null,
      can: (capability: Capability) => can(role, capability),
      signIn,
      signOut,
      error,
    }),
    [user, role, error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
