/**
 * The import plan, without a spreadsheet.
 *
 * `SheetReader` is four lines of interface, which means the mapping rules can
 * be tested against a hand-written grid where every cell is visible in the
 * test. The C & D suite proves the same code against a real workbook; this one
 * proves the edges that a real workbook happens not to contain.
 */

import { describe, expect, it } from 'vitest';

import {
  buildPlan,
  planTotals,
  validatePlan,
  type PlanSection,
  type SheetReader,
} from '../import/plan';
import { materialise, totalsAgree } from '../import/materialise';
import { toPence } from '../money';

/** Columns: A description, B quantity, C unit price, D line total, H unit cost. */
type Row = [string, number | null, number | null, number | null, number | null];

function sheet(rows: Record<number, Row>, name = 'Budget'): SheetReader {
  const columns: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 8: 4 };
  return {
    name,
    rowCount: Math.max(...Object.keys(rows).map(Number)),
    cell(row, col) {
      const index = columns[col];
      if (index === undefined) return null;
      return rows[row]?.[index] ?? null;
    },
  };
}

const options = { projectName: 'Test Event', sourceFilename: 'test.xlsx' };

describe('buildPlan', () => {
  it('derives a lump line total from the unit price', () => {
    const plan = buildPlan(
      sheet({ 2: ['Arch', 1, 4800, 4800, 1200] }),
      [{ headerRow: 1, firstRow: 2, lastRow: 2, name: 'Florals' }],
      options,
    );

    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0].mode).toBe('lump');
    expect(plan.lines[0].clientPrice).toBe(toPence(4800));
    expect(plan.lines[0].actualCost).toBe(toPence(1200));
  });

  it('costs a quantity line at quantity × unit cost, not unit cost', () => {
    // The £36,820 error in the reference workbook, in one line: fifteen days
    // at £320 is £4,800, and the workbook's own cost total says £320.
    const plan = buildPlan(
      sheet({ 2: ['Pre-planning — Fin, 15 days', 15, 450, 6750, 320] }),
      [{ headerRow: 1, firstRow: 2, lastRow: 2, name: 'Labour' }],
      options,
    );

    expect(plan.lines[0].mode).toBe('quantity');
    expect(plan.lines[0].clientPrice).toBe(toPence(6750));
    expect(plan.lines[0].actualCost).toBe(toPence(4800));
  });

  it('charges nothing for a line left at quantity zero, and says so', () => {
    const plan = buildPlan(
      sheet({ 2: ['External Church Arch', 0, 10000, 0, 0] }),
      [{ headerRow: 1, firstRow: 2, lastRow: 2, name: 'Florals' }],
      options,
    );

    // The workbook's own line total is quantity × price, so this line is
    // descoped. Importing it at £10,000 would invent revenue nobody billed.
    expect(plan.lines[0].clientPrice).toBe(0);
    expect(plan.warnings.filter((w) => w.kind === 'zero_quantity')).toHaveLength(1);
  });

  it('skips spare rows but keeps a real line priced at zero', () => {
    const plan = buildPlan(
      sheet({
        2: ['Freelancer overtime', 1, 0, 0, 0],
        3: ['', null, null, null, null],
        4: ['Sub Total', null, null, 999, null],
      }),
      [{ headerRow: 1, firstRow: 2, lastRow: 4, name: 'Extras' }],
      options,
    );

    // Three rows, one line. Counting rows instead of lines is how a section
    // that spans 192–207 grows a sixteenth optional extra that does not exist.
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0].description).toBe('Freelancer overtime');
    expect(plan.lines[0].clientPrice).toBe(0);
  });

  it('keeps optional extras out of revenue but keeps their cost', () => {
    const sections: PlanSection[] = [
      { headerRow: 1, firstRow: 2, lastRow: 2, name: 'Florals' },
      {
        headerRow: 3,
        firstRow: 4,
        lastRow: 4,
        name: 'Optional Extras',
        isExtras: true,
        includeInContingencyBase: false,
      },
    ];
    const plan = buildPlan(
      sheet({ 2: ['Arch', 1, 10000, 10000, 6000], 4: ['Extra lorry', 1, 9500, 9500, 9500] }),
      sections,
      options,
    );

    expect(plan.lines[1].extraStatus).toBe('proposed');
    expect(plan.totals.pricedOriginal).toBe(toPence(10_000));
    expect(plan.totals.proposedExtrasRevenue).toBe(toPence(9_500));
    // Spent, unconfirmed, and not hidden.
    expect(plan.totals.proposedExtrasActualCost).toBe(toPence(9_500));
    expect(plan.totals.actualCost).toBe(toPence(6_000));
  });

  it('excludes a category from the contingency base when the category says so', () => {
    const rows = {
      2: ['Arch', 1, 10000, 10000, 0] as Row,
      4: ['Creative direction', 1, 5000, 5000, 0] as Row,
      6: ['Contingency', 1, 0.1, 0, 0] as Row,
    };
    const base: PlanSection[] = [
      { headerRow: 1, firstRow: 2, lastRow: 2, name: 'Florals' },
      { headerRow: 3, firstRow: 4, lastRow: 4, name: 'Creative' },
      { headerRow: 5, firstRow: 6, lastRow: 6, name: 'Contingency', isContingency: true },
    ];

    const included = buildPlan(sheet(rows), base, options);
    expect(included.totals.contingency).toBe(toPence(1_500));

    const excluded = buildPlan(
      sheet(rows),
      base.map((s) => (s.name === 'Creative' ? { ...s, includeInContingencyBase: false } : s)),
      options,
    );
    // 10% of £10,000 rather than of £15,000. Nothing here looked at the word
    // "Creative" — the flag did the work, which is why renaming the category
    // cannot move the figure.
    expect(excluded.totals.contingency).toBe(toPence(1_000));
    expect(excluded.totals.agreedRevenue).toBe(toPence(16_000));
  });

  it('reports a disagreement with the workbook rather than adopting it', () => {
    const plan = buildPlan(
      sheet({ 2: ['Arch', 15, 450, 6750, 320], 9: ['EVENT TOTAL', null, null, 999999, null] }),
      [{ headerRow: 1, firstRow: 2, lastRow: 2, name: 'Florals' }],
      { ...options, totalsRow: 9 },
    );

    expect(plan.warnings.some((w) => w.kind === 'workbook_disagrees')).toBe(true);
    // The recalculated figure is the one that will be stored.
    expect(plan.totals.agreedRevenue).toBe(toPence(6_750));
  });
});

