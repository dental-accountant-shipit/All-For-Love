/**
 * Rollups: cost item → sub-event → project.
 *
 * Sub-events are always present. An ordinary event has exactly one, created
 * with the project and never shown, so the same code path serves a single
 * marquee wedding and a three-day destination event with a welcome dinner,
 * a wedding day and a farewell brunch.
 *
 * In production these functions run inside a Cloud Function on writes to
 * commitments and transactions. They are pure so that the same code can be
 * run against a real past workbook to prove the numbers before anyone trusts
 * a screen.
 */

import { margin, type Pence } from './money';
import { forecastCostItem, budgetForForecast, isOverBudget } from './forecast';
import { calculateCommission, isAgreed, isProposedExtra, revenueBreakdown } from './revenue';
import {
  DEFAULT_PROJECT_SETTINGS,
  type Category,
  type Commission,
  type Commitment,
  type CostItem,
  type FinancialRollup,
  type ProjectRollup,
  type ProjectSettings,
  type SubEvent,
  type Transaction,
} from './types';

export interface RollupInput {
  costItems: CostItem[];
  commitments: Commitment[];
  transactions: Transaction[];
}

/**
 * Resolve percentage lines (contingency) before anything else reads a total.
 *
 * A percentage line is computed over the original priced lines of its OWN
 * sub-event, so sub-event totals still sum to the project total. It cannot
 * compound: percentage lines never form part of another percentage line's
 * base.
 *
 * Three things keep a line out of the base:
 *
 *   1. Its category says so — `category.includeInContingencyBase`. The
 *      reference workbook excludes Creative, and All for Love keep that, but
 *      it is recorded as a decision about a category rather than inferred from
 *      the word "Creative". Categories not supplied are treated as included,
 *      so a caller that has not loaded them cannot silently shrink the base.
 *   2. It is an optional extra, and the project setting
 *      `applyContingencyToApprovedExtras` is off (the default) or the extra is
 *      not approved. An extra is negotiated and priced at the time with its
 *      own margin, so adding a buffer on top re-prices a change the client has
 *      already agreed.
 *   3. The client value has been withdrawn.
 *
 * The reference workbook gets two further things wrong — its label says 6%
 * while the cell says 5.25%, and its base misses a category by accident rather
 * than by decision. Both are why this is computed rather than typed.
 */
export function applyPercentageLines(
  items: CostItem[],
  settings: ProjectSettings = DEFAULT_PROJECT_SETTINGS,
  categories: Array<Pick<Category, 'id' | 'includeInContingencyBase'>> = [],
): CostItem[] {
  // Absence means "no opinion", not "excluded". A caller that forgot to load
  // categories gets the full base, which is wrong in the safe direction —
  // visibly too much contingency, rather than a quietly smaller one.
  const excluded = new Set(
    categories.filter((c) => c.includeInContingencyBase === false).map((c) => c.id),
  );

  const baseBySubEvent = new Map<string, Pence>();
  for (const item of items) {
    if (item.mode === 'percentage') continue;
    if (excluded.has(item.categoryId)) continue;
    if (item.origin === 'extra') {
      if (!settings.applyContingencyToApprovedExtras) continue;
      if (item.extraStatus !== 'approved') continue;
    }
    if (item.clientValueWithdrawn) continue;
    const values = item.approved ?? item.draft;
    baseBySubEvent.set(
      item.subEventId,
      (baseBySubEvent.get(item.subEventId) ?? 0) + values.clientPrice,
    );
  }

  return items.map((item) => {
    if (item.mode !== 'percentage') return item;
    const base = baseBySubEvent.get(item.subEventId) ?? 0;
    const rate = (item.approved ?? item.draft).percentageRate ?? 0;
    const clientPrice = Math.round(base * (rate / 100));
    return {
      ...item,
      draft: { ...item.draft, clientPrice },
      approved: item.approved ? { ...item.approved, clientPrice } : null,
    };
  });
}

function emptyFinancials(): Omit<FinancialRollup, 'recomputedAt' | 'recomputeSeq'> {
  return {
    budgetCost: 0,
    budgetCostKnown: true,
    linesWithoutBudget: 0,
    committedTotal: 0,
    committedRemaining: 0,
    actualTotal: 0,
    forecastCost: 0,
    originalClientValue: 0,
    approvedExtras: 0,
    agreedReductions: 0,
    currentAgreedClientRevenue: 0,
    forecastProfit: 0,
    forecastMargin: null,
    proposedExtrasRevenue: 0,
    proposedExtrasCost: 0,
    proposedExtrasCostKnown: true,
    proposedExtrasActualCost: 0,
    lineCount: 0,
    linesOverBudget: 0,
  };
}

/**
 * Financial position for an arbitrary set of cost items — one sub-event, or a
 * whole project. Proposed and rejected extras are excluded from both cost and
 * revenue; proposed ones are reported separately so the opportunity is
 * visible without contaminating the agreed position.
 */
