/**
 * Fractional index keys for budget line ordering.
 *
 * Inserting a line between two others computes a key that sorts between
 * theirs and writes ONE document. An integer `position` field would rewrite
 * every row below the insertion point — on a 200-line budget that is a
 * visible stall on exactly the interaction that has to feel instant.
 *
 * Keys are base-62 fractions, ordered by plain string comparison, which is
 * what Firestore's orderBy gives us for free.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const MIN = DIGITS[0];

function digitAt(s: string, i: number): number {
  const c = s[i];
  if (c === undefined) return 0;
  const d = DIGITS.indexOf(c);
  if (d < 0) throw new Error(`Invalid sort key character: ${c}`);
  return d;
}

/**
 * A key strictly between `a` and `b`.
 *
 * Never returns a key ending in the lowest digit, which is what keeps the
 * space infinitely divisible — a key ending in '0' has nothing below it.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) {
    throw new Error(`Sort keys out of order: ${a} >= ${b}`);
  }
  if (a.endsWith(MIN) || (b !== null && b.endsWith(MIN))) {
    throw new Error('Sort key must not end with the lowest digit');
  }

  if (b !== null) {
    let n = 0;
    while (digitAt(a, n) === digitAt(b, n) && n < b.length) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }

  const lo = a ? digitAt(a, 0) : 0;
  const hi = b !== null ? digitAt(b, 0) : DIGITS.length;

  if (hi - lo > 1) {
    return DIGITS[Math.round(0.5 * (lo + hi))];
  }
  if (b !== null && b.length > 1) {
    return b.slice(0, 1);
  }
  return DIGITS[lo] + midpoint(a.slice(1), null);
}

/**
 * The key for a line placed between `before` and `after`.
 * Pass null for either end. Both null gives the first key in an empty list.
 */
export function keyBetween(before: string | null, after: string | null): string {
  if (before === null && after === null) return DIGITS[Math.floor(DIGITS.length / 2)];
  if (before === null) return midpoint('', after);
  return midpoint(before, after);
}

/** Keys for `count` lines appended after `before` — used by Excel paste. */
export function keysAfter(before: string | null, count: number): string[] {
  const keys: string[] = [];
  let prev = before;
  for (let i = 0; i < count; i++) {
    const key = keyBetween(prev, null);
    keys.push(key);
    prev = key;
  }
  return keys;
}

/** Keys for `count` lines inserted between two existing ones. */
export function keysBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  if (count <= 0) return [];
  if (after === null) return keysAfter(before, count);
  const keys: string[] = [];
  let lo = before;
  let remaining = count;
  while (remaining > 0) {
    const key = keyBetween(lo, after);
    keys.push(key);
    lo = key;
    remaining--;
  }
  return keys;
}
