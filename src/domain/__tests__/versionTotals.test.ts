/**
 * Totalling a budget version.
 *
 * Written after an imported version reached the live site with no `totals`
 * field at all, because the import wrote the version document by hand and
 * simply left the field out. The Versions screen read `v.totals.budgetCost`
 * and the application went white.
 */

import { describe, expect, it } from 'vitest';

import { versionTotals } from '../versionTotals';
import { lumpValues } from '../values';
import { toPence } from '../money';
import type { CostItem } from '../types';

type Line = Pick<CostItem, 'origin' | 'extraStatus' | 'draft'>;

const line = (
  budgetCost: number | null,
  clientPrice: number,
  extra?: { extraStatus: CostItem['extraStatus'] },
): Line => ({
  origin: extra ? 'extra' : 'original',
  extraStatus: extra?.extraStatus ?? null,
  draft: lumpValues(budgetCost === null ? null : toPence(budgetCost), toPence(clientPrice)),
});

describe('totalling a version', () => {
  it('adds up the ordinary lines', () => {
    const totals = versionTotals([line(100, 200), line(50, 90)]);
    expect(totals.budgetCost).toBe(toPence(150));
    expect(totals.clientPrice).toBe(toPence(290));
    expect(totals.budgetCostKnown).toBe(true);
    expect(totals.linesWithoutBudget).toBe(0);
  });

  it('does not count a missing budget as a zero', () => {
    // The distinction this exists for. An imported workbook recorded client
    // prices and actual costs but never a budget; summing null as zero would
    // report a budget of nothing, met exactly.
    const totals = versionTotals([line(null, 200), line(50, 90)]);
    expect(totals.budgetCost).toBe(toPence(50));
    expect(totals.budgetCostKnown).toBe(false);
    expect(totals.linesWithoutBudget).toBe(1);
  });

  it('leaves a proposed extra out until it is agreed', () => {
    const totals = versionTotals([
      line(100, 200),
      line(40, 80, { extraStatus: 'proposed' }),
    ]);
    expect(totals.clientPrice).toBe(toPence(200));
    expect(totals.budgetCost).toBe(toPence(100));
  });

  it('counts an extra once it is agreed', () => {
    const totals = versionTotals([
      line(100, 200),
      line(40, 80, { extraStatus: 'approved' }),
    ]);
    expect(totals.clientPrice).toBe(toPence(280));
    expect(totals.budgetCost).toBe(toPence(140));
  });

  it('does not let a proposed extra with no budget mark the whole version unknown', () => {
    // It is not in the version at all, so it cannot make the version's budget
    // unknowable.
    const totals = versionTotals([line(100, 200), line(null, 80, { extraStatus: 'proposed' })]);
    expect(totals.budgetCostKnown).toBe(true);
    expect(totals.linesWithoutBudget).toBe(0);
  });

  it('totals an empty version to nothing known', () => {
    const totals = versionTotals([]);
    expect(totals).toEqual({
      budgetCost: 0,
      budgetCostKnown: true,
      linesWithoutBudget: 0,
      clientPrice: 0,
    });
  });

  it('reproduces the C & D import: every line priced, none budgeted', () => {
    const lines = Array.from({ length: 133 }, () => line(null, 100));
    const totals = versionTotals(lines);
    expect(totals.budgetCostKnown).toBe(false);
    expect(totals.linesWithoutBudget).toBe(133);
    expect(totals.budgetCost).toBe(0);
    expect(totals.clientPrice).toBe(toPence(13_300));
  });
});
