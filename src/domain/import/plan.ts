/**
 * The Import Plan — what an import will do, before it does it.
 *
 * A historical import is the one operation in this system that writes hundreds
 * of records at once, from a file nobody has checked, into a project that will
 * be reported on for years. So it happens in two halves. This half turns a
 * spreadsheet into a *plan*: a plain description of every category, line, cost
 * and warning, with no database anywhere near it. The plan is shown to a human
 * in full. Only then does anything get written.
 *
 * The plan carries no totals of its own that anyone is asked to trust. Money is
 * derived here by the same arithmetic the live application uses, and derived
 * AGAIN on the server before writing, from the raw cell values that travel with
 * the plan. A browser can therefore be wrong, or lying, and the stored figures
 * are still the ones the engine computes.
 *
 * Nothing in this file imports Firebase, Excel or React. It is given a
 * `SheetReader` and it returns data.
 */

import { toPence, type Pence } from '../money';
import type { CostMode, ExtraStatus } from '../types';

// ---------------------------------------------------------------------------
// Reading a sheet, without knowing what produced it
// ---------------------------------------------------------------------------

/**
 * The smallest thing a spreadsheet has to be able to do to be imported.
 * ExcelJS satisfies this in Node and in the browser through a four-line
 * adapter, which is what lets the reference workbook test and the Admin Import
 * screen run identical code rather than similar code.
 */
export interface SheetReader {
  readonly name: string;
  readonly rowCount: number;
  cell(row: number, col: number): unknown;
}

/** Formula cells arrive as `{ formula, result }`; only the result matters. */
function unwrap(value: unknown): unknown {
  if (value && typeof value === 'object') {
    if ('result' in value) return (value as { result?: unknown }).result ?? null;
    if ('richText' in value) {
      return (value as { richText: Array<{ text: string }> }).richText
        .map((t) => t.text)
        .join('');
    }
    if ('text' in value) return (value as { text: unknown }).text;
  }
  return value;
}

