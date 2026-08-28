/**
 * All for Love — Projects
 * Domain model. Mirrors the Firestore document shapes exactly.
 *
 * This is a standalone All for Love London application. It inherits no
 * architecture, terminology or business logic from any other system.
 */

import type { Pence } from './money';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** ISO 8601 timestamp. Firestore Timestamps are converted at the boundary. */
export type Iso = string;

/**
 * Fractional index for ordering. Inserting between two rows computes a key
 * that sorts between theirs, so a reorder writes ONE document rather than
 * renumbering everything below it.
 */
export type SortKey = string;

/**
 * Provenance stamped on anything created by the Admin Import pathway.
 * Its presence is what separates reconstructed history from history the
 * system actually recorded, and no interface is allowed to blur the two.
 */
export interface ImportProvenance {
  imported: true;
  sourceSystem: 'excel_workbook' | 'csv' | 'other';
  /** e.g. "C & D Wedding Budget v4.xlsx" */
  sourceFilename: string;
  /** e.g. "tab: Budget v4" — where in the source this came from */
  sourceReference: string | null;
  /** The version label used in the original workbook, e.g. "v4" */
  originalVersionRef: string | null;
  /** Approval date in the original workbook. Null when genuinely unknown. */
  originalApprovalDate: Iso | null;
  importedAt: Iso;
  importedBy: string;
  /** Every record from one import run shares this, so a bad run is reversible. */
  importBatchId: string;
}

export interface Audit {
  createdAt: Iso;
  createdBy: string;
  updatedAt: Iso;
  updatedBy: string;
}

/**
 * Owner sits above director: everything a director does, plus deciding who
 * else may do what, plus the workbook import. It exists so that being able to
 * hand out access is a deliberate, separate thing from running events — a
 * director can build and approve budgets all day and still not be able to make
 * themselves the owner.
 *
 * 'admin' is retired. It existed only to run the import and could not read a
 * budget, which meant switching roles back and forth to use it. Owner absorbed
 * it. The value is still accepted so an account that already carries the claim
 * keeps working until it is changed.
 */
export type Role = 'owner' | 'director' | 'producer' | 'finance' | 'viewer' | 'admin';

// ---------------------------------------------------------------------------
// Project and Sub-event
// ---------------------------------------------------------------------------

export type ProjectStatus =
  | 'enquiry'
  | 'proposal'
  | 'confirmed'
  | 'in_delivery'
  | 'delivered'
  | 'closed'
  | 'lost';

/** Business rules that vary by project. Defaults live in DEFAULT_PROJECT_SETTINGS. */
export interface ProjectSettings {
  /**
   * Whether a percentage line (contingency) is calculated on approved optional
   * extras as well as the original scope.
   *
   * Default NO. An extra is negotiated and priced at the time with its own
   * margin, so adding a buffer on top re-prices a change the client has already
   * agreed, and makes the contingency figure move whenever an extra is
   * approved. Some projects are quoted the other way round, hence the setting.
   */
  applyContingencyToApprovedExtras: boolean;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  applyContingencyToApprovedExtras: false,
};

export interface Project {
  id: string;
  name: string;
  clientName: string;
  eventType: string | null;
  venue: string | null;
  eventDate: Iso | null;
  status: ProjectStatus;
  baseCurrency: 'GBP';

  /**
   * UI mode only — it never changes the data shape. Every project has at
   * least one sub-event; 'single' means the layer is hidden entirely and the
   * user sees Project → Categories → Budget Lines.
   */
  subEventMode: 'single' | 'multiple';

  settings: ProjectSettings;

  /** Pinned at first approval and never changed thereafter. */
  originalApprovedVersionId: string | null;
  currentApprovedVersionId: string | null;
  openDraftVersionId: string | null;

  rollup: ProjectRollup;
  import?: ImportProvenance;
  audit: Audit;
}

/**
 * Every project has at least one sub-event, created automatically. For an
 * ordinary event it is never shown. This is deliberate: one code path for
 * queries, rollups and forecasting, instead of a nullable parent that every
 * function has to branch on.
 */
export interface SubEvent {
  id: string;
  projectId: string;
  name: string;
  /** True for the sub-event created with the project. Cannot be deleted. */
  isDefault: boolean;
  date: Iso | null;
  venue: string | null;
  sortKey: SortKey;
  rollup: FinancialRollup;
  import?: ImportProvenance;
  audit: Audit;
}

