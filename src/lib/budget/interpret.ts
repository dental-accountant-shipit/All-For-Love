/**
 * Turning what a person typed into stored values — the pure half of the grid.
 *
 * Kept out of the component so it can be tested without rendering anything,
 * which matters: this is where the workbook's fatal ambiguity is prevented.
 */

import {
  lumpValues,
  parseMoney,
  parseQuantityExpression,
  profitOf,
  quantityValues,
} from '../../domain/values';
import { formatGBP } from '../../domain/money';
import type { CostMode, CostValues } from '../../domain/types';
import type { ColumnKey } from './gridState';

export interface GridRow {
  id: string;
  categoryId: string;
  categoryName: string;
  description: string;
  mode: CostMode;
  values: CostValues;
  /** Rendered but not editable — a percentage line's price is derived. */
  derivedClientPrice?: boolean;
}

export const HEADINGS: Record<ColumnKey, string> = {
  description: 'Description',
  budgetCost: 'Budget Cost £',
  clientPrice: 'Client Price £',
  profit: 'Profit £',
};

export function cellText(row: GridRow, col: ColumnKey): string {
  switch (col) {
    case 'description':
      return row.description;
    case 'budgetCost':
      // Never recorded reads as a dash. Zero reads as zero. They differ.
      if (row.values.budgetCost === null) return '—';
      return row.values.budgetCost === 0 ? '' : (row.values.budgetCost / 100).toFixed(2);
    case 'clientPrice':
      return row.values.clientPrice === 0 ? '' : (row.values.clientPrice / 100).toFixed(2);
    case 'profit': {
      const profit = profitOf(row.values);
      return profit === null ? '—' : formatGBP(profit);
    }
  }
}

/**
 * Turning what was typed into stored values.
 *
 * `15 x 320` in a money cell converts the line to quantity mode and fills in
 * the rate — the shorthand people already write into descriptions. A plain
 * number keeps the line simple. Anything unparseable returns null so the cell
 * can be flagged rather than silently storing zero, which is how a pasted
 * budget quietly loses a line.
 */
export function interpret(
  row: GridRow,
  col: ColumnKey,
  input: string,
): { mode: CostMode; values: CostValues } | null {
  if (col === 'description' || col === 'profit') return null;

  const expression = parseQuantityExpression(input);
  if (expression) {
    const { quantity, unitAmount } = expression;
    // Converting a lump line to a quantity line must not touch the other
    // column. The side that was not typed keeps its exact total and stays a
    // lump — deriving a rate from it would move an agreed figure by pennies.
    const unitCost = col === 'budgetCost' ? unitAmount : row.values.unitCost;
    // Typing a cost onto a line whose budget was never recorded records it.
    const unitPrice = col === 'clientPrice' ? unitAmount : row.values.unitPrice;
    return {
      mode: 'quantity',
      values: quantityValues(quantity, unitCost, unitPrice, row.values),
    };
  }

  const amount = parseMoney(input);
  if (amount === null) return null;

  if (row.mode === 'quantity') {
    // Typing a total into a rated column re-derives the rate; typing into the
    // column that has no rate simply sets the total.
    const quantity = row.values.quantity ?? 1;
    const rated = col === 'budgetCost' ? row.values.unitCost : row.values.unitPrice;
    const unit = rated === null ? null : Math.round(amount / (quantity || 1));
    return {
      mode: 'quantity',
      values: quantityValues(
        quantity,
        col === 'budgetCost' ? unit : row.values.unitCost,
        col === 'clientPrice' ? unit : row.values.unitPrice,
        {
          budgetCost: col === 'budgetCost' ? amount : row.values.budgetCost,
          clientPrice: col === 'clientPrice' ? amount : row.values.clientPrice,
        } as { budgetCost: number | null; clientPrice: number },
      ),
    };
  }

  return {
    mode: 'lump',
    values: lumpValues(
      col === 'budgetCost' ? amount : row.values.budgetCost,
      col === 'clientPrice' ? amount : row.values.clientPrice,
    ),
  };
}