export function numberAt(sheet: SheetReader, row: number, col: number): number {
  const value = unwrap(sheet.cell(row, col));
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function textAt(sheet: SheetReader, row: number, col: number): string {
  const value = unwrap(sheet.cell(row, col));
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// ---------------------------------------------------------------------------
// The column map
// ---------------------------------------------------------------------------

/**
 * Which column holds what, 1-based.
 *
 * Defaults match All for Love's workbook family. They are a setting rather
 * than a constant because the next workbook to be imported will not be this
 * one, and the failure mode of a wrong guess — reading a phone number as a
 * price — is silent.
 */
export interface ColumnMap {
  description: number;
  quantity: number;
  /** Client price PER UNIT, ex VAT. */
  unitPrice: number;
  /** The workbook's own line total. Read for comparison, never used. */
  lineTotal: number;
  /**
   * Actual cost PER UNIT, ex VAT.
   *
   * Confirmed with All for Love against the workbook header and its mark-up
   * formulas. A line's total cost is therefore quantity × this, which is why
   * summing this column understates C & D Wedding by £36,820: fifteen
   * pre-planning days at £320 appear in that sum as £320.
   */
  unitCost: number;
  commissionRate: number;
  supplier: number;
}

export const DEFAULT_COLUMNS: ColumnMap = {
  description: 1,
  quantity: 2,
  unitPrice: 3,
  lineTotal: 4,
  unitCost: 8,
  commissionRate: 11,
  supplier: 14,
};

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export interface PlanSection {
  /** Row of the category heading, for the reviewer's benefit. */
  headerRow: number;
  firstRow: number;
  lastRow: number;
  name: string;
  /** Extras sit outside the workbook's own totals. */
  isExtras?: boolean;
  /** A percentage of the rest, not a priced line. */
  isContingency?: boolean;
  /** Defaults to true; false for Creative and Optional Extras. */
  includeInContingencyBase?: boolean;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export interface PlannedCategory {
  key: string;
  name: string;
  includeInContingencyBase: boolean;
  isContingency: boolean;
  isExtras: boolean;
}

export interface PlannedLine {
  sourceRow: number;
  sourceRef: string;
  categoryKey: string;
  description: string;
  mode: CostMode;
  quantity: number;
  /** Client price per unit. Null on a lump or percentage line. */
  unitPrice: Pence | null;
  /** Actual supplier cost per unit, from the cost column. Null when absent. */
  unitCost: Pence | null;
  percentageRate: number | null;
  /** quantity × unitPrice, or the lump figure. Derived, never read off. */
  clientPrice: Pence;
  /** quantity × unitCost. Derived, never read off. */
  actualCost: Pence;
  supplierName: string | null;
  origin: 'original' | 'extra';
  extraStatus: ExtraStatus | null;
}

export type WarningKind =
  | 'euro_in_description'
  | 'zero_quantity'
  | 'commission_rate'
  | 'unnamed_line'
  | 'workbook_disagrees';

export interface ImportWarning {
  kind: WarningKind;
  sourceRow: number | null;
  message: string;
}

export interface PlanTotals {
  /** Original scope only. Excludes extras and the contingency line. */
  pricedOriginal: Pence;
  contingency: Pence;
  /** pricedOriginal + contingency. What the client has agreed. */
  agreedRevenue: Pence;
  /** Cost on agreed lines. */
  actualCost: Pence;
  agreedProfit: Pence;
  /** Extras, reported separately because nobody has confirmed them. */
  proposedExtrasRevenue: Pence;
  proposedExtrasActualCost: Pence;
  lineCount: number;
  extraCount: number;
}

export interface WorkbookTotals {
  eventTotalExVat: Pence;
  contingency: Pence;
  /** The workbook's own cost figure: unit costs summed without quantities. */
  costColumnSum: Pence;
}

export interface ImportPlan {
  projectName: string;
  clientName: string;
  sourceFilename: string;
  sheetName: string;
  originalVersionRef: string | null;
  columns: ColumnMap;
  sections: PlanSection[];
  categories: PlannedCategory[];
  lines: PlannedLine[];
  warnings: ImportWarning[];
  /** Derived by the engine. Recomputed server-side; never trusted from here. */
  totals: PlanTotals;
  /** Read off the sheet for comparison. Never used in a stored figure. */
  workbookTotals: WorkbookTotals;
}

export interface PlanOptions {
  projectName: string;
  clientName?: string;
  sourceFilename: string;
  originalVersionRef?: string | null;
  columns?: ColumnMap;
  /**
   * Treat optional extras as agreed. Off by default and it should stay off —
   * see `buildPlan`.
   */
  extrasApproved?: boolean;
  /** Row holding the workbook's own grand totals, for comparison only. */
  totalsRow?: number | null;
}

const categoryKey = (name: string, index: number) =>
  `${index}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;

/**
 * Turn a sheet into a plan.
 *
 * Three decisions are baked in, all of them confirmed with All for Love
 * against the reference workbook:
 *
 *   1. **No budgeted cost exists.** The workbook has a client price column and
 *      an actual cost column and nothing in between. Every line arrives with
 *      budget unknown. Setting budget equal to actual would report every line
 *      at zero variance — a budget met that was never set.
 *   2. **The cost column is per unit.** Total cost is quantity × unit cost.
 *   3. **Optional extras are proposed, not agreed.** They sit outside the
 *      workbook's Event Total, so nothing in the sheet says the client was
 *      asked to pay. Their selling value stays out of revenue until somebody
 *      confirms it; their cost is imported regardless, because it was spent
 *      regardless.
 */
export function buildPlan(
  sheet: SheetReader,
  sections: PlanSection[],
  options: PlanOptions,
): ImportPlan {
  const columns = options.columns ?? DEFAULT_COLUMNS;
  const categories: PlannedCategory[] = [];
  const lines: PlannedLine[] = [];
  const warnings: ImportWarning[] = [];

  sections.forEach((section, index) => {
    const key = categoryKey(section.name, index);
    categories.push({
      key,
      name: section.name,
      includeInContingencyBase: section.includeInContingencyBase ?? true,
      isContingency: section.isContingency === true,
      isExtras: section.isExtras === true,
    });

    for (let row = section.firstRow; row <= section.lastRow; row++) {
      const description = textAt(sheet, row, columns.description);
      const quantity = numberAt(sheet, row, columns.quantity);
      const unitPriceRaw = numberAt(sheet, row, columns.unitPrice);
      const unitCostRaw = numberAt(sheet, row, columns.unitCost);
      const commissionRate = numberAt(sheet, row, columns.commissionRate);
      const supplier = textAt(sheet, row, columns.supplier);

      // What makes a row a budget line: somebody said how many, or how much
      // each. Those are the two cells a person types when they add something
      // to a budget, and a row with neither is not a line.
      //
      // Cost alone is deliberately not enough. The reference workbook ends
      // with a SUMMARY block — one row per category, carrying a total and a
      // cost and nothing else — and every row of it would otherwise import as
      // a line, duplicating eight categories inside the budget it summarises.
      // Subtotals and the event total go the same way, for the same reason.
      //
      // Note what this still keeps: a line priced at zero with a quantity of
      // one. "Freelancers additional hours - OT" is a real line that happened
      // to come to nothing, and a zero-value line is a line.
      const hasInput = quantity !== 0 || unitPriceRaw !== 0;
      if (!hasInput) continue;
      if (unitCostRaw !== 0 && quantity === 0 && unitPriceRaw === 0) continue;
      if (/^sub\s*total$/i.test(description)) continue;
      const hasMoney = unitPriceRaw !== 0 || unitCostRaw !== 0;

      const sourceRef = `${sheet.name}!${row}`;
      const isExtra = section.isExtras === true;

      if (description === '') {
        warnings.push({
          kind: 'unnamed_line',
          sourceRow: row,
          message: `Row ${row} carries money but no description. Imported as "(untitled — row ${row})".`,
        });
      }

      let line: PlannedLine;

      if (section.isContingency) {
        // Held in the workbook as a decimal fraction in the per-unit cell.
        line = {
          sourceRow: row,
          sourceRef,
          categoryKey: key,
          description: description || `(untitled — row ${row})`,
          mode: 'percentage',
          quantity: 0,
          unitPrice: null,
          unitCost: null,
          percentageRate: unitPriceRaw * 100,
          // Filled in by the rollup from the resolved base, not from here.
          clientPrice: 0,
          actualCost: 0,
          supplierName: supplier || null,
          origin: 'original',
          extraStatus: null,
        };
      } else {
        const unitPrice = toPence(unitPriceRaw);
        const unitCost = unitCostRaw === 0 ? null : toPence(unitCostRaw);
        const isQuantityLine = quantity !== 1;

        // The workbook's own line total is quantity × unit price, so a line
        // left at quantity zero charges nothing however large its unit price.
        // Reproduced faithfully — a descoped line should import as descoped —
        // but always reported, because it is worth a human's eye.
        if (quantity === 0 && hasMoney) {
          warnings.push({
            kind: 'zero_quantity',
            sourceRow: row,
            message:
              `Row ${row} ("${description.slice(0, 40)}") has a unit price but a ` +
              `quantity of zero, so the workbook charges nothing for it. ` +
              `Imported at zero, as the workbook has it.`,
          });
        }

        line = {
          sourceRow: row,
          sourceRef,
          categoryKey: key,
          description: description || `(untitled — row ${row})`,
          mode: isQuantityLine ? 'quantity' : 'lump',
          quantity: isQuantityLine ? quantity : 1,
          unitPrice: isQuantityLine ? unitPrice : null,
          unitCost,
          percentageRate: null,
          clientPrice: isQuantityLine ? Math.round(quantity * unitPrice) : unitPrice,
          actualCost:
            unitCost === null ? 0 : Math.round((isQuantityLine ? quantity : 1) * unitCost),
          supplierName: supplier || null,
          origin: isExtra ? 'extra' : 'original',
          extraStatus: isExtra ? (options.extrasApproved ? 'approved' : 'proposed') : null,
        };
      }

      lines.push(line);

      if (commissionRate !== 0) {
        warnings.push({
          kind: 'commission_rate',
          sourceRow: row,
          message: `Row ${row} carries a commission rate of ${commissionRate}. Commission is not imported; record it on the project.`,
        });
      }
      if (/EURO?\s|€/i.test(description)) {
        warnings.push({
          kind: 'euro_in_description',
          sourceRow: row,
          message:
            `Row ${row} records a euro amount in its description ` +
            `("${description.slice(0, 48)}") with no exchange rate. Imported at ` +
            `its sterling figure only.`,
        });
      }
    }
  });

  const workbookTotals: WorkbookTotals = {
    eventTotalExVat: options.totalsRow
      ? toPence(numberAt(sheet, options.totalsRow, columns.lineTotal))
      : 0,
    contingency: toPence(
      numberAt(
        sheet,
        sections.find((s) => s.isContingency)?.firstRow ?? 0,
        columns.lineTotal,
      ),
    ),
    costColumnSum: options.totalsRow
      ? toPence(numberAt(sheet, options.totalsRow, columns.unitCost))
      : 0,
  };

  const plan: ImportPlan = {
    projectName: options.projectName,
    clientName: options.clientName ?? '',
    sourceFilename: options.sourceFilename,
    sheetName: sheet.name,
    originalVersionRef: options.originalVersionRef ?? null,
    columns,
    sections,
    categories,
    lines,
    warnings,
    totals: emptyTotals(),
    workbookTotals,
  };

  plan.totals = planTotals(plan);

  if (
    workbookTotals.eventTotalExVat !== 0 &&
    workbookTotals.eventTotalExVat !== plan.totals.agreedRevenue
  ) {
    warnings.push({
      kind: 'workbook_disagrees',
      sourceRow: options.totalsRow ?? null,
      message:
        `The workbook's own event total and the recalculated total differ. ` +
        `This is reported, not corrected — the recalculated figure is the one ` +
        `that will be stored.`,
    });
  }

  return plan;
}

