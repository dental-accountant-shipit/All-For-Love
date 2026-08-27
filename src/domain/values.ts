/**
 * Cost line values: how a typed figure becomes a stored one.
 *
 * The rule this file exists to enforce: **a figure in a money column is always
 * a total.** The reference workbook does not do this — its "Actual Cost per
 * unit" column holds a per-unit rate on some rows and a whole supplier invoice
 * on others, and that single ambiguity is responsible for a £36,820
 * discrepancy between two cost totals in the same spreadsheet.
 *
 * So in quantity and percentage modes the totals are derived here and the
 * money cells are read-only in the interface. There is no path by which a
 * user can type a number whose meaning is unclear.
 */

import { toPence, type Pence } from './money';
import type { CostMode, CostValues } from './types';

export const ZERO_VALUES: CostValues = {
  quantity: null,
  unitCost: null,
  unitPrice: null,
  percentageRate: null,
  budgetCost: 0,
  clientPrice: 0,
};

export function lumpValues(budgetCost: Pence | null, clientPrice: Pence): CostValues {
  return { ...ZERO_VALUES, budgetCost, clientPrice };
}

/**
 * A quantity line. Either side may be null, meaning "this side is a lump total,
 * not a rate" — which is a real case: assistants charged per day but billed to
 * the client as one figure.
 *
 * Null is not a convenience. Deriving a rate from a total cannot round-trip:
 * £10,000 over 15 units is £666.67 a unit, and 15 of those is £10,000.05. A
 * five-pence drift in a price the client has already agreed is precisely the
 * class of silent change this system exists to eliminate, so the side that was
 * not typed keeps its exact total instead.
 */
export function quantityValues(
  quantity: number,
  unitCost: Pence | null,
  unitPrice: Pence | null,
  totals: { budgetCost?: Pence | null; clientPrice?: Pence } = {},
): CostValues {
  return {
    quantity,
    unitCost,
    unitPrice,
    percentageRate: null,
    budgetCost:
      unitCost !== null
        ? Math.round(quantity * unitCost)
        : totals.budgetCost === undefined
          ? 0
          : totals.budgetCost,
    clientPrice: unitPrice !== null ? Math.round(quantity * unitPrice) : (totals.clientPrice ?? 0),
  };
}

/**
 * A percentage line's client price is filled in by the rollup, which knows the
 * base. Its cost is whatever was entered, normally zero.
 */
export function percentageValues(
  percentageRate: number,
  budgetCost: Pence | null = 0,
): CostValues {
  return { ...ZERO_VALUES, percentageRate, budgetCost };
}

/**
 * Budgeted profit for a line. Null when no budget was ever recorded — an
 * unknown cost cannot produce a known profit, and showing one would be a lie
 * dressed as a figure.
 */
export function profitOf(values: CostValues): Pence | null {
  if (values.budgetCost === null) return null;
  return values.clientPrice - values.budgetCost;
}

export function marginOf(values: CostValues): number | null {
  const profit = profitOf(values);
  if (profit === null || values.clientPrice === 0) return null;
  return profit / values.clientPrice;
}

/**
 * Recompute the derived totals after any field on a line changes. Called on
 * every cell commit, so a quantity edit and a unit-cost edit both land as a
 * consistent whole rather than leaving the row briefly wrong.
 */
export function recompute(mode: CostMode, values: CostValues): CostValues {
  switch (mode) {
    case 'quantity':
      return quantityValues(values.quantity ?? 0, values.unitCost, values.unitPrice, values);
    case 'percentage':
      // clientPrice is owned by the rollup; leave whatever is there.
      return { ...values, quantity: null, unitCost: null, unitPrice: null };
    case 'lump':
      return { ...values, quantity: null, unitCost: null, unitPrice: null, percentageRate: null };
  }
}

// ---------------------------------------------------------------------------
// Parsing what people actually type
// ---------------------------------------------------------------------------

/**
 * Money as typed into a cell. Accepts "4800", "4,800", "£4,800.50", "(500)"
 * for negative, and a bare "-". Returns null when it cannot tell, so the
 * interface can highlight the cell rather than silently storing a zero —
 * which is how a pasted budget quietly loses a line.
 */
export function parseMoney(input: string): Pence | null {
  const raw = input.trim();
  if (raw === '') return 0;

  const bracketed = /^\((.*)\)$/.exec(raw);
  const body = bracketed ? bracketed[1] : raw;

  const cleaned = body.replace(/[£$€\s,]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;

  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;

  const pence = toPence(n);
  return bracketed ? -pence : pence;
}

export interface QuantityExpression {
  quantity: number;
  unitAmount: Pence;
}

/**
 * "15 x 320", "15 × 320", "15*320" — the shorthand that turns a lump line into
 * a quantity line in one keystroke, because that is how people already write
 * it in the workbook descriptions ("Aisle Runners - 350 per metre").
 */
export function parseQuantityExpression(input: string): QuantityExpression | null {
  const match = /^\s*([\d,.]+)\s*[x×*]\s*(.+?)\s*$/i.exec(input);
  if (!match) return null;

  const quantityText = match[1].replace(/,/g, '');
  const quantity = Number(quantityText);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  // Guards against a mistyped or half-overwritten cell turning into a
  // plausible-looking line. "6400.0015 x 320" is not fifteen assistants at
  // £320 — it is a cell that was edited on top of its existing contents, and
  // silently storing £2,048,000 for it is the worst possible response.
  if (quantity > 100_000) return null;
  const decimals = quantityText.split('.')[1]?.length ?? 0;
  if (decimals > 3) return null;

  const unitAmount = parseMoney(match[2]);
  if (unitAmount === null) return null;

  return { quantity, unitAmount };
}

/** "5.25%", "5.25", "6 %" → 5.25. Null when it is not a percentage at all. */
export function parsePercentage(input: string): number | null {
  const cleaned = input.trim().replace(/%$/, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * One tab-separated block from Excel, split into rows and cells.
 * Excel quotes any cell containing a tab, newline or quote; this honours that
 * rather than splitting naively and mangling a description.
 */
export function parseClipboardTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
      continue;
    }

    if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === '\t') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // Excel adds a trailing newline; drop the empty row it produces.
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/**
 * Normalise the sign on a recorded cost.
 *
 * A credit is stored as a negative amount of the same shape as a bill, not as
 * a separate concept, so every sum in the engine handles it without knowing it
 * exists. Doing that conversion here rather than in the form means a credit
 * entered as a positive figure — which is how people naturally type it, and
 * how it appears on the supplier's document — cannot silently increase the
 * project's cost.
 */
export function signedAmounts(
  type: 'bill' | 'credit' | 'expense',
  amountExVat: Pence,
  vatAmount: Pence,
): { amountExVat: Pence; vatAmount: Pence } {
  if (type !== 'credit') return { amountExVat, vatAmount };
  return { amountExVat: -Math.abs(amountExVat), vatAmount: -Math.abs(vatAmount) };
}
