'use client';

/**
 * The description cell, with the catalogue behind it.
 *
 * The rule this component is built around: **typing always wins.** The list is
 * a suggestion and never a gate. You can type a description that is not in the
 * catalogue, press Enter, and get exactly what you typed — the suggestions
 * appear beneath and are only taken when you deliberately reach for one, with
 * the arrow keys or the mouse. A picker that hijacks Enter to insert whatever
 * it had highlighted is how people end up with "Bridal bouquet" where they
 * meant "Bridal bouquet — trial".
 *
 * So there is no selection until you press Down. Enter with nothing selected
 * commits your text and moves on, exactly as the grid did before this existed.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { searchCatalogue, type CatalogueEntry } from '../domain/catalogue';

export interface DescriptionPickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Commit the typed text as it stands. */
  onCommit: (value: string) => void;
  /** Commit and adopt an entry's shape — its mode and unit — as well. */
  onChoose: (entry: CatalogueEntry) => void;
  onCancel: () => void;
  entries: CatalogueEntry[];
  currentCategory?: string;
}

export default function DescriptionPicker({
  value,
  onChange,
  onCommit,
  onChoose,
  onCancel,
  entries,
  currentCategory,
}: DescriptionPickerProps) {
  // -1 means "nothing selected — my typing stands".
  const [selected, setSelected] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(
    () => searchCatalogue(entries, value, { currentCategory, limit: 7 }),
    [entries, value, currentCategory],
  );

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Typing invalidates any selection: the list under the cursor has changed,
  // so the third item is no longer the thing that was being pointed at.
  useEffect(() => setSelected(-1), [value]);

  const choose = (entry: CatalogueEntry) => {
    onChoose(entry);
  };

  return (
    <div style={S.wrap}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={S.input}
        // The list is advisory; the browser's own autofill would fight it.
        autoComplete="off"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            setSelected((s) => Math.min(s + 1, matches.length - 1));
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            setSelected((s) => Math.max(s - 1, -1));
            return;
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            if (selected >= 0 && matches[selected]) {
              // Taking a suggestion is a deliberate act, so it consumes the
              // key rather than also moving the cursor on. The next keystroke
              // does that, and by then the row says what was chosen.
              e.preventDefault();
              e.stopPropagation();
              choose(matches[selected]);
              return;
            }
            // Nothing selected: let the grid's own key handling take it.
            onCommit(value);
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        onBlur={() => {
          // A click on a suggestion blurs the input first. Let that land.
          window.setTimeout(() => onCommit(value), 120);
        }}
      />

      {matches.length > 0 ? (
        <ul style={S.list} role="listbox" aria-label="Budget lines">
          {matches.map((entry, index) => (
            <li key={entry.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === selected}
                style={{ ...S.option, ...(index === selected ? S.optionOn : null) }}
                onMouseEnter={() => setSelected(index)}
                onMouseDown={(e) => {
                  // mousedown, not click: click arrives after blur.
                  e.preventDefault();
                  choose(entry);
                }}
              >
                <span style={S.optionText}>{entry.description}</span>
                <span style={S.optionMeta}>
                  {entry.unit ? `per ${entry.unit}` : entry.mode === 'percentage' ? '%' : ''}
                  {entry.category !== currentCategory ? (
                    <em style={S.optionCategory}> {entry.category}</em>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {value.trim() !== '' && matches.length === 0 ? (
        <p style={S.none}>Nothing in the catalogue matches. Enter keeps what you typed.</p>
      ) : null}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { position: 'relative' },
  input: {
    font: 'inherit',
    fontSize: 'inherit',
    width: '100%',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    padding: 0,
  },
  list: {
    position: 'absolute',
    zIndex: 20,
    top: '100%',
    left: -6,
    minWidth: 340,
    margin: '4px 0 0',
    padding: '4px 0',
    listStyle: 'none',
    background: '#fff',
    border: '1px solid #d5d5d5',
    borderRadius: 2,
    boxShadow: '0 6px 20px rgba(0,0,0,0.10)',
  },
  option: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    width: '100%',
    textAlign: 'left',
    font: 'inherit',
    fontSize: 13,
    padding: '5px 12px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  },
  optionOn: { background: '#f3f0ea' },
  optionText: { marginRight: 'auto' },
  optionMeta: { fontSize: 11, color: '#8a8a8a', whiteSpace: 'nowrap' },
  optionCategory: { fontStyle: 'normal', color: '#b0b0b0' },
  none: {
    position: 'absolute',
    zIndex: 20,
    top: '100%',
    left: -6,
    margin: '4px 0 0',
    padding: '5px 12px',
    fontSize: 11,
    color: '#8a8a8a',
    background: '#fff',
    border: '1px solid #ececec',
    borderRadius: 2,
    whiteSpace: 'nowrap',
  },
};
