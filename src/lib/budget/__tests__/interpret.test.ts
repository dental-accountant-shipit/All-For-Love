/**
 * What the grid does with what somebody typed — and which cells will take it.
 */

import { describe, expect, it } from 'vitest';

import { cellText, interpret, isEditable, type GridRow } from '../interpret';
import { lumpValues, quantityValues } from '../../../domain/values';

const lump: GridRow = {
  id: 'a',
  categoryId: 'c',
  categoryName: 'Florals',
  description: 'Urns',
  mode: 'lump',
  values: lumpValues(10000, 20000),
};

const perDay: GridRow = {
  ...lump,
  description: 'Onsite crew — day rate',
  mode: 'quantity',
  values: quantityValues(15, 45000, 0, lump.values),
  unit: 'day',
};

describe('which cells accept typing', () => {
  it('lets a quantity line be filled in', () => {
    // The defect this exists to prevent: choosing a per-day entry from the
    // catalogue turned every numeric cell on that line grey and unclickable,
    // and there was nowhere else in the application to record the days or the
    // rate. The engine had always accepted them; only the screen said no. A
    // line you cannot fill in is worse than no line at all.
    expect(isEditable(perDay, 'budgetCost')).toBe(true);
    expect(isEditable(perDay, 'clientPrice')).toBe(true);
    expect(isEditable(perDay, 'description')).toBe(true);
  });

  it('never lets profit be typed', () => {
    // The one figure in the application that is always the answer to a
    // subtraction and never an opinion.
    expect(isEditable(lump, 'profit')).toBe(false);
    expect(isEditable(perDay, 'profit')).toBe(false);
  });

  it("will not let a percentage line's price be typed over", () => {
    const contingency: GridRow = { ...lump, mode: 'percentage' };
    expect(isEditable(contingency, 'clientPrice')).toBe(false);
    expect(isEditable(contingency, 'budgetCost')).toBe(true);
  });
});

describe('filling in a quantity line', () => {
  it('takes days times rate', () => {
    const result = interpret(perDay, 'budgetCost', '15 x 450');
    expect(result?.mode).toBe('quantity');
    expect(result?.values.budgetCost).toBe(675000);
    expect(result?.values.unitCost).toBe(45000);
  });

  it('re-derives the rate when a total is typed over it', () => {
    const result = interpret(perDay, 'budgetCost', '7500');
    expect(result?.values.budgetCost).toBe(750000);
    expect(result?.values.unitCost).toBe(50000);
    expect(result?.values.quantity).toBe(15);
  });

  it('shows the working beside the total', () => {
    expect(cellText(perDay, 'budgetCost')).toBe('6750.00');
  });
});
