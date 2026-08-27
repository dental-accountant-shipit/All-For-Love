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
import { validatePlan, type ImportPlan } from '../../src/domain/import/plan';
import { materialise, totalsAgree } from '../../src/domain/import/materialise';
import {
  DEFAULT_PROJECT_SETTINGS,
  type Category,
  type Commission,
  type Commitment,
  type CostItem,
  type ProjectSettings,
  type SubEvent,
  type Transaction,
} from '../../src/domain/types';

initializeApp();
const db = getFirestore();

const REGION = 'europe-west2';

// ---------------------------------------------------------------------------
// Reading a project's financial state
// ---------------------------------------------------------------------------

async function loadProject(projectId: string) {
  const [project, items, subEvents, categories, commissions, commitments, transactions] =
    await Promise.all([
      db.doc(`projects/${projectId}`).get(),
      db.collection(`projects/${projectId}/costItems`).get(),
      db.collection(`projects/${projectId}/subEvents`).get(),
      db.collection(`projects/${projectId}/categories`).get(),
      db.collection(`projects/${projectId}/commissions`).get(),
      db.collection('commitments').where('projectId', '==', projectId).get(),
      db.collection('transactions').where('projectId', '==', projectId).get(),
    ]);

  const withId = <T>(d: FirebaseFirestore.QueryDocumentSnapshot): T =>
    ({ ...d.data(), id: d.id }) as T;

  return {
    costItems: items.docs.map((d) => withId<CostItem>(d)),
    subEvents: subEvents.docs.map((d) => withId<SubEvent>(d)),
    // The contingency base depends on both of these. The browser path loads
    // them too; the two must agree exactly, or a figure would change the
    // moment Blaze was switched on.
    categories: categories.docs.map((d) => withId<Category>(d)),
    settings: (project.data()?.settings as ProjectSettings) ?? DEFAULT_PROJECT_SETTINGS,
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
    let budgetCostKnown = true;
    let linesWithoutBudget = 0;

    for (const docSnap of itemsSnap.docs) {
      const item = { ...docSnap.data(), id: docSnap.id } as CostItem;

      // A proposed extra is not part of the approved budget until it is agreed.
      if (item.origin === 'extra' && item.extraStatus !== 'approved') continue;

      const values = item.draft;
      // A line with no recorded budget does not contribute a zero. Summing
      // null as zero is how a project with no budget at all comes to report
      // that it met one.
      if (values.budgetCost === null) {
        budgetCostKnown = false;
        linesWithoutBudget += 1;
      } else {
        budgetCost += values.budgetCost;
      }
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
      totals: { budgetCost, budgetCostKnown, linesWithoutBudget, clientPrice },
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
      totals: { budgetCost, budgetCostKnown, linesWithoutBudget, clientPrice },
      createdAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();
    await recomputeProject(projectId);

    return { versionNo };
  },
);

// ---------------------------------------------------------------------------
// Admin Import
// ---------------------------------------------------------------------------

/**
 * Write a reviewed import plan.
 *
 * The one operation that creates hundreds of records at once, so it is the one
 * with the most said no to it:
 *
 *   - Only the `admin` role may call it, and `admin` can do nothing else. It
 *     cannot edit a budget, approve one, or record a cost. Historical loading
 *     is a job, not a rank.
 *   - The plan's money is recomputed here from its raw per-unit cell values
 *     before anything is written. The browser's figures are a preview. If the
 *     two disagree the import is refused rather than reconciled, because a
 *     reviewer approved a set of numbers and those are the numbers that should
 *     land.
 *   - Everything lands under one `importBatches` document, so a bad run is one
 *     call to undo rather than an afternoon of archaeology.
 *
 * What it deliberately does NOT do: set a budgeted cost. Imported lines carry
 * budget null — never budget equal to actual, which would report every line at
 * a variance of zero against a budget nobody ever set.
 */
export const adminImportProject = onCall(
  { region: REGION, memory: '512MiB', timeoutSeconds: 300 },
  async (request): Promise<{ projectId: string; importBatchId: string; counts: Counts }> => {
    if (request.auth?.token?.role !== 'admin') {
      throw new HttpsError(
        'permission-denied',
        'Historical import is restricted to the administrator role.',
      );
    }

    const plan = (request.data as { plan?: ImportPlan }).plan;
    if (!plan || typeof plan !== 'object') {
      throw new HttpsError('invalid-argument', 'No import plan was supplied.');
    }

    const problems = validatePlan(plan);
    if (problems.length > 0) {
      throw new HttpsError('invalid-argument', problems.map((p) => p.message).join(' '));
    }

    // The browser computed these to show the reviewer. This recomputes them
    // from the same raw lines and refuses to proceed if they have moved.
    if (!totalsAgree(plan)) {
      throw new HttpsError(
        'failed-precondition',
        'The plan no longer adds up to the figures that were reviewed. Rebuild the preview and try again.',
      );
    }

    const uid = request.auth!.uid;
    const at = new Date().toISOString();
    const projectRef = db.collection('projects').doc();
    const projectId = projectRef.id;
    const batchRef = db.collection('importBatches').doc();
    const importBatchId = batchRef.id;
    const versionId = `${importBatchId}_v`;

    const categoryIds = new Map(
      plan.categories.map((c) => [c.key, `${importBatchId}_c${c.key}`.slice(0, 120)]),
    );

    const built = materialise(plan, {
      projectId,
      subEventId: 'main',
      importBatchId,
      importedBy: uid,
      at,
      versionId,
      versionNo: 1,
      categoryId: (key) => categoryIds.get(key) ?? key,
      costItemId: (line) => `r${line.sourceRow}`,
      transactionId: (line) => `${importBatchId}_r${line.sourceRow}`,
    });

    const provenance = {
      imported: true as const,
      sourceSystem: 'excel_workbook' as const,
      sourceFilename: plan.sourceFilename,
      sourceReference: plan.sheetName,
      originalVersionRef: plan.originalVersionRef,
      originalApprovalDate: null,
      importedAt: at,
      importedBy: uid,
      importBatchId,
    };

    const audit = { createdAt: at, createdBy: uid, updatedAt: at, updatedBy: uid };

    const writer = db.bulkWriter();

    writer.set(projectRef, {
      name: plan.projectName,
      clientName: plan.clientName,
      eventType: null,
      venue: null,
      eventDate: null,
      // A historical import is a finished job, not a live one.
      status: 'completed',
      baseCurrency: 'GBP',
      subEventMode: 'single',
      settings: DEFAULT_PROJECT_SETTINGS,
      originalApprovedVersionId: versionId,
      currentApprovedVersionId: versionId,
      openDraftVersionId: null,
      rollup: {},
      import: provenance,
      audit,
    });

    // The imported figures are recorded as an approved version so the project
    // has a history from its first day, and so nothing can quietly edit what
    // was imported without leaving a revision behind.
    writer.set(projectRef.collection('budgetVersions').doc(versionId), {
      projectId,
      versionNo: 1,
      status: 'approved',
      label: `Imported from ${plan.sourceFilename}`,
      note: plan.originalVersionRef
        ? `Original workbook version ${plan.originalVersionRef}.`
        : null,
      approvedAt: at,
      approvedBy: uid,
      supersededAt: null,
      import: provenance,
      audit,
    });

    writer.set(projectRef.collection('subEvents').doc('main'), stripId(built.subEvent));
    for (const category of built.categories) {
      writer.set(projectRef.collection('categories').doc(category.id), stripId(category));
    }
    for (const item of built.costItems) {
      writer.set(projectRef.collection('costItems').doc(item.id), stripId(item));
    }
    for (const transaction of built.transactions) {
      writer.set(db.collection('transactions').doc(transaction.id), stripId(transaction));
    }

    const counts: Counts = {
      categories: built.categories.length,
      costItems: built.costItems.length,
      transactions: built.transactions.length,
      warnings: plan.warnings.length,
    };

    writer.set(batchRef, {
      projectId,
      projectName: plan.projectName,
      sourceFilename: plan.sourceFilename,
      sheetName: plan.sheetName,
      originalVersionRef: plan.originalVersionRef,
      importedAt: at,
      importedBy: uid,
      counts,
      // The reviewed figures, kept so a stored project can always be compared
      // with what the import said it would produce.
      plannedTotals: plan.totals,
      workbookTotals: plan.workbookTotals,
      warnings: plan.warnings,
      reversedAt: null,
      reversedBy: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    await writer.close();
    await recomputeProject(projectId);

    logger.info(`Imported ${plan.projectName}`, { projectId, importBatchId, ...counts });
    return { projectId, importBatchId, counts };
  },
);

interface Counts {
  categories: number;
  costItems: number;
  transactions: number;
  warnings: number;
}

/** Documents do not store the ID they are keyed by. */
function stripId<T extends { id: string }>(model: T): Omit<T, 'id'> {
  const { id: _ignored, ...rest } = model;
  return rest;
}

/**
 * Undo an import.
 *
 * Reversibility is what makes a restricted import pathway safe to use rather
 * than something everyone is afraid to touch. Every record from a run carries
 * the same `importBatchId`, so this is a query rather than a reconstruction.
 *
 * It refuses once the project has been worked on. Deleting a project that
 * somebody has since recorded real costs against would destroy live data to
 * tidy up an old mistake, which is the wrong trade every time.
 */
export const adminReverseImport = onCall(
  { region: REGION, memory: '512MiB', timeoutSeconds: 300 },
  async (request): Promise<{ deleted: number }> => {
    if (request.auth?.token?.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Reversing an import is restricted.');
    }

    const { importBatchId } = request.data as { importBatchId?: string };
    if (!importBatchId) throw new HttpsError('invalid-argument', 'importBatchId is required.');

    const batchRef = db.doc(`importBatches/${importBatchId}`);
    const batchSnap = await batchRef.get();
    if (!batchSnap.exists) throw new HttpsError('not-found', 'No such import.');
    if (batchSnap.data()!.reversedAt) {
      throw new HttpsError('failed-precondition', 'That import has already been reversed.');
    }

    const projectId = batchSnap.data()!.projectId as string;

    const [commitments, laterTransactions, versions] = await Promise.all([
      db.collection('commitments').where('projectId', '==', projectId).limit(1).get(),
      db
        .collection('transactions')
        .where('projectId', '==', projectId)
        .where('source', '!=', 'import')
        .limit(1)
        .get(),
      db.collection(`projects/${projectId}/budgetVersions`).get(),
    ]);

    if (!commitments.empty || !laterTransactions.empty || versions.size > 1) {
      throw new HttpsError(
        'failed-precondition',
        'This project has been worked on since it was imported, so it will not be deleted automatically. Remove it by hand if that is really what you want.',
      );
    }

    const writer = db.bulkWriter();
    let deleted = 0;

    const transactions = await db
      .collection('transactions')
      .where('projectId', '==', projectId)
      .get();
    for (const doc of transactions.docs) {
      writer.delete(doc.ref);
      deleted += 1;
    }

    for (const sub of ['costItems', 'categories', 'subEvents', 'budgetVersions', 'commissions']) {
      const snap = await db.collection(`projects/${projectId}/${sub}`).get();
      for (const doc of snap.docs) {
        writer.delete(doc.ref);
        deleted += 1;
      }
    }

    writer.delete(db.doc(`projects/${projectId}`));
    deleted += 1;

    // The batch record itself stays, marked reversed. An import that happened
    // and was undone is part of the history of the system.
    writer.update(batchRef, { reversedAt: new Date().toISOString(), reversedBy: request.auth!.uid });

    await writer.close();
    logger.info(`Reversed import ${importBatchId}`, { projectId, deleted });
    return { deleted };
  },
);
