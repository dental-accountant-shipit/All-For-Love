'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '../../lib/auth/AuthProvider';
import { usingEmulators } from '../../lib/firestore/client';

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
      <p style={{ fontFamily: 'system-ui, sans-serif' }}>
        Signed in. <a href="/projects">Go to projects</a>.
      </p>
    );
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 360, margin: '8vh auto' }}>
      <h1 style={{ fontWeight: 400, fontSize: 22 }}>Sign in</h1>
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
      >
        <label style={label}>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={input}
          />
        </label>
        <label style={label}>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={input}
          />
        </label>
        {error ? <p style={{ color: '#c10001', fontSize: 13 }}>{error}</p> : null}
        <button type="submit" disabled={busy} style={button}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p style={{ fontSize: 12, color: '#777', marginTop: 24 }}>
        Accounts are created by an administrator. There is no self sign-up.
      </p>
      {usingEmulators ? (
        <div style={localPanel}>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: '#666' }}>
            Running on this Mac. Click one to fill it in.
          </p>
          {LOCAL_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => {
                setEmail(account.email);
                setPassword(account.password);
              }}
              style={localButton}
            >
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{account.email}</span>
              <span style={{ color: '#888' }}>{account.what}</span>
            </button>
          ))}
        </div>
      ) : null}
    </main>
  );
}

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#666',
  marginBottom: 14,
};
const input: React.CSSProperties = {
  display: 'block',
  width: '100%',
  font: 'inherit',
  fontSize: 15,
  padding: '8px 10px',
  marginTop: 4,
  border: '1px solid #ccc',
  borderRadius: 4,
  color: '#111',
};
const button: React.CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  fontWeight: 600,
  padding: '10px 18px',
  background: '#000',
  color: '#fff',
  border: 'none',
  borderRadius: 2,
  cursor: 'pointer',
};

const localPanel: React.CSSProperties = {
  marginTop: 28,
  padding: '14px 16px',
  border: '1px dashed #d5d0c8',
  borderRadius: 6,
  background: '#faf8f5',
};

const localButton: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  width: '100%',
  padding: '8px 10px',
  marginBottom: 6,
  fontSize: 13,
  fontFamily: 'inherit',
  textAlign: 'left',
  background: '#fff',
  border: '1px solid #e4dfd7',
  borderRadius: 4,
  cursor: 'pointer',
};
