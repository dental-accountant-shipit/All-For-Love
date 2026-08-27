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
import { formatGBP, formatPercent } from '../domain/money';
import type { CostMode, CostValues } from '../domain/types';
import { HEADINGS, cellText, interpret, type GridRow } from '../lib/budget/interpret';

export interface BudgetGridProps {
  rows: GridRow[];
  /**
   * Every category on the project, in order — not only those that happen to
   * have lines. The grid is drawn from these, so an empty category is still
   * visible and still has somewhere to type.
   */
  categories: Array<{ id: string; name: string }>;
  onCommit: (rowId: string, patch: { description?: string; mode?: CostMode; values?: CostValues }) => void;
  onInsertBelow: (afterRowId: string | null) => void;
  onInsertAbove: (beforeRowId: string) => void;
  onDuplicate: (rowId: string) => void;
  onDelete: (rowId: string) => void;
  onPaste: (afterRowId: string | null, rows: Array<{ description: string; mode: CostMode; values: CostValues }>) => void;
  onOpenDetails?: (rowId: string) => void;
  /** Add the first (or next) line to a category. */
  onAddLine?: (categoryId: string) => void;
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
          const derived =
            col === 'profit' ||
            (row.mode === 'quantity' && col !== 'description') ||
            (row.mode === 'percentage' && col === 'clientPrice');
          const flagged = invalid === `${row.id}:${col}`;

          return (
            <td
              key={col}
              style={{
                ...S.cell,
                ...(col === 'description' ? S.textCell : S.numberCell),
                ...(derived ? S.derived : null),
                ...(focused ? S.focused : null),
                ...(flagged ? S.invalid : null),
              }}
              onClick={() => {
                if (!EDITABLE_COLUMNS.includes(col) || derived) return;
                setState(focusCell(state, index, col));
              }}
              onDoubleClick={() => {
                if (!EDITABLE_COLUMNS.includes(col) || derived) return;
                setState({
                  focus: { row: index, col },
                  editing: cellText(row, col),
                  editingOriginal: cellText(row, col),
                });
              }}
            >
              {editing ? (
                <input
                  ref={inputRef}
                  value={state.editing ?? ''}
                  onChange={(e) => setState(updateEdit(state, e.target.value))}
                  onBlur={() => {
                    if (state.editing !== null) commit(index, col, state.editing);
                    setState({ ...state, editing: null, editingOriginal: null });
                  }}
                  style={S.input}
                />
              ) : (
                <span>
                  {cellText(row, col)}
                  {row.mode === 'quantity' && col === 'budgetCost' && row.values.quantity ? (
                    <em style={S.hint}>
                      {' '}
                      {row.values.quantity} × {formatGBP(row.values.unitCost ?? 0)}
                    </em>
                  ) : null}
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
        <th colSpan={4} scope="colgroup" style={S.categoryCell}>
          {section.name}
        </th>
      </tr>,
    );

    for (const row of section.lines) {
      body.push(renderRow(row, indexOfRow.get(row.id) ?? 0));
    }

    if (section.canAdd && props.onAddLine) {
      const onAddLine = props.onAddLine;
      body.push(
        <tr key={`add-${section.id}`}>
          <td colSpan={4} style={S.addCell}>
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
                style={{ ...S.head, ...(col === 'description' ? S.textCell : S.numberCell) }}
              >
                {HEADINGS[col]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
        <tfoot>
          <tr>
            <td style={{ ...S.cell, ...S.textCell, ...S.total }}>
              {rows.length} {rows.length === 1 ? 'line' : 'lines'}
            </td>
            <td style={{ ...S.cell, ...S.numberCell, ...S.total }}>
              {budgetKnown ? (totals.budgetCost / 100).toFixed(2) : '—'}
            </td>
            <td style={{ ...S.cell, ...S.numberCell, ...S.total }}>
              {(totals.clientPrice / 100).toFixed(2)}
            </td>
            <td style={{ ...S.cell, ...S.numberCell, ...S.total }}>
              {profitOf(totalValues) === null ? '—' : formatGBP(profitOf(totalValues)!)}{' '}
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

/** Layout only. No brand: the visual design comes after the interaction works. */
const S: Record<string, React.CSSProperties> = {
  addCell: {
    padding: '4px 0 10px',
    borderBottom: '1px solid #f0f0f0',
  },
  addButton: {
    background: 'none',
    border: 'none',
    padding: '2px 0',
    font: 'inherit',
    fontSize: 12,
    color: '#c10001',
    cursor: 'pointer',
  },
  wrap: { outline: 'none', fontFamily: 'system-ui, sans-serif', fontSize: 14 },
  table: { borderCollapse: 'collapse', width: '100%', fontVariantNumeric: 'tabular-nums' },
  head: {
    textAlign: 'left',
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    padding: '8px 8px',
    borderBottom: '1px solid #999',
    whiteSpace: 'nowrap',
  },
  cell: { padding: '0 8px', height: 32, borderBottom: '1px solid #e5e5e5' },
  textCell: { textAlign: 'left', minWidth: 260 },
  numberCell: { textAlign: 'right', width: 150, whiteSpace: 'nowrap' },
  categoryCell: {
    textAlign: 'left',
    padding: '14px 8px 6px',
    fontSize: 12,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    borderBottom: '1px solid #e5e5e5',
  },
  focused: { outline: '2px solid #333', outlineOffset: -2 },
  derived: { background: '#fafafa', color: '#555' },
  invalid: { outline: '2px solid #c10001', outlineOffset: -2 },
  total: { borderTop: '1px solid #000', borderBottom: 'none', fontWeight: 600 },
  input: { width: '100%', font: 'inherit', textAlign: 'inherit', border: 'none', outline: 'none', background: 'transparent' },
  hint: { fontStyle: 'normal', fontSize: 11, color: '#777' },
  error: { color: '#c10001', fontSize: 13 },
  note: { color: '#555', fontSize: 12, maxWidth: '62ch' },
  help: { fontSize: 12, color: '#666', marginTop: 16 },
};