/**
 * Categories are defined once at project level and shared across sub-events.
 * A category a sub-event does not use simply has no lines in it and does not
 * appear. This gives per-sub-event budgets AND project-wide reporting by
 * category from single queries, which per-sub-event category definitions
 * would not.
 */
export interface Category {
  id: string;
  projectId: string;
  name: string;
  sortKey: SortKey;
  /**
   * Whether this category's client value forms part of the base a percentage
   * line (contingency) is calculated on.
   *
   * A setting rather than a rule about names. The reference workbook keeps
   * Creative out of its contingency base, and All for Love want that behaviour
   * kept — but a system that decided it by looking for the word "Creative"
   * would silently change a project's revenue the day somebody renamed a
   * category to "Creative & Styling". So the intent is stored on the category,
   * and renaming one is only ever renaming one.
   *
   * Defaults to true for a new category. The importer sets it false for
   * Creative and for Optional Extras.
   */
  includeInContingencyBase: boolean;
  audit: Audit;
}

/** A new category counts towards contingency unless somebody says otherwise. */
export const DEFAULT_INCLUDE_IN_CONTINGENCY_BASE = true;

// ---------------------------------------------------------------------------
// Cost Item — the stable spine
// ---------------------------------------------------------------------------

export type CostItemStatus =
  | 'planned'
  | 'quoted'
  | 'committed'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

/**
 * 'percentage' exists because the reference workbook needs it: a contingency
 * line priced as a percentage of the rest of the budget. It is computed over
 * its OWN sub-event's non-percentage lines, so sub-event totals still
 * reconcile to the project total.
 */
export type CostMode = 'lump' | 'quantity' | 'percentage';

export type CostItemOrigin = 'original' | 'extra';

export type ExtraStatus = 'proposed' | 'approved' | 'rejected';

/**
 * A priced position. In quantity and percentage modes the totals are derived,
 * never typed — a figure in a money column is always a total, everywhere.
 */
export interface CostValues {
  /** null in lump and percentage modes */
  quantity: number | null;
  unitCost: Pence | null;
  unitPrice: Pence | null;
  /** percentage mode only, e.g. 5.25 */
  percentageRate: number | null;

  /**
   * null means the budgeted cost was NEVER RECORDED — not that it was zero.
   *
   * The distinction matters because the historic workbooks have a client price
   * column and an actual cost column and nothing in between. Importing those
   * with budget set equal to actual would show every line at zero variance,
   * implying a budget was met when no budget was ever set. Such lines carry
   * null, and every variance figure derived from them reads as unavailable.
   *
   * Lines created in the application are always known, starting at zero.
   */
  budgetCost: Pence | null;
  clientPrice: Pence;
}

export interface ApprovedValues extends CostValues {
  versionId: string;
  versionNo: number;
  approvedAt: Iso;
}

export interface CostItemDetails {
  supplierId: string | null;
  supplierName: string | null;
  /**
   * What one unit is on a quantity line: "metre", "day", "person-day".
   *
   * Display only — no calculation reads it. But a quantity of 24 with no unit
   * beside it is a figure nobody can check, and "285" in the reference
   * workbook turned out to mean 285 person-days rather than 285 people, which
   * is not a distinction the arithmetic can make for you.
   */
  unit?: string | null;
  currency: string;
  /** Rate to base currency. 1 for GBP. Manually entered — no rate feed. */
  fxRate: number;
  vatRate: number;
  ownerUid: string | null;
  notes: string | null;
  startDate: Iso | null;
  endDate: Iso | null;
  responsibility: string | null;
}

export interface ForecastOverride {
  value: Pence;
  reason: string;
  byUid: string;
  at: Iso;
}

export interface CostItemRollup {
  committedTotal: Pence;
  committedRemaining: Pence;
  actualTotal: Pence;
  /** Always maintained, even while an override is in force. */
  calculatedForecast: Pence;
  /** The figure the rest of the system uses. */
  forecastCost: Pence;
  forecastSource: 'calculated' | 'override';
  recomputedAt: Iso;
  /** Monotonic — makes recompute idempotent and safe to replay. */
  recomputeSeq: number;
}

export interface CostItem {
  id: string;
  projectId: string;
  /** Always set. For a single-sub-event project this is the default one. */
  subEventId: string;
  categoryId: string;
  sortKey: SortKey;

  description: string;
  mode: CostMode;
  status: CostItemStatus;
  origin: CostItemOrigin;
  /** Only meaningful when origin === 'extra'. */
  extraStatus: ExtraStatus | null;

