'use client';

import { useEffect, useMemo, useState } from 'react';

import ProjectScreen from '../../../components/ProjectScreen';
import BudgetGrid from '../../../components/BudgetGrid';
import CostItemDrawer from '../../../components/CostItemDrawer';
import type { GridRow } from '../../../lib/budget/interpret';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { firestore } from '../../../lib/firestore/client';
import { watchCategories, watchSubEvents, addCategory } from '../../../lib/firestore/projects';
import {
  deleteLine,
  duplicateLine,
  insertLine,
  pasteRows,
  updateDescription,
  updateStatus,
  updateValues,
  watchCostItems,
} from '../../../lib/firestore/budget';
import {
  watchProjectCommitments,
  watchProjectTransactions,
} from '../../../lib/firestore/money';
import { applyPercentageLines } from '../../../domain/rollup';
import type {
  Category,
  Commitment,
  CostItem,
  Project,
  SubEvent,
  Transaction,
} from '../../../domain/types';

export default function BudgetPage() {
  return <ProjectScreen>{(project) => <Budget project={project} />}</ProjectScreen>;
}

function Budget({ project }: { project: Project }) {
  const { user, can } = useAuth();
  const db = firestore();

  const [items, setItems] = useState<CostItem[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subEvents, setSubEvents] = useState<SubEvent[]>([]);
  const [subEventId, setSubEventId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  useEffect(() => watchCostItems(db, project.id, setItems), [db, project.id]);
  useEffect(() => watchCategories(db, project.id, setCategories), [db, project.id]);
  useEffect(() => watchSubEvents(db, project.id, setSubEvents), [db, project.id]);
  useEffect(() => watchProjectCommitments(db, project.id, setCommitments), [db, project.id]);
  useEffect(() => watchProjectTransactions(db, project.id, setTransactions), [db, project.id]);

  const multi = project.subEventMode === 'multiple';
  const activeSubEvent = subEventId ?? subEvents[0]?.id ?? null;

  const rows = useMemo<GridRow[]>(() => {
    if (!items) return [];
    const names = new Map(categories.map((c) => [c.id, c.name]));
    const order = new Map(categories.map((c, i) => [c.id, i]));

    // Contingency is derived here exactly as the rollup derives it — same
    // function, same settings, same categories — so the figure on the screen
    // and the figure in the database are one calculation, not two that agree.
    const resolved = applyPercentageLines(items, project.settings, categories);

    return resolved
      .filter((i) => (multi && activeSubEvent ? i.subEventId === activeSubEvent : true))
      .sort((a, b) => {
        const byCategory = (order.get(a.categoryId) ?? 0) - (order.get(b.categoryId) ?? 0);
        return byCategory !== 0 ? byCategory : a.sortKey < b.sortKey ? -1 : 1;
      })
      .map((i) => ({
        id: i.id,
        categoryId: i.categoryId,
        categoryName: names.get(i.categoryId) ?? 'Uncategorised',
        description: i.description,
        mode: i.mode,
        values: i.draft,
      }));
  }, [items, categories, multi, activeSubEvent, project.settings]);
  // `categories` is already a dependency — it now feeds the contingency base
  // as well as the names, so a category toggled out of the base re-renders the
  // grid with the new figure immediately.

  if (!items) return <p style={{ color: '#666' }}>Loading budget…</p>;
  if (!user) return null;

  const readOnly = !can('editBudget');
  const lastOf = (categoryId: string) =>
    rows.filter((r) => r.categoryId === categoryId).at(-1)?.id ?? null;
  const itemById = (id: string) => items.find((i) => i.id === id);
  const positionFor = (rowId: string | null) => {
    const item = rowId ? itemById(rowId) : undefined;
    const categoryId = item?.categoryId ?? categories[0]?.id;
    return {
      subEventId: item?.subEventId ?? activeSubEvent ?? subEvents[0]?.id ?? '',
      categoryId: categoryId ?? '',
      after: item?.sortKey ?? null,
      before: null,
    };
  };

  return (
    <>
      <div style={bar}>
        {multi ? (
          <label style={hint}>
            Sub-event{' '}
            <select
              value={activeSubEvent ?? ''}
              onChange={(e) => setSubEventId(e.target.value)}
              style={select}
            >
              {subEvents.map((se) => (
                <option key={se.id} value={se.id}>
                  {se.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <span style={{ ...hint, marginRight: 'auto' }}>
          {project.openDraftVersionId ? 'Draft — not yet approved' : 'No open draft'}
        </span>

        {can('editBudget') ? (
          adding ? (
            // An inline field rather than window.prompt. A browser dialog
            // steals the whole window, cannot be styled, is blocked outright
            // in some contexts, and gives no sign of what happened after OK —
            // which is exactly how "I typed a name and nothing happened" felt.
            <form
              style={{ display: 'flex', gap: 8 }}
              onSubmit={async (e) => {
                e.preventDefault();
                const name = newCategory.trim();
                if (!name) return;
                setAdding(false);
                setNewCategory('');
                await addCategory(db, user.uid, project.id, name);
                setMessage(`Added the category "${name}".`);
              }}
            >
              <input
                autoFocus
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="Category name"
                style={{ ...select, width: 180 }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setAdding(false);
                    setNewCategory('');
                  }
                }}
              />
              <button type="submit" style={btn}>
                Add
              </button>
              <button
                type="button"
                style={linkBtn}
                onClick={() => {
                  setAdding(false);
                  setNewCategory('');
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" style={btn} onClick={() => setAdding(true)}>
              Add category
            </button>
          )
        ) : null}
      </div>

      {readOnly ? (
        <p style={{ ...hint, marginBottom: 12 }}>
          You can see this budget but not change it.
        </p>
      ) : null}

      {categories.length === 0 ? (
        <p style={hint}>
          This budget has no categories yet. Add one — Florals, Labour, Transport — and the
          grid appears underneath it.
        </p>
      ) : (
        <BudgetGrid
          rows={rows}
          categories={categories}
          onAddLine={async (categoryId) => {
            if (readOnly) return;
            const last = rows.filter((r) => r.categoryId === categoryId).at(-1);
            await insertLine(db, user.uid, project.id, {
              subEventId: activeSubEvent ?? subEvents[0]?.id ?? '',
              categoryId,
              after: last ? (itemById(last.id)?.sortKey ?? null) : null,
              before: null,
            });
          }}
          onCommit={async (rowId, patch) => {
            if (readOnly) return;
            const item = itemById(rowId);
            if (!item) return;
            if (patch.description !== undefined) {
              await updateDescription(db, user.uid, project.id, rowId, patch.description);
            }
            if (patch.values && patch.mode) {
              await updateValues(db, user.uid, project.id, rowId, patch.mode, patch.values);
            }
          }}
          onInsertBelow={async (afterRowId) => {
            if (readOnly) return;
            await insertLine(db, user.uid, project.id, positionFor(afterRowId ?? lastOf(categories[0].id)));
          }}
          onInsertAbove={async (beforeRowId) => {
            if (readOnly) return;
            const item = itemById(beforeRowId);
            if (!item) return;
            const previous = rows[rows.findIndex((r) => r.id === beforeRowId) - 1];
            await insertLine(db, user.uid, project.id, {
              subEventId: item.subEventId,
              categoryId: item.categoryId,
              after: previous ? (itemById(previous.id)?.sortKey ?? null) : null,
              before: item.sortKey,
            });
          }}
          onDuplicate={async (rowId) => {
            if (readOnly) return;
            const item = itemById(rowId);
            if (!item) return;
            const next = rows[rows.findIndex((r) => r.id === rowId) + 1];
            await duplicateLine(
              db,
              user.uid,
              project.id,
              item,
              next ? (itemById(next.id)?.sortKey ?? null) : null,
            );
          }}
          onDelete={async (rowId) => {
            if (readOnly) return;
            const result = await deleteLine(db, user.uid, project.id, rowId);
            if (!result.deleted) setMessage(result.reason ?? null);
          }}
          onPaste={async (afterRowId, pasted) => {
            if (readOnly) return;
            const ids = await pasteRows(
              db,
              user.uid,
              project.id,
              positionFor(afterRowId),
              pasted,
            );
            setMessage(`Added ${ids.length} lines from the clipboard.`);
          }}
          onOpenDetails={(rowId) => setOpenItemId(rowId)}
        />
      )}

      {openItemId && itemById(openItemId) ? (
        <CostItemDrawer
          item={itemById(openItemId)!}
          commitments={commitments}
          transactions={transactions}
          onClose={() => setOpenItemId(null)}
          onSetStatus={(status) =>
            void updateStatus(db, user.uid, project.id, openItemId, status)
          }
        />
      ) : null}

      {message ? (
        <p style={{ ...hint, marginTop: 16, maxWidth: '62ch' }}>
          {message}{' '}
          <button type="button" onClick={() => setMessage(null)} style={linkBtn}>
            Dismiss
          </button>
        </p>
      ) : null}
    </>
  );
}

const bar: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  alignItems: 'baseline',
  marginBottom: 16,
};
const hint: React.CSSProperties = { fontSize: 12, color: '#777' };
const select: React.CSSProperties = { font: 'inherit', fontSize: 13, padding: '4px 6px' };
const btn: React.CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  fontWeight: 600,
  padding: '6px 12px',
  background: 'transparent',
  color: '#111',
  border: '1px solid #ccc',
  borderRadius: 2,
  cursor: 'pointer',
};
const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  color: '#c10001',
  cursor: 'pointer',
  textDecoration: 'underline',
};
