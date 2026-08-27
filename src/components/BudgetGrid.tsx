'use client';

/**
 * The budget grid — unstyled.
 *
 * Deliberately plain: a table, hairlines, no brand. The interaction is the
 * thing being built and tested here, and it has to be right against a real
 * budget before any visual design lands on top of it.
 *
 * All keyboard behaviour lives in `lib/budget/gridState.ts` and is unit
 * tested. This component renders, and turns intents into calls.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  COLUMNS,
  EDITABLE_COLUMNS,
  focusCell,
  handleKey,
  initialGridState,
  updateEdit,
  type ColumnKey,
  type GridIntent,
} from '../lib/budget/gridState';
import { lumpValues, marginOf, parseClipboardTable, parseMoney, profitOf } from '../domain/values';
import { formatAmount, formatPercent } from '../domain/money';
import { colour, radius, type as typeToken } from '../design/tokens';
import { tableHead, tableCell, tableTotal, buttonQuiet } from '../design/ui';
import type { CostMode, CostValues } from '../domain/types';
import { HEADINGS, cellText, interpret, isEditable, type GridRow } from '../lib/budget/interpret';
import DescriptionPicker from './DescriptionPicker';
import type { CatalogueEntry } from '../domain/catalogue';

export interface BudgetGridProps {
  rows: GridRow[];
  /**
   * Every category on the project, in order — not only those that happen to
   * have lines. The grid is drawn from these, so an empty category is still
   * visible and still has somewhere to type.
   */
  categories: Array<{ id: string; name: string }>;
  onCommit: (
    rowId: string,
    patch: { description?: string; mode?: CostMode; values?: CostValues; unit?: string | null },
  ) => void;
  onInsertBelow: (afterRowId: string | null) => void;
  onInsertAbove: (beforeRowId: string) => void;
  onDuplicate: (rowId: string) => void;
  onDelete: (rowId: string) => void;
  onPaste: (afterRowId: string | null, rows: Array<{ description: string; mode: CostMode; values: CostValues }>) => void;
  onOpenDetails?: (rowId: string) => void;
  /** Add the first (or next) line to a category. */
  onAddLine?: (categoryId: string) => void;
  /**
   * The category whose add-a-line form is open, and what to draw for it. The
   * form is rendered in place, inside the section it belongs to, rather than
   * as a dialog over the top — so the line being written stays next to the
   * lines it is being written among.
   */
  addingIn?: string | null;
  renderAddForm?: (categoryId: string) => React.ReactNode;
  /** The line catalogue, offered as you type a description. Optional. */
  catalogue?: CatalogueEntry[];
  /** A description was taken from the catalogue, shape and all. */
  onChooseFromCatalogue?: (rowId: string, entry: CatalogueEntry) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

export type { GridRow } from '../lib/budget/interpret';

