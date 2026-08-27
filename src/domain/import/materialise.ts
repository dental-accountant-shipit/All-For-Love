/**
 * Plan → records.
 *
 * The second half of an import. Takes a reviewed `ImportPlan` and produces the
 * documents that will be written: categories, cost items, and a transaction for
 * every actual cost.
 *
 * This runs on the server, from the plan's raw per-unit values, so the figures
 * that get stored are the ones this code derives. Whatever the browser
 * displayed is a preview, not an input.
 *
 * Two shapes matter and are worth stating plainly, because both are decisions
 * rather than conveniences:
 *
 *   **Budget is null, never actual.** The workbook holds no budgeted cost. A
 *   line imports with `budgetCost: null`, meaning never recorded. Every rollup
 *   then reports budget-versus-actual as unavailable instead of as a variance
 *   of zero, which is what setting budget = actual would have said.
 *
 *   **Actual cost is a transaction, not a field.** A supplier cost belongs to a
 *   cost item as a dated record with a supplier on it. Importing it as a
 *   transaction means an imported project behaves like a live one from its
 *   first day: the same forecast rules, the same drill-down, the same audit.
 */

import type { ImportPlan, PlannedLine } from './plan';
import { planTotals } from './plan';
import type {
  Audit,
  Category,
  CostItem,
  CostValues,
  ImportProvenance,
  SubEvent,
  Transaction,
} from '../types';

export interface MaterialiseOptions {
  projectId: string;
  subEventId: string;
  importBatchId: string;
  importedBy: string;
  /** Timestamp for every record in this run. Passed in so a run is reproducible. */
  at: string;
  /** Budget version the imported values are recorded against. */
  versionId: string;
  versionNo: number;
  /** Deterministic IDs. Supplied so the caller owns identity. */
  categoryId: (key: string) => string;
  costItemId: (line: PlannedLine) => string;
  transactionId: (line: PlannedLine) => string;
}

export interface MaterialisedImport {
  subEvent: SubEvent;
  categories: Category[];
  costItems: CostItem[];
  transactions: Transaction[];
}

/**
 * Fractional sort keys are generated as a fixed-width sequence here rather than
 * by midpoint insertion. An import is a single ordered pass, so there is
 * nothing to insert between; and a stable, padded key means the imported order
 * is the workbook's order, exactly, forever.
 */
const sortKeyAt = (index: number) => `a${String(index).padStart(5, '0')}`;

