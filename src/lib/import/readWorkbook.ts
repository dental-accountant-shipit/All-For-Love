/**
 * Reading a workbook in the browser, and guessing its shape.
 *
 * The guessing is the interesting part. A budget workbook has no schema — it
 * has a layout, and the layout is different every time somebody adds a day to
 * an event. So this proposes a set of sections and then gets out of the way:
 * every row range, every name and every flag it suggests is editable on the
 * import screen before anything is written.
 *
 * That distinction is deliberate. Detection may use a category's name as a
 * hint — a section called "Contingency" is probably the contingency — but
 * nothing downstream ever does. Once the reviewer has confirmed the sections,
 * the behaviour is carried by explicit flags, so renaming a category later
 * cannot change a single figure.
 */

import {
  DEFAULT_COLUMNS,
  type ColumnMap,
  type PlanSection,
  type SheetReader,
  numberAt,
  textAt,
} from '../../domain/import/plan';

export interface LoadedWorkbook {
  sheetNames: string[];
  sheet(name: string): SheetReader;
}

/**
 * ExcelJS is around a megabyte and is needed on exactly one screen, which is
 * visited by one person a handful of times ever. It is loaded on demand rather
 * than shipped to everybody opening a budget.
 */
export async function loadWorkbook(data: ArrayBuffer): Promise<LoadedWorkbook> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);

  return {
    sheetNames: wb.worksheets.map((ws) => ws.name),
    sheet(name: string): SheetReader {
      const ws = wb.getWorksheet(name);
      if (!ws) throw new Error(`The workbook has no sheet called "${name}".`);
      return {
        name: ws.name,
        rowCount: ws.rowCount,
        cell: (row, col) => ws.getRow(row).getCell(col).value,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Guessing the sections
// ---------------------------------------------------------------------------

const CONTINGENCY_HINT = /conting/i;
const EXTRAS_HINT = /optional|extra/i;
const OUTSIDE_BASE_HINT = /creative/i;
const IGNORE_HINT = /^(invoicing|invoice|event total|total|sub\s*total|summary|notes?)\b/i;

/**
 * The same test the importer applies: a row is a line when somebody said how
 * many, or how much each.
 *
 * Neither the total column nor the cost column is consulted, and both
 * omissions matter. They are the two columns a summary block fills in, so a
 * detector that trusted them would place a section over the summary at the
 * foot of the sheet and offer the reviewer a second copy of half the budget.
 */
function isLineRow(sheet: SheetReader, row: number, columns: ColumnMap): boolean {
  return (
    numberAt(sheet, row, columns.quantity) !== 0 ||
    numberAt(sheet, row, columns.unitPrice) !== 0
  );
}

/**
 * A heading is text on its own: something in the description column, and no
 * numbers anywhere across the row. That is what a category banner looks like in
 * every one of these workbooks, and it is a far better signal than font or fill,
 * which do not survive a copy-paste between files.
 */
function isHeadingRow(sheet: SheetReader, row: number, columns: ColumnMap): boolean {
  const text = textAt(sheet, row, columns.description);
  if (text === '' || text.length > 60) return false;
  return !isLineRow(sheet, row, columns);
}

export interface DetectionResult {
  sections: PlanSection[];
  /** Row holding the workbook's own grand totals, if one was recognised. */
  totalsRow: number | null;
  /** Headings that were found but deliberately not turned into categories. */
  ignored: Array<{ row: number; name: string }>;
}

/**
 * Propose a section map for a sheet.
 *
 * Everything here is a suggestion for a human to correct. It is tuned to be
 * slightly over-eager rather than cautious: a section proposed wrongly is
 * obvious on screen and takes one click to delete, whereas a section that was
 * never proposed is a whole category of a budget silently missing, which is
 * exactly the failure this pathway exists to prevent.
 */
export function detectSections(
  sheet: SheetReader,
  columns: ColumnMap = DEFAULT_COLUMNS,
  maxRow = 400,
): DetectionResult {
  const limit = Math.min(sheet.rowCount || maxRow, maxRow);
  const headings: Array<{ row: number; name: string }> = [];
  const ignored: Array<{ row: number; name: string }> = [];
  let totalsRow: number | null = null;

  for (let row = 1; row <= limit; row++) {
    const text = textAt(sheet, row, columns.description);
    // The first one, not the last. This workbook has two rows headed "EVENT
    // TOTAL": the real one at the foot of the summary, carrying both a total
    // and a cost, and a later one in the invoicing block that repeats the
    // total alone. Taking the last would quietly lose the cost comparison,
    // which is the single most useful number on the review screen.
    if (totalsRow === null && text !== '' && /^event total\b/i.test(text)) totalsRow = row;
    if (!isHeadingRow(sheet, row, columns)) continue;
    if (IGNORE_HINT.test(text)) {
      ignored.push({ row, name: text });
      continue;
    }
    headings.push({ row, name: text });
  }

  const sections: PlanSection[] = [];

  headings.forEach((heading, index) => {
    const nextBoundary = headings[index + 1]?.row ?? limit + 1;
    const ceiling = Math.min(nextBoundary, limit + 1);

    // Trim to the last row that actually carries money, so a section does not
    // swallow the blank run beneath it and report a phantom line.
    let lastRow = heading.row;
    for (let row = heading.row + 1; row < ceiling; row++) {
      if (isLineRow(sheet, row, columns)) lastRow = row;
    }
    if (lastRow === heading.row) return;

    const isContingency = CONTINGENCY_HINT.test(heading.name);
    const isExtras = EXTRAS_HINT.test(heading.name);

    sections.push({
      headerRow: heading.row,
      firstRow: heading.row + 1,
      lastRow,
      name: titleCase(heading.name),
      ...(isContingency ? { isContingency: true } : {}),
      ...(isExtras ? { isExtras: true } : {}),
      // A suggestion only, and shown as one. Extras and Creative sit outside
      // the contingency base in All for Love's workbooks; the reviewer confirms
      // it, and from then on it is a stored decision about a category.
      includeInContingencyBase: !(isExtras || OUTSIDE_BASE_HINT.test(heading.name)),
    });
  });

  return { sections, totalsRow, ignored };
}

/** "OPTIONAL EXTRAS" reads badly as a category name; "Optional Extras" does not. */
function titleCase(value: string): string {
  if (value !== value.toUpperCase()) return value;
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bAnd\b/g, 'and');
}