  /**
   * Set when a line is cancelled or dropped AND the client stops paying for
   * it. Cancelling a line does not automatically reduce what the client owes
   * — sometimes the work is dropped and the price stands — so the interface
   * asks, and the answer is recorded here. This is what produces the
   * "agreed reductions" figure.
   */
  clientValueWithdrawn: boolean;

  /** Working values, edited by the budget grid. */
  draft: CostValues;
  /** Snapshot of the current approved version. Null before first approval. */
  approved: ApprovedValues | null;
  /** Snapshot of the very first approved version. Never overwritten. */
  original: { versionId: string; budgetCost: Pence | null; clientPrice: Pence } | null;

  details: CostItemDetails;
  rollup: CostItemRollup;
  forecastOverride: ForecastOverride | null;

  copiedFromCostItemId: string | null;
  import?: ImportProvenance;
  audit: Audit;
}

// ---------------------------------------------------------------------------
// Budget versions
// ---------------------------------------------------------------------------

export type BudgetVersionStatus = 'draft' | 'approved' | 'superseded';

/**
 * Client approval happens outside the application — email, PDF, a meeting.
 * What the system holds is the record of it, kept separate from the internal
 * act of making a version current. They are two different facts.
 */
export interface ClientApproval {
  status: 'not_sent' | 'sent' | 'approved' | 'rejected';
  sentAt: Iso | null;
  decidedAt: Iso | null;
  method: 'email' | 'meeting' | 'signed_document' | 'other' | null;
  /** Email subject, document name, or whatever identifies the evidence. */
  reference: string | null;
  notes: string | null;
  recordedBy: string | null;
  recordedAt: Iso | null;
}

export interface BudgetVersion {
  id: string;
  projectId: string;
  versionNo: number;
  status: BudgetVersionStatus;
  note: string | null;

  /** Internal approval — who made this the current budget, and when. */
  approvedBy: string | null;
  approvedAt: Iso | null;
  supersededAt: Iso | null;

  clientApproval: ClientApproval;

  /** Totals across every sub-event, frozen at approval. */
  /**
   * `budgetCost` is the sum of the budgets that WERE recorded. When
   * `budgetCostKnown` is false some lines had none — an imported historical
   * project has none at all — and the sum must be displayed as unavailable
   * rather than as a total. Adding null as zero here would quietly report a
   * £0 budget for a project whose budget was simply never written down.
   */
  totals: {
    budgetCost: Pence;
    budgetCostKnown: boolean;
    linesWithoutBudget: number;
    clientPrice: Pence;
  };

  import?: ImportProvenance;
  audit: Audit;
}

/**
 * A line in a budget version. The document ID *is* the cost item ID, which is
 * what makes the link between a historical budget and a live cost item
 * unbreakable. Immutable once its version is approved.
 */
export interface BudgetVersionLine {
  /** === costItemId */
  id: string;
  subEventId: string;
  categoryId: string;
  description: string;
  mode: CostMode;
  values: CostValues;
  sortKey: SortKey;
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export interface Supplier {
  id: string;
  name: string;
  /** Free text — "flowers", "structures", "crew". Not an enum; it changes. */
  kind: string | null;
  defaultCurrency: string;
  vatRegistered: boolean;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  active: boolean;
  /** Set once Xero is connected, so a supplier maps to one Xero contact. */
  xeroContactId: string | null;
  import?: ImportProvenance;
  audit: Audit;
}

// ---------------------------------------------------------------------------
// Commitments and transactions
// ---------------------------------------------------------------------------

export type CommitmentStatus =
  | 'draft'
  | 'issued'
  | 'accepted'
  | 'part_delivered'
  | 'closed'
  | 'cancelled';

/** Statuses where the commitment still represents money expected to be spent. */
export const OPEN_COMMITMENT_STATUSES: CommitmentStatus[] = [
  'draft',
  'issued',
  'accepted',
  'part_delivered',
];

export interface Commitment {
  id: string;
  projectId: string;
  /** Denormalised from the cost item so sub-event queries need no join. */
  subEventId: string;
  costItemId: string;
  supplierId: string | null;
  supplierName: string | null;
  reference: string | null;
  status: CommitmentStatus;

  amountExVat: Pence;
  vatAmount: Pence;
  currency: string;
  fxRate: number;
  amountBaseExVat: Pence;

  issuedAt: Iso | null;
  expectedInvoiceDate: Iso | null;
  notes: string | null;
  import?: ImportProvenance;
  audit: Audit;
}

export type TransactionType = 'bill' | 'credit' | 'expense';

export interface Transaction {
  id: string;
  /** Null while sitting in Unallocated Costs. */
  projectId: string | null;
  subEventId: string | null;
  costItemId: string | null;
  /** Set when this bill draws down a specific commitment. */
  commitmentId: string | null;

