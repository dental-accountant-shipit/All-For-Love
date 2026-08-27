/**
 * Test fixtures.
 *
 * `fenwickAndHale` reproduces the worked example in the system design
 * document exactly. If the design document and this fixture ever disagree,
 * one of them is wrong and the build should stop.
 */

import { toPence } from '../money';
import type {
  Commission,
  Commitment,
  CostItem,
  CostValues,
  SubEvent,
  Transaction,
} from '../types';

const AT = '2026-08-26T09:00:00.000Z';

const audit = { createdAt: AT, createdBy: 'u_ruth', updatedAt: AT, updatedBy: 'u_ruth' };

const details = {
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

const emptyRollup = {
  committedTotal: 0,
  committedRemaining: 0,
  actualTotal: 0,
  calculatedForecast: 0,
  forecastCost: 0,
  forecastSource: 'calculated' as const,
  recomputedAt: AT,
  recomputeSeq: 0,
};

function values(budgetCost: number, clientPrice: number): CostValues {
  return {
    quantity: null,
    unitCost: null,
    unitPrice: null,
    percentageRate: null,
    budgetCost: toPence(budgetCost),
    clientPrice: toPence(clientPrice),
  };
}

function quantityValues(qty: number, unitCost: number, unitPrice: number): CostValues {
  return {
    quantity: qty,
    unitCost: toPence(unitCost),
    unitPrice: toPence(unitPrice),
    percentageRate: null,
    budgetCost: toPence(qty * unitCost),
    clientPrice: toPence(qty * unitPrice),
  };
}

export interface ItemSpec {
  id: string;
  description: string;
  status: CostItem['status'];
  subEventId?: string;
  categoryId?: string;
  origin?: CostItem['origin'];
  extraStatus?: CostItem['extraStatus'];
  clientValueWithdrawn?: boolean;
  /** Values in the first approved version. Omit for a line added later. */
  original?: CostValues;
  /** Values in the current approved version. Omit for an unapproved line. */
  approved?: CostValues;
  draft: CostValues;
  override?: { value: number; reason: string };
}

export function makeItem(spec: ItemSpec, projectId = 'p_fenwick'): CostItem {
  return {
    id: spec.id,
    projectId,
    subEventId: spec.subEventId ?? 'se_main',
    categoryId: spec.categoryId ?? 'cat_general',
    sortKey: spec.id,
    description: spec.description,
    mode: spec.draft.quantity === null ? 'lump' : 'quantity',
    status: spec.status,
    origin: spec.origin ?? 'original',
    extraStatus: spec.extraStatus ?? null,
    clientValueWithdrawn: spec.clientValueWithdrawn ?? false,
    draft: spec.draft,
    approved: spec.approved
      ? { ...spec.approved, versionId: 'bv_3', versionNo: 3, approvedAt: AT }
      : null,
    original: spec.original
      ? {
          versionId: 'bv_1',
          budgetCost: spec.original.budgetCost,
          clientPrice: spec.original.clientPrice,
        }
      : null,
    details,
    rollup: emptyRollup,
    forecastOverride: spec.override
      ? { value: toPence(spec.override.value), reason: spec.override.reason, byUid: 'u_ruth', at: AT }
      : null,
    copiedFromCostItemId: null,
    audit,
  };
}

export function makeCommitment(
  id: string,
  costItemId: string,
  amount: number,
  status: Commitment['status'] = 'accepted',
  subEventId = 'se_main',
  projectId = 'p_fenwick',
): Commitment {
  return {
    id,
    projectId,
    subEventId,
    costItemId,
    supplierId: null,
    supplierName: null,
    reference: id.toUpperCase(),
    status,
    amountExVat: toPence(amount),
    vatAmount: toPence(amount * 0.2),
    currency: 'GBP',
    fxRate: 1,
    amountBaseExVat: toPence(amount),
    issuedAt: AT,
    expectedInvoiceDate: null,
    notes: null,
    audit,
  };
}

export function makeTransaction(
  id: string,
  costItemId: string,
  amount: number,
  commitmentId: string | null = null,
  type: Transaction['type'] = 'bill',
  subEventId = 'se_main',
  projectId = 'p_fenwick',
): Transaction {
  return {
    id,
    projectId,
    subEventId,
    costItemId,
    commitmentId,
    supplierId: null,
    supplierName: null,
    type,
    source: 'manual',
    xeroId: null,
    xeroUpdatedAt: null,
    reference: id.toUpperCase(),
    date: AT,
    amountExVat: toPence(amount),
    vatAmount: toPence(amount * 0.2),
    currency: 'GBP',
    fxRate: 1,
    amountBaseExVat: toPence(amount),
    paymentStatus: 'unpaid',
    allocationStatus: 'allocated',
    parentTransactionId: null,
    audit,
  };
}

export function makeSubEvent(
  id: string,
  name: string,
  sortKey: string,
  isDefault = false,
  projectId = 'p_fenwick',
): SubEvent {
  return {
    id,
    projectId,
    name,
    isDefault,
    date: null,
    venue: null,
    sortKey,
    rollup: {} as SubEvent['rollup'],
    audit,
  };
}

// ---------------------------------------------------------------------------
// Fenwick & Hale — the worked example from the system design document
// ---------------------------------------------------------------------------

export function fenwickAndHale() {
  const costItems: CostItem[] = [
    makeItem({
      id: 'ci_florals',
      description: 'Ceremony florals',
      status: 'in_progress',
      original: values(42_000, 63_000),
      approved: values(42_000, 63_000),
      draft: values(42_000, 63_000),
    }),
    makeItem({
      id: 'ci_structures',
      description: 'Structures & rigging',
      status: 'completed',
      original: values(21_500, 44_000),
      approved: values(21_500, 44_000),
      draft: values(21_500, 44_000),
    }),
    makeItem({
      id: 'ci_vessels',
      description: 'Vessels & props hire',
      status: 'committed',
      original: values(9_800, 18_750),
      approved: values(9_800, 18_750),
      draft: values(9_800, 18_750),
    }),
    makeItem({
      id: 'ci_assistants',
      description: 'Assistants',
      status: 'quoted',
      original: quantityValues(15, 320, 450),
      approved: quantityValues(15, 320, 450),
      draft: quantityValues(15, 320, 450),
    }),
    // Added after the original budget and agreed by the client — an approved
    // extra. It has both a client value and a cost, as a real change does.
    makeItem({
      id: 'ci_transport',
      description: 'Transport & logistics',
      status: 'committed',
      origin: 'extra',
      extraStatus: 'approved',
      approved: values(6_280, 9_750),
      draft: values(6_280, 9_750),
    }),
    // Dropped by the client. The £12,000 budget leaves the forecast; the £850
    // already spent on drawings does not.
    makeItem({
      id: 'ci_ceiling',
      description: 'Ceiling installation',
      status: 'cancelled',
      clientValueWithdrawn: true,
      original: values(12_000, 16_000),
      approved: values(12_000, 16_000),
      draft: values(12_000, 16_000),
    }),
    // Awaiting the client's yes. Contributes to nothing until it has it.
    makeItem({
      id: 'ci_lounge',
      description: 'Afterparty lounge dressing',
      status: 'planned',
      origin: 'extra',
      extraStatus: 'proposed',
      draft: values(11_900, 22_400),
    }),
  ];

  const commitments: Commitment[] = [
    makeCommitment('c_florals', 'ci_florals', 39_850, 'accepted'),
    makeCommitment('c_structures', 'ci_structures', 23_940, 'closed'),
    makeCommitment('c_vessels', 'ci_vessels', 8_115, 'issued'),
    makeCommitment('c_transport', 'ci_transport', 7_400, 'accepted'),
  ];

  const transactions: Transaction[] = [
    makeTransaction('t_florals_1', 'ci_florals', 18_420, 'c_florals'),
    makeTransaction('t_structures_1', 'ci_structures', 23_940, 'c_structures'),
    makeTransaction('t_transport_1', 'ci_transport', 1_900, 'c_transport'),
    makeTransaction('t_ceiling_1', 'ci_ceiling', 850, null),
  ];

  const subEvents: SubEvent[] = [makeSubEvent('se_main', 'Wedding Day', 'a0', true)];

  const commissions: Commission[] = [
    {
      id: 'cm_1',
      projectId: 'p_fenwick',
      subEventId: null,
      payeeName: 'Introducing planner',
      payeeSupplierId: null,
      basis: 'percent_of_revenue',
      ratePercent: 5,
      fixedAmount: null,
      status: 'agreed',
      claim: { invoiceNumber: null, invoicedAt: null, paidAt: null, comments: null },
      sortKey: 'a0',
      notes: null,
      audit,
    },
  ];

  return { costItems, commitments, transactions, subEvents, commissions };
}