export default function BudgetGrid(props: BudgetGridProps) {
  const { rows, categories } = props;
  const [state, setState] = useState(initialGridState);
  const [invalid, setInvalid] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ctx = useMemo(
    () => ({
      rowCount: rows.length,
      valueAt: (row: number, col: ColumnKey) =>
        rows[row] ? cellText(rows[row], col) : '',
    }),
    [rows],
  );

  useEffect(() => {
    if (state.editing !== null) inputRef.current?.focus();
  }, [state.editing, state.focus.row, state.focus.col]);

  // Opening the add-a-line form lets go of whatever cell was selected. A
  // highlighted cell behind an open form is an invitation to type into the
  // wrong one, and belt-and-braces against the grid grabbing keys it should
  // not have.
  const addingIn = props.addingIn;
  useEffect(() => {
    if (addingIn) setState(initialGridState);
  }, [addingIn]);

  const commit = useCallback(
    (rowIndex: number, col: ColumnKey, value: string) => {
      const row = rows[rowIndex];
      if (!row) return;

      if (col === 'description') {
        if (value !== row.description) props.onCommit(row.id, { description: value });
        setInvalid(null);
        return;
      }

      const result = interpret(row, col, value);
      if (result === null) {
        setInvalid(`${row.id}:${col}`);
        return;
      }
      setInvalid(null);
      if (result.kind === 'unit') {
        if (result.unit !== (row.unit ?? null)) props.onCommit(row.id, { unit: result.unit });
        return;
      }
      props.onCommit(row.id, { mode: result.mode, values: result.values });
    },
    [props, rows],
  );

  const run = useCallback(
    (intent: GridIntent) => {
      switch (intent.type) {
        case 'commit':
          commit(intent.row, intent.col, intent.value);
          break;
        case 'commitAndInsertBelow':
          commit(intent.row, intent.col, intent.value);
          props.onInsertBelow(rows[intent.row]?.id ?? null);
          break;
        case 'insertAbove':
          if (rows[intent.row]) props.onInsertAbove(rows[intent.row].id);
          break;
        case 'duplicate':
          if (rows[intent.row]) props.onDuplicate(rows[intent.row].id);
          break;
        case 'delete':
          if (rows[intent.row]) props.onDelete(rows[intent.row].id);
          break;
        case 'openDetails':
          if (rows[intent.row]) props.onOpenDetails?.(rows[intent.row].id);
          break;
        case 'undo':
          props.onUndo?.();
          break;
        case 'redo':
          props.onRedo?.();
          break;
        default:
          break;
      }
    },
    [commit, props, rows],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Keys typed inside something nested in the grid belong to that something.
    //
    // The grid listens on its wrapping element, so every keystroke in the
    // add-a-line form bubbled up to it. With a cell focused — which it is the
    // moment anybody has clicked one — the grid took each printable character
    // as "start editing that cell", called preventDefault, and the character
    // never reached the field being typed into. The form looked broken and the
    // grid quietly filled a cell nobody was looking at.
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('[data-afl-own-keys]')) return;

    const result = handleKey(
      state,
      {
        key: event.key,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
      },
      ctx,
    );
    if (result.handled) event.preventDefault();
    setState(result.state);
    run(result.intent);
  };

  /** A block from Excel lands as one write, not forty round trips. */
  const onPaste = (event: React.ClipboardEvent) => {
    const text = event.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return;
    event.preventDefault();

    const table = parseClipboardTable(text);
    const parsed = table.map((cells) => {
      const description = (cells[0] ?? '').trim();
      const cost = parseMoney(cells[1] ?? '') ?? 0;
      const price = parseMoney(cells[2] ?? '') ?? 0;
      return { description, mode: 'lump' as CostMode, values: lumpValues(cost, price) };
    });

    props.onPaste(rows[state.focus.row]?.id ?? null, parsed);
  };

  // Category headings are rendered between lines but are never focusable, so
  // the focus index stays a simple index into the line list.
  const renderRow = (row: GridRow, index: number) => (
      <tr key={row.id}>
        {COLUMNS.map((col) => {
          const focused = state.focus.row === index && state.focus.col === col;
          const editing = focused && state.editing !== null;
          const derived = !isEditable(row, col);
          const flagged = invalid === `${row.id}:${col}`;

          return (
            <td
              key={col}
              style={{
                ...S.cell,
                ...columnStyle(col),
                ...(derived ? S.derived : null),
                ...(flagged ? S.invalid : null),
              }}
              // One click, not two. Selecting a cell and then having to
              // discover that a second click — or F2, or just typing — is what
              // actually opens it is a spreadsheet convention, and this is not
              // a spreadsheet. Clicking a thing you can type into should let
              // you type into it.
              onClick={() => {
                if (!EDITABLE_COLUMNS.includes(col) || derived) return;
                if (editing) return;
                setState({
                  focus: { row: index, col },
                  editing: cellText(row, col),
                  editingOriginal: cellText(row, col),
                });
              }}
            >
              {editing && col === 'description' && props.catalogue ? (
                <DescriptionPicker
                  value={state.editing ?? ''}
                  entries={props.catalogue}
                  currentCategory={row.categoryName}
                  onChange={(v) => setState(updateEdit(state, v))}
                  onCommit={(v) => {
                    commit(index, col, v);
                    setState({ ...state, editing: null, editingOriginal: null });
                  }}
                  onChoose={(entry) => {
                    // The whole point of the catalogue: the line arrives with
                    // its shape, not just its words. A per-metre line that
                    // knows it is per-metre cannot have a total typed into its
                    // rate column.
                    props.onChooseFromCatalogue?.(row.id, entry);
                    setState({ ...state, editing: null, editingOriginal: null });
                  }}
                  onCancel={() =>
                    setState({
                      ...state,
                      editing: null,
                      editingOriginal: null,
                    })
                  }
                />
              ) : editing ? (
                <input
                  ref={inputRef}
                  value={state.editing ?? ''}
                  onChange={(e) => setState(updateEdit(state, e.target.value))}
                  onBlur={() => {
                    if (state.editing !== null) commit(index, col, state.editing);
                    setState({ ...state, editing: null, editingOriginal: null });
                  }}
                  style={{ ...S.input, ...S.fieldFocused }}
                />
              ) : (
                <span
                  className={derived ? undefined : 'afl-cell'}
                  style={{
                    ...(derived ? S.readOnlyValue : focused ? S.fieldFocused : S.field),
                    ...(col === 'profit' ? S.profitValue : null),
                    ...(!derived && cellText(row, col) === '' ? S.placeholder : null),
                    // The only colour a figure ever carries. Red here means the
                    // line loses money, and red means nothing else anywhere in
                    // this table — which is why the buttons are black.
                    ...(col === 'profit' && isLoss(row) ? S.loss : null),
                  }}
                >
                  {cellText(row, col) || (derived ? '' : placeholderFor(col))}
                  {row.mode === 'percentage' && col === 'clientPrice' ? (
                    <em style={S.hint}> {row.values.percentageRate}% of budget</em>
                  ) : null}
                </span>
              )}
            </td>
          );
        })}
      </tr>
  );

  /**
   * The body is drawn from the CATEGORIES, not from the lines.
   *
   * Drawing it from the lines meant a category with nothing in it did not
   * exist on screen — so a new project, which has categories and no lines,
   * showed an empty table with no way to type into it. Adding a category
   * appeared to do nothing, because nothing about the screen changed.
   *
   * A category is a place to put lines. It has to be visible before there are
   * any, or there is nowhere to put the first one.
   */
  const indexOfRow = new Map(rows.map((row, index) => [row.id, index]));
  const known = new Set(categories.map((c) => c.id));
  const orphaned = rows.filter((row) => !known.has(row.categoryId));

  const sections = [
    ...categories.map((category) => ({
      id: category.id,
      name: category.name,
      lines: rows.filter((row) => row.categoryId === category.id),
      canAdd: true,
    })),
    // A line whose category has been deleted is still a line, and still money.
    // It is shown rather than dropped.
    ...(orphaned.length > 0
      ? [{ id: '__orphaned', name: 'Uncategorised', lines: orphaned, canAdd: false }]
      : []),
  ];

  const body: React.ReactNode[] = [];
  for (const section of sections) {
    body.push(
      <tr key={`cat-${section.id}`}>
        <th colSpan={COLUMNS.length} scope="colgroup" style={S.categoryCell}>
          {section.name}
        </th>
      </tr>,
    );

    for (const row of section.lines) {
      body.push(renderRow(row, indexOfRow.get(row.id) ?? 0));
    }

    if (section.canAdd && props.addingIn === section.id && props.renderAddForm) {
      body.push(
        <tr key={`form-${section.id}`}>
          <td colSpan={COLUMNS.length} style={S.formCell}>
            {props.renderAddForm(section.id)}
          </td>
        </tr>,
      );
    } else if (section.canAdd && props.onAddLine) {
      const onAddLine = props.onAddLine;
      body.push(
        <tr key={`add-${section.id}`}>
          <td colSpan={COLUMNS.length} style={S.addCell}>
            <button type="button" style={S.addButton} onClick={() => onAddLine(section.id)}>
              + Add a line
            </button>
          </td>
        </tr>,
      );
    }
  }

  // A total across lines whose budget was never recorded is not a total.
  const budgetKnown = rows.every((r) => r.values.budgetCost !== null);
  const totals = rows.reduce(
    (a, r) => ({
      budgetCost: a.budgetCost + (r.values.budgetCost ?? 0),
      clientPrice: a.clientPrice + r.values.clientPrice,
    }),
    { budgetCost: 0, clientPrice: 0 },
  );
  const totalValues = lumpValues(budgetKnown ? totals.budgetCost : null, totals.clientPrice);

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div tabIndex={0} onKeyDown={onKeyDown} onPaste={onPaste} style={S.wrap}>
      <table style={S.table}>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col}
                scope="col"
                style={{ ...S.head, ...columnStyle(col) }}
              >
                {HEADINGS[col]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
        <tfoot>
          <tr>
            <td style={{ ...S.cell, ...columnStyle('description'), ...S.total }}>
              {rows.length} {rows.length === 1 ? 'line' : 'lines'}
            </td>
            <td colSpan={3} style={{ ...S.cell, ...S.total }} />
            <td style={{ ...S.cell, ...columnStyle('budgetCost'), ...S.total }}>
              {budgetKnown ? formatAmount(totals.budgetCost) : '—'}
            </td>
            <td style={{ ...S.cell, ...columnStyle('clientPrice'), ...S.total }}>
              {formatAmount(totals.clientPrice)}
            </td>
            <td
              style={{
                ...S.cell,
                ...columnStyle('profit'),
                ...S.total,
                ...((profitOf(totalValues) ?? 0) < 0 ? S.loss : null),
              }}
            >
              {profitOf(totalValues) === null ? '—' : formatAmount(profitOf(totalValues)!)}{' '}
              <em style={S.hint}>{formatPercent(marginOf(totalValues))}</em>
            </td>
          </tr>
        </tfoot>
      </table>

      {!budgetKnown ? (
        <p style={S.note}>
          Some lines were imported without a recorded budget, so budget versus actual
          is unavailable for this budget. Actual cost and profitability are unaffected.
        </p>
      ) : null}

      {invalid ? (
        <p style={S.error}>
          That figure could not be read. Try a number, or a rate like{' '}
          <code>15 x 320</code>.
        </p>
      ) : null}

      <p style={S.help}>
        Tab moves across · Enter commits and moves down · Enter on the last line adds
        another · Shift+Enter inserts above · ⌘D duplicates · ⌘⌫ deletes · ⌘↵ opens
        details · paste a block from Excel
      </p>
    </div>
  );
}


