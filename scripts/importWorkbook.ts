/**
 * Reference workbook importer — All for Love's existing budget format.
 *
 * Maps a MASTER Budget sheet into domain records so the calculation engine can
 * be run against a real project. This is the shape the Admin Import pathway
 * will use; keeping it out of `src/` and out of the repository's data is
 * deliberate — the workbooks stay in Google Drive.
 *
 * The workbook's own totals are NOT trusted. Every figure here is rebuilt from
 * the cell values, because v14 of C & D Wedding contains two different cost
 * totals for the same project.
 *
 * COLUMN MAP (as headed in the workbook)
 *   A  description            B  units              C  price per unit (client)
 *   D  total ex VAT           E  UK VAT             F  total inc VAT
 *   H  actual cost per unit   I  mark-up per unit   J  total mark-up
 *   K  commission %           L  commission amount  N  suppliers used
 *
 * Note what is NOT there: a budgeted cost column. The workbook records what a
 * line was sold for and what it eventually cost, never what it was expected to
 * cost. Budget-versus-actual therefore cannot be reconstructed from it, and
 * imported lines arrive with budget NULL — never with budget set equal to
 * actual, which would report a variance of zero for a budget nobody ever set.
 */

import ExcelJS from 'exceljs';

import { toPence, type Pence } from '../src/domain/money';
import { lumpValues, percentageValues, quantityValues } from '../src/domain/values';
import type {
  Commission,
  Commitment,
  CostItem,
  CostValues,
  ImportProvenance,
  SubEvent,
  Transaction,
} from '../src/domain/types';

export interface WorkbookSection {
  /** Row of the category heading. */
  headerRow: number;
  /** First and last data rows, inclusive. */
  firstRow: number;
  lastRow: number;
  name: string;
  /** Extras sit outside every total in the workbook. */
  isExtras?: boolean;
  /** Contingency is a percentage of the rest, not a priced line. */
  isContingency?: boolean;
}

/** C & D Wedding MASTER Budget v14. Verified against the sheet, not guessed. */
export const CD_WEDDING_SECTIONS: WorkbookSection[] = [
  { headerRow: 10, firstRow: 11, lastRow: 28, name: 'Vatican Florals' },
  { headerRow: 31, firstRow: 32, lastRow: 59, name: 'Castle Florals, Chandeliers etc' },
  { headerRow: 63, firstRow: 64, lastRow: 69, name: 'Day 2 Florals' },
  { headerRow: 72, firstRow: 73, lastRow: 110, name: 'Labour / Team' },
  { headerRow: 113, firstRow: 115, lastRow: 117, name: 'Catering' },
  { headerRow: 120, firstRow: 121, lastRow: 126, name: 'Transport, Site Visits' },
  { headerRow: 129, firstRow: 130, lastRow: 158, name: 'Admin, Equipment' },
  { headerRow: 161, firstRow: 162, lastRow: 167, name: 'Creative' },
  { headerRow: 170, firstRow: 171, lastRow: 171, name: 'Contingency', isContingency: true },
  { headerRow: 191, firstRow: 192, lastRow: 207, name: 'Optional Extras', isExtras: true },
];

const AT = '2026-08-26T00:00:00.000Z';

function numberAt(row: ExcelJS.Row, col: number): number {
  const value = row.getCell(col).value;
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'result' in value) {
    const r = (value as { result?: unknown }).result;
    return typeof r === 'number' ? r : 0;
  }
  return 0;
}

function textAt(row: ExcelJS.Row, col: number): string {
  const value = row.getCell(col).value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('result' in value) return String((value as { result?: unknown }).result ?? '');
    if ('richText' in value) {
      return (value as ExcelJS.RichText[] | { richText: ExcelJS.RichText[] } as {
        richText: ExcelJS.RichText[];
      }).richText
        .map((t) => t.text)
        .join('');
    }
    if ('text' in value) return String((value as { text: unknown }).text);
  }
  return String(value);
}

export interface ImportedProject {
  projectName: string;
  subEvents: SubEvent[];
  categories: Array<{ id: string; name: string }>;
  costItems: CostItem[];
  commitments: Commitment[];
  transactions: Transaction[];
  commissions: Commission[];
  /** Figures read straight off the workbook, for comparison — never trusted. */
  workbookTotals: {
    eventTotalExVat: Pence;
    vat: Pence;
    incVat: Pence;
    costPerHColumn: Pence;
    markUp: Pence;
    contingency: Pence;
  };
  warnings: string[];
}

export interface ImportOptions {
  /** Workbook file name, recorded as provenance on every record. */
  sourceFilename: string;
  /** Treat optional extras as agreed with the client. See warnings. */
  extrasApproved?: boolean;
  projectId?: string;
  importedBy?: string;
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
  const batchId = 'batch_reference_validation';

  const provenance = (row: number, ref: string): ImportProvenance => ({
    imported: true,
    sourceSystem: 'excel_workbook',
    sourceFilename: options.sourceFilename,
    sourceReference: `${sheetName}!${ref}${row}`,
    originalVersionRef: 'v14',
    originalApprovalDate: null,
    importedAt: AT,
    importedBy,
    importBatchId: batchId,
  });

  const audit = { createdAt: AT, createdBy: importedBy, updatedAt: AT, updatedBy: importedBy };

