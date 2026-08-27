import { describe, expect, it } from 'vitest';
import { keyBetween, keysAfter, keysBetween } from '../sortKey';

describe('fractional sort keys', () => {
  it('gives a first key for an empty list', () => {
    expect(keyBetween(null, null)).toBe('V');
  });

  it('appends after the last line', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    expect(b > a).toBe(true);
  });

  it('inserts before the first line', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(null, a);
    expect(b < a).toBe(true);
  });

  it('inserts between two adjacent lines', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    const mid = keyBetween(a, b);
    expect(a < mid && mid < b).toBe(true);
  });

  it('survives repeated insertion at the same point', () => {
    // The interaction that breaks naive schemes: dragging into the same gap
    // over and over. 200 times is far past anything a real budget will do.
    let lo = keyBetween(null, null);
    const hi = keyBetween(lo, null);
    for (let i = 0; i < 200; i++) {
      const k = keyBetween(lo, hi);
      expect(lo < k && k < hi).toBe(true);
      lo = k;
    }
  });

  it('keeps a pasted block in order', () => {
    const keys = keysAfter(null, 40);
    expect(keys).toHaveLength(40);
    const sorted = [...keys].sort();
    expect(sorted).toEqual(keys);
    expect(new Set(keys).size).toBe(40);
  });

  it('keeps an inserted block in order and inside its gap', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    const keys = keysBetween(a, b, 12);
    expect(keys).toHaveLength(12);
    expect([...keys].sort()).toEqual(keys);
    expect(keys.every((k) => k > a && k < b)).toBe(true);
  });

  it('never produces a key that cannot be inserted before', () => {
    let k: string | null = null;
    for (let i = 0; i < 50; i++) {
      k = keyBetween(k, null);
      expect(k.endsWith('0')).toBe(false);
    }
  });

  it('refuses keys given in the wrong order', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    expect(() => keyBetween(b, a)).toThrow();
  });
});
