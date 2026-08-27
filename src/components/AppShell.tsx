'use client';

/**
 * Application shell: sign-in gate, navigation, role.
 *
 * This is the chrome, which is where the brand lives. The screens inside it are
 * white, hairline-ruled and unbranded on purpose — a table of money is judged
 * on how fast a figure can be found in it, and nothing decorative helps with
 * that. See the two registers in claude/design-direction.md.
 *
 * The navigation is the live site's signature gesture: uppercase serif, small,
 * heavily tracked. It costs nothing to carry into an application and it is
 * recognisable from across a room.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

import Wordmark from './Wordmark';
import { useRoutePath } from '../lib/useRoutePath';
import { useAuth } from '../lib/auth/AuthProvider';
import { ROLE_LABELS } from '../lib/auth/roles';
import { missingFirebaseConfig } from '../lib/firestore/client';
import { colour, type } from '../design/tokens';
import { buttonQuiet, hint } from '../design/ui';

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, role, roleMissing, signOut, can } = useAuth();
  const pathname = useRoutePath();

  // Better than a blank screen and a console message: say exactly what is
  // missing and where it goes.
  const missing = missingFirebaseConfig();
  if (missing.length > 0) {
    return (
      <Doorway title="Not configured">
        <p style={S.doorwayBody}>
          This build has no Firebase configuration, so it cannot connect to anything.
          Copy <code>.env.example</code> to <code>.env.local</code>, fill in the six
          values from your Firebase project, and rebuild.
        </p>
        <ul style={{ ...S.doorwayBody, fontSize: 13, opacity: 0.8 }}>
          {missing.map((key) => (
            <li key={key}>
              <code>{key}</code>
            </li>
          ))}
        </ul>
      </Doorway>
    );
  }

  // Screens that must render without a session. Sign-in for the obvious
  // reason; the budget demo because it holds no data at all — it is the grid
  // running in memory, for trying the interaction — and gating it behind a
  // login made it unreachable for the one purpose it has.
  const isPublic = pathname === '/sign-in' || pathname === '/budget-demo';

  if (user === undefined) {
    return <Doorway title="Signing in…" />;
  }

  if (user === null) {
    if (isPublic) return <>{children}</>;
    return (
      <Doorway title="All for Love — Projects">
        <p style={S.doorwayBody}>
          <Link href="/sign-in" style={S.doorwayLink}>
            Sign in
          </Link>{' '}
          to continue.
        </p>
      </Doorway>
    );
  }

  if (roleMissing) {
    return (
      <Doorway title="Nothing to see yet">
        <p style={S.doorwayBody}>
          Your account exists but has no role, so there is nothing you can see or do.
          A director needs to grant one.
        </p>
        <p>
          <button
            type="button"
            onClick={() => void signOut()}
            style={{ ...buttonQuiet, color: colour.paper, opacity: 0.75 }}
          >
            Sign out
          </button>
        </p>
      </Doorway>
    );
  }

  const nav = [
    { href: '/projects', label: 'Projects', path: '/projects' },
    { href: '/suppliers', label: 'Suppliers', path: '/suppliers' },
    // The only screen the administrator role can reach, and the only role that
    // can reach it. Hidden from everyone else rather than shown and refused.
    ...(can('adminImport')
      ? [{ href: '/admin/import', label: 'Import', path: '/admin/import' }]
      : []),
  ];

  return (
    <div style={S.shell}>
      <header style={S.header}>
        <div style={S.headerInner}>
          <Link href="/projects" style={S.brand} aria-label="All for Love — Projects">
            <Wordmark />
            <span style={S.brandSuffix}>Projects</span>
          </Link>

          <nav style={S.nav}>
            {nav.map((item) => {
              const on = pathname === item.path;
              return (
                <Link
                  key={item.path}
                  href={item.href}
                  style={{ ...S.navLink, ...(on ? S.navLinkOn : null) }}
                  aria-current={on ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <span style={S.role}>{role ? ROLE_LABELS[role] : ''}</span>
          <button type="button" onClick={() => void signOut()} style={S.signOut}>
            Sign out
          </button>
        </div>
      </header>

      <main style={S.main}>{children}</main>
    </div>
  );
}

/**
 * The front-of-house register: black ground, large serif, no data.
 *
 * Used for every screen you meet before you are working — signing in, waiting,
 * being told your account has no role. These are the moments where the brand is
 * the whole content of the screen, so it gets the whole screen.
 */
function Doorway({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div style={S.doorway}>
      <div style={S.doorwayInner}>
        <Wordmark tone="paper" size={22} />
        <h1 style={S.doorwayTitle}>{title}</h1>
        {children}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  shell: { minHeight: '100vh' },

  header: {
    borderBottom: `1px solid ${colour.rule}`,
    background: colour.paper,
    position: 'sticky',
    top: 0,
    zIndex: 20,
  },
  headerInner: {
    display: 'flex',
    alignItems: 'center',
    gap: 28,
    maxWidth: 1240,
    margin: '0 auto',
    padding: '0 28px',
    height: 62,
  },
  brand: { display: 'flex', alignItems: 'baseline', gap: 10, textDecoration: 'none' },
  brandSuffix: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: type.trackingNav,
    textTransform: 'uppercase',
    color: colour.muted,
  },

  nav: { display: 'flex', gap: 26, marginRight: 'auto' },
  navLink: {
    fontFamily: type.serif,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: type.trackingNav,
    textTransform: 'uppercase',
    color: colour.ink,
    paddingBottom: 3,
    borderBottom: '2px solid transparent',
    textDecoration: 'none',
  },
  // Blush marks the current page on the live site's navigation too. It is the
  // one decorative use of a brand colour inside the working chrome, and it
  // carries no financial meaning, so it cannot be mistaken for one.
  navLinkOn: { borderBottomColor: colour.blush },

  role: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: type.trackingNav,
    textTransform: 'uppercase',
    color: colour.muted,
  },
  signOut: { ...buttonQuiet, fontSize: 12, textDecoration: 'none', color: colour.muted },

  main: { maxWidth: 1240, margin: '0 auto', padding: '28px 28px 96px' },

  doorway: {
    minHeight: '100vh',
    background: colour.ink,
    color: colour.paper,
    display: 'flex',
    alignItems: 'center',
  },
  doorwayInner: { maxWidth: 460, margin: '0 auto', padding: '0 28px' },
  doorwayTitle: {
    fontFamily: type.serif,
    fontSize: 34,
    fontWeight: 400,
    lineHeight: 1.15,
    margin: '20px 0 14px',
    color: colour.paper,
  },
  doorwayBody: { ...hint, color: colour.paper, opacity: 0.72, maxWidth: '46ch' },
  doorwayLink: { color: colour.paper, textDecoration: 'underline', textUnderlineOffset: 4 },
};
