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
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { randomBytes } from 'node:crypto';

import { versionTotals } from '../../src/domain/versionTotals';
import { canChangeRole, looksLikeEmail, type Person } from '../../src/domain/userAdmin';
import { ASSIGNABLE_ROLES, isRole } from '../../src/lib/auth/roles';
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
  type Role,
  type SubEvent,
  type Transaction,
} from '../../src/domain/types';

initializeApp();
const db = getFirestore();

const REGION = 'europe-west2';

/**
 * Who may run an import, or take one back.
 *
 * 'admin' is still accepted so that a claim issued before the owner role
 * existed keeps working; nobody is given it any more.
 */
function canImport(role: unknown): boolean {
  return role === 'owner' || role === 'admin';
}

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
    if (role !== 'director' && role !== 'owner') {
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
    const items = itemsSnap.docs.map(
      (docSnap) => ({ ...docSnap.data(), id: docSnap.id }) as CostItem,
    );
    // One definition of what a version totals, shared with the import. They
    // used to be two, in two files, with nothing checking they agreed.
    const { budgetCost, clientPrice, budgetCostKnown, linesWithoutBudget } =
      versionTotals(items);

    for (const item of items) {
      // A proposed extra is not part of the approved budget until it is agreed.
      if (item.origin === 'extra' && item.extraStatus !== 'approved') continue;

      const values = item.draft;

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
    if (!canImport(request.auth?.token?.role)) {
      throw new HttpsError('permission-denied', 'Historical import is restricted to the owner.');
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
      // Totalled with the same function `approveBudgetVersion` uses.
      //
      // This was simply left out, and nothing complained: the Admin SDK's
      // set() takes plain document data, so a required field of BudgetVersion
      // can go missing with no type error. The Versions screen then read
      // v.totals.budgetCost off it and the whole application went white.
      totals: versionTotals(built.costItems),
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
    if (!canImport(request.auth?.token?.role)) {
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

// ---------------------------------------------------------------------------
// People and what they may do
// ---------------------------------------------------------------------------

/**
 * Access lives in Firebase Auth, not in a document.
 *
 * A role is a custom claim, which is why a security rule can check it without
 * costing a read. That also makes Auth the single source of truth: there is no
 * `users` document that could disagree with the claim and let somebody argue
 * about which one is right. These three functions are the only way a claim is
 * ever set, and they run server-side because a client that could write its own
 * claim would have no permissions at all, only the appearance of them.
 *
 * A `users/{uid}` document is written alongside as a readable record — who is
 * here, what they may do, who last changed it and when. It is never read to
 * decide anything.
 */

const PEOPLE_LIMIT = 200;

function requireOwner(request: CallableRequest<unknown>): string {
  if (request.auth?.token?.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Only an owner can manage who has access.');
  }
  return request.auth.uid!;
}

async function everybody(): Promise<Person[]> {
  const { users } = await getAuth().listUsers(PEOPLE_LIMIT);
  return users.map((user) => ({
    uid: user.uid,
    email: user.email ?? null,
    role: isRole(user.customClaims?.role) ? (user.customClaims!.role as Role) : null,
  }));
}

interface PersonRow extends Person {
  displayName: string | null;
  disabled: boolean;
  lastSignInAt: string | null;
  createdAt: string;
  /** True when the account exists but has never been signed into. */
  awaitingFirstSignIn: boolean;
}

/** Everyone with an account, and what each of them may do. */
export const listPeople = onCall(
  { region: REGION },
  async (request): Promise<{ people: PersonRow[] }> => {
    requireOwner(request);

    const { users } = await getAuth().listUsers(PEOPLE_LIMIT);
    const people = users
      .map((user): PersonRow => ({
        uid: user.uid,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        role: isRole(user.customClaims?.role) ? (user.customClaims!.role as Role) : null,
        disabled: user.disabled,
        lastSignInAt: user.metadata.lastSignInTime
          ? new Date(user.metadata.lastSignInTime).toISOString()
          : null,
        createdAt: new Date(user.metadata.creationTime).toISOString(),
        awaitingFirstSignIn: !user.metadata.lastSignInTime,
      }))
      .sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));

    return { people };
  },
);

/**
 * Change what somebody may do, or take their access away entirely.
 *
 * `null` means no role: the account still exists and can sign in, but every
 * rule refuses it and the application shows the "no role yet" screen. That is
 * deliberately not the same as deleting the account, which would throw away
 * the audit trail of everything they did.
 *
 * The refusal that matters — never leaving the system without an owner — is
 * decided by `canChangeRole` in the domain, where it is tested, rather than
 * being remembered here.
 */
export const setUserRole = onCall(
  { region: REGION },
  async (request): Promise<{ uid: string; role: Role | null }> => {
    const actorUid = requireOwner(request);

    const { uid, role } = request.data as { uid?: string; role?: string | null };
    if (!uid) throw new HttpsError('invalid-argument', 'uid is required.');

    // null is meaningful — it is "no role", which is how access is removed —
    // so it is checked before anything else rather than treated as missing.
    if (role != null && (!isRole(role) || !ASSIGNABLE_ROLES.includes(role))) {
      throw new HttpsError('invalid-argument', `${role} is not a role that can be given out.`);
    }
    const next: Role | null = role ?? null;

    const people = await everybody();
    const decision = canChangeRole(people, actorUid, uid, next);
    if (!decision.allowed) {
      throw new HttpsError('failed-precondition', decision.reason);
    }

    const at = new Date().toISOString();
    await getAuth().setCustomUserClaims(uid, next === null ? null : { role: next });

    // A claim lives inside an ID token, which the browser holds for up to an
    // hour. Without this, taking somebody's access away would leave them with
    // it until their token happened to expire. Revoking makes them sign in
    // again, which is the honest version of what just happened.
    await getAuth().revokeRefreshTokens(uid);

    const subject = people.find((person) => person.uid === uid);
    await db.doc(`users/${uid}`).set(
      {
        email: subject?.email ?? null,
        role: next,
        roleSetAt: at,
        roleSetBy: actorUid,
      },
      { merge: true },
    );

    logger.info('Role changed', { uid, from: subject?.role ?? null, to: next, by: actorUid });
    return { uid, role: next };
  },
);

/**
 * Invite somebody by email address.
 *
 * The account is created here with a random password that is never returned to
 * anybody, including the person who sent the invitation. The caller then asks
 * Firebase to send a password email, so the new person sets their own password
 * and nobody ever handles it — not the owner, not this function, not a log.
 *
 * If the address already has an account this does not fail: it sets the role
 * and reports that they were already here. Re-inviting a colleague who forgot
 * they had access should not look like an error.
 */
export const invitePerson = onCall(
  { region: REGION },
  async (request): Promise<{ uid: string; email: string; created: boolean }> => {
    const actorUid = requireOwner(request);

    const { email, role } = request.data as { email?: string; role?: string };
    if (!email || !looksLikeEmail(email)) {
      throw new HttpsError('invalid-argument', 'That does not look like an email address.');
    }
    if (!role || !isRole(role) || !ASSIGNABLE_ROLES.includes(role)) {
      throw new HttpsError('invalid-argument', 'Choose what they may do.');
    }

    const address = email.trim().toLowerCase();

    let uid: string;
    let created: boolean;
    try {
      const existing = await getAuth().getUserByEmail(address);
      uid = existing.uid;
      created = false;
    } catch (error) {
      // Only "there is no such person" means create one. Anything else — a
      // network fault, a quota — must surface as itself rather than being
      // turned into a confusing "email already exists" from the next call.
      if ((error as { code?: string })?.code !== 'auth/user-not-found') {
        logger.error('Could not look up an invited address', error);
        throw new HttpsError('internal', 'The invitation could not be sent. Try again.');
      }
      const made = await getAuth().createUser({
        email: address,
        emailVerified: false,
        // Never returned, never logged. The invitation email is what gets them
        // in, and it makes them choose their own.
        password: randomPassword(),
      });
      uid = made.uid;
      created = true;
    }

    await getAuth().setCustomUserClaims(uid, { role });

    const at = new Date().toISOString();
    await db.doc(`users/${uid}`).set(
      { email: address, role, roleSetAt: at, roleSetBy: actorUid, invitedAt: at },
      { merge: true },
    );

    logger.info('Person invited', { uid, role, by: actorUid, created });
    return { uid, email: address, created };
  },
);

/** Long, random, and immediately forgotten. */
function randomPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%^&*-_';
  const bytes = randomBytes(32);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}
