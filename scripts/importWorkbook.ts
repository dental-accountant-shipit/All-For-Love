/**
 * Reference workbook importer — All for Love's existing budget format.
 *
 * This is a thin adapter now. The mapping, the arithmetic and the warnings all
 * live in `src/domain/import`, which is the same code the Admin Import screen
 * previews with and the same code the server writes from. That matters: the
 * C & D Wedding suite is the proof that the import pathway is correct, and it
 * would prove nothing if it exercised a separate implementation that merely
 * resembled the real one.
 *
 * What this file still owns is ExcelJS — reading an .xlsm off disk and
 * presenting it as a `SheetReader` — plus the verified section map for the
 * reference workbook.
 *
 * The workbook's own totals are NOT trusted. Every figure is rebuilt from the
 * cell values, because v14 of C & D Wedding contains two different cost totals
 * for the same project.
 *
 * COLUMN MAP (as headed in the workbook)
 *   A  description            B  units              C  price per unit (client)
 *   D  total ex VAT           E  UK VAT             F  total inc VAT
 *   H  actual cost per unit   I  mark-up per unit   J  total mark-up
 *   K  commission %           L  commission amount  N  suppliers used
 */

import ExcelJS from 'exceljs';

import {
  buildPlan,
  type ImportPlan,
  type PlanSection,
  type SheetReader,
} from '../src/domain/import/plan';
import { materialise } from '../src/domain/import/materialise';
import type { Pence } from '../src/domain/money';
import type {
  Commission,
  Commitment,
  CostItem,
  SubEvent,
  Transaction,
} from '../src/domain/types';

/** Kept as an alias so existing callers and docs still line up. */
export type WorkbookSection = PlanSection;

/**
 * C & D Wedding MASTER Budget v14. Verified against the sheet, not guessed.
 *
 * Two categories sit outside the contingency base, matching the workbook and
 * confirmed by All for Love: Creative, and Optional Extras. Both are recorded
 * as decisions on the category rather than as rules about their names, so
 * renaming a category is only ever renaming a category.
 */
export const CD_WEDDING_SECTIONS: WorkbookSection[] = [
  { headerRow: 10, firstRow: 11, lastRow: 28, name: 'Vatican Florals' },
  { headerRow: 31, firstRow: 32, lastRow: 59, name: 'Castle Florals, Chandeliers etc' },
  { headerRow: 63, firstRow: 64, lastRow: 69, name: 'Day 2 Florals' },
  { headerRow: 72, firstRow: 73, lastRow: 110, name: 'Labour / Team' },
  { headerRow: 113, firstRow: 115, lastRow: 117, name: 'Catering' },
  { headerRow: 120, firstRow: 121, lastRow: 126, name: 'Transport, Site Visits' },
  { headerRow: 129, firstRow: 130, lastRow: 158, name: 'Admin, Equipment' },
  { headerRow: 161, firstRow: 162, lastRow: 167, name: 'Creative', includeInContingencyBase: false },
  { headerRow: 170, firstRow: 171, lastRow: 171, name: 'Contingency', isContingency: true },
  {
    headerRow: 191,
    firstRow: 192,
    lastRow: 207,
    name: 'Optional Extras',
    isExtras: true,
    includeInContingencyBase: false,
  },
];

/** The workbook's own grand-total row, read only for comparison. */
export const CD_WEDDING_TOTALS_ROW = 186;

const AT = '2026-08-26T00:00:00.000Z';

/** ExcelJS worksheet → the minimal interface the domain importer needs. */
export function sheetReader(ws: ExcelJS.Worksheet): SheetReader {
  return {
    name: ws.name,
    rowCount: ws.rowCount,
    cell: (row, col) => ws.getRow(row).getCell(col).value,
  };
}

export interface ImportedProject {
  projectName: string;
  subEvents: SubEvent[];
  categories: Array<{ id: string; name: string; includeInContingencyBase: boolean }>;
  costItems: CostItem[];
  commitments: Commitment[];
  transactions: Transaction[];
  commissions: Commission[];
  /** The full reviewable plan, exactly as the Admin Import screen would show it. */
  plan: ImportPlan;
  /** Figures read straight off the workbook, for comparison — never trusted. */
  workbookTotals: {
    eventTotalExVat: Pence;
    costPerHColumn: Pence;
    contingency: Pence;
  };
  warnings: string[];
}

export interface ImportOptions {
  /** Workbook file name, recorded as provenance on every record. */
  sourceFilename: string;
  /**
   * Treat optional extras as agreed with the client. **Off by default, and it
   * should stay off.**
   *
   * In the reference workbook the optional extras sit below the INVOICING
   * block and outside the Event Total, so nothing in the sheet says the client
   * was ever asked to pay for them. Importing them as agreed would inflate
   * revenue by an amount nobody invoiced. They arrive as Proposed instead, and
   * whoever knows the answer marks them approved in the application — at which
   * point the selling value enters revenue through the normal route, with an
   * audit trail, rather than through an import switch.
   *
   * The cost is imported either way. It was spent either way.
   */
  extrasApproved?: boolean;
  projectId?: string;
  importedBy?: string;
  totalsRow?: number;
}

export async function importWorkbook(
  path: string,
  sheetName: string,
  sections: WorkbookSection[],
  options: ImportOptions,
): Promise<ImportedProject> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`Sheet "${sheetName}" not found in ${path}`);

  const projectId = options.projectId ?? 'p_cd_wedding';
  const importedBy = options.importedBy ?? 'import';

  const plan = buildPlan(sheetReader(ws), sections, {
    projectName: 'C & D Wedding',
    sourceFilename: options.sourceFilename,
    originalVersionRef: 'v14',
    extrasApproved: options.extrasApproved,
    totalsRow: options.totalsRow ?? CD_WEDDING_TOTALS_ROW,
  });

  const built = materialise(plan, {
    projectId,
    subEventId: 'se_main',
    importBatchId: 'batch_reference_validation',
    importedBy,
    at: AT,
    versionId: 'bv_import',
    versionNo: 14,
    categoryId: (key) => `cat_${key}`,
    costItemId: (line) => `ci_${line.sourceRow}`,
    transactionId: (line) => `t_${line.sourceRow}`,
  });

  return {
    projectName: plan.projectName,
    // Labour, Transport, Admin and Creative are shared across the Vatican,
    // Castle and Day 2 days, and the workbook records no allocation between
    // them. Inventing one would be inventing the answer, so this imports as a
    // single-sub-event project and the split stays a decision for All for Love.
    subEvents: [built.subEvent],
    categories: built.categories.map((c) => ({
      id: c.id,
      name: c.name,
      includeInContingencyBase: c.includeInContingencyBase,
    })),
    costItems: built.costItems,
    commitments: [],
    transactions: built.transactions,
    commissions: [],
    plan,
    workbookTotals: {
      eventTotalExVat: plan.workbookTotals.eventTotalExVat,
      costPerHColumn: plan.workbookTotals.costColumnSum,
      contingency: plan.workbookTotals.contingency,
    },
    warnings: plan.warnings.map((w) => w.message),
  };
}
