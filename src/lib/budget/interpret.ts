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
import { formatAmount } from '../../domain/money';
import type { CostMode, CostValues } from '../../domain/types';
import type { ColumnKey } from './gridState';

export interface GridRow {
  id: string;
  categoryId: string;
  categoryName: string;
  description: string;
  mode: CostMode;
  values: CostValues;
  /**
   * What one unit is on a quantity line — "metre", "day", "person-day".
   * Shown beside the quantity, because 24 on its own is not a figure anybody
   * can check.
   */
  unit?: string | null;
  /** Rendered but not editable — a percentage line's price is derived. */
  derivedClientPrice?: boolean;
}

export const HEADINGS: Record<ColumnKey, string> = {
  description: 'Description',
  quantity: 'Qty',
  unit: 'Unit',
  unitCost: 'Cost each £',
  budgetCost: 'Budget Cost £',
  clientPrice: 'Client Price £',
  profit: 'Profit £',
};

/**
 * Which cells accept typing.
 *
 * This was inline in the grid and wrong in a way that made whole lines
 * unfillable: every numeric cell on a *quantity* line was treated as derived
 * and refused clicks. So choosing "Onsite crew — day rate" from the catalogue
 * — which is the moment the line becomes a quantity line — locked the cost and
 * price columns, and there was nowhere else in the application to put the
 * numbers. The engine had always accepted them; only the screen said no.
 *
 * Genuinely derived, and only these: profit is always computed, and a
 * percentage line's client price is a percentage of something else.
 */
export function isEditable(row: GridRow, col: ColumnKey): boolean {
  if (col === 'profit') return false;
  if (row.mode === 'percentage') {
    // A contingency line is a percentage of a base. It has no quantity, no
    // unit and no rate, and its price is worked out by the rollup.
    return col === 'description' || col === 'budgetCost';
  }
  return true;
}

export function cellText(row: GridRow, col: ColumnKey): string {
  switch (col) {
    case 'description':
      return row.description;
    case 'quantity':
      return row.values.quantity === null ? '' : String(row.values.quantity);
    case 'unit':
      return row.unit ?? '';
    case 'unitCost':
      // Null here is not "nothing". It means this side is a lump total rather
      // than a rate, which is a real and deliberate state — see quantityValues.
      return row.values.unitCost === null ? '' : formatAmount(row.values.unitCost);
    case 'budgetCost':
      // Never recorded reads as a dash. Zero reads as zero. They differ.
      if (row.values.budgetCost === null) return '—';
      return row.values.budgetCost === 0 ? '' : formatAmount(row.values.budgetCost);
    case 'clientPrice':
      return row.values.clientPrice === 0 ? '' : formatAmount(row.values.clientPrice);
    case 'profit': {
      const profit = profitOf(row.values);
      return profit === null ? '—' : formatAmount(profit);
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
export type CellEdit =
  | { kind: 'values'; mode: CostMode; values: CostValues }
  | { kind: 'unit'; unit: string | null };

export function interpret(row: GridRow, col: ColumnKey, input: string): CellEdit | null {
  if (col === 'description' || col === 'profit') return null;

  // The unit is a label, not a figure: no calculation reads it. It is still
  // worth having, because a quantity of 285 turned out to mean person-days
  // rather than people, and no arithmetic can tell you that.
  if (col === 'unit') {
    const unit = input.trim();
    return { kind: 'unit', unit: unit === '' ? null : unit };
  }

  // Clearing the quantity makes the line a lump again, keeping both totals
  // exactly as they stand. Deriving anything here would move an agreed figure.
  if (col === 'quantity') {
    const text = input.trim();
    if (text === '') {
      return {
        kind: 'values',
        mode: 'lump',
        values: lumpValues(row.values.budgetCost, row.values.clientPrice),
      };
    }
    const quantity = Number(text.replace(/,/g, ''));
    if (!Number.isFinite(quantity) || quantity < 0) return null;
    return {
      kind: 'values',
      mode: 'quantity',
      values: quantityValues(quantity, row.values.unitCost, row.values.unitPrice, row.values),
    };
  }

  // Clearing the rate returns this side to being a lump total — the state that
  // exists for assistants charged per day and billed to the client as one
  // figure.
  if (col === 'unitCost') {
    const text = input.trim();
    const quantity = row.values.quantity ?? 1;
    if (text === '') {
      return {
        kind: 'values',
        mode: row.values.quantity === null ? 'lump' : 'quantity',
        values:
          row.values.quantity === null
            ? lumpValues(row.values.budgetCost, row.values.clientPrice)
            : quantityValues(quantity, null, row.values.unitPrice, row.values),
      };
    }
    const rate = parseMoney(text);
    if (rate === null) return null;
    return {
      kind: 'values',
      mode: 'quantity',
      values: quantityValues(quantity, rate, row.values.unitPrice, row.values),
    };
  }

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
      kind: 'values',
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
      kind: 'values',
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
    kind: 'values',
    mode: 'lump',
    values: lumpValues(
      col === 'budgetCost' ? amount : row.values.budgetCost,
      col === 'clientPrice' ? amount : row.values.clientPrice,
    ),
  };
}

