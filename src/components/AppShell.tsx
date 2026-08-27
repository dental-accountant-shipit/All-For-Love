'use client';

/**
 * Application shell: sign-in gate, navigation, role badge.
 *
 * Unstyled on purpose. The workflows come first; the All for Love visual
 * identity lands on top of them once they work.
 */

import Link from 'next/link';
import { useRoutePath } from '../lib/useRoutePath';
import type { ReactNode } from 'react';

import { useAuth } from '../lib/auth/AuthProvider';
import { ROLE_LABELS } from '../lib/auth/roles';
import { missingFirebaseConfig } from '../lib/firestore/client';

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, role, roleMissing, signOut } = useAuth();
  const pathname = useRoutePath();

  // Better than a blank screen and a console message: say exactly what is
  // missing and where it goes.
  const missing = missingFirebaseConfig();
  if (missing.length > 0) {
    return (
      <main style={S.centred}>
        <h1 style={S.title}>All for Love — Projects</h1>
        <p style={{ maxWidth: '58ch' }}>
          This build has no Firebase configuration, so it cannot connect to anything.
          Copy <code>.env.example</code> to <code>.env.local</code>, fill in the six
          values from your Firebase project, and rebuild.
        </p>
        <ul style={{ fontSize: 13, color: '#555' }}>
          {missing.map((key) => (
            <li key={key}>
              <code>{key}</code>
            </li>
          ))}
        </ul>
        <p style={{ fontSize: 13, color: '#555' }}>
          Step by step in <code>docs/FIREBASE-NEXT-STEPS.md</code>.
        </p>
      </main>
    );
  }

  // The sign-in page is the one screen that must render without a session.
  const isSignIn = pathname === '/sign-in';

  if (user === undefined) {
    return <p style={S.quiet}>Signing in…</p>;
  }

  if (user === null) {
    if (isSignIn) return <>{children}</>;
    return (
      <main style={S.centred}>
        <h1 style={S.title}>All for Love — Projects</h1>
        <p style={S.quiet}>
          <Link href="/sign-in">Sign in</Link> to continue.
        </p>
      </main>
    );
  }

  if (roleMissing) {
    return (
      <main style={S.centred}>
        <h1 style={S.title}>All for Love — Projects</h1>
        <p style={{ maxWidth: '52ch' }}>
          Your account exists but has no role yet, so there is nothing you can see or
          do. A director needs to grant one — the command is in{' '}
          <code>docs/FIREBASE-NEXT-STEPS.md</code>.
        </p>
        <p>
          <button type="button" onClick={() => void signOut()} style={S.link}>
            Sign out
          </button>
        </p>
      </main>
    );
  }

  return (
    <div style={S.shell}>
      <header style={S.header}>
        <strong style={S.brand}>All for Love — Projects</strong>
        <nav style={S.nav}>
          <Link href="/projects" style={pathname === '/projects' ? S.on : undefined}>
            Projects
          </Link>
          <Link href="/suppliers" style={pathname === '/suppliers' ? S.on : undefined}>
            Suppliers
          </Link>
        </nav>
        <span style={S.role}>{role ? ROLE_LABELS[role] : ''}</span>
        <button type="button" onClick={() => void signOut()} style={S.link}>
          Sign out
        </button>
      </header>
      <main>{children}</main>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  shell: { fontFamily: 'system-ui, sans-serif', maxWidth: 1100, margin: '0 auto' },
  header: {
    display: 'flex',
    gap: 20,
    alignItems: 'baseline',
    paddingBottom: 12,
    marginBottom: 24,
    borderBottom: '1px solid #e5e5e5',
  },
  brand: { fontWeight: 600, fontSize: 14 },
  nav: { display: 'flex', gap: 16, marginRight: 'auto', fontSize: 14 },
  on: { fontWeight: 600 },
  role: { fontSize: 12, color: '#777', textTransform: 'uppercase', letterSpacing: '0.08em' },
  link: {
    background: 'none',
    border: 'none',
    padding: 0,
    font: 'inherit',
    fontSize: 13,
    color: '#c10001',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  centred: { fontFamily: 'system-ui, sans-serif', maxWidth: 520, margin: '10vh auto' },
  title: { fontWeight: 400, fontSize: 22 },
  quiet: { color: '#666', fontFamily: 'system-ui, sans-serif' },
};