export function rollupFinancials(
  input: RollupInput,
  at: string,
  seq: number,
): FinancialRollup {
  const totals = emptyFinancials();
  const revenue = revenueBreakdown(input.costItems);

  for (const item of input.costItems) {
    if (isProposedExtra(item) || !isAgreed(item)) {
      // Not part of the agreed position — but money spent on it is still money
      // spent. An imported historical extra typically has a real supplier cost
      // and an unconfirmed selling value, and dropping the cost on the floor
      // here would make an unrecovered £4,000 disappear from the system
      // entirely. Reported separately, never blended in.
      if (isProposedExtra(item)) {
        totals.proposedExtrasActualCost += forecastCostItem(
          item,
          input.commitments,
          input.transactions,
        ).actualTotal;
      }
      continue;
    }

    const result = forecastCostItem(item, input.commitments, input.transactions);

    const budget = budgetForForecast(item);
    if (budget === null) {
      // An imported historical line. Counting it as zero would report a
      // variance of zero, which reads as "on budget" for a budget that was
      // never set. The whole rollup is marked unmeasurable instead.
      totals.budgetCostKnown = false;
      totals.linesWithoutBudget += 1;
    } else {
      totals.budgetCost += budget;
    }
    totals.committedTotal += result.committedTotal;
    totals.committedRemaining += result.committedRemaining;
    totals.actualTotal += result.actualTotal;
    totals.forecastCost += result.forecastCost;
    totals.lineCount += 1;
    if (isOverBudget(item, result)) totals.linesOverBudget += 1;
  }

  totals.originalClientValue = revenue.originalClientValue;
  totals.approvedExtras = revenue.approvedExtras;
  totals.agreedReductions = revenue.agreedReductions;
  totals.currentAgreedClientRevenue = revenue.currentAgreedClientRevenue;
  totals.proposedExtrasRevenue = revenue.proposedExtrasRevenue;
  totals.proposedExtrasCost = revenue.proposedExtrasCost;
  totals.proposedExtrasCostKnown = revenue.proposedExtrasCostKnown;

  totals.forecastProfit = totals.currentAgreedClientRevenue - totals.forecastCost;
  totals.forecastMargin = margin(totals.forecastProfit, totals.currentAgreedClientRevenue);

  return { ...totals, recomputedAt: at, recomputeSeq: seq };
}

/**
 * Whole-project rollup, including a per-sub-event breakdown.
 *
 * Sub-event profitability is reported BEFORE commission. Commission is a
 * project-level obligation in the MVP, so attributing it down to a single day
 * of a three-day event would be an invented number.
 */
export function rollupProject(
  input: RollupInput & {
    subEvents: SubEvent[];
    commissions: Commission[];
    settings?: ProjectSettings;
    /**
     * Needed for `includeInContingencyBase`. Omitting them puts every category
     * in the contingency base — see `applyPercentageLines`.
     */
    categories?: Array<Pick<Category, 'id' | 'includeInContingencyBase'>>;
  },
  at: string,
  seq: number,
): ProjectRollup {
  // Percentage lines are resolved once, up front, so every figure below —
  // project and sub-event alike — reads the same resolved values.
  input = {
    ...input,
    costItems: applyPercentageLines(
      input.costItems,
      input.settings ?? DEFAULT_PROJECT_SETTINGS,
      input.categories ?? [],
    ),
  };

  const project = rollupFinancials(input, at, seq);

  const subEvents = [...input.subEvents]
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    .map((se) => {
      const items = input.costItems.filter((i) => i.subEventId === se.id);
      const ids = new Set(items.map((i) => i.id));
      const financials = rollupFinancials(
        {
          costItems: items,
          commitments: input.commitments.filter((c) => ids.has(c.costItemId)),
          transactions: input.transactions.filter(
            (t) => t.costItemId !== null && ids.has(t.costItemId),
          ),
        },
        at,
        seq,
      );
      return { subEventId: se.id, name: se.name, ...financials };
    });

  const commission = calculateCommission(
    input.commissions,
    project.currentAgreedClientRevenue,
    project.forecastProfit,
    project.forecastCost,
  );

  const netProfitAfterCommission = project.forecastProfit - commission.total;

  return {
    ...project,
    subEvents,
    commissionTotal: commission.total,
    netProfitAfterCommission,
    netMarginAfterCommission: margin(
      netProfitAfterCommission,
      project.currentAgreedClientRevenue,
    ),
  };
}

/**
 * Guard for the recompute chain. A recompute writes a whole result with an
 * incrementing sequence, so replaying an event is harmless and a stale
 * function invocation cannot overwrite a newer result.
 */
export function shouldApplyRecompute(
  existingSeq: number | undefined,
  incomingSeq: number,
): boolean {
  return existingSeq === undefined || incomingSeq > existingSeq;
}

/** Sub-event totals must always sum to the project total. Used in tests and CI. */
export function subEventTotalsReconcile(rollup: ProjectRollup): boolean {
  const keys: Array<keyof FinancialRollup> = [
    'budgetCost',
    'linesWithoutBudget',
    'committedTotal',
    'committedRemaining',
    'actualTotal',
    'forecastCost',
    'currentAgreedClientRevenue',
    'forecastProfit',
    'proposedExtrasRevenue',
    'proposedExtrasActualCost',
  ];
  return keys.every((k) => {
    const total = rollup.subEvents.reduce((a, se) => a + (se[k] as Pence), 0);
    return total === (rollup[k] as Pence);
  });
}
