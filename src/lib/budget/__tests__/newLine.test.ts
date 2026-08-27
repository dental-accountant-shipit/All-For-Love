/**
 * The add-a-line form's arithmetic.
 *
 * Every defect this project has had was in scaffolding like this rather than
 * in the engine, which is the whole reason it is a module and not a closure
 * inside a component.
 */

import { describe, expect, it } from 'vitest';

import { buildNewLine, readLine, type LineFields } from '../newLine';
import { toPence } from '../../../domain/money';

const blank: LineFields = { description: '', quantity: '', unit: '', cost: '', price: '' };

describe('reading the form as it is typed', () => {
  it('multiplies a quantity line out', () => {
    const r = readLine({
      ...blank,
      description: 'Onsite crew — day rate',
      quantity: '15',
      unit: 'day',
      cost: '450',
      price: '9000',
    });
    expect(r.budgetTotal).toBe(toPence(6_750));
    expect(r.clientTotal).toBe(toPence(9_000));
    expect(r.profit).toBe(toPence(2_250));
    expect(r.ready).toBe(true);
  });

  it('treats the cost box as the whole cost when there is no quantity', () => {
    // The label changes with it — "Budget cost £" rather than "Cost each £" —
    // because the same box meaning two things without saying so is precisely
    // the workbook's £36,820 mistake.
    const r = readLine({ ...blank, description: 'Urns', cost: '1200', price: '1800' });
    expect(r.budgetTotal).toBe(toPence(1_200));
    expect(r.profit).toBe(toPence(600));
  });

  it('will not report a profit when no cost was given', () => {
    // A blank cost is "not recorded", not zero. Reporting £1,800 of profit
    // against an unknown cost is a lie dressed as a figure.
    const r = readLine({ ...blank, description: 'Urns', price: '1800' });
    expect(r.budgetTotal).toBeNull();
    expect(r.profit).toBeNull();
    expect(r.ready).toBe(true);
  });

  it('refuses nonsense rather than storing a zero', () => {
    const r = readLine({ ...blank, description: 'Urns', cost: 'about twelve hundred' });
    expect(r.costValid).toBe(false);
    expect(r.ready).toBe(false);
  });

  it('refuses a negative quantity', () => {
    const r = readLine({ ...blank, description: 'Urns', quantity: '-3' });
    expect(r.quantityValid).toBe(false);
    expect(r.ready).toBe(false);
  });

  it('is not ready without a description', () => {
    expect(readLine({ ...blank, cost: '1200' }).ready).toBe(false);
    expect(readLine({ ...blank, description: '   ', cost: '1200' }).ready).toBe(false);
  });

  it('takes money as people write it', () => {
    expect(readLine({ ...blank, description: 'x', cost: '£1,200.50' }).budgetTotal).toBe(
      toPence(1_200.5),
    );
  });
});

describe('building the line', () => {
  it('makes a quantity line that keeps its rate and its unit', () => {
    const line = buildNewLine({
      ...blank,
      description: '  Steps dressing  ',
      quantity: '24',
      unit: ' metre ',
      cost: '30',
      price: '1080',
    })!;
    expect(line.mode).toBe('quantity');
    expect(line.description).toBe('Steps dressing');
    expect(line.unit).toBe('metre');
    expect(line.values.quantity).toBe(24);
    expect(line.values.unitCost).toBe(toPence(30));
    expect(line.values.budgetCost).toBe(toPence(720));
    expect(line.values.clientPrice).toBe(toPence(1_080));
  });

  it('leaves the client side as a total rather than inventing a rate for it', () => {
    // Deriving a price per unit from an agreed total cannot round-trip:
    // £10,000 over 15 is £666.67, and 15 of those is £10,000.05. Five pence of
    // drift in a figure the client has agreed is the exact class of silent
    // change this system exists to remove.
    const line = buildNewLine({
      ...blank,
      description: 'Assistants',
      quantity: '15',
      cost: '400',
      price: '10000',
    })!;
    expect(line.values.unitPrice).toBeNull();
    expect(line.values.clientPrice).toBe(toPence(10_000));
  });

  it('stores a missing cost as never recorded, not as zero', () => {
    const line = buildNewLine({ ...blank, description: 'Urns', price: '1800' })!;
    expect(line.values.budgetCost).toBeNull();
  });

  it('stores a missing cost as never recorded on a quantity line too', () => {
    const line = buildNewLine({
      ...blank,
      description: 'Assistants',
      quantity: '15',
      price: '10000',
    })!;
    expect(line.values.budgetCost).toBeNull();
    expect(line.values.quantity).toBe(15);
  });

  it('makes a lump line when the quantity is left blank', () => {
    const line = buildNewLine({ ...blank, description: 'Urns', cost: '1200', price: '1800' })!;
    expect(line.mode).toBe('lump');
    expect(line.values.quantity).toBeNull();
    expect(line.values.unitCost).toBeNull();
  });

  it('gives nothing back when the form is not ready', () => {
    expect(buildNewLine(blank)).toBeNull();
    expect(buildNewLine({ ...blank, description: 'Urns', cost: 'nonsense' })).toBeNull();
  });

  it('keeps a blank unit as null rather than as an empty string', () => {
    const line = buildNewLine({ ...blank, description: 'Urns', quantity: '3', cost: '10' })!;
    expect(line.unit).toBeNull();
  });
});
