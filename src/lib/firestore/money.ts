/**
 * Commitments and actual costs.
 *
 * Budget versus actual hides the most useful moment in an event budget: the
 * point where money is promised but not yet spent. These two collections are
 * what make the four-figure view possible — Budget · Committed · Actual ·
 * Forecast — and why a £2,500 overspend is visible the day a purchase order
 * is raised rather than six weeks later when the invoice arrives.
 */

import {
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

import * as paths from './paths';
import { newAudit, touch } from './projects';
import { toBaseCurrency, type Pence } from '../../domain/money';
import { signedAmounts } from '../../domain/values';
import type {
  Commitment,
  CommitmentStatus,
  CostItem,
  CostItemStatus,
  Transaction,
  TransactionType,
} from '../../domain/types';

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function watchProjectCommitments(
  db: Firestore,
  projectId: string,
  onChange: (commitments: Commitment[]) => void,
) {
  return onSnapshot(
    query(paths.commitments(db), where('projectId', '==', projectId)),
    (snap) => onChange(snap.docs.map((d) => d.data())),
  );
}

export function watchProjectTransactions(
  db: Firestore,
  projectId: string,
  onChange: (transactions: Transaction[]) => void,
) {
  return onSnapshot(
    query(paths.transactions(db), where('projectId', '==', projectId), orderBy('date', 'desc')),
    (snap) => onChange(snap.docs.map((d) => d.data())),
  );
}

/** Everything owed to and spent with one supplier, across every project. */
export function watchSupplierSpend(
  db: Firestore,
  supplierId: string,
  onChange: (transactions: Transaction[]) => void,
) {
  return onSnapshot(
    query(paths.transactions(db), where('supplierId', '==', supplierId), orderBy('date', 'desc')),
    (snap) => onChange(snap.docs.map((d) => d.data())),
  );
}

// ---------------------------------------------------------------------------
// Commitments
// ---------------------------------------------------------------------------

export interface NewCommitment {
  supplierId: string | null;
  supplierName: string | null;
  reference: string | null;
  amountExVat: Pence;
  vatAmount: Pence;
  currency: string;
  fxRate: number;
  expectedInvoiceDate: string | null;
  notes: string | null;
}

/**
 * Record a purchase order or accepted quote.
 *
 * Recording a commitment advances the cost item to Committed, unless it is
 * already further along — a line that is in progress does not go backwards
 * because a second supplier was booked.
 */
export async function createCommitment(
  db: Firestore,
  uid: string,
  item: CostItem,
  input: NewCommitment,
): Promise<string> {
  const ref = doc(paths.commitments(db));
  const batch = writeBatch(db);

  const commitment: Omit<Commitment, 'id'> = {
    projectId: item.projectId,
    // Denormalised at write time so a sub-event's ledger needs no join.
    subEventId: item.subEventId,
    costItemId: item.id,
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    reference: input.reference,
    status: 'issued',
    amountExVat: input.amountExVat,
    vatAmount: input.vatAmount,
    currency: input.currency,
    fxRate: input.fxRate,
    amountBaseExVat: toBaseCurrency(input.amountExVat, input.fxRate),
    issuedAt: new Date().toISOString(),
    expectedInvoiceDate: input.expectedInvoiceDate,
    notes: input.notes,
    audit: newAudit(uid),
  };
  batch.set(ref, { ...commitment, id: ref.id });

  const ADVANCES_FROM: CostItemStatus[] = ['planned', 'quoted'];
  if (ADVANCES_FROM.includes(item.status)) {
    batch.update(paths.costItemDoc(db, item.projectId, item.id), {
      status: 'committed',
      ...touch(uid),
    });
  }

  await batch.commit();
  return ref.id;
}

export async function setCommitmentStatus(
  db: Firestore,
  uid: string,
  commitmentId: string,
  status: CommitmentStatus,
): Promise<void> {
  // Cancelling is a status change. The record itself stays, because a
  // commitment that was raised and withdrawn is part of what happened.
  await updateDoc(doc(paths.commitments(db), commitmentId), { status, ...touch(uid) });
}

// ---------------------------------------------------------------------------
// Actual costs
// ---------------------------------------------------------------------------

export interface NewTransaction {
  type: TransactionType;
  supplierId: string | null;
  supplierName: string | null;
  /** Links a bill to the commitment it draws down. Optional and often absent. */
  commitmentId: string | null;
  reference: string | null;
  date: string;
  amountExVat: Pence;
  vatAmount: Pence;
  currency: string;
  fxRate: number;
  paymentStatus: Transaction['paymentStatus'];
}

/**
 * Record a bill, credit or expense against a cost item.
 *
 * A credit is stored as a negative amount of the same shape rather than as a
 * separate concept, so every sum in the engine handles it without knowing it
 * exists.
 *
 * A bill need not reference a commitment. Uncommitted spend still counts
 * towards actual cost and still moves the forecast — that is the point.
 */
export async function createTransaction(
  db: Firestore,
  uid: string,
  item: CostItem,
  input: NewTransaction,
): Promise<string> {
  const { amountExVat: signed, vatAmount: signedVat } = signedAmounts(
    input.type,
    input.amountExVat,
    input.vatAmount,
  );

  const ref = doc(paths.transactions(db));
  const batch = writeBatch(db);

  const transaction: Omit<Transaction, 'id'> = {
    projectId: item.projectId,
    subEventId: item.subEventId,
    costItemId: item.id,
    commitmentId: input.commitmentId,
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    type: input.type,
    source: 'manual',
    xeroId: null,
    xeroUpdatedAt: null,
    reference: input.reference,
    date: input.date,
    amountExVat: signed,
    vatAmount: signedVat,
    currency: input.currency,
    fxRate: input.fxRate,
    amountBaseExVat: toBaseCurrency(signed, input.fxRate),
    paymentStatus: input.paymentStatus,
    allocationStatus: 'allocated',
    parentTransactionId: null,
    audit: newAudit(uid),
  };
  batch.set(ref, { ...transaction, id: ref.id });

  // The first cost against a planned or quoted line means work has started.
  const ADVANCES_FROM: CostItemStatus[] = ['planned', 'quoted', 'committed'];
  if (input.type !== 'credit' && ADVANCES_FROM.includes(item.status)) {
    batch.update(paths.costItemDoc(db, item.projectId, item.id), {
      status: 'in_progress',
      ...touch(uid),
    });
  }

  await batch.commit();
  return ref.id;
}

/** Only manually entered costs can be removed. Xero owns its own records. */
export async function deleteTransaction(
  db: Firestore,
  transaction: Transaction,
): Promise<void> {
  if (transaction.source !== 'manual') {
    throw new Error('This cost came from Xero and cannot be deleted here.');
  }
  await deleteDoc(doc(paths.transactions(db), transaction.id));
}

// ---------------------------------------------------------------------------
// Forecast override
// ---------------------------------------------------------------------------

/**
 * Override the calculated forecast for one line.
 *
 * The calculated value keeps running underneath — `rollup.calculatedForecast`
 * is maintained on every write regardless — so an override never destroys the
 * arithmetic it replaces, and the audit trail can answer why a project's
 * forecast profit moved on a particular day.
 */
export async function setForecastOverride(
  db: Firestore,
  uid: string,
  projectId: string,
  costItemId: string,
  value: Pence,
  reason: string,
): Promise<void> {
  if (!reason.trim()) throw new Error('An override needs a reason.');
  await updateDoc(paths.costItemDoc(db, projectId, costItemId), {
    forecastOverride: { value, reason: reason.trim(), byUid: uid, at: new Date().toISOString() },
    ...touch(uid),
  });
}

export async function clearForecastOverride(
  db: Firestore,
  uid: string,
  projectId: string,
  costItemId: string,
): Promise<void> {
  await updateDoc(paths.costItemDoc(db, projectId, costItemId), {
    forecastOverride: null,
    ...touch(uid),
  });
}

// ---------------------------------------------------------------------------
// Cost item details
// ---------------------------------------------------------------------------

export async function updateDetails(
  db: Firestore,
  uid: string,
  projectId: string,
  costItemId: string,
  details: Partial<CostItem['details']>,
): Promise<void> {
  const patch: Record<string, unknown> = { ...touch(uid) };
  for (const [key, value] of Object.entries(details)) {
    patch[`details.${key}`] = value;
  }
  await updateDoc(paths.costItemDoc(db, projectId, costItemId), patch);
}

export async function updateExtraStatus(
  db: Firestore,
  uid: string,
  projectId: string,
  costItemId: string,
  origin: CostItem['origin'],
  extraStatus: CostItem['extraStatus'],
): Promise<void> {
  await updateDoc(paths.costItemDoc(db, projectId, costItemId), {
    origin,
    extraStatus: origin === 'extra' ? extraStatus : null,
    ...touch(uid),
  });
}

/**
 * Cancel a line, and record whether the client stops paying for it.
 *
 * Cancelling does not automatically reduce what the client owes — sometimes
 * the work is dropped and the price stands. The answer produces the "agreed
 * reductions" figure, so it is asked rather than assumed.
 */
export async function cancelLine(
  db: Firestore,
  uid: string,
  projectId: string,
  costItemId: string,
  clientValueWithdrawn: boolean,
): Promise<void> {
  await updateDoc(paths.costItemDoc(db, projectId, costItemId), {
    status: 'cancelled',
    clientValueWithdrawn,
    ...touch(uid),
  });
}