function emptyTotals(): PlanTotals {
  return {
    pricedOriginal: 0,
    contingency: 0,
    agreedRevenue: 0,
    actualCost: 0,
    agreedProfit: 0,
    proposedExtrasRevenue: 0,
    proposedExtrasActualCost: 0,
    lineCount: 0,
    extraCount: 0,
  };
}

/**
 * Every figure the reviewer is shown, derived from the plan's own line values.
 *
 * Contingency is resolved here the same way the rollup resolves it: a
 * percentage of the priced lines whose category is in the base, with extras
 * excluded unless approved. Two implementations of one rule would eventually
 * disagree, so this defers to the same predicate.
 */
export function planTotals(plan: ImportPlan): PlanTotals {
  const byKey = new Map(plan.categories.map((c) => [c.key, c]));
  const totals = emptyTotals();

  for (const line of plan.lines) {
    const category = byKey.get(line.categoryKey);
    if (!category) continue;
    if (line.mode === 'percentage') continue;

    if (line.origin === 'extra' && line.extraStatus !== 'approved') {
      totals.proposedExtrasRevenue += line.clientPrice;
      totals.proposedExtrasActualCost += line.actualCost;
      totals.extraCount += 1;
      continue;
    }

    if (line.origin === 'extra') totals.extraCount += 1;
    totals.pricedOriginal += line.clientPrice;
    totals.actualCost += line.actualCost;
    totals.lineCount += 1;
  }

  // The contingency base: priced, agreed, and in a category that says yes.
  let base = 0;
  for (const line of plan.lines) {
    if (line.mode === 'percentage') continue;
    const category = byKey.get(line.categoryKey);
    if (!category || !category.includeInContingencyBase) continue;
    if (line.origin === 'extra' && line.extraStatus !== 'approved') continue;
    base += line.clientPrice;
  }

  for (const line of plan.lines) {
    if (line.mode !== 'percentage') continue;
    totals.contingency += Math.round(base * ((line.percentageRate ?? 0) / 100));
    totals.lineCount += 1;
  }

  totals.agreedRevenue = totals.pricedOriginal + totals.contingency;
  totals.agreedProfit = totals.agreedRevenue - totals.actualCost;
  return totals;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface PlanProblem {
  field: string;
  message: string;
}

/**
 * Refuse a plan that would produce nonsense.
 *
 * Run in the browser so the reviewer is told immediately, and again on the
 * server, which is where it counts — the browser's copy is a courtesy and the
 * server's is the rule.
 */
export function validatePlan(plan: ImportPlan): PlanProblem[] {
  const problems: PlanProblem[] = [];

  if (!plan.projectName.trim()) {
    problems.push({ field: 'projectName', message: 'The project needs a name.' });
  }
  if (plan.lines.length === 0) {
    problems.push({ field: 'lines', message: 'No budget lines were found. Check the row ranges.' });
  }
  if (plan.lines.length > 5000) {
    problems.push({
      field: 'lines',
      message: `${plan.lines.length} lines is beyond what one import should write in a single pass.`,
    });
  }

  const keys = new Set(plan.categories.map((c) => c.key));
  for (const line of plan.lines) {
    if (!keys.has(line.categoryKey)) {
      problems.push({
        field: 'lines',
        message: `Row ${line.sourceRow} refers to a category that is not in the plan.`,
      });
      break;
    }
  }

  const contingencyLines = plan.lines.filter((l) => l.mode === 'percentage');
  if (contingencyLines.length > 1) {
    problems.push({
      field: 'sections',
      message:
        'More than one contingency line. Percentage lines cannot compound, so only one is supported per sub-event.',
    });
  }
  for (const line of contingencyLines) {
    const rate = line.percentageRate ?? 0;
    if (rate < 0 || rate > 100) {
      problems.push({
        field: 'sections',
        message: `Row ${line.sourceRow} gives a contingency rate of ${rate}%. Check the column map — the workbook holds it as a decimal fraction.`,
      });
    }
  }

  const overlapping = [...plan.sections]
    .sort((a, b) => a.firstRow - b.firstRow)
    .find((section, i, all) => i > 0 && section.firstRow <= all[i - 1].lastRow);
  if (overlapping) {
    problems.push({
      field: 'sections',
      message: `Rows ${overlapping.firstRow}–${overlapping.lastRow} ("${overlapping.name}") overlap the section above, so lines would be imported twice.`,
    });
  }

  return problems;
}
