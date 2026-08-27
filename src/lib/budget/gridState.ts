/**
 * Budget grid keyboard model.
 *
 * Deliberately pure: no React, no DOM. The whole point of the grid is that it
 * behaves like a spreadsheet under the hands of someone who has built budgets
 * in Excel for years, and behaviour that subtle needs to be testable without
 * rendering anything.
 *
 * The interface layer turns the returned intents into Firestore writes.
 */

/**
 * Quantity, unit and rate have columns of their own.
 *
 * They used to be reachable only by typing `15 x 450` into a money cell — a
 * shorthand that works well once you know it and is invisible until then. The
 * numbers were real either way; only the boxes to put them in were missing.
 */
export const COLUMNS = [
  'description',
  'quantity',
  'unit',
  'unitCost',
  'budgetCost',
  'clientPrice',
  'profit',
] as const;
export type ColumnKey = (typeof COLUMNS)[number];

/** Profit is derived. Nobody types into it, so nothing focuses it for editing. */
export const EDITABLE_COLUMNS: ColumnKey[] = [
  'description',
  'quantity',
  'unit',
  'unitCost',
  'budgetCost',
  'clientPrice',
];

export interface GridPosition {
  /** Index into the visible line list. -1 when nothing is focused. */
  row: number;
  col: ColumnKey;
}

export interface GridState {
  focus: GridPosition;
  /** Null when navigating; a string while a cell is being edited. */
  editing: string | null;
  /** The value the cell held when editing began, restored by Escape. */
  editingOriginal: string | null;
}

export type GridIntent =
  | { type: 'none' }
  | { type: 'commit'; row: number; col: ColumnKey; value: string }
  | { type: 'commitAndInsertBelow'; row: number; col: ColumnKey; value: string }
  | { type: 'insertAbove'; row: number }
  | { type: 'duplicate'; row: number }
  | { type: 'delete'; row: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'openDetails'; row: number }
  | { type: 'commandPalette' };

