'use client';

/**
 * The budget grid, running in memory.
 *
 * No Firebase, no auth, no styling — this exists so the interaction can be
 * tried against a realistic budget before the Firestore layer is connected and
 * long before any visual design lands on it. The rows below are the shape of
 * a real All for Love budget: quantity lines, a percentage contingency, and
 * categories that already imply sub-events.
 */

import { useCallback, useMemo, useState } from 'react';

import BudgetGrid, { type GridRow } from '../../components/BudgetGrid';
import { keyBetween } from '../../lib/firestore/sortKey';
import { lumpValues, percentageValues, quantityValues, ZERO_VALUES } from '../../domain/values';
import { toPence, formatGBP, formatPercent } from '../../domain/money';
import type { CostMode, CostValues } from '../../domain/types';
import { colour } from '../../design/tokens';

interface DemoRow extends GridRow {
  sortKey: string;
}

let seq = 0;
const nextId = () => `line_${++seq}`;

function seed(): DemoRow[] {
  let key: string | null = null;
  const k = () => (key = keyBetween(key, null));

  return [
    {
      id: nextId(),
      categoryId: 'vatican',
      categoryName: 'Vatican Florals',
      description: 'External church arch',
      mode: 'lump',
      values: lumpValues(toPence(6_400), toPence(10_000)),
      sortKey: k(),
    },
    {
      id: nextId(),
      categoryId: 'vatican',
      categoryName: 'Vatican Florals',
      description: 'Aisle runners',
      mode: 'quantity',
      values: quantityValues(24, toPence(210), toPence(350)),
      sortKey: k(),
    },
    {
      id: nextId(),
      categoryId: 'castle',
      categoryName: 'Castle Florals',
      description: 'Entrance castle archway',
      mode: 'lump',
      values: lumpValues(toPence(5_200), toPence(8_000)),
      sortKey: k(),
    },
    {
      id: nextId(),
      categoryId: 'castle',
      categoryName: 'Castle Florals',
      description: 'Poseur table arrangements',
      mode: 'quantity',
      values: quantityValues(14, toPence(42), toPence(75)),
      sortKey: k(),
    },
    {
      id: nextId(),
      categoryId: 'labour',
      categoryName: 'Labour / Team',
      description: 'Onsite florists — 7 days',
      mode: 'quantity',
      values: quantityValues(12, toPence(2_850), toPence(3_300)),
      sortKey: k(),
    },
    {
      id: nextId(),
      categoryId: 'contingency',
      categoryName: 'Contingency',
      description: 'Contingency',
      mode: 'percentage',
      values: percentageValues(5.25),
      sortKey: k(),
      derivedClientPrice: true,
    },
  ];
}

/** The demo has no database, so its categories are stated rather than loaded. */
const DEMO_CATEGORIES = [
  { id: 'vatican', name: 'Vatican Florals' },
  { id: 'castle', name: 'Castle Florals' },
  { id: 'labour', name: 'Labour / Team' },
  { id: 'contingency', name: 'Contingency' },
];