export function materialise(
  plan: ImportPlan,
  options: MaterialiseOptions,
): MaterialisedImport {
  const { projectId, subEventId, at, importedBy } = options;

  const audit: Audit = {
    createdAt: at,
    createdBy: importedBy,
    updatedAt: at,
    updatedBy: importedBy,
  };

  const provenance = (sourceReference: string): ImportProvenance => ({
    imported: true,
    sourceSystem: 'excel_workbook',
    sourceFilename: plan.sourceFilename,
    sourceReference,
    originalVersionRef: plan.originalVersionRef,
    originalApprovalDate: null,
    importedAt: at,
    importedBy,
    importBatchId: options.importBatchId,
  });

  const subEvent: SubEvent = {
    id: subEventId,
    projectId,
    // Every project has one. For an ordinary event it is never shown; it
    // exists so that queries, rollups and forecasting have exactly one shape.
    name: 'Whole event',
    isDefault: true,
    date: null,
    venue: null,
    sortKey: 'V',
    rollup: {} as SubEvent['rollup'],
    audit,
  };

  const categories: Category[] = plan.categories.map((category, index) => ({
    id: options.categoryId(category.key),
    projectId,
    name: category.name,
    sortKey: sortKeyAt(index),
    includeInContingencyBase: category.includeInContingencyBase,
    audit,
  }));

  const costItems: CostItem[] = [];
  const transactions: Transaction[] = [];

  plan.lines.forEach((line, index) => {
    const id = options.costItemId(line);
    const values = valuesFor(line);
    const approved: CostItem['approved'] = {
      ...values,
      versionId: options.versionId,
      versionNo: options.versionNo,
      approvedAt: at,
    };

    costItems.push({
      id,
      projectId,
      subEventId,
      categoryId: options.categoryId(line.categoryKey),
      sortKey: sortKeyAt(index),
      description: line.description,
      mode: line.mode,
      // A historical import is a delivered event. Every priced line is done.
      status: 'completed',
      origin: line.origin,
      extraStatus: line.extraStatus,
      clientValueWithdrawn: false,
      draft: values,
      approved,
      original: {
        versionId: options.versionId,
        budgetCost: values.budgetCost,
        clientPrice: values.clientPrice,
      },
      details: {
        supplierId: null,
        supplierName: line.supplierName,
        currency: 'GBP',
        fxRate: 1,
        vatRate: 20,
        ownerUid: null,
        notes: null,
        startDate: null,
        endDate: null,
        responsibility: null,
      },
      rollup: {
        committedTotal: 0,
        committedRemaining: 0,
        actualTotal: 0,
        calculatedForecast: 0,
        forecastCost: 0,
        forecastSource: 'calculated',
        recomputedAt: at,
        recomputeSeq: 0,
      },
      forecastOverride: null,
      copiedFromCostItemId: null,
      import: provenance(`${line.sourceRef}`),
      audit,
    });

    if (line.actualCost !== 0) {
      transactions.push({
        id: options.transactionId(line),
        projectId,
        subEventId,
        costItemId: id,
        commitmentId: null,
        supplierId: null,
        supplierName: line.supplierName,
        type: 'bill',
        source: 'import',
        xeroId: null,
        xeroUpdatedAt: null,
        reference: null,
        date: at,
        amountExVat: line.actualCost,
        // The workbook records cost ex VAT only. Inventing a VAT figure at 20%
        // would be inventing a reclaim.
        vatAmount: 0,
        currency: 'GBP',
        fxRate: 1,
        amountBaseExVat: line.actualCost,
        paymentStatus: 'paid',
        allocationStatus: 'allocated',
        parentTransactionId: null,
        import: provenance(`${line.sourceRef} (cost)`),
        audit,
      });
    }
  });

  return { subEvent, categories, costItems, transactions };
}

/**
 * A line's stored values.
 *
 * `budgetCost` is null on every one of them. That is the whole point — see the
 * note at the top of this file.
 */
function valuesFor(line: PlannedLine): CostValues {
  switch (line.mode) {
    case 'percentage':
      return {
        quantity: null,
        unitCost: null,
        unitPrice: null,
        percentageRate: line.percentageRate,
        budgetCost: null,
        // Owned by the rollup, which resolves it from the live base.
        clientPrice: 0,
      };
    case 'quantity':
      return {
        quantity: line.quantity,
        // The unit COST is deliberately not stored as a budget rate. It is an
        // actual, and it has gone in as a transaction.
        unitCost: null,
        unitPrice: line.unitPrice,
        percentageRate: null,
        budgetCost: null,
        clientPrice: line.clientPrice,
      };
    case 'lump':
      return {
        quantity: null,
        unitCost: null,
        unitPrice: null,
        percentageRate: null,
        budgetCost: null,
        clientPrice: line.clientPrice,
      };
  }
}

/**
 * Recompute a plan's totals from its raw lines and compare them with the totals
 * the plan arrived carrying.
 *
 * The server calls this before writing anything. A mismatch means the plan was
 * altered between preview and submission, and the import is refused — not
 * silently corrected, because a reviewer approved a set of figures and those
 * are the figures that should land.
 */
export function totalsAgree(plan: ImportPlan): boolean {
  const recomputed = planTotals(plan);
  const keys = Object.keys(recomputed) as Array<keyof typeof recomputed>;
  return keys.every((k) => recomputed[k] === plan.totals[k]);
}
