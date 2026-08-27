/**
 * The sign-in screen offers the local accounts, and must never offer them
 * anywhere else.
 *
 * They exist because the launcher prints them once, in a Terminal window, at
 * the moment nobody is reading — and the alternative is somebody typing their
 * real credentials into a database that has never heard of them. Which is
 * exactly what happened.
 *
 * The guard is a build-time flag, so the live bundle does not contain the block
 * at all. This test is here to keep it that way: a hint that becomes
 * unconditional is a password on a public page.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src/app/sign-in/page.tsx'), 'utf8');

describe('the local sign-in hint', () => {
  it('names the accounts the launcher creates', () => {
    expect(source).toContain('director@local');
    expect(source).toContain('admin@local');
  });

  it('is shown only when pointed at the emulators', () => {
    expect(source).toContain('usingEmulators ?');

    // Every mention of the password sits inside the guarded block.
    const guard = source.indexOf('{usingEmulators ?');
    const constants = source.indexOf('const LOCAL_ACCOUNTS');
    for (const index of indicesOf(source, 'localdev')) {
      const inConstants = index > constants && index < source.indexOf('];', constants);
      expect(inConstants || index > guard).toBe(true);
    }
  });

  it('reads the flag from the shared client rather than the environment directly', () => {
    // process.env would be true in the emulator-run test suite and in any
    // future server render; the shared constant is the single decision.
    expect(source).not.toContain('process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS');
    expect(source).toContain("from '../../lib/firestore/client'");
  });
});

function indicesOf(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return out;
    out.push(at);
    from = at + needle.length;
  }
}