  supplierId: string | null;
  supplierName: string | null;
  type: TransactionType;
  source: 'manual' | 'xero' | 'import';
  xeroId: string | null;
  xeroUpdatedAt: Iso | null;

  reference: string | null;
  date: Iso;

  /** Credits are negative. */
  amountExVat: Pence;
  vatAmount: Pence;
  currency: string;
  fxRate: number;
  amountBaseExVat: Pence;

  /** Owned by Xero from phase 2. */
  paymentStatus: 'unpaid' | 'part_paid' | 'paid';
  allocationStatus: 'allocated' | 'unallocated';
  /** Set on children when one bill is split across several cost items. */
  parentTransactionId: string | null;

  import?: ImportProvenance;
  audit: Audit;
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

/**
 * 'percent_of_cost' is how the existing workbook actually calculates
 * commission — cost × rate, not revenue × rate. Included because the business
 * already works this way, not because it is a fourth option worth having.
 */
export type CommissionBasis =
  | 'percent_of_revenue'
  | 'percent_of_profit'
  | 'percent_of_cost'
  | 'fixed';

export interface Commission {
  id: string;
  projectId: string;
  /**
   * Reserved. MVP only writes project-level commission (null); the field
   * exists so attributing a fee to one sub-event later is additive.
   */
  subEventId: string | null;
  payeeName: string;
  payeeSupplierId: string | null;
  basis: CommissionBasis;
  /** Percentage for the percent_* bases, ignored for 'fixed'. */
  ratePercent: number | null;
  /** Amount for the 'fixed' basis, ignored otherwise. */
  fixedAmount: Pence | null;
  status: 'expected' | 'agreed' | 'invoiced' | 'paid';
  /** The workbook tracks claims separately from the calculation. So do we. */
  claim: {
    invoiceNumber: string | null;
    invoicedAt: Iso | null;
    paidAt: Iso | null;
    comments: string | null;
  };
  sortKey: SortKey;
  notes: string | null;
  audit: Audit;
}

// ---------------------------------------------------------------------------
// Rollups
// ---------------------------------------------------------------------------

/** The four figures that must always be comparable, plus what they imply. */
export interface FinancialRollup {
  /** Sum of the budgets that WERE recorded. Never includes an assumed zero. */
  budgetCost: Pence;
  /**
   * False when any counted line has no recorded budget, in which case every
   * budget-versus-actual figure on this rollup must display as unavailable
   * rather than as a variance of zero.
   */
  budgetCostKnown: boolean;
  linesWithoutBudget: number;
  committedTotal: Pence;
  committedRemaining: Pence;
  actualTotal: Pence;
  forecastCost: Pence;

  /** Original approved client value, from the first approved version. */
  originalClientValue: Pence;
  approvedExtras: Pence;
  agreedReductions: Pence;
  /** originalClientValue + approvedExtras − agreedReductions */
  currentAgreedClientRevenue: Pence;

  /** currentAgreedClientRevenue − forecastCost */
  forecastProfit: Pence;
  /** forecastProfit ÷ currentAgreedClientRevenue, or null when revenue is 0 */
  forecastMargin: number | null;

  /** Excluded from every figure above. Shown, never blended in. */
  proposedExtrasRevenue: Pence;
  proposedExtrasCost: Pence;
  /**
   * False when a proposed extra has no recorded budget — otherwise the
   * dashboard would offer "£33,958 revenue, £0 cost" as an opportunity.
   */
  proposedExtrasCostKnown: boolean;
  /**
   * Money already spent on extras the client has not agreed to pay for.
   *
   * Kept separate from `actualTotal` because it is not part of the agreed
   * position — but it is real money and it must not vanish. On an imported
   * historical project this is the honest reading of the workbook's optional
   * extras: the cost happened, the revenue is unconfirmed. If it stays
   * unconfirmed, this figure is the loss.
   */
  proposedExtrasActualCost: Pence;

  lineCount: number;
  linesOverBudget: number;
  recomputedAt: Iso;
  recomputeSeq: number;
}

export interface ProjectRollup extends FinancialRollup {
  /** Sub-event profitability, in display order. */
  subEvents: Array<{ subEventId: string; name: string } & FinancialRollup>;

  commissionTotal: Pence;
  /** forecastProfit − commissionTotal */
  netProfitAfterCommission: Pence;
  netMarginAfterCommission: number | null;
}