  /**
   * One sub-event. The workbook's Vatican / Castle / Day 2 split is real, but
   * Labour, Transport, Admin and Creative are shared across all three and the
   * workbook records no allocation between them. Inventing one would be
   * inventing the answer, so this imports as a single-sub-event project and
   * the split is left as a decision for All for Love.
   */
  const subEvents: SubEvent[] = [
    {
      id: 'se_main',
      projectId,
      name: 'Whole event',
      isDefault: true,
      date: null,
      venue: null,
      sortKey: 'V',
      rollup: {} as SubEvent['rollup'],
      audit,
    },
  ];

  const categories: Array<{ id: string; name: string }> = [];
  const costItems: CostItem[] = [];
  const commitments: Commitment[] = [];
  const transactions: Transaction[] = [];
  const warnings: string[] = [];

  let sortSeed = 0;
  const nextSortKey = () => `a${String(sortSeed++).padStart(4, '0')}`;

  for (const section of sections) {
    const categoryId = `cat_${section.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    categories.push({ id: categoryId, name: section.name });

    for (let r = section.firstRow; r <= section.lastRow; r++) {
      const row = ws.getRow(r);
      const description = textAt(row, 1).trim();
      const units = numberAt(row, 2);
      const pricePerUnit = numberAt(row, 3);
      const costPerUnit = numberAt(row, 8);
      const commissionRate = numberAt(row, 11);
      const supplier = textAt(row, 14).trim();

      // Spare rows: the workbook keeps blank lines pre-filled with units 1 and
      // zero money, ready to be typed into. They are not budget lines.
      const hasMoney = pricePerUnit !== 0 || costPerUnit !== 0;
      if (!hasMoney && description === '') continue;
      if (/^sub\s*total$/i.test(description)) continue;

      const id = `ci_${r}`;
      let mode: CostItem['mode'] = 'lump';
      let values: CostValues;

      // THE WORKBOOK RECORDS NO BUDGETED COST.
      //
      // It has a client price column and an actual cost column and nothing in
      // between. Importing the actual as the budget would show every line at
      // zero variance — implying a budget was met when none was ever set. So
      // the budget is imported as null, meaning "never recorded", and the
      // actual cost becomes a transaction against the line instead. Imported
      // projects therefore show real cost and real profit, and report budget
      // versus actual as unavailable.
      if (section.isContingency) {
        // Stored in the workbook as a decimal fraction in the "per unit" cell.
        mode = 'percentage';
        values = percentageValues(pricePerUnit * 100, null);
      } else if (units !== 1) {
        mode = 'quantity';
        values = quantityValues(units, null, toPence(pricePerUnit), { budgetCost: null });
      } else {
        values = lumpValues(null, toPence(pricePerUnit));
      }

      const isExtra = section.isExtras === true;
      const approvedValues = { ...values, versionId: 'bv_import', versionNo: 14, approvedAt: AT };

      costItems.push({
        id,
        projectId,
        subEventId: 'se_main',
        categoryId,
        sortKey: nextSortKey(),
        description: description || `(untitled — row ${r})`,
        mode,
        // The workbook is a delivered event: every priced line is done.
        status: 'completed',
        origin: isExtra ? 'extra' : 'original',
        extraStatus: isExtra ? (options.extrasApproved ? 'approved' : 'proposed') : null,
        clientValueWithdrawn: false,
        draft: values,
        approved: approvedValues,
        original: { versionId: 'bv_import', budgetCost: values.budgetCost, clientPrice: values.clientPrice },
        details: {
          supplierId: null,
          supplierName: supplier || null,
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
          recomputedAt: AT,
          recomputeSeq: 0,
        },
        forecastOverride: null,
        copiedFromCostItemId: null,
        import: provenance(r, 'A'),
        audit,
      });

      // The "actual cost" column becomes a real transaction against the line —
      // which is the whole point: a supplier cost belongs to a Cost Item, not
      // typed into a price cell.
      if (costPerUnit !== 0 && !section.isContingency) {
        const amount = toPence(costPerUnit * (units === 0 ? 1 : units));
        transactions.push({
          id: `t_${r}`,
          projectId,
          subEventId: 'se_main',
          costItemId: id,
          commitmentId: null,
          supplierId: null,
          supplierName: supplier || null,
          type: 'bill',
          source: 'import',
          xeroId: null,
          xeroUpdatedAt: null,
          reference: null,
          date: AT,
          amountExVat: amount,
          vatAmount: 0,
          currency: 'GBP',
          fxRate: 1,
          amountBaseExVat: amount,
          paymentStatus: 'paid',
          allocationStatus: 'allocated',
          parentTransactionId: null,
          import: provenance(r, 'H'),
          audit,
        });
      }

      if (commissionRate !== 0) {
        warnings.push(`Row ${r} carries a commission rate of ${commissionRate}.`);
      }
      if (/EURO?\s|€/i.test(description)) {
        warnings.push(
          `Row ${r} records a euro amount in its description ("${description.slice(0, 48)}") ` +
            `with no exchange rate. Imported at its sterling figure only.`,
        );
      }
    }
  }

  const totalsRow = ws.getRow(186);
  const contingencyRow = ws.getRow(171);

  return {
    projectName: 'C & D Wedding',
    subEvents,
    categories,
    costItems,
    commitments,
    transactions,
    commissions: [],
    workbookTotals: {
      eventTotalExVat: toPence(numberAt(totalsRow, 4)),
      vat: toPence(numberAt(totalsRow, 5)),
      incVat: toPence(numberAt(totalsRow, 6)),
      costPerHColumn: toPence(numberAt(totalsRow, 8)),
      markUp: toPence(numberAt(totalsRow, 10)),
      contingency: toPence(numberAt(contingencyRow, 4)),
    },
    warnings,
  };
}