describe('validatePlan', () => {
  const oneLine = () =>
    buildPlan(
      sheet({ 2: ['Arch', 1, 4800, 4800, 0] }),
      [{ headerRow: 1, firstRow: 2, lastRow: 2, name: 'Florals' }],
      options,
    );

  it('accepts a plain plan', () => {
    expect(validatePlan(oneLine())).toEqual([]);
  });

  it('refuses a plan with no name and no lines', () => {
    const plan = buildPlan(sheet({}), [], { ...options, projectName: '' });
    const fields = validatePlan(plan).map((p) => p.field);
    expect(fields).toContain('projectName');
    expect(fields).toContain('lines');
  });

  it('refuses overlapping sections, which would import lines twice', () => {
    const plan = buildPlan(
      sheet({ 2: ['A', 1, 100, 100, 0], 3: ['B', 1, 200, 200, 0] }),
      [
        { headerRow: 1, firstRow: 2, lastRow: 3, name: 'One' },
        { headerRow: 1, firstRow: 3, lastRow: 3, name: 'Two' },
      ],
      options,
    );
    expect(validatePlan(plan).some((p) => p.message.includes('overlap'))).toBe(true);
  });

  it('refuses a contingency rate that is obviously a decimal fraction misread', () => {
    const plan = buildPlan(
      sheet({ 2: ['Arch', 1, 100, 100, 0], 4: ['Contingency', 1, 525, 0, 0] }),
      [
        { headerRow: 1, firstRow: 2, lastRow: 2, name: 'Florals' },
        { headerRow: 3, firstRow: 4, lastRow: 4, name: 'Contingency', isContingency: true },
      ],
      options,
    );
    // 525 in the cell means 52,500%. Something is wrong with the column map.
    expect(validatePlan(plan).some((p) => p.message.includes('52500'))).toBe(true);
  });
});