/**
 * Column widths, set once.
 *
 * Description takes what is left; the rest are sized to their contents so a
 * quantity of 15 does not sit in a box built for £123,456.78.
 */
function columnStyle(col: ColumnKey): React.CSSProperties {
  switch (col) {
    case 'description':
      return { textAlign: 'left', minWidth: 240, width: 'auto' };
    case 'quantity':
      return { textAlign: 'right', width: 70, whiteSpace: 'nowrap' };
    case 'unit':
      return { textAlign: 'left', width: 92, whiteSpace: 'nowrap' };
    case 'unitCost':
      return { textAlign: 'right', width: 122, whiteSpace: 'nowrap' };
    case 'profit':
      return { textAlign: 'right', width: 132, whiteSpace: 'nowrap' };
    default:
      return { textAlign: 'right', width: 146, whiteSpace: 'nowrap' };
  }
}

/**
 * A line that costs more than it earns.
 *
 * Null profit is not a loss — it is an unknown, from an imported line whose
 * budget was never recorded — so it is left plain rather than coloured.
 */
function isLoss(row: GridRow): boolean {
  const profit = profitOf(row.values);
  return profit !== null && profit < 0;
}

/**
 * What an empty cell says.
 *
 * An empty budget used to be a grid of blank space with no indication that any
 * of it could be typed into. A placeholder in every empty field is the
 * cheapest possible instruction, and it disappears the moment it is not needed.
 */
