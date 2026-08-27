/**
 * Budget version repository.
 *
 * What is NOT here is the point: there is no `approveVersion` function.
 * Approval writes approved history, and the security rules deny that to every
 * signed-in user including admins. It happens in a Cloud Function, called from
 * here, so there is no client code path to approved history at all — not even
 * a guarded one.
 */

import {
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import * as paths from './paths';
import { newAudit, touch } from './projects';
import { firebaseApp } from './client';
import type {
  BudgetVersion,
  BudgetVersionLine,
  ClientApproval,
  CostItem,
  CostValues,
} from '../../domain/types';

export function watchVersions(
  db: Firestore,
  projectId: string,
  onChange: (versions: BudgetVersion[]) => void,
) {
  return onSnapshot(
    query(paths.budgetVersions(db, projectId), orderBy('versionNo', 'desc')),
    (snap) => onChange(snap.docs.map((d) => d.data())),
  );
}

export async function getVersionLines(
  db: Firestore,
  projectId: string,
  versionId: string,
): Promise<BudgetVersionLine[]> {
  const snap = await getDocs(paths.budgetVersionLines(db, projectId, versionId));
  return snap.docs.map((d) => d.data());
}

/**
 * Start a revision.
 *
 * Copies the current approved values into each cost item's draft block so the
 * grid opens on what was approved rather than on whatever the last draft
 * happened to say. One open draft per project.
 */
export async function startRevision(
  db: Firestore,
  uid: string,
  projectId: string,
): Promise<string> {
  const projectSnap = await getDoc(paths.projectDoc(db, projectId));
  const project = projectSnap.data();
  if (!project) throw new Error('Project not found.');
  if (project.openDraftVersionId) {
    throw new Error('This project already has an open draft. Finish or abandon it first.');
  }

  const [versions, items] = await Promise.all([
    getDocs(query(paths.budgetVersions(db, projectId), orderBy('versionNo', 'desc'))),
    getDocs(paths.costItems(db, projectId)),
  ]);

  const nextNo = (versions.docs[0]?.data().versionNo ?? 0) + 1;
  const versionRef = doc(paths.budgetVersions(db, projectId));
  const batch = writeBatch(db);

  batch.set(versionRef, {
    id: versionRef.id,
    projectId,
    versionNo: nextNo,
    status: 'draft',
    note: null,
    approvedBy: null,
    approvedAt: null,
    supersededAt: null,
    clientApproval: {
      status: 'not_sent',
      sentAt: null,
      decidedAt: null,
      method: null,
      reference: null,
      notes: null,
      recordedBy: null,
      recordedAt: null,
    },
    totals: { budgetCost: 0, budgetCostKnown: true, linesWithoutBudget: 0, clientPrice: 0 },
    audit: newAudit(uid),
  });

  for (const snap of items.docs) {
    const item = snap.data();
    if (!item.approved) continue;
    const { versionId: _v, versionNo: _n, approvedAt: _a, ...values } = item.approved;
    batch.update(snap.ref, { draft: values, ...touch(uid) });
  }

  batch.update(paths.projectDoc(db, projectId), { openDraftVersionId: versionRef.id });
  await batch.commit();
  return versionRef.id;
}

/**
 * Abandoning a draft restores the approved values and deletes the draft.
 *
 * It refuses on a budget that has never been approved, because there is
 * nothing to restore TO. On such a project "abandon" would delete the version
 * record and leave every line exactly where it was — a project with a budget
 * in it, no draft, and no way to approve what it contains until somebody
 * works out that a revision has to be started from nothing. That is a
 * confusing state to be dropped into by a button labelled Abandon.
 */
export async function abandonDraft(
  db: Firestore,
  uid: string,
  projectId: string,
  versionId: string,
): Promise<void> {
  const projectSnap = await getDoc(paths.projectDoc(db, projectId));
  if (!projectSnap.data()?.currentApprovedVersionId) {
    throw new Error(
      'This budget has never been approved, so there is nothing to go back to. ' +
        'Abandoning would only delete the draft record — the lines would stay ' +
        'exactly as they are. Delete the lines you do not want instead.',
    );
  }

  const items = await getDocs(paths.costItems(db, projectId));
  const batch = writeBatch(db);

  for (const snap of items.docs) {
    const item = snap.data();
    if (!item.approved) continue;
    const { versionId: _v, versionNo: _n, approvedAt: _a, ...values } = item.approved;
    batch.update(snap.ref, { draft: values, ...touch(uid) });
  }

  batch.delete(doc(paths.budgetVersions(db, projectId), versionId));
  batch.update(paths.projectDoc(db, projectId), { openDraftVersionId: null });
  await batch.commit();
}

/**
 * Approve, via the Cloud Function. Requires Blaze.
 *
 * Deliberately not weakened to work on Spark: approval is what makes a budget
 * a record rather than a draft, and it has to be written where a client cannot
 * reach it.
 */
export async function approveVersion(
  projectId: string,
  versionId: string,
  note: string | null,
): Promise<{ versionNo: number }> {
  const functions = getFunctions(firebaseApp(), 'europe-west2');
  const call = httpsCallable<
    { projectId: string; versionId: string; note: string | null },
    { versionNo: number }
  >(functions, 'approveBudgetVersion');
  const result = await call({ projectId, versionId, note });
  return result.data;
}

/**
 * Record what the client said, and when.
 *
 * The client never logs in. Approval happens by email, PDF or across a table,
 * and this is the record of it — kept separate from the internal act of making
 * a version current, because they are two different facts.
 */
export async function recordClientApproval(
  db: Firestore,
  uid: string,
  projectId: string,
  versionId: string,
  approval: Partial<ClientApproval>,
): Promise<void> {
  await updateDoc(doc(paths.budgetVersions(db, projectId), versionId), {
    clientApproval: {
      ...approval,
      recordedBy: uid,
      recordedAt: new Date().toISOString(),
    },
  });
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export type DiffKind = 'added' | 'removed' | 'changed' | 'unchanged';

export interface DiffLine {
  costItemId: string;
  description: string;
  subEventId: string;
  categoryId: string;
  kind: DiffKind;
  before: CostValues | null;
  after: CostValues | null;
  budgetDelta: number | null;
  priceDelta: number;
}

/**
 * What a revision changes, against the currently approved version.
 *
 * Keyed by cost item ID throughout — which is why a line can be renamed,
 * re-categorised and re-priced across three revisions and still be recognised
 * as the same line.
 */
export function diffAgainstApproved(
  draftItems: CostItem[],
  approvedLines: BudgetVersionLine[],
): DiffLine[] {
  const approved = new Map(approvedLines.map((l) => [l.id, l]));
  const lines: DiffLine[] = [];

  for (const item of draftItems) {
    const before = approved.get(item.id)?.values ?? null;
    const after = item.draft;
    approved.delete(item.id);

    const changed =
      before === null ||
      before.budgetCost !== after.budgetCost ||
      before.clientPrice !== after.clientPrice;

    lines.push({
      costItemId: item.id,
      description: item.description,
      subEventId: item.subEventId,
      categoryId: item.categoryId,
      kind: before === null ? 'added' : changed ? 'changed' : 'unchanged',
      before,
      after,
      budgetDelta:
        before?.budgetCost == null || after.budgetCost == null
          ? null
          : after.budgetCost - before.budgetCost,
      priceDelta: after.clientPrice - (before?.clientPrice ?? 0),
    });
  }

  // Anything left was in the approved version and is gone from the draft.
  for (const line of approved.values()) {
    lines.push({
      costItemId: line.id,
      description: line.description,
      subEventId: line.subEventId,
      categoryId: line.categoryId,
      kind: 'removed',
      before: line.values,
      after: null,
      budgetDelta: line.values.budgetCost === null ? null : -line.values.budgetCost,
      priceDelta: -line.values.clientPrice,
    });
  }

  return lines;
}

export function diffTotals(lines: DiffLine[]) {
  const moved = lines.filter((l) => l.kind !== 'unchanged');
  return {
    added: lines.filter((l) => l.kind === 'added').length,
    removed: lines.filter((l) => l.kind === 'removed').length,
    changed: lines.filter((l) => l.kind === 'changed').length,
    priceMovement: moved.reduce((a, l) => a + l.priceDelta, 0),
    budgetMovement: moved.reduce((a, l) => a + (l.budgetDelta ?? 0), 0),
    budgetMovementKnown: moved.every((l) => l.budgetDelta !== null),
  };
}
