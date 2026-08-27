import { describe, expect, it } from 'vitest';

import { formatGBP, toBaseCurrency, toPence } from '../money';
import { signedAmounts } from '../values';

describe('foreign currency', () => {
  it('converts at the stated rate and keeps whole pence', () => {
    // The reference workbook records "Lunches at Castello — EURO 6,130.5"
    // inside a description with no rate at all. This is the fix.
    expect(toBaseCurrency(toPence(6_130.5), 0.8532)).toBe(toPence(5_230.54));
  });

  it('leaves sterling untouched at a rate of one', () => {
    expect(toBaseCurrency(toPence(9_500), 1)).toBe(toPence(9_500));
  });

  it('rounds to the penny rather than carrying a fraction', () => {
    const converted = toBaseCurrency(toPence(100), 1.234_567);
    expect(Number.isInteger(converted)).toBe(true);
  });
});

describe('credit notes', () => {
  it('stores a credit as negative however it was typed', () => {
    // People type a credit as it appears on the supplier's document: positive.
    // Storing it that way would increase the project's cost.
    expect(signedAmounts('credit', toPence(600), toPence(120))).toEqual({
      amountExVat: toPence(-600),
      vatAmount: toPence(-120),
    });
  });

  it('leaves an already-negative credit alone', () => {
    expect(signedAmounts('credit', toPence(-600), 0).amountExVat).toBe(toPence(-600));
  });

  it('does not touch bills or expenses', () => {
    expect(signedAmounts('bill', toPence(3_400), toPence(680))).toEqual({
      amountExVat: toPence(3_400),
      vatAmount: toPence(680),
    });
    expect(signedAmounts('expense', toPence(220), 0).amountExVat).toBe(toPence(220));
  });

  it('shows a negative amount with a proper minus sign', () => {
    expect(formatGBP(toPence(-600))).toBe('−£600.00');
  });
});
