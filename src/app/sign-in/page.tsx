'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '../../lib/auth/AuthProvider';

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
