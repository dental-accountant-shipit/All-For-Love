import { describe, expect, it } from 'vitest';

import {
  EDITABLE_COLUMNS,
  focusCell,
  handleKey,
  initialGridState,
  updateEdit,
  type GridContext,
  type GridState,
} from '../gridState';
import { interpret, type GridRow } from '../interpret';
import { lumpValues, quantityValues } from '../../../domain/values';
import { toPence } from '../../../domain/money';

/**
 * Most edits produce values. The unit column produces a label instead, so the
 * result is a union; these tests are about the numbers.
 */
function valued(edit: ReturnType<typeof interpret>) {
  if (!edit || edit.kind !== 'values') throw new Error('expected a values edit');
  return edit;
}


const ctx: GridContext = {
  rowCount: 3,
  valueAt: (row, col) => `${col}-${row}`,
};

function at(row: number, col: Parameters<typeof focusCell>[2]): GridState {
  return focusCell(initialGridState, row, col);
}

describe('budget grid keyboard', () => {
  it('Tab walks the editable columns and skips derived Profit', () => {
    // Description → Qty → Unit → Cost each → Budget → Client, then the next
    // line. Quantity, unit and rate have boxes of their own now; they used to
    // be reachable only through the `15 x 450` shorthand.
    let s = at(0, 'description');
    const visited: string[] = [];
    for (let i = 0; i < 5; i++) {
      s = handleKey(s, { key: 'Tab' }, ctx).state;
      visited.push(s.focus.col);
    }
    expect(visited).toEqual(['quantity', 'unit', 'unitCost', 'budgetCost', 'clientPrice']);

    s = handleKey(s, { key: 'Tab' }, ctx).state;
    // Wraps to the next row rather than landing on Profit.
    expect(s.focus).toEqual({ row: 1, col: 'description' });
  });

  it('Shift+Tab walks backwards across rows', () => {
    let s = at(1, 'description');
    s = handleKey(s, { key: 'Tab', shiftKey: true }, ctx).state;
    expect(s.focus).toEqual({ row: 0, col: 'clientPrice' });
  });

  it('the unit column is reachable by keyboard, not only by mouse', () => {
    // A column you can see and click but cannot Tab into is worse than no
    // column: it breaks the rhythm of filling a line in left to right.
    expect(EDITABLE_COLUMNS).toContain('unit');
    expect(EDITABLE_COLUMNS).not.toContain('profit');
  });

  it('Tab stops at the end rather than wrapping to the top', () => {
    const s = at(2, 'clientPrice');
    const r = handleKey(s, { key: 'Tab' }, ctx);
    expect(r.state.focus).toEqual({ row: 2, col: 'clientPrice' });
  });

  it('Enter opens an edit seeded with the current value', () => {
    const r = handleKey(at(1, 'budgetCost'), { key: 'Enter' }, ctx);
    expect(r.state.editing).toBe('budgetCost-1');
    expect(r.handled).toBe(true);
  });

  it('typing a character replaces the cell, as a spreadsheet does', () => {
    const r = handleKey(at(1, 'budgetCost'), { key: '4' }, ctx);
    expect(r.state.editing).toBe('4');
    expect(r.state.editingOriginal).toBe('budgetCost-1');
  });

  it('Enter commits and moves down', () => {
    let s = at(0, 'budgetCost');
    s = handleKey(s, { key: 'Enter' }, ctx).state;
    s = updateEdit(s, '42000');
    const r = handleKey(s, { key: 'Enter' }, ctx);
    expect(r.intent).toEqual({ type: 'commit', row: 0, col: 'budgetCost', value: '42000' });
    expect(r.state.focus).toEqual({ row: 1, col: 'budgetCost' });
    expect(r.state.editing).toBeNull();
  });

  it('Enter on the last row commits and adds a new one, cursor in Description', () => {
    let s = at(2, 'clientPrice');
    s = handleKey(s, { key: 'Enter' }, ctx).state;
    s = updateEdit(s, '9600');
    const r = handleKey(s, { key: 'Enter' }, ctx);
    expect(r.intent).toEqual({
      type: 'commitAndInsertBelow',
      row: 2,
      col: 'clientPrice',
      value: '9600',
    });
    expect(r.state.focus).toEqual({ row: 3, col: 'description' });
  });

  it('Shift+Enter inserts a row above instead of continuing downward', () => {
    const r = handleKey(at(1, 'description'), { key: 'Enter', shiftKey: true }, ctx);
    expect(r.intent).toEqual({ type: 'insertAbove', row: 1 });
  });

  it('Tab commits the edit in flight', () => {
    let s = at(0, 'description');
    s = handleKey(s, { key: 'Enter' }, ctx).state;
    s = updateEdit(s, 'Ceremony florals');
    const r = handleKey(s, { key: 'Tab' }, ctx);
    expect(r.intent).toEqual({
      type: 'commit',
      row: 0,
      col: 'description',
      value: 'Ceremony florals',
    });
    expect(r.state.focus).toEqual({ row: 0, col: 'quantity' });
  });

  it('Escape abandons the edit and commits nothing', () => {
    let s = at(0, 'budgetCost');
    s = handleKey(s, { key: 'Enter' }, ctx).state;
    s = updateEdit(s, 'nonsense');
    const r = handleKey(s, { key: 'Escape' }, ctx);
    expect(r.intent).toEqual({ type: 'none' });
    expect(r.state.editing).toBeNull();
  });

  it('arrow keys navigate outside an edit and belong to the cursor inside one', () => {
    const navigating = handleKey(at(0, 'description'), { key: 'ArrowDown' }, ctx);
    expect(navigating.state.focus.row).toBe(1);

    let s = at(0, 'description');
    s = handleKey(s, { key: 'Enter' }, ctx).state;
    const editing = handleKey(s, { key: 'ArrowDown' }, ctx);
    expect(editing.handled).toBe(false);
    expect(editing.state.editing).not.toBeNull();
  });

  it('arrows stop at the ends of the list', () => {
    expect(handleKey(at(0, 'description'), { key: 'ArrowUp' }, ctx).state.focus.row).toBe(0);
    expect(handleKey(at(2, 'description'), { key: 'ArrowDown' }, ctx).state.focus.row).toBe(2);
  });

  it('supports duplicate, delete, details, undo and redo', () => {
    const s = at(1, 'description');
    expect(handleKey(s, { key: 'd', metaKey: true }, ctx).intent).toEqual({
      type: 'duplicate',
      row: 1,
    });
    expect(handleKey(s, { key: 'Backspace', metaKey: true }, ctx).intent).toEqual({
      type: 'delete',
      row: 1,
    });
    expect(handleKey(s, { key: 'Enter', metaKey: true }, ctx).intent).toEqual({
      type: 'openDetails',
      row: 1,
    });
    expect(handleKey(s, { key: 'z', metaKey: true }, ctx).intent).toEqual({ type: 'undo' });
    expect(handleKey(s, { key: 'z', metaKey: true, shiftKey: true }, ctx).intent).toEqual({
      type: 'redo',
    });
  });

  it('opens the command palette even with nothing focused', () => {
    const r = handleKey(initialGridState, { key: 'k', metaKey: true }, ctx);
    expect(r.intent).toEqual({ type: 'commandPalette' });
  });

  it('ignores keys when no cell is focused', () => {
    expect(handleKey(initialGridState, { key: 'ArrowDown' }, ctx).handled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cell interpretation — what a typed figure becomes
// ---------------------------------------------------------------------------

const row = (overrides: Partial<GridRow> = {}): GridRow => ({
  id: 'r1',
  categoryId: 'c1',
  categoryName: 'Florals',
  description: 'Ceremony florals',
  mode: 'lump',
  values: lumpValues(toPence(6_400), toPence(10_000)),
  ...overrides,
});

describe('interpreting what was typed into a cell', () => {
  it('stores a plain figure as a total', () => {
    const r = valued(interpret(row(), 'budgetCost', '4,800'));
    expect(r.mode).toBe('lump');
    expect(r.values.budgetCost).toBe(toPence(4_800));
  });

  it('turns "15 x 320" into a quantity line', () => {
    const r = valued(interpret(row(), 'budgetCost', '15 x 320'));
    expect(r.mode).toBe('quantity');
    expect(r.values.quantity).toBe(15);
    expect(r.values.unitCost).toBe(toPence(320));
    expect(r.values.budgetCost).toBe(toPence(4_800));
  });

  it('keeps the other column exactly whole when converting to a quantity line', () => {
    // Two bugs this exists to prevent: entering a cost as "15 x 320" used to
    // zero an agreed client price of £10,000, and deriving a rate from it
    // would have moved that price to £10,000.05.
    const r = valued(interpret(row(), 'budgetCost', '15 x 320'));
    expect(r.values.clientPrice).toBe(toPence(10_000));
    expect(r.values.unitPrice).toBeNull();
  });

  it('rejects a quantity that is really a half-overwritten cell', () => {
    // "6400.00" was in the cell; "15 x 320" was typed on top of it.
    expect(interpret(row(), 'budgetCost', '6400.0015 x 320')).toBeNull();
  });

  it('rejects nonsense rather than silently storing zero', () => {
    expect(interpret(row(), 'budgetCost', 'about four thousand')).toBeNull();
  });

  it('edits the rate, not the total, on a line already in quantity mode', () => {
    const q = row({ mode: 'quantity', values: quantityValues(12, toPence(2_850), toPence(3_300)) });
    const r = valued(interpret(q, 'budgetCost', '36000'));
    expect(r.values.quantity).toBe(12);
    expect(r.values.unitCost).toBe(toPence(3_000));
    expect(r.values.budgetCost).toBe(toPence(36_000));
  });

  it('accepts money as people write it', () => {
    expect(valued(interpret(row(), 'clientPrice', '£12,500.50')).values.clientPrice).toBe(
      toPence(12_500.5),
    );
    expect(valued(interpret(row(), 'clientPrice', '(500)')).values.clientPrice).toBe(
      toPence(-500),
    );
  });
});
