/**
 * The design system, kept honest.
 *
 * Two things are worth a test here, and neither is about how anything looks.
 *
 * The first is that every token names a custom property that actually exists —
 * a typo produces `var(--afl-signatur)`, which is not an error anywhere, just a
 * colour that silently falls back to inherited black.
 *
 * The second is the ruling on red. Red is All for Love's colour and it is also
 * universally "over budget". Both cannot be true inside a table, so the whole
 * system rests on red being spent only where it means money going the wrong
 * way. That is a rule a screen written in six months will break by accident,
 * and this is what will notice.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { colour, figureColour, radius, type } from '../tokens';

const root = process.cwd();
const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8');

const tokens = { ...colour, ...type, ...radius } as Record<string, string>;

describe('tokens', () => {
  it('every token points at a custom property that is declared', () => {
    for (const [name, value] of Object.entries(tokens)) {
      const match = /var\((--[a-z0-9-]+)\)/.exec(value);
      expect(match, `${name} should be a var() reference, not the literal ${value}`).not.toBeNull();
      expect(css, `${name} → ${match![1]} is not declared in globals.css`).toContain(
        `${match![1]}:`,
      );
    }
  });

  it('spends red on losses and green on nothing decorative', () => {
    expect(figureColour('over')).toBe(colour.signature);
    expect(figureColour('under')).toBe(colour.verdant);
    expect(figureColour('neutral')).toBe(colour.ink);
  });
});

describe('the ruling on red', () => {
  // Where a brand hex is allowed to appear as a literal: the stylesheet that
  // declares it, and the document that decides it.
  const allowed = new Set(['src/app/globals.css']);

  it('is decided in one place, not typed into screens', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(root, 'src'))) {
      const relative = file.slice(root.length + 1);
      if (allowed.has(relative)) continue;
      const text = readFileSync(file, 'utf8');
      // The brand palette, in any casing. A screen that hard-codes one of these
      // has made a decision the design direction had already made.
      if (/#(c10001|fdd1d2|1f5d45|f7f4f3|e4dedc|c8bfbc|7a716e)/i.test(text)) {
        offenders.push(relative);
      }
    }
    expect(offenders, 'these files hard-code a brand colour instead of using a token').toEqual(
      [],
    );
  });

  it('keeps the sign-in screen out of the working register', () => {
    // Front of house is the one place the brand gets the whole screen. It is
    // also the one place a black primary button would be invisible, so the
    // inversion there is deliberate and should stay deliberate.
    const signIn = readFileSync(join(root, 'src/app/sign-in/page.tsx'), 'utf8');
    expect(signIn).toContain('colour.ink');
    expect(signIn).toContain('background: colour.paper');
  });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(tsx?|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}