describe('totalsAgree', () => {
  it('catches a plan whose figures were changed after review', () => {
    const plan = buildPlan(
      sheet({ 2: ['Arch', 1, 4800, 4800, 1200] }),
      [{ headerRow: 1, firstRow: 2, lastRow: 2, name: 'Florals' }],
      options,
    );
    expect(totalsAgree(plan)).toBe(true);

    const tampered = { ...plan, totals: { ...plan.totals, agreedRevenue: toPence(48_000) } };
    expect(totalsAgree(tampered)).toBe(false);
  });

  it('recomputes from the lines, so an inflated line is caught too', () => {
    const plan = buildPlan(
      sheet({ 2: ['Arch', 1, 4800, 4800, 1200] }),
      [{ headerRow: 1, firstRow: 2, lastRow: 2, name: 'Florals' }],
      options,
    );
    const tampered = {
      ...plan,
      lines: [{ ...plan.lines[0], clientPrice: toPence(48_000) }],
    };
    expect(totalsAgree(tampered)).toBe(false);
    expect(planTotals(tampered).agreedRevenue).toBe(toPence(48_000));
  });
});

describe('materialise', () => {
  const build = () => {
    const plan = buildPlan(
      sheet({ 2: ['Pre-planning', 15, 450, 6750, 320] }),
      [{ headerRow: 1, firstRow: 2, lastRow: 2, name: 'Labour' }],
      options,
    );
    return materialise(plan, {
      projectId: 'p1',
      subEventId: 'main',
      importBatchId: 'b1',
      importedBy: 'admin',
      at: '2026-08-27T00:00:00.000Z',
      versionId: 'v1',
      versionNo: 1,
      categoryId: (key) => `cat_${key}`,
      costItemId: (line) => `ci_${line.sourceRow}`,
      transactionId: (line) => `t_${line.sourceRow}`,
    });
  };

  it('never sets a budgeted cost', () => {
    const built = build();
    // The workbook has no budget column. Setting budget = actual would report
    // every line at zero variance — a budget met that was never set.
    expect(built.costItems[0].draft.budgetCost).toBeNull();
    expect(built.costItems[0].approved!.budgetCost).toBeNull();
    expect(built.costItems[0].original!.budgetCost).toBeNull();
  });

  it('turns the actual cost into a transaction against the line', () => {
    const built = build();
    expect(built.transactions).toHaveLength(1);
    expect(built.transactions[0].costItemId).toBe(built.costItems[0].id);
    expect(built.transactions[0].amountBaseExVat).toBe(toPence(4800));
    expect(built.transactions[0].source).toBe('import');
    // Cost ex VAT is all the workbook records. Inventing 20% would be
    // inventing a reclaim.
    expect(built.transactions[0].vatAmount).toBe(0);
  });

  it('carries provenance on every record', () => {
    const built = build();
    expect(built.costItems[0].import?.importBatchId).toBe('b1');
    expect(built.costItems[0].import?.sourceReference).toContain('Budget!2');
    expect(built.transactions[0].import?.importBatchId).toBe('b1');
  });

  it('preserves the workbook order', () => {
    const plan = buildPlan(
      sheet({ 2: ['First', 1, 1, 1, 0], 3: ['Second', 1, 1, 1, 0], 4: ['Third', 1, 1, 1, 0] }),
      [{ headerRow: 1, firstRow: 2, lastRow: 4, name: 'Labour' }],
      options,
    );
    const built = materialise(plan, {
      projectId: 'p1',
      subEventId: 'main',
      importBatchId: 'b1',
      importedBy: 'admin',
      at: '2026-08-27T00:00:00.000Z',
      versionId: 'v1',
      versionNo: 1,
      categoryId: (key) => `cat_${key}`,
      costItemId: (line) => `ci_${line.sourceRow}`,
      transactionId: (line) => `t_${line.sourceRow}`,
    });
    const keys = built.costItems.map((i) => i.sortKey);
    expect([...keys].sort()).toEqual(keys);
    expect(built.costItems.map((i) => i.description)).toEqual(['First', 'Second', 'Third']);
  });
});
