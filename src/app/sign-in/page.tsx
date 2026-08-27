'use client';

/**
 * Signing in: the front-of-house register.
 *
 * Black ground, the wordmark, one large serif line and two fields. Nothing on
 * this screen is compared against anything, so the brand gets it whole — which
 * is exactly the trade the design direction makes, in return for leaving the
 * working screens white and undecorated.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import Wordmark from '../../components/Wordmark';
import { useAuth } from '../../lib/auth/AuthProvider';
import { usingEmulators } from '../../lib/firestore/client';
import { colour, radius, type } from '../../design/tokens';

/**
 * The accounts the local launcher creates.
 *
 * Printed in the Terminal window at startup, which is exactly where nobody
 * looks twenty minutes later. They are shown here only when the application is
 * pointed at the emulators — a throwaway database on one laptop that no network
 * can reach — and the flag is compiled in at build time, so the live site does
 * not contain this block at all rather than merely hiding it.
 */
const LOCAL_ACCOUNTS = [
  { email: 'director@local', password: 'localdev', what: 'normal use' },
  { email: 'admin@local', password: 'localdev', what: 'the workbook import' },
];

export default function SignInPage() {
  const { signIn, error, user } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) {
    return (
      <main style={S.ground}>
        <div style={S.panel}>
          <Wordmark tone="paper" size={22} />
          <h1 style={S.title}>Signed in</h1>
          <p style={S.body}>
            <a href="/projects" style={S.textLink}>
              Go to projects
            </a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={S.ground}>
      <div style={S.panel}>
        <Wordmark tone="paper" size={22} />
        <h1 style={S.title}>Projects</h1>
        <p style={S.body}>Budgets, costs and profitability for every event.</p>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await signIn(email, password);
              router.push('/projects');
            } catch {
              // The message is already on the context.
            } finally {
              setBusy(false);
            }
          }}
          style={{ marginTop: 30 }}
        >
          <label style={S.field}>
            <span style={S.label}>Email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={S.input}
            />
          </label>

          <label style={S.field}>
            <span style={S.label}>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={S.input}
            />
          </label>

          {error ? <p style={S.error}>{error}</p> : null}

          <button type="submit" disabled={busy} style={S.submit}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={S.footnote}>
          Accounts are created by an administrator. There is no self sign-up.
        </p>

        {usingEmulators ? (
          <div style={S.localPanel}>
            <p style={S.localTitle}>Running on this Mac — click one to fill it in</p>
            {LOCAL_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => {
                  setEmail(account.email);
                  setPassword(account.password);
                }}
                style={S.localButton}
              >
                <span className="afl-figures">{account.email}</span>
                <span style={{ opacity: 0.55 }}>{account.what}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  ground: {
    minHeight: '100vh',
    background: colour.ink,
    color: colour.paper,
    display: 'flex',
    alignItems: 'center',
  },
  panel: { width: '100%', maxWidth: 420, margin: '0 auto', padding: '48px 28px' },
  title: {
    fontFamily: type.serif,
    fontSize: 42,
    fontWeight: 400,
    lineHeight: 1.05,
    color: colour.paper,
    margin: '22px 0 10px',
  },
  body: { fontSize: 14, color: colour.paper, opacity: 0.66, margin: 0, maxWidth: '42ch' },

  field: { display: 'block', marginBottom: 16 },
  label: {
    display: 'block',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: type.trackingNav,
    textTransform: 'uppercase',
    color: colour.paper,
    opacity: 0.6,
    marginBottom: 6,
  },
  // On black, a field is a lighter block rather than an outlined one — an
  // outline alone disappears at this contrast.
  input: {
    display: 'block',
    width: '100%',
    font: 'inherit',
    fontSize: 15,
    padding: '11px 12px',
    color: colour.paper,
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.22)',
    borderRadius: radius.base,
  },
  error: { color: colour.blush, fontSize: 13, margin: '0 0 14px' },
  // Inverted here, because on a black ground the black button is the one thing
  // that cannot be seen. It is still the plain, unornamented primary action.
  submit: {
    width: '100%',
    font: 'inherit',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: type.trackingLabel,
    textTransform: 'uppercase',
    padding: '13px 18px',
    marginTop: 6,
    color: colour.ink,
    background: colour.paper,
    border: `1px solid ${colour.paper}`,
    borderRadius: radius.base,
    cursor: 'pointer',
  },
  footnote: { fontSize: 12, color: colour.paper, opacity: 0.45, marginTop: 26 },
  textLink: { color: colour.paper, textDecoration: 'underline', textUnderlineOffset: 4 },

  localPanel: {
    marginTop: 26,
    padding: '14px 16px',
    border: '1px dashed rgba(255,255,255,0.24)',
    borderRadius: radius.base,
  },
  localTitle: {
    margin: '0 0 10px',
    fontSize: 11,
    letterSpacing: type.trackingLabel,
    textTransform: 'uppercase',
    color: colour.paper,
    opacity: 0.55,
  },
  localButton: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
    padding: '9px 10px',
    marginBottom: 6,
    font: 'inherit',
    fontSize: 13,
    textAlign: 'left',
    color: colour.paper,
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: radius.base,
    cursor: 'pointer',
  },
};
