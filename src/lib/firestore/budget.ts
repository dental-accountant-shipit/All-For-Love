/**
 * Budget grid repository — every operation the spreadsheet-speed grid needs.
 *
 * All of these write the DRAFT block. The approved block and the rollup are
 * written server-side and are denied to clients by the security rules, so a
 * bug here cannot corrupt an approved budget or invent a total.
 */

import {
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

import * as paths from './paths';
import { keyBetween, keysBetween } from './sortKey';
import { newAudit, touch } from './projects';
import { ZERO_VALUES, recompute } from '../../domain/values';
import type { CostItem, CostMode, CostValues, CostItemStatus } from '../../domain/types';

const EMPTY_ITEM_ROLLUP = {
  committedTotal: 0,
  committedRemaining: 0,
  actualTotal: 0,
  calculatedForecast: 0,
  forecastCost: 0,
  forecastSource: 'calculated' as const,
  recomputedAt: new Date(0).toISOString(),
  recomputeSeq: 0,
};

const EMPTY_DETAILS = {
  supplierId: null,
  supplierName: null,
  currency: 'GBP',
  fxRate: 1,
  vatRate: 20,
  ownerUid: null,
  notes: null,
  startDate: null,
  endDate: null,
  responsibility: null,
};

export function watchCostItems(
  db: Firestore,
  projectId: string,
  onChange: (items: CostItem[]) => void,
  subEventId?: string,
) {
  const base = subEventId
    ? query(paths.costItems(db, projectId), where('subEventId', '==', subEventId))
    : paths.costItems(db, projectId);
  return onSnapshot(query(base, orderBy('sortKey')), (snap) =>
    onChange(snap.docs.map((d) => d.data())),
  );
}

function blankItem(
  projectId: string,
  subEventId: string,
  categoryId: string,
  sortKey: string,
  uid: string,
): Omit<CostItem, 'id'> {
  return {
    projectId,
    subEventId,
    categoryId,
    sortKey,
    description: '',
    mode: 'lump',
    status: 'planned',
    origin: 'original',
    extraStatus: null,
    clientValueWithdrawn: false,
    draft: { ...ZERO_VALUES },
    approved: null,
    original: null,
    details: { ...EMPTY_DETAILS },
    rollup: { ...EMPTY_ITEM_ROLLUP },
    forecastOverride: null,
    copiedFromCostItemId: null,
    audit: newAudit(uid),
  };
}

export interface InsertPosition {
  subEventId: string;
  categoryId: string;
  /** Sort key of the line above the new one, or null for the top. */
  after: string | null;
  /** Sort key of the line below, or null for the bottom. */
  before: string | null;
}

/** Enter, or Shift+Enter — the two ways a new row appears. */
export async function insertLine(
  db: Firestore,
  uid: string,
  projectId: string,
  at: InsertPosition,
): Promise<string> {
  const ref = doc(paths.costItems(db, projectId));
  const item = blankItem(
    projectId,
    at.subEventId,
    at.categoryId,
    keyBetween(at.after, at.before),
    uid,
  );
  await writeBatch(db).set(ref, { ...item, id: ref.id }).commit();
  return ref.id;
}

/**
 * A whole line, written once.
 *
 * The form fills everything in before anything is saved, so this exists to
 * avoid the alternative — insert a blank line, then write a description, then
 * write values, then write a unit — which is four round trips, four rollup
 * recomputations, and a line that exists in a half-finished state in between.
 */
export async function insertCompleteLine(
  db: Firestore,
  uid: string,
  projectId: string,
  at: InsertPosition,
  line: { description: string; unit: string | null; mode: CostMode; values: CostValues },
): Promise<string> {
  const ref = doc(paths.costItems(db, projectId));
  const item = blankItem(
    projectId,
    at.subEventId,
    at.categoryId,
    keyBetween(at.after, at.before),
    uid,
  );
  await writeBatch(db)
    .set(ref, {
      ...item,
      id: ref.id,
      description: line.description,
      mode: line.mode,
      draft: recompute(line.mode, line.values),
      details: { ...item.details, unit: line.unit },
    })
    .commit();
  return ref.id;
}

/**
 * A cell commit. Only ever touches the draft block plus whatever the mode
 * derives from it, so a quantity edit and a unit-cost edit land as one
 * consistent whole rather than leaving the row briefly wrong.
 */
export async function updateValues(
  db: Firestore,
  uid: string,
  projectId: string,
  itemId: string,
  mode: CostMode,
  values: CostValues,
): Promise<void> {
  await updateDoc(paths.costItemDoc(db, projectId, itemId), {
    mode,
    draft: recompute(mode, values),
    ...touch(uid),
  });
}

export async function updateDescription(
  db: Firestore,
  uid: string,
  projectId: string,
  itemId: string,
  description: string,
): Promise<void> {
  await updateDoc(paths.costItemDoc(db, projectId, itemId), { description, ...touch(uid) });
}

/**
 * The unit is display only — no calculation reads it — so it is its own small
 * write rather than a round trip through the values. What it prevents is a
 * quantity nobody can check: "285" in the reference workbook meant 285
 * person-days, not 285 people, and no arithmetic can tell you which.
 */
export async function updateUnit(
  db: Firestore,
  uid: string,
  projectId: string,
  itemId: string,
  unit: string | null,
): Promise<void> {
  await updateDoc(paths.costItemDoc(db, projectId, itemId), {
    'details.unit': unit,
    ...touch(uid),
  });
}

export async function updateStatus(
  db: Firestore,
  uid: string,
  projectId: string,
  itemId: string,
  status: CostItemStatus,
): Promise<void> {
  await updateDoc(paths.costItemDoc(db, projectId, itemId), { status, ...touch(uid) });
}

/** Moving a line between categories is a one-field write, by design. */
export async function moveToCategory(
  db: Firestore,
  uid: string,
  projectId: string,
  itemId: string,
  categoryId: string,
  sortKey: string,
): Promise<void> {
  await updateDoc(paths.costItemDoc(db, projectId, itemId), {
    categoryId,
    sortKey,
    ...touch(uid),
  });
}

/** Dragging a line. One document changes, whatever the list length. */
export async function reorder(
  db: Firestore,
  uid: string,
  projectId: string,
  itemId: string,
  after: string | null,
  before: string | null,
): Promise<void> {
  await updateDoc(paths.costItemDoc(db, projectId, itemId), {
    sortKey: keyBetween(after, before),
    ...touch(uid),
  });
}

export async function duplicateLine(
  db: Firestore,
  uid: string,
  projectId: string,
  source: CostItem,
  before: string | null,
): Promise<string> {
  const ref = doc(paths.costItems(db, projectId));
  const copy: Omit<CostItem, 'id'> = {
    ...source,
    sortKey: keyBetween(source.sortKey, before),
    // A duplicate inherits the plan, never the history.
    status: 'planned',
    approved: null,
    original: null,
    rollup: { ...EMPTY_ITEM_ROLLUP },
    forecastOverride: null,
    clientValueWithdrawn: false,
    copiedFromCostItemId: source.id,
    audit: newAudit(uid),
  };
  const { id: _drop, ...rest } = copy as CostItem;
  await writeBatch(db).set(ref, { ...rest, id: ref.id }).commit();
  return ref.id;
}

/**
 * A line carrying money is never deleted — it is cancelled, so the costs
 * already incurred stay in the forecast. This checks before deleting; the
 * Cloud Function enforces the same rule on the server.
 */
export async function deleteLine(
  db: Firestore,
  uid: string,
  projectId: string,
  itemId: string,
): Promise<{ deleted: boolean; reason?: string }> {
  const [commitments, transactions] = await Promise.all([
    getDocs(query(paths.commitments(db), where('costItemId', '==', itemId))),
    getDocs(query(paths.transactions(db), where('costItemId', '==', itemId))),
  ]);

  if (!commitments.empty || !transactions.empty) {
    await updateDoc(paths.costItemDoc(db, projectId, itemId), {
      status: 'cancelled',
      ...touch(uid),
    });
    return {
      deleted: false,
      reason:
        'This line has supplier commitments or costs against it, so it has been ' +
        'cancelled rather than deleted. Money already spent stays in the forecast.',
    };
  }

  await deleteDoc(paths.costItemDoc(db, projectId, itemId));
  return { deleted: true };
}

export interface PastedRow {
  description: string;
  values: CostValues;
  mode: CostMode;
}

/**
 * A block pasted from Excel, written in ONE batch so the grid never
 * half-fills. Firestore caps a batch at 500 writes; larger pastes are split,
 * which is still atomic per chunk and vastly better than 500 round trips.
 */
export async function pasteRows(
  db: Firestore,
  uid: string,
  projectId: string,
  at: InsertPosition,
  rows: PastedRow[],
): Promise<string[]> {
  const keys = keysBetween(at.after, at.before, rows.length);
  const ids: string[] = [];
  const CHUNK = 400;

  for (let start = 0; start < rows.length; start += CHUNK) {
    const batch = writeBatch(db);
    const slice = rows.slice(start, start + CHUNK);
    slice.forEach((row, i) => {
      const ref = doc(paths.costItems(db, projectId));
      const item = blankItem(projectId, at.subEventId, at.categoryId, keys[start + i], uid);
      batch.set(ref, {
        ...item,
        id: ref.id,
        description: row.description,
        mode: row.mode,
        draft: recompute(row.mode, row.values),
      });
      ids.push(ref.id);
    });
    await batch.commit();
  }

  return ids;
}
