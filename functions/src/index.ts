/**
 * Cloud Functions — the rollup chain and the approval transaction.
 *
 * These require the Blaze plan. Until it is enabled the application computes
 * the same figures in the browser from the same pure engine
 * (`src/lib/firestore/liveRollup.ts`), so nothing is blocked and nothing here
 * has to change when Blaze is switched on.
 *
 * Everything in this file is a thin shell. The arithmetic lives in
 * `src/domain`, is framework-free, and is covered by the test suite — because
 * a total nobody can test is a total nobody should trust.
 */

import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import { rollupProject } from '../../src/domain/rollup';
import { forecastCostItem } from '../../src/domain/forecast';
import type {
  Commission,
  Commitment,
  CostItem,
  SubEvent,
  Transaction,
} from '../../src/domain/types';

initializeApp();
const db = getFirestore();

const REGION = 'europe-west2';

// ---------------------------------------------------------------------------
// Reading a project's financial state
// ---------------------------------------------------------------------------

async function loadProject(projectId: string) {
  const [items, subEvents, commissions, commitments, transactions] = await Promise.all([
    db.collection(`projects/${projectId}/costItems`).get(),
    db.collection(`projects/${projectId}/subEvents`).get(),
    db.collection(`projects/${projectId}/commissions`).get(),
    db.collection('commitments').where('projectId', '==', projectId).get(),
    db.collection('transactions').where('projectId', '==', projectId).get(),
  ]);

  const withId = <T>(d: FirebaseFirestore.QueryDocumentSnapshot): T =>
    ({ ...d.data(), id: d.id }) as T;

  return {
    costItems: items.docs.map((d) => withId<CostItem>(d)),
    subEvents: subEvents.docs.map((d) => withId<SubEvent>(d)),
    commissions: commissions.docs.map((d) => withId<Commission>(d)),
    commitments: commitments.docs.map((d) => withId<Commitment>(d)),
    transactions: transactions.docs.map((d) => withId<Transaction>(d)),
  };
}

/**
 * Recompute cost item → sub-event → project, and write the whole result.
 *
 * Every write carries an incrementing `recomputeSeq`. A recompute reads the
 * current state and writes a complete result, so replaying an event is
 * harmless and a slow invocation cannot overwrite a newer one. No counters are
 * incremented anywhere — a counter that drifts after one failed write is a
 * figure nobody can reconcile.
 */
async function recomputeProject(projectId: string): Promise<void> {
  const data = await loadProject(projectId);
  if (data.subEvents.length === 0) {
    logger.warn(`Project ${projectId} has no sub-events; skipping recompute.`);
    return;
  }

  const at = new Date().toISOString();
  const projectSnap = await db.doc(`projects/${projectId}`).get();
  const seq = ((projectSnap.data()?.rollup?.recomputeSeq as number) ?? 0) + 1;

  const rollup = rollupProject(data, at, seq);

  const batch = db.batch();

  for (const item of data.costItems) {
    const result = forecastCostItem(item, data.commitments, data.transactions);
    batch.update(db.doc(`projects/${projectId}/costItems/${item.id}`), {
      rollup: {
        committedTotal: result.committedTotal,
        committedRemaining: result.committedRemaining,
        actualTotal: result.actualTotal,
        calculatedForecast: result.calculatedForecast,
        forecastCost: result.forecastCost,
        forecastSource: result.forecastSource,
        recomputedAt: at,
        recomputeSeq: seq,
      },
    });
  }

  for (const se of rollup.subEvents) {
    const { subEventId, name, ...financials } = se;
    void name;
    batch.update(db.doc(`projects/${projectId}/subEvents/${subEventId}`), {
      rollup: financials,
    });
  }

  batch.update(db.doc(`projects/${projectId}`), { rollup });

  await batch.commit();
  logger.info(`Recomputed ${projectId}`, {
    seq,
    lines: rollup.lineCount,
    forecastCost: rollup.forecastCost,
    forecastProfit: rollup.forecastProfit,
  });
}

