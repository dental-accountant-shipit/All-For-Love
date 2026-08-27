'use client';

/**
 * Adding a line as a form rather than as a row.
 *
 * The grid is quick once you know it, and unhelpful before that: an empty row
 * appears, and everything about what goes where has to be inferred from four
 * blank boxes. This is the same line, laid out with labels, with the
 * arithmetic shown as it is typed so there is no question about whether a
 * figure is a rate or a total — the ambiguity that put £36,820 of error into
 * the reference workbook.
 *
 * The grid stays. This is for the first line of a budget and for anybody who
 * would rather fill a form in; the grid is faster for the twentieth line.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { searchCatalogue, type CatalogueEntry } from '../domain/catalogue';
import { formatGBP } from '../domain/money';
import { buildNewLine, readLine, type NewLine } from '../lib/budget/newLine';
import { colour, radius, type as typeToken } from '../design/tokens';
import { buttonPrimary, buttonSecondary, buttonQuiet, input as inputStyle } from '../design/ui';

export type { NewLine } from '../lib/budget/newLine';

export interface AddLineFormProps {
  categoryName: string;
  catalogue?: CatalogueEntry[];
  onSave: (line: NewLine, addAnother: boolean) => void | Promise<void>;
  onCancel: () => void;
}

export default function AddLineForm({
  categoryName,
  catalogue = [],
  onSave,
  onCancel,
}: AddLineFormProps) {
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  const suggestions = useMemo(
    () =>
      showSuggestions && description.trim()
        ? searchCatalogue(catalogue, description, { currentCategory: categoryName, limit: 6 })
        : [],
    [catalogue, description, categoryName, showSuggestions],
  );

  // Everything below is derived from what is in the boxes right now. Showing
  // the multiplication as it happens is the whole point: a rate and a total
  // are never confusable if the product is on screen. The arithmetic itself
  // lives in lib/budget/newLine, where it is tested.
  const fields = { description, quantity, unit, cost, price };
  const reading = readLine(fields);
  const { quantityValid, costValid, priceValid, budgetTotal, clientTotal, profit, ready } = reading;
  const qty = reading.quantity;

  const submit = async (addAnother: boolean) => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const line = buildNewLine(fields);
      if (!line) return;
      await onSave(line, addAnother);
      if (addAnother) {
        // Keep the unit: consecutive lines in a section are usually the same
        // shape — six per-day crew lines, then four per-metre dressing lines.
        setDescription('');
        setQuantity('');
        setCost('');
        setPrice('');
        first.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    // Everything typed in here is this form's business, not the grid's. See the
    // guard in BudgetGrid's onKeyDown.
    <div style={S.panel} data-afl-own-keys>
      <p style={S.title}>New line in {categoryName}</p>

      <div style={S.row}>
        <label style={{ ...S.field, flex: '1 1 320px', position: 'relative' }}>
          <span style={S.label}>Description</span>
          <input
            ref={first}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setShowSuggestions(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (suggestions.length > 0) {
                  e.stopPropagation();
                  setShowSuggestions(false);
                } else {
                  onCancel();
                }
              }
            }}
            placeholder="Bridal bouquet, Onsite crew — day rate…"
            style={S.input}
          />
          {suggestions.length > 0 ? (
            <ul style={S.suggestions}>
              {suggestions.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    style={S.suggestion}
                    // A chosen entry brings its shape, not just its words.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setDescription(entry.description);
                      setShowSuggestions(false);
                      if (entry.mode === 'quantity') {
                        setUnit(entry.unit ?? '');
                        if (quantity.trim() === '') setQuantity('1');
                      }
                    }}
                  >
                    <span>{entry.description}</span>
                    <span style={S.suggestionMeta}>
                      {entry.mode === 'quantity' ? `per ${entry.unit ?? 'unit'}` : entry.category}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </label>

        <label style={{ ...S.field, flex: '0 0 84px' }}>
          <span style={S.label}>Quantity</span>
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="—"
            inputMode="decimal"
            style={{ ...S.input, textAlign: 'right', ...(quantityValid ? null : S.wrong) }}
          />
        </label>

        <label style={{ ...S.field, flex: '0 0 110px' }}>
          <span style={S.label}>Unit</span>
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="day, metre…"
            style={S.input}
          />
        </label>

        <label style={{ ...S.field, flex: '0 0 130px' }}>
          <span style={S.label}>{qty === null ? 'Budget cost £' : 'Cost each £'}</span>
          <input
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            style={{ ...S.input, textAlign: 'right', ...(costValid ? null : S.wrong) }}
          />
        </label>

        <label style={{ ...S.field, flex: '0 0 130px' }}>
          <span style={S.label}>Client price £</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit(true);
            }}
            placeholder="0.00"
            inputMode="decimal"
            style={{ ...S.input, textAlign: 'right', ...(priceValid ? null : S.wrong) }}
          />
        </label>
      </div>

      <p style={S.sum}>
        {qty !== null && reading.cost !== null ? (
          <>
            {quantity.trim()}
            {unit.trim() ? ` ${unit.trim()}${qty === 1 ? '' : 's'}` : ''} ×{' '}
            {formatGBP(reading.cost)} ={' '}
          </>
        ) : null}
        <strong>{budgetTotal === null ? 'no budget cost' : formatGBP(budgetTotal)}</strong> cost ·{' '}
        <strong>{formatGBP(clientTotal)}</strong> to the client ·{' '}
        <strong style={profit !== null && profit < 0 ? { color: colour.signature } : undefined}>
          {profit === null ? '—' : formatGBP(profit)}
        </strong>{' '}
        profit
      </p>

      <div style={S.actions}>
        <button type="button" disabled={!ready || busy} onClick={() => void submit(true)} style={S.primary}>
          Save and add another
        </button>
        <button type="button" disabled={!ready || busy} onClick={() => void submit(false)} style={S.secondary}>
          Save and close
        </button>
        <button type="button" onClick={onCancel} style={S.quiet}>
          Cancel
        </button>
        <span style={S.tip}>Enter saves and starts the next line</span>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  panel: {
    border: `1px solid ${colour.rule}`,
    borderLeft: `3px solid ${colour.ink}`,
    borderRadius: radius.base,
    background: colour.ground,
    padding: '16px 18px 14px',
    margin: '8px 0 16px',
  },
  title: {
    margin: '0 0 14px',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: typeToken.trackingLabel,
    textTransform: 'uppercase',
    color: colour.muted,
  },
  row: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' },
  field: { display: 'block' },
  label: {
    display: 'block',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: typeToken.trackingLabel,
    textTransform: 'uppercase',
    color: colour.muted,
    marginBottom: 5,
  },
  input: inputStyle,
  wrong: { borderColor: colour.signature },

  suggestions: {
    position: 'absolute',
    zIndex: 5,
    top: '100%',
    left: 0,
    right: 0,
    margin: '4px 0 0',
    padding: 0,
    listStyle: 'none',
    background: colour.paper,
    border: `1px solid ${colour.rule}`,
    borderRadius: radius.base,
    boxShadow: '0 8px 22px rgba(0,0,0,0.10)',
    maxHeight: 250,
    overflowY: 'auto',
  },
  suggestion: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
    padding: '9px 11px',
    font: 'inherit',
    fontSize: 13,
    textAlign: 'left',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  },
  suggestionMeta: { color: colour.muted, whiteSpace: 'nowrap' },

  // The arithmetic, said out loud. A rate and a total cannot be confused when
  // the product is on the screen beside them.
  sum: {
    margin: '14px 0 0',
    paddingTop: 12,
    borderTop: `1px solid ${colour.rule}`,
    fontSize: 13,
    color: colour.muted,
    fontVariantNumeric: 'tabular-nums',
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 14 },
  primary: buttonPrimary,
  secondary: buttonSecondary,
  quiet: buttonQuiet,
  tip: { fontSize: 12, color: colour.muted, marginLeft: 'auto' },
};
