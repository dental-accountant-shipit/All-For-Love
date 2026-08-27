/**
 * Turning a filled-in form into a line.
 *
 * Pure, and separate from the form, because this is where the workbook's fatal
 * ambiguity would creep back in: whether the figure in a box is a rate or a
 * total. Every defect this project has had was in untested scaffolding like
 * this, never in the engine, so it is tested.
 */

import { lumpValues, parseMoney, quantityValues } from '../../domain/values';
import type { CostMode, CostValues } from '../../domain/types';
import type { Pence } from '../../domain/money';

export interface LineFields {
  description: string;
  /** Blank means "this is not a quantity line". */
  quantity: string;
  unit: string;
  /** Cost each on a quantity line; the whole budgeted cost otherwise. */
  cost: string;
  /** Always a total, on every kind of line. */
  price: string;
}

export interface NewLine {
  description: string;
  unit: string | null;
  mode: CostMode;
  values: CostValues;
}

export interface LineReading {
  quantity: number | null;
  cost: Pence | null;
  price: Pence | null;
  quantityValid: boolean;
  costValid: boolean;
  priceValid: boolean;
  /** What the budgeted cost comes to. Null means no cost was given at all. */
  budgetTotal: Pence | null;
  clientTotal: Pence;
  profit: Pence | null;
  ready: boolean;
}

/**
 * What the boxes currently say, and what that adds up to.
 *
 * Separate from building the line so the form can show the arithmetic while it
 * is being typed. A rate and a total are never confusable when the product is
 * on screen beside them.
 */
export function readLine(fields: LineFields): LineReading {
  const quantityText = fields.quantity.trim();
  const quantity = quantityText === '' ? null : Number(quantityText.replace(/,/g, ''));
  const quantityValid = quantity === null || (Number.isFinite(quantity) && quantity >= 0);

  const cost = fields.cost.trim() === '' ? null : parseMoney(fields.cost);
  const price = fields.price.trim() === '' ? null : parseMoney(fields.price);
  const costValid = fields.cost.trim() === '' || cost !== null;
  const priceValid = fields.price.trim() === '' || price !== null;

  const budgetTotal =
    quantity !== null && quantityValid && cost !== null ? Math.round(quantity * cost) : cost;
  const clientTotal = price ?? 0;

  return {
    quantity: quantityValid ? quantity : null,
    cost,
    price,
    quantityValid,
    costValid,
    priceValid,
    budgetTotal,
    clientTotal,
    profit: budgetTotal === null ? null : clientTotal - budgetTotal,
    ready:
      fields.description.trim() !== '' && quantityValid && costValid && priceValid,
  };
}

/**
 * Build the line, or null if the form is not ready.
 *
 * A cost left blank stores null rather than zero. Those are different facts —
 * null is "no budget was ever recorded", which every variance figure downstream
 * reports as unavailable rather than as met.
 */
export function buildNewLine(fields: LineFields): NewLine | null {
  const reading = readLine(fields);
  if (!reading.ready) return null;

  const unit = fields.unit.trim();
  const description = fields.description.trim();

  if (reading.quantity !== null) {
    return {
      description,
      unit: unit === '' ? null : unit,
      mode: 'quantity',
      values: quantityValues(reading.quantity, reading.cost, null, {
        // Only consulted when there is no rate: the line then keeps a lump
        // total rather than having one invented for it.
        budgetCost: reading.cost === null ? null : undefined,
        clientPrice: reading.clientTotal,
      }),
    };
  }

  return {
    description,
    unit: unit === '' ? null : unit,
    mode: 'lump',
    values: lumpValues(reading.cost, reading.clientTotal),
  };
}
