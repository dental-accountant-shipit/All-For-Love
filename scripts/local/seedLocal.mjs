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

export const LOCAL_PASSWORD = 'localdev';

/**
 * Two accounts, because there are two roles.
 *
 * The director is who you are day to day. The administrator exists only for the
 * things the rules deliberately keep away from everybody else — chiefly the
 * workbook import, which writes approved budget history no client is allowed to
 * write. Seeding one account with both roles would be more convenient and would
 * quietly destroy the distinction the whole permission model rests on.
 */
export const LOCAL_ACCOUNTS = [
  { email: 'director@local', role: 'director' },
  { email: 'admin@local', role: 'admin' },
];

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

/**
 * The same API, as the project owner.
 *
 * Custom claims are an administrator operation, so they go through the
 * project-scoped endpoints with the emulator's owner credential rather than
 * through a user's own token. The first version of this called an
 * `/emulator/v1/.../:setCustomClaims` path that does not exist, and swallowed
 * the 404 in a catch — so every local account was created with no role, and the
 * only symptom was a signed-in user being told there was nothing they could do.
 */
async function adminApi(path, body) {
  const response = await fetch(
    `http://${HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/${path}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify(body),
    },
  );
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, json };
}

/**
 * Wait for Auth to answer.
 *
 * The first run is slow in a way no later run is: firebase-tools is fetched,
 * then the Firestore and Storage jars, then the emulator UI, and only then does
 * Auth bind its port. On a cold machine with an ordinary connection that is
 * comfortably several minutes. The original minute here was an educated guess
 * and the guess was wrong, which produced the worst possible outcome — a
 * confident "never came up" while the download was still in progress.
 *
 * So: wait long enough for a first run, and say what is happening while waiting
 * rather than sitting silent.
 */
async function waitForEmulator(seconds = 600) {
  const started = Date.now();
  let announced = false;

  for (let i = 0; i < seconds * 2; i++) {
    try {
      const response = await fetch(`http://${HOST}/`, { signal: AbortSignal.timeout(1000) });
      if (response.status < 500) return true;
    } catch {
      /* not up yet */
    }

    if (!announced && Date.now() - started > 20_000) {
      announced = true;
      console.log(
        '\n  Still starting the local database. The first run downloads it,\n' +
          '  which can take a few minutes. Nothing is wrong.\n',
      );
    }

    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function seed({ email, role }) {
  const signUp = await api('accounts:signUp', {
    email,
    password: LOCAL_PASSWORD,
    returnSecureToken: true,
  });

  let uid = signUp.json?.localId;

  if (!uid) {
    // Already exists, which is fine — sign in to find its id.
    const signIn = await api('accounts:signInWithPassword', {
      email,
      password: LOCAL_PASSWORD,
      returnSecureToken: true,
    });
    uid = signIn.json?.localId;
  }

  if (!uid) {
    console.error(`Could not create ${email}.`);
    return false;
  }

  // The role lives in a custom claim, exactly as it does in production — the
  // application reads it from the token and the security rules read it from
  // the request. Setting it here means local behaves identically rather than
  // needing a "trust everyone when local" branch, which is the kind of branch
  // that eventually ships.
  const claimed = await adminApi('accounts:update', {
    localId: uid,
    customAttributes: JSON.stringify({ role }),
  });

  if (!claimed.ok) {
    console.error(
      `Could not give ${email} the ${role} role: ` +
        (claimed.json?.error?.message ?? 'no reason given'),
    );
    return false;
  }

  // Read it back. A claim that did not stick produces an account that signs in
  // perfectly and can then do nothing at all, which reads as a broken
  // application rather than a broken setup script.
  const check = await adminApi('accounts:lookup', { localId: [uid] });
  const stored = check.json?.users?.[0]?.customAttributes ?? '';
  if (!stored.includes(role)) {
    console.error(`${email} was created but the ${role} role did not stick.`);
    return false;
  }

  return true;
}

async function main() {
  if (!(await waitForEmulator())) {
    console.error(
      '\n  The local database did not start.\n' +
        '\n  What went wrong is written down in  .local-emulators.log  in this\n' +
        '  folder — the last few lines of it are the useful part. Closing this\n' +
        '  window and double-clicking Start again is worth trying first.\n',
    );
    process.exit(0); // Not fatal — the app still runs, you just cannot sign in.
  }

  const made = [];
  for (const account of LOCAL_ACCOUNTS) {
    if (await seed(account)) made.push(account);
  }

  if (made.length === 0) {
    console.error('No local accounts could be created.');
    process.exit(0);
  }

  console.log('');
  for (const { email, role } of made) {
    console.log(`  Sign in with  ${email}  /  ${LOCAL_PASSWORD}   (${role})`);
  }
  console.log('');
}

main().catch((error) => {
  console.error('Seeding skipped:', error.message);
  process.exit(0);
});
