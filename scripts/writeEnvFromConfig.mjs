/**
 * Turn the Firebase config block into a .env.local file.
 *
 * Firebase shows you a block of JavaScript in the console. Retyping its six
 * values into six separate places is exactly the sort of fiddly job that goes
 * wrong once and then costs an afternoon, so this takes the whole block —
 * however you paste it — and writes the file itself.
 *
 * It reads FIREBASE_WEB_CONFIG from the environment, which is how the GitHub
 * Actions workflow uses it. To run it by hand:
 *
 *   FIREBASE_WEB_CONFIG="$(pbpaste)" node scripts/writeEnvFromConfig.mjs
 *
 * Accepts the JavaScript object as the console prints it, real JSON, or just
 * the six lines on their own. Keys can be quoted or not, values in single or
 * double quotes, trailing commas and comments are all fine.
 */

import { writeFileSync } from 'node:fs';

const KEYS = [
  ['apiKey', 'NEXT_PUBLIC_FIREBASE_API_KEY'],
  ['authDomain', 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'],
  ['projectId', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'],
  ['storageBucket', 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'],
  ['messagingSenderId', 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'],
  ['appId', 'NEXT_PUBLIC_FIREBASE_APP_ID'],
];

const OPTIONAL = new Set(['measurementId']);

function extract(source, key) {
  // "apiKey": "…"  |  apiKey: '…'  |  apiKey = "…"
  const pattern = new RegExp(`['"]?${key}['"]?\\s*[:=]\\s*['"\`]([^'"\`]+)['"\`]`);
  return pattern.exec(source)?.[1]?.trim() ?? null;
}

const raw = process.env.FIREBASE_WEB_CONFIG ?? '';

if (!raw.trim()) {
  console.error(
    '\nNothing to read.\n\n' +
      'Copy the whole firebaseConfig block from the Firebase console\n' +
      '(Project settings → General → Your apps → Web) and pass it in as\n' +
      'FIREBASE_WEB_CONFIG. See docs/DEPLOYING.md.\n',
  );
  process.exit(1);
}

const found = [];
const missing = [];

for (const [configKey, envKey] of KEYS) {
  const value = extract(raw, configKey);
  if (value) found.push(`${envKey}=${value}`);
  else missing.push(configKey);
}

if (missing.length > 0) {
  console.error(
    `\nThat config block is missing: ${missing.join(', ')}.\n\n` +
      'Copy the whole block including the curly brackets, not just part of it.\n',
  );
  process.exit(1);
}

// measurementId only appears when Analytics is on. It is not used.
if (extract(raw, 'measurementId')) {
  console.log('  (ignoring measurementId — Analytics is not used)');
}
void OPTIONAL;

const contents = [
  '# Written by scripts/writeEnvFromConfig.mjs — do not commit.',
  '# These six values identify the project to the browser. They are not',
  '# secrets, but they still do not belong in source: dev and production must',
  '# never be one edit apart.',
  '',
  ...found,
  '',
  'NEXT_PUBLIC_APP_NAME="All for Love — Projects"',
  'NEXT_PUBLIC_BASE_CURRENCY=GBP',
  'NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false',
  '',
].join('\n');

writeFileSync('.env.local', contents);

const projectId = extract(raw, 'projectId');
console.log(`\n  Wrote .env.local for project "${projectId}".\n`);
