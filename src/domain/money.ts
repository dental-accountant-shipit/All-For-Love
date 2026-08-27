/**
 * All monetary amounts in this system are integer minor units (pence).
 * Floats are never used to hold money — a budget that drifts by a penny
 * across 200 lines is a budget nobody trusts.
 */

export type Pence = number;

/** Convert a pounds figure (as typed by a user) to pence. */
export function toPence(pounds: number): Pence {
  return Math.round(pounds * 100);
}

export function toPounds(pence: Pence): number {
  return pence / 100;
}

/** Sum with an explicit zero, so an empty list is 0 rather than undefined. */
export function sum(values: Pence[]): Pence {
  return values.reduce((a, b) => a + b, 0);
}

export function formatGBP(pence: Pence, opts: { showZero?: boolean } = {}): string {
  if (pence === 0 && opts.showZero === false) return '—';
  const negative = pence < 0;
  const abs = Math.abs(pence);
  const body = (abs / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${negative ? '−' : ''}£${body}`;
}

/**
 * Margin as a fraction (0.376), not a percentage. Percentages are formatted
 * at display time only — storing a rounded percentage loses information.
 * Zero revenue yields null rather than Infinity or NaN.
 */
export function margin(profit: Pence, revenue: Pence): number | null {
  if (revenue === 0) return null;
  return profit / revenue;
}

export function formatPercent(fraction: number | null, dp = 1): string {
  if (fraction === null) return '—';
  return `${(fraction * 100).toFixed(dp)}%`;
}

/** Percentage of an amount, rounded to the nearest penny. */
export function percentOf(amount: Pence, ratePercent: number): Pence {
  return Math.round(amount * (ratePercent / 100));
}

/**
 * Convert a foreign amount to base currency at a stated rate.
 *
 * The rate is entered by hand, deliberately — there is no rate feed. The
 * reference workbook records euro amounts inside line descriptions
 * ("Lunches at Castello — EURO 6,130.5") with no rate at all, so what matters
 * first is that the original amount, its currency and the rate used are all
 * kept. An automatic feed can come later; a recoverable number cannot.
 */
export function toBaseCurrency(amount: Pence, fxRate: number): Pence {
  return Math.round(amount * fxRate);
}