function placeholderFor(col: ColumnKey): string {
  switch (col) {
    case 'description':
      return 'Type or choose a line…';
    // Quantity, unit and rate are empty on most lines by design — a lump line
    // has no quantity. A dash there reads as a value rather than as an empty
    // field, and three of them per row is a table full of noise.
    case 'quantity':
    case 'unit':
    case 'unitCost':
      return '';
    default:
      return '0.00';
  }
}

/** Layout only. No brand: the visual design comes after the interaction works. */
const S: Record<string, React.CSSProperties> = {
  addCell: { padding: '6px 6px 14px', borderBottom: `1px solid ${colour.rule}` },
  addButton: {
    ...buttonQuiet,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: typeToken.trackingLabel,
    textTransform: 'uppercase',
    color: colour.ink,
    textDecoration: 'none',
  },
  formCell: { padding: 0, borderBottom: `1px solid ${colour.rule}` },

  wrap: { outline: 'none' },
  table: { borderCollapse: 'collapse', width: '100%', fontVariantNumeric: 'tabular-nums' },
  head: tableHead,
  cell: tableCell,

  // Every cell that accepts typing looks like it accepts typing. The old grid
  // drew plain text until you clicked, which gave somebody filling in their
  // first budget nothing to aim at.
  field: {
    display: 'block',
    padding: '8px 9px',
    minHeight: 20,
    border: '1px solid transparent',
    borderRadius: radius.base,
    background: colour.ground,
    cursor: 'text',
    color: 'inherit',
  },
  fieldFocused: {
    display: 'block',
    padding: '8px 9px',
    minHeight: 20,
    border: `1px solid ${colour.ink}`,
    borderRadius: radius.base,
    background: colour.paper,
    cursor: 'text',
  },
  readOnlyValue: { display: 'block', padding: '8px 9px', color: colour.muted },
  // Every other derived cell is a working, and greys back. Profit is the answer
  // the row exists to give.
  profitValue: { color: colour.ink, fontWeight: 500 },
  placeholder: { color: colour.ruleStrong },
  loss: { color: colour.signature },

  // A category is a quiet serif line, not a heading that competes with the
  // project title above it.
  categoryCell: {
    textAlign: 'left',
    padding: '26px 6px 8px',
    fontFamily: typeToken.serif,
    fontSize: 15,
    fontWeight: 400,
    letterSpacing: '0.02em',
    color: colour.ink,
    borderBottom: `1px solid ${colour.rule}`,
  },

  derived: { background: 'transparent', color: colour.muted },
  invalid: { outline: `2px solid ${colour.signature}`, outlineOffset: -2 },
  total: tableTotal,
  input: {
    width: '100%',
    font: 'inherit',
    textAlign: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
  },
  hint: { fontStyle: 'normal', fontSize: 11, color: colour.muted },
  error: { color: colour.signature, fontSize: 13 },
  note: { color: colour.muted, fontSize: 13, maxWidth: '62ch' },
  help: { fontSize: 12, color: colour.muted, marginTop: 18, lineHeight: 1.7 },
};