export default function BudgetDemoPage() {
  const [rows, setRows] = useState<DemoRow[]>(seed);
  const [log, setLog] = useState<string[]>([]);

  const note = useCallback((message: string) => {
    setLog((l) => [message, ...l].slice(0, 6));
  }, []);

  // Contingency is derived, exactly as the rollup does it server-side: a
  // percentage of the other lines, never a typed figure.
  const displayed = useMemo<GridRow[]>(() => {
    const base = rows
      .filter((r) => r.mode !== 'percentage')
      .reduce((a, r) => a + r.values.clientPrice, 0);
    return rows.map((r) =>
      r.mode === 'percentage'
        ? {
            ...r,
            values: {
              ...r.values,
              clientPrice: Math.round(base * ((r.values.percentageRate ?? 0) / 100)),
            },
          }
        : r,
    );
  }, [rows]);

  const indexOf = (id: string) => rows.findIndex((r) => r.id === id);

  const blank = (near: DemoRow, sortKey: string): DemoRow => ({
    id: nextId(),
    categoryId: near.categoryId,
    categoryName: near.categoryName,
    description: '',
    mode: 'lump',
    values: { ...ZERO_VALUES },
    sortKey,
  });

  const resort = (next: DemoRow[]) =>
    [...next].sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  return (
    // This route renders outside the application shell — it has no session and
    // no data — so it brings its own margins rather than sitting flush against
    // the window edge.
    <main style={{ maxWidth: 1240, margin: '0 auto', padding: '40px 28px 90px' }}>
      <h1 style={{ fontWeight: 400, fontSize: 22 }}>Budget — demo</h1>
      <p style={{ color: colour.muted, fontSize: 13, maxWidth: '60ch' }}>
        In memory, unstyled, no Firebase. Try typing <code>15 x 320</code> into a Budget
        Cost cell, pasting a block from Excel, and Enter on the last line.
      </p>

      <BudgetGrid
        rows={displayed}
        categories={DEMO_CATEGORIES}
        onCommit={(id, patch) => {
          setRows((current) =>
            current.map((r) =>
              r.id === id
                ? {
                    ...r,
                    description: patch.description ?? r.description,
                    mode: (patch.mode ?? r.mode) as CostMode,
                    values: (patch.values ?? r.values) as CostValues,
                  }
                : r,
            ),
          );
        }}
        onInsertBelow={(afterId) => {
          setRows((current) => {
            const i = afterId ? current.findIndex((r) => r.id === afterId) : current.length - 1;
            const near = current[i] ?? current[current.length - 1];
            const sortKey = keyBetween(near?.sortKey ?? null, current[i + 1]?.sortKey ?? null);
            return resort([...current, blank(near, sortKey)]);
          });
        }}
        onInsertAbove={(beforeId) => {
          setRows((current) => {
            const i = current.findIndex((r) => r.id === beforeId);
            const sortKey = keyBetween(current[i - 1]?.sortKey ?? null, current[i].sortKey);
            return resort([...current, blank(current[i], sortKey)]);
          });
        }}
        onDuplicate={(id) => {
          setRows((current) => {
            const i = indexOf(id);
            const source = current[i];
            const sortKey = keyBetween(source.sortKey, current[i + 1]?.sortKey ?? null);
            return resort([...current, { ...source, id: nextId(), sortKey }]);
          });
          note('Duplicated a line.');
        }}
        onDelete={(id) => {
          setRows((current) => current.filter((r) => r.id !== id));
          note('Deleted a line. In the real system a line with costs against it is cancelled instead.');
        }}
        onPaste={(afterId, pasted) => {
          setRows((current) => {
            const i = afterId ? current.findIndex((r) => r.id === afterId) : current.length - 1;
            const near = current[i] ?? current[current.length - 1];
            let key: string | null = near?.sortKey ?? null;
            const additions = pasted.map((p) => {
              key = keyBetween(key, current[i + 1]?.sortKey ?? null);
              return {
                id: nextId(),
                categoryId: near.categoryId,
                categoryName: near.categoryName,
                description: p.description,
                mode: p.mode,
                values: p.values,
                sortKey: key!,
              };
            });
            return resort([...current, ...additions]);
          });
          note(`Pasted ${pasted.length} rows in one write.`);
        }}
        onOpenDetails={() => note('More Details drawer — supplier, VAT, currency, notes, attachments.')}
        onUndo={() => note('Undo is wired to the intent; the history stack comes with the Firestore layer.')}
      />

      <Summary rows={displayed} />

      {log.length > 0 ? (
        <ul style={{ fontSize: 12, color: colour.muted, marginTop: 20, paddingLeft: 18 }}>
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}

function Summary({ rows }: { rows: GridRow[] }) {
  const known = rows.every((r) => r.values.budgetCost !== null);
  const cost = rows.reduce((a, r) => a + (r.values.budgetCost ?? 0), 0);
  const price = rows.reduce((a, r) => a + r.values.clientPrice, 0);
  const profit = price - cost;
  return (
    <dl
      style={{
        display: 'flex',
        gap: 32,
        marginTop: 24,
        paddingTop: 16,
        borderTop: `1px solid ${colour.rule}`,
        fontSize: 13,
      }}
    >
      {[
        ['Budget cost', known ? formatGBP(cost) : '—'],
        ['Client price', formatGBP(price)],
        ['Profit', known ? formatGBP(profit) : '—'],
        ['Margin', formatPercent(known && price !== 0 ? profit / price : null)],
      ].map(([label, value]) => (
        <div key={label}>
          <dt style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: colour.muted }}>
            {label}
          </dt>
          <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
