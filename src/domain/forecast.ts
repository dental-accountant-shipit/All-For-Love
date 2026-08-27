/**
 * Forecast engine.
 *
 * Every figure the business looks at is derived here, from individual cost
 * lines. Nothing in the application accepts a typed forecast or profit
 * figure — the single exception is an explicit, flagged, audited override on
 * one cost item, and even then the calculated value keeps running underneath.
 *
 * These are pure functions. They take the records and return numbers. That is
 * what makes the arithmetic testable against a real past project before any
 * interface exists.
 */

import { sum, type Pence } from './money';
import {
  OPEN_COMMITMENT_STATUSES,
  type Commitment,
  type CostItem,
  type Transaction,
} from './types';

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/**
 * Actual cost to date for a cost item — bills less credits, ex VAT, in base
 * currency. Transactions with no commitment still count, so an uncommitted
 * overspend can never hide from the forecast.
 */
export function actualToDate(transactions: Transaction[]): Pence {
  return sum(transactions.map((t) => t.amountBaseExVat));
}

/**
 * Money promised to suppliers but not yet invoiced.
 *
 * Computed per commitment rather than in aggregate: a commitment that has
 * been over-invoiced contributes zero remaining, and must not be allowed to
 * offset another commitment that is still fully outstanding.
 */
export function remainingCommitted(
  commitments: Commitment[],
  transactions: Transaction[],
): Pence {
  return sum(
    commitments
      .filter((c) => OPEN_COMMITMENT_STATUSES.includes(c.status))
      .map((c) => {
        const invoiced = sum(
          transactions
            .filter((t) => t.commitmentId === c.id)
            .map((t) => t.amountBaseExVat),
        );
        return Math.max(0, c.amountBaseExVat - invoiced);
      }),
  );
}

export function committedTotal(commitments: Commitment[]): Pence {
  return sum(
    commitments
      .filter((c) => c.status !== 'cancelled')
      .map((c) => c.amountBaseExVat),
  );
}

/**
 * The budget figure the forecast compares against.
 *
 * This is the CURRENT APPROVED budget, not an open draft. If it were the
 * draft, someone half-way through typing a revision would silently move the
 * project's forecast profit. Before a project's first approval there is
 * nothing else to use, so the draft stands in.
 */
export function budgetForForecast(item: CostItem): Pence | null {
  return item.approved ? item.approved.budgetCost : item.draft.budgetCost;
}

// ---------------------------------------------------------------------------
// Cost item forecast
// ---------------------------------------------------------------------------

export interface ForecastResult {
  committedTotal: Pence;
  committedRemaining: Pence;
  actualTotal: Pence;
  /** What the rules produce, always computed even when overridden. */
  calculatedForecast: Pence;
  /** What the rest of the system uses. */
  forecastCost: Pence;
  forecastSource: 'calculated' | 'override';
  /** True when a standing override has drifted far from the calculation. */
  overrideMayBeStale: boolean;
}

/** An override is flagged once it diverges from the calculation by this much. */
export const OVERRIDE_STALE_THRESHOLD = 0.1;

export function forecastCostItem(
  item: CostItem,
  commitments: Commitment[],
  transactions: Transaction[],
): ForecastResult {
  const mine = commitments.filter((c) => c.costItemId === item.id);
  const myTx = transactions.filter((t) => t.costItemId === item.id);

  const actual = actualToDate(myTx);
  const remaining = remainingCommitted(mine, myTx);
  const budget = budgetForForecast(item);

  let calculated: Pence;
  switch (item.status) {
    case 'completed':
      // The line is done. The fact replaces the estimate.
      calculated = actual;
      break;
    case 'cancelled':
      // Abort costs already incurred still count. Often zero, not always.
      calculated = actual;
      break;
    default:
      // planned | quoted | committed | in_progress
      //
      // With no recorded budget — an imported historical line — there is
      // nothing to take the greater of. The forecast is simply what has been
      // spent plus what is still promised.
      calculated = budget === null ? actual + remaining : Math.max(budget, actual + remaining);
  }

  const override = item.forecastOverride;
  const forecastCost = override ? override.value : calculated;
  const forecastSource: 'calculated' | 'override' = override ? 'override' : 'calculated';

  const overrideMayBeStale =
    override !== null &&
    calculated !== 0 &&
    Math.abs(calculated - override.value) / Math.abs(calculated) > OVERRIDE_STALE_THRESHOLD;

  return {
    committedTotal: committedTotal(mine),
    committedRemaining: remaining,
    actualTotal: actual,
    calculatedForecast: calculated,
    forecastCost,
    forecastSource,
    overrideMayBeStale,
  };
}

/**
 * A line is over budget when its forecast exceeds its approved budget.
 *
 * A line with no recorded budget is never "over" — it is unmeasurable, which
 * is a different thing and must not be reported as compliance.
 */
export function isOverBudget(item: CostItem, result: ForecastResult): boolean {
  const budget = budgetForForecast(item);
  return budget !== null && result.forecastCost > budget;
}

/** Whether budget-versus-actual can be shown for this line at all. */
export function hasBudget(item: CostItem): boolean {
  return budgetForForecast(item) !== null;
}
