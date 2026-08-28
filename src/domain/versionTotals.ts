/**
 * What a budget version totals.
 *
 * This existed twice, in two places that had to agree and were never checked
 * against each other: `approveBudgetVersion` computed it inline when a director
 * approved a budget, and `adminImportProject` — which also writes an approved
 * version — did not compute it at all. The imported version went to the
 * database with no `totals` field, the Versions screen read
 * `v.totals.budgetCost` off it, and the whole application went white with
 * "a client-side exception has occurred".
 *
 * TypeScript did not catch it because the Admin SDK's `set()` takes plain
 * document data, so a required field of `BudgetVersion` can simply be left out
 * with nothing to complain. That is exactly the kind of gap a shared function
 * closes: there is now one definition of what a version totals, both writers
 * call it, and it is tested.
 */

import type { CostItem } from './types';
import type { Pence } from './money';

export interface VersionTotals {
  /** Sum of the recorded budgets. Lines with no recorded budget add nothing. */
  budgetCost: Pence;
  /**
   * False when any line has no recorded budget at all.
   *
   * The distinction is the whole reason this is not a plain sum: an imported
   * workbook that recorded a client price and an actual cost but never a
   * budget would otherwise report a budget of zero, met exactly.
   */
  budgetCostKnown: boolean;
  linesWithoutBudget: number;
  clientPrice: Pence;
}

/**
 * Total a version from its lines.
 *
 * Proposed extras are excluded until they are agreed — they sit outside the
 * client's agreed value, which is the ruling that came out of the C & D
 * workbook, so counting them here would contradict every other figure.
 */
export function versionTotals(
  items: Array<Pick<CostItem, 'origin' | 'extraStatus' | 'draft'>>,
): VersionTotals {
  let budgetCost = 0;
  let clientPrice = 0;
  let budgetCostKnown = true;
  let linesWithoutBudget = 0;

  for (const item of items) {
    if (item.origin === 'extra' && item.extraStatus !== 'approved') continue;

    if (item.draft.budgetCost === null) {
      budgetCostKnown = false;
      linesWithoutBudget += 1;
    } else {
      budgetCost += item.draft.budgetCost;
    }
    clientPrice += item.draft.clientPrice;
  }

  return { budgetCost, budgetCostKnown, linesWithoutBudget, clientPrice };
}
