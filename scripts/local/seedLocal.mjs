/**
 * Give the local emulators somebody to sign in as.
 *
 * A freshly started Auth emulator has no accounts, and the application
 * deliberately has no self sign-up — so without this, the first thing anybody
 * sees running locally is a sign-in screen they cannot get past. That is a
 * miserable first thirty seconds and entirely avoidable.
 *
 * Creates one director account with a password that is written on the screen,
 * because this is a throwaway database on one laptop that no network can reach.
 * A real password here would be security theatre with a support cost.
 *
 * Idempotent: the emulator is wiped and reseeded on every start, and running
 * this twice against a live emulator is harmless.
 */

const HOST = '127.0.0.1:9099';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'all-for-love-local';

export const LOCAL_EMAIL = 'director@local';
export const LOCAL_PASSWORD = 'localdev';

async function api(path, body) {
  const response = await fetch(
    `http://${HOST}/identitytoolkit.googleapis.com/v1/${path}?key=any`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, json };
}

async function waitForEmulator(seconds = 60) {
  for (let i = 0; i < seconds * 2; i++) {
    try {
      const response = await fetch(`http://${HOST}/`, { signal: AbortSignal.timeout(1000) });
      if (response.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  if (!(await waitForEmulator())) {
    console.error('The Auth emulator never came up. Nothing seeded.');
    process.exit(0); // Not fatal — the app still runs, you just cannot sign in.
  }

  const signUp = await api('accounts:signUp', {
    email: LOCAL_EMAIL,
    password: LOCAL_PASSWORD,
    returnSecureToken: true,
  });

  let uid = signUp.json?.localId;

  if (!uid) {
    // Already exists, which is fine — sign in to find its id.
    const signIn = await api('accounts:signInWithPassword', {
      email: LOCAL_EMAIL,
      password: LOCAL_PASSWORD,
      returnSecureToken: true,
    });
    uid = signIn.json?.localId;
  }

  if (!uid) {
    console.error('Could not create the local account.');
    process.exit(0);
  }

  // The role lives in a custom claim, exactly as it does in production — the
  // application reads it from the token and the security rules read it from
  // the request. Setting it here means local behaves identically rather than
  // needing a "trust everyone when local" branch, which is the kind of branch
  // that eventually ships.
  await fetch(
    `http://${HOST}/emulator/v1/projects/${PROJECT}/accounts/${uid}:setCustomClaims`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customClaims: JSON.stringify({ role: 'director' }) }),
    },
  ).catch(() => {});

  console.log(`\n  Sign in with  ${LOCAL_EMAIL}  /  ${LOCAL_PASSWORD}   (director)\n`);
}

main().catch((error) => {
  console.error('Seeding skipped:', error.message);
  process.exit(0);
});
