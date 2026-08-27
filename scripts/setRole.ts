/**
 * Grant an internal user a role.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   npx tsx scripts/setRole.ts --email ruth@allforlovelondon.com --role director
 *
 * Roles are Firebase custom claims, which is what the security rules read.
 * They are set with the Admin SDK, which bypasses the rules — so this script
 * needs a service account key. That key never goes in the repository, never in
 * `.env.local`, and never into a chat window: point
 * GOOGLE_APPLICATION_CREDENTIALS at it in your own shell and nowhere else.
 *
 *   --list                 show every user and their current role
 *   --role none            remove a role, leaving the account unable to do
 *                          anything until one is granted again
 */

import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'node:fs';

import { ALL_ROLES, ROLE_DESCRIPTIONS, isRole } from '../src/lib/auth/roles';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function usage(message?: string): never {
  if (message) console.error(`\n${message}`);
  console.error(`
Usage
  npx tsx scripts/setRole.ts --email <address> --role <role>
  npx tsx scripts/setRole.ts --list

Roles
${ALL_ROLES.map((r) => `  ${r.padEnd(10)} ${ROLE_DESCRIPTIONS[r]}`).join('\n')}
  none       remove the role entirely

The service account key is read from GOOGLE_APPLICATION_CREDENTIALS, or from
--key <path>. It is a secret: keep it outside the repository.
`);
  process.exit(1);
}

function init() {
  if (getApps().length) return;
  const keyPath = arg('key');
  if (keyPath) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))) });
    return;
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    usage('No credentials. Set GOOGLE_APPLICATION_CREDENTIALS or pass --key <path>.');
  }
  initializeApp({ credential: applicationDefault() });
}

async function list() {
  const { users } = await getAuth().listUsers(1000);
  if (users.length === 0) {
    console.log('\nNo users yet. Create them in the Firebase console under Authentication.\n');
    return;
  }
  console.log('');
  for (const user of users.sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''))) {
    const role = user.customClaims?.role;
    console.log(
      `  ${(user.email ?? user.uid).padEnd(38)} ${role ? String(role) : '— no role —'}`,
    );
  }
  console.log('');
}

async function main() {
  init();

  if (has('list')) {
    await list();
    return;
  }

  const email = arg('email');
  const role = arg('role');
  if (!email || !role) usage();
  if (role !== 'none' && !isRole(role)) usage(`"${role}" is not a role.`);

  const user = await getAuth().getUserByEmail(email);

  // Claims are replaced wholesale, so read what is there and keep the rest.
  const claims = { ...(user.customClaims ?? {}) };
  if (role === 'none') delete claims.role;
  else claims.role = role;

  await getAuth().setCustomUserClaims(user.uid, claims);

  // Force the change to reach the browser on the next token refresh rather
  // than up to an hour later.
  await getAuth().revokeRefreshTokens(user.uid);

  console.log(
    role === 'none'
      ? `\n  Removed the role from ${email}. They can sign in but do nothing.\n`
      : `\n  ${email} is now ${role} — ${ROLE_DESCRIPTIONS[role]}\n  They will need to sign in again.\n`,
  );
}

main().catch((error) => {
  const code = (error as { code?: string }).code;
  if (code === 'auth/user-not-found') {
    console.error(
      '\nNo such user. Create the account first: Firebase console → Authentication → Users → Add user.\n',
    );
  } else {
    console.error('\n', error, '\n');
  }
  process.exit(1);
});