export interface KeyEvent {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export interface GridContext {
  /** Number of visible lines. */
  rowCount: number;
  /** Current text of the cell at a position, used when editing begins. */
  valueAt: (row: number, col: ColumnKey) => string;
}

export const initialGridState: GridState = {
  focus: { row: -1, col: 'description' },
  editing: null,
  editingOriginal: null,
};

function columnIndex(col: ColumnKey): number {
  return EDITABLE_COLUMNS.indexOf(col);
}

function clampRow(row: number, rowCount: number): number {
  if (rowCount === 0) return -1;
  return Math.max(0, Math.min(row, rowCount - 1));
}

/**
 * Tab moves across the editable columns and wraps to the next row — the
 * behaviour that lets a whole budget be typed without the hands leaving the
 * keyboard. The derived Profit column is skipped entirely.
 */
function step(pos: GridPosition, delta: number, rowCount: number): GridPosition {
  const flat = pos.row * EDITABLE_COLUMNS.length + columnIndex(pos.col) + delta;
  const total = rowCount * EDITABLE_COLUMNS.length;
  if (flat < 0) return { row: 0, col: EDITABLE_COLUMNS[0] };
  if (flat >= total) return pos;
  return {
    row: Math.floor(flat / EDITABLE_COLUMNS.length),
    col: EDITABLE_COLUMNS[flat % EDITABLE_COLUMNS.length],
  };
}

export interface GridResult {
  state: GridState;
  intent: GridIntent;
  /** True when the key was consumed and the browser default should be stopped. */
  handled: boolean;
}

function unchanged(state: GridState): GridResult {
  return { state, intent: { type: 'none' }, handled: false };
}

export function handleKey(
  state: GridState,
  event: KeyEvent,
  ctx: GridContext,
): GridResult {
  const mod = event.metaKey || event.ctrlKey;
  const { focus, editing } = state;
  const noFocus = focus.row < 0;

  // ------------------------------------------------------------ shortcuts

  if (mod && event.key.toLowerCase() === 'k') {
    return { state, intent: { type: 'commandPalette' }, handled: true };
  }
  if (mod && event.key.toLowerCase() === 'z') {
    return {
      state,
      intent: { type: event.shiftKey ? 'redo' : 'undo' },
      handled: true,
    };
  }
  if (noFocus) return unchanged(state);

  if (mod && event.key.toLowerCase() === 'd') {
    return { state, intent: { type: 'duplicate', row: focus.row }, handled: true };
  }
  if (mod && (event.key === 'Backspace' || event.key === 'Delete')) {
    return { state, intent: { type: 'delete', row: focus.row }, handled: true };
  }
  if (mod && event.key === 'Enter') {
    return { state, intent: { type: 'openDetails', row: focus.row }, handled: true };
  }

  // -------------------------------------------------------------- editing

  if (editing !== null) {
    if (event.key === 'Escape') {
      return {
        state: { ...state, editing: null, editingOriginal: null },
        intent: { type: 'none' },
        handled: true,
      };
    }

    if (event.key === 'Enter') {
      // Shift+Enter inserts above rather than continuing downward, so a line
      // remembered halfway through typing does not mean re-sorting afterwards.
      if (event.shiftKey) {
        return {
          state: { ...state, editing: null, editingOriginal: null },
          intent: { type: 'insertAbove', row: focus.row },
          handled: true,
        };
      }
      const atLastRow = focus.row >= ctx.rowCount - 1;
      const intent: GridIntent = atLastRow
        ? { type: 'commitAndInsertBelow', row: focus.row, col: focus.col, value: editing }
        : { type: 'commit', row: focus.row, col: focus.col, value: editing };
      return {
        state: {
          focus: atLastRow
            ? { row: focus.row + 1, col: 'description' }
            : { row: focus.row + 1, col: focus.col },
          editing: null,
          editingOriginal: null,
        },
        intent,
        handled: true,
      };
    }

    if (event.key === 'Tab') {
      const next = step(focus, event.shiftKey ? -1 : 1, ctx.rowCount);
      return {
        state: { focus: next, editing: null, editingOriginal: null },
        intent: { type: 'commit', row: focus.row, col: focus.col, value: editing },
        handled: true,
      };
    }

    // Arrow keys inside an edit belong to the text cursor, not the grid.
    return unchanged(state);
  }

  // ----------------------------------------------------------- navigating

  switch (event.key) {
    case 'Tab': {
      return {
        state: { ...state, focus: step(focus, event.shiftKey ? -1 : 1, ctx.rowCount) },
        intent: { type: 'none' },
        handled: true,
      };
    }
    case 'ArrowDown':
      return {
        state: { ...state, focus: { ...focus, row: clampRow(focus.row + 1, ctx.rowCount) } },
        intent: { type: 'none' },
        handled: true,
      };
    case 'ArrowUp':
      return {
        state: { ...state, focus: { ...focus, row: clampRow(focus.row - 1, ctx.rowCount) } },
        intent: { type: 'none' },
        handled: true,
      };
    case 'ArrowRight':
      return {
        state: { ...state, focus: step(focus, 1, ctx.rowCount) },
        intent: { type: 'none' },
        handled: true,
      };
    case 'ArrowLeft':
      return {
        state: { ...state, focus: step(focus, -1, ctx.rowCount) },
        intent: { type: 'none' },
        handled: true,
      };
    case 'Enter': {
      if (event.shiftKey) {
        return { state, intent: { type: 'insertAbove', row: focus.row }, handled: true };
      }
      const value = ctx.valueAt(focus.row, focus.col);
      return {
        state: { ...state, editing: value, editingOriginal: value },
        intent: { type: 'none' },
        handled: true,
      };
    }
    default:
      break;
  }

  // Typing a printable character starts an edit and replaces the cell, which
  // is what a spreadsheet does and what fingers expect.
  if (!mod && event.key.length === 1) {
    return {
      state: {
        ...state,
        editing: event.key,
        editingOriginal: ctx.valueAt(focus.row, focus.col),
      },
      intent: { type: 'none' },
      handled: true,
    };
  }

  return unchanged(state);
}

/** Click, or programmatic focus after an insert. */
export function focusCell(state: GridState, row: number, col: ColumnKey): GridState {
  return { focus: { row, col }, editing: null, editingOriginal: null };
}

export function beginEdit(state: GridState, value: string): GridState {
  return { ...state, editing: value, editingOriginal: value };
}

export function updateEdit(state: GridState, value: string): GridState {
  return { ...state, editing: value };
}
