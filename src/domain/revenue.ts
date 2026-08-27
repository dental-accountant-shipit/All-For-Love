/**
 * Revenue, profit and commission.
 *
 * Revenue is not a separate ledger. It is the sum of agreed client prices on
 * cost items, partitioned by how each one got there. One grid therefore
 * drives both sides of the margin, and the reconciliation
 *
 *     original + approved extras & changes − agreed reductions
 *
 * balances by construction rather than by luck.
 */

import { percentOf, type Pence } from './money';
import type { Commission, CostItem } from './types';

// ---------------------------------------------------------------------------
// Which lines count, and for how much
// ---------------------------------------------------------------------------

/** A proposed or rejected extra is not part of the agreed position. */
export function isAgreed(item: CostItem): boolean {
  if (item.origin === 'extra' && item.extraStatus !== 'approved') return false;
  return true;
}

export function isProposedExtra(item: CostItem): boolean {
  return item.origin === 'extra' && item.extraStatus === 'proposed';
}

/**
 * What the client has currently agreed to pay for this line.
 *
 * Zero for anything not yet approved, for a withdrawn line, and for an extra
 * the client has not said yes to. Draft values never count — a client cannot
 * have agreed to a figure that has not been approved.
 */
export function currentAgreedClientPrice(item: CostItem): Pence {
  if (!isAgreed(item)) return 0;
  if (item.clientValueWithdrawn) return 0;
  return item.approved ? item.approved.clientPrice : 0;
}

/** What this line was worth in the project's first approved budget. */
export function originalClientPrice(item: CostItem): Pence {
  return item.original ? item.original.clientPrice : 0;
}

// ---------------------------------------------------------------------------
// Revenue composition
// ---------------------------------------------------------------------------

export interface RevenueBreakdown {
  originalClientValue: Pence;
  approvedExtras: Pence;
  agreedReductions: Pence;
  currentAgreedClientRevenue: Pence;
  proposedExtrasRevenue: Pence;
  proposedExtrasCost: Pence;
  proposedExtrasCostKnown: boolean;
}

/**
 * Every line's movement since the original approved budget is classified as
 * an increase or a decrease, so the three components always sum back to the
 * current figure — for new extras, for revisions that raised a price, and for
 * work the client dropped.
 */
export function revenueBreakdown(items: CostItem[]): RevenueBreakdown {
  let originalClientValue = 0;
  let approvedExtras = 0;
  let agreedReductions = 0;
  let proposedExtrasRevenue = 0;
  let proposedExtrasCost = 0;
  let proposedExtrasCostKnown = true;

  for (const item of items) {
    if (isProposedExtra(item)) {
      const values = item.approved ?? item.draft;
      proposedExtrasRevenue += values.clientPrice;
      if (values.budgetCost === null) proposedExtrasCostKnown = false;
      else proposedExtrasCost += values.budgetCost;
      continue;
    }

    const original = originalClientPrice(item);
    const current = currentAgreedClientPrice(item);
    const delta = current - original;

    originalClientValue += original;
    if (delta > 0) approvedExtras += delta;
    else if (delta < 0) agreedReductions += -delta;
  }

  return {
    originalClientValue,
    approvedExtras,
    agreedReductions,
    currentAgreedClientRevenue: originalClientValue + approvedExtras - agreedReductions,
    proposedExtrasRevenue,
    proposedExtrasCost,
    proposedExtrasCostKnown,
  };
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

export interface CommissionLine {
  commissionId: string;
  payeeName: string;
  amount: Pence;
}

export interface CommissionResult {
  lines: CommissionLine[];
  total: Pence;
}

/**
 * Commission is never a supplier cost line. It is computed from the project
 * result and reported beside it, so a low-margin project introduced by an
 * agency is not mistaken for a badly-bought project.
 *
 * Percentage-of-profit commissions are all computed on profit BEFORE any
 * commission. They do not cascade — two 10% introducers take 10% each, not
 * 10% and then 10% of what is left.
 */
export function calculateCommission(
  commissions: Commission[],
  currentAgreedClientRevenue: Pence,
  forecastProfitBeforeCommission: Pence,
  forecastCost: Pence,
): CommissionResult {
  const lines = commissions.map((c) => {
    let amount: Pence;
    switch (c.basis) {
      case 'percent_of_revenue':
        amount = percentOf(currentAgreedClientRevenue, c.ratePercent ?? 0);
        break;
      case 'percent_of_profit':
        amount = percentOf(forecastProfitBeforeCommission, c.ratePercent ?? 0);
        break;
      case 'percent_of_cost':
        // How the existing workbook does it: cost × rate.
        amount = percentOf(forecastCost, c.ratePercent ?? 0);
        break;
      case 'fixed':
        amount = c.fixedAmount ?? 0;
        break;
    }
    return { commissionId: c.id, payeeName: c.payeeName, amount };
  });

  return { lines, total: lines.reduce((a, l) => a + l.amount, 0) };
}