function projectIdOf(data: FirebaseFirestore.DocumentData | undefined): string | null {
  const id = data?.projectId;
  return typeof id === 'string' ? id : null;
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

export const onCostItemWritten = onDocumentWritten(
  { region: REGION, document: 'projects/{projectId}/costItems/{costItemId}' },
  async (event) => {
    await recomputeProject(event.params.projectId);
  },
);

export const onCommitmentWritten = onDocumentWritten(
  { region: REGION, document: 'commitments/{commitmentId}' },
  async (event) => {
    const projectId =
      projectIdOf(event.data?.after.data()) ?? projectIdOf(event.data?.before.data());
    if (projectId) await recomputeProject(projectId);
  },
);

export const onTransactionWritten = onDocumentWritten(
  { region: REGION, document: 'transactions/{transactionId}' },
  async (event) => {
    // A transaction can move between projects during allocation, and can
    // arrive with no project at all. Both ends are recomputed.
    const before = projectIdOf(event.data?.before.data());
    const after = projectIdOf(event.data?.after.data());
    const affected = [...new Set([before, after].filter((p): p is string => p !== null))];
    await Promise.all(affected.map(recomputeProject));
  },
);

export const onCommissionWritten = onDocumentWritten(
  { region: REGION, document: 'projects/{projectId}/commissions/{commissionId}' },
  async (event) => {
    await recomputeProject(event.params.projectId);
  },
);

// ---------------------------------------------------------------------------
// Budget approval
// ---------------------------------------------------------------------------

/**
 * Approving a revision, as one transaction:
 *
 *   - freeze an immutable `lines` snapshot keyed by cost item ID
 *   - flip the previous approved version to superseded
 *   - update every cost item's `approved` block
 *   - pin `original` on any line seeing its first approval
 *
 * This runs server-side because the security rules deny clients any write to
 * an approved version — which is the point. There is no client path to
 * approved history at all, not even a guarded one.
 */
export const approveBudgetVersion = onCall(
  { region: REGION },
  async (request): Promise<{ versionNo: number }> => {
    const role = request.auth?.token?.role;
    if (role !== 'director') {
      throw new HttpsError('permission-denied', 'Only a director can approve a budget.');
    }

    const { projectId, versionId, note } = request.data as {
      projectId?: string;
      versionId?: string;
      note?: string;
    };
    if (!projectId || !versionId) {
      throw new HttpsError('invalid-argument', 'projectId and versionId are required.');
    }

    const uid = request.auth!.uid;
    const at = new Date().toISOString();

    const versionRef = db.doc(`projects/${projectId}/budgetVersions/${versionId}`);
    const projectRef = db.doc(`projects/${projectId}`);

    const [versionSnap, projectSnap, itemsSnap] = await Promise.all([
      versionRef.get(),
      projectRef.get(),
      db.collection(`projects/${projectId}/costItems`).get(),
    ]);

    if (!versionSnap.exists) throw new HttpsError('not-found', 'Budget version not found.');
    if (versionSnap.data()!.status !== 'draft') {
      throw new HttpsError('failed-precondition', 'Only a draft version can be approved.');
    }

    const versionNo = versionSnap.data()!.versionNo as number;
    const project = projectSnap.data()!;
    const previousApprovedId = project.currentApprovedVersionId as string | null;

    const batch = db.batch();
    let budgetCost = 0;
    let clientPrice = 0;

    for (const docSnap of itemsSnap.docs) {
      const item = { ...docSnap.data(), id: docSnap.id } as CostItem;

      // A proposed extra is not part of the approved budget until it is agreed.
      if (item.origin === 'extra' && item.extraStatus !== 'approved') continue;

      const values = item.draft;
      budgetCost += values.budgetCost;
      clientPrice += values.clientPrice;

      batch.set(db.doc(`projects/${projectId}/budgetVersions/${versionId}/lines/${item.id}`), {
        id: item.id,
        subEventId: item.subEventId,
        categoryId: item.categoryId,
        description: item.description,
        mode: item.mode,
        values,
        sortKey: item.sortKey,
      });

      const approved = { ...values, versionId, versionNo, approvedAt: at };
      const update: Record<string, unknown> = { approved };

      // The first approval pins the original. It is never written again.
      if (!item.original) {
        update.original = {
          versionId,
          budgetCost: values.budgetCost,
          clientPrice: values.clientPrice,
        };
      }

      batch.update(db.doc(`projects/${projectId}/costItems/${item.id}`), update);
    }

    batch.update(versionRef, {
      status: 'approved',
      approvedBy: uid,
      approvedAt: at,
      note: note ?? null,
      totals: { budgetCost, clientPrice },
    });

    if (previousApprovedId && previousApprovedId !== versionId) {
      batch.update(db.doc(`projects/${projectId}/budgetVersions/${previousApprovedId}`), {
        status: 'superseded',
        supersededAt: at,
      });
    }

    batch.update(projectRef, {
      currentApprovedVersionId: versionId,
      originalApprovedVersionId: project.originalApprovedVersionId ?? versionId,
      openDraftVersionId: null,
    });

    batch.set(db.collection(`projects/${projectId}/activity`).doc(), {
      type: 'budget_approved',
      versionId,
      versionNo,
      by: uid,
      at,
      note: note ?? null,
      totals: { budgetCost, clientPrice },
      createdAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();
    await recomputeProject(projectId);

    return { versionNo };
  },
);
