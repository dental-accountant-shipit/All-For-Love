/**
 * The engine, run against a real project.
 *
 * C & D Wedding MASTER Budget v14 is All for Love's principal reference case.
 * The workbook stays in Google Drive and is never committed, so this suite
 * skips unless AFL_CD_WORKBOOK points at it:
 *
 *   AFL_CD_WORKBOOK="/path/to/C and D wedding - MASTER Budget v14 (1).xlsm" npm test
 *
 * These tests assert what the arithmetic SHOULD produce, not what the workbook
 * displays. Where they disagree, the difference is asserted explicitly so it
 * cannot be quietly lost.
 */

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';

import { toPence, formatGBP, formatPercent } from '../money';
import { rollupProject, applyPercentageLines, subEventTotalsReconcile } from '../rollup';
import {
  CD_WEDDING_SECTIONS,
  importWorkbook,
  sheetReader,
  type ImportedProject,
} from '../../../scripts/importWorkbook';
import { buildPlan, validatePlan } from '../import/plan';
import { detectSections } from '../../lib/import/readWorkbook';

const WORKBOOK = process.env.AFL_CD_WORKBOOK;
const available = Boolean(WORKBOOK && existsSync(WORKBOOK));
const suite = available ? describe : describe.skip;

const AT = '2026-08-26T00:00:00.000Z';

async function load(extrasApproved: boolean): Promise<ImportedProject> {
  return importWorkbook(WORKBOOK!, 'C & D wedding', CD_WEDDING_SECTIONS, {
    sourceFilename: 'C and D wedding - MASTER Budget v14 (1).xlsm',
    extrasApproved,
  });
}

/**
 * Categories are passed in, which is what carries `includeInContingencyBase`.
 * All for Love keep Creative and Optional Extras out of the contingency base,
 * matching the workbook — recorded on the category, never inferred from a name.
 */
function rollup(p: ImportedProject) {
  return rollupProject(
    {
      costItems: p.costItems,
      commitments: p.commitments,
      transactions: p.transactions,
      subEvents: p.subEvents,
      commissions: p.commissions,
      categories: p.categories,
    },
    AT,
    1,
  );
}

suite('C & D Wedding — core event, extras excluded', () => {
  it('reproduces the workbook client total exactly', async () => {
    const p = await load(false);
    const r = rollup(p);

    // Contingency is recomputed by the engine over every category, so the
    // client total differs from the workbook by exactly the amount the
    // workbook's contingency formula misses. Check the priced lines first.
    const priced = p.costItems.filter((i) => i.mode !== 'percentage' && i.origin === 'original');
    const pricedTotal = priced.reduce((a, i) => a + i.approved!.clientPrice, 0);
    expect(pricedTotal).toBe(toPence(404_635.8));

    // Workbook event total = priced lines + its own contingency figure.
    expect(pricedTotal + p.workbookTotals.contingency).toBe(p.workbookTotals.eventTotalExVat);
    expect(r.currentAgreedClientRevenue).toBeGreaterThan(0);
  });

  it('recovers the £36,820 the workbook drops from its cost total', async () => {
    const p = await load(false);
    const r = rollup(p);

    // Cost as the mark-up column implies it: quantity × unit cost, arriving
    // as transactions against each line rather than as a budget.
    expect(r.forecastCost).toBe(toPence(306_322.97));

    // Cost as cell H186 reports it: unit costs summed without quantities.
    expect(p.workbookTotals.costPerHColumn).toBe(toPence(269_502.97));

    expect(r.forecastCost - p.workbookTotals.costPerHColumn).toBe(toPence(36_820));
  });

  it('reproduces the workbook contingency exactly once Creative is excluded', async () => {
    const p = await load(false);
    const contingency = applyPercentageLines(
      p.costItems,
      undefined,
      p.categories,
    ).find((i) => i.mode === 'percentage')!;

    // 5.25% of every category except Creative and Optional Extras. All for
    // Love confirmed this is the intended base, so the engine and the workbook
    // now agree to the penny — which is the point: the workbook's arithmetic
    // was right here, and only its cost total and its 6% label were wrong.
    expect(contingency.approved!.clientPrice).toBe(toPence(18_902.95));
    expect(contingency.approved!.clientPrice).toBe(p.workbookTotals.contingency);
  });

  it('puts Creative back in the base when the category says so', async () => {
    const p = await load(false);
    const everythingIncluded = p.categories.map((c) => ({
      ...c,
      includeInContingencyBase: true,
    }));
    const contingency = applyPercentageLines(
      p.costItems,
      undefined,
      everythingIncluded,
    ).find((i) => i.mode === 'percentage')!;

    // £2,340.43 more — 5.25% of Creative. The setting is what moves it, so a
    // project quoted the other way round is one toggle away rather than a
    // different codebase.
    expect(contingency.approved!.clientPrice).toBe(toPence(21_243.38));
    expect(contingency.approved!.clientPrice - p.workbookTotals.contingency).toBe(
      toPence(2_340.43),
    );
  });

  it('reproduces the workbook Event Total to the penny', async () => {
    const p = await load(false);
    const r = rollup(p);

    // Priced original lines + contingency on the agreed base. With the extras
    // correctly excluded this is the workbook's own headline figure, which
    // means every difference that follows is a cost difference, not a dispute
    // about what the client agreed to pay.
    expect(r.currentAgreedClientRevenue).toBe(toPence(423_538.75));
    expect(r.currentAgreedClientRevenue).toBe(p.workbookTotals.eventTotalExVat);
  });

  it('leaves proposed extras out of every agreed figure', async () => {
    const p = await load(false);
    const r = rollup(p);
    expect(r.proposedExtrasRevenue).toBe(toPence(33_958.38));
    expect(r.forecastCost).toBe(toPence(306_322.97));
  });

  it('will not offer proposed extras as free revenue when their cost is unknown', async () => {
    const p = await load(false);
    const r = rollup(p);
    // Imported extras have no budgeted cost, so the opportunity is reported as
    // revenue with an unknown cost — never as £33,958 of pure profit.
    expect(r.proposedExtrasCostKnown).toBe(false);
    expect(r.proposedExtrasCost).toBe(0);

    const extraIds = new Set(p.costItems.filter((i) => i.origin === 'extra').map((i) => i.id));
    const spent = p.transactions
      .filter((t) => t.costItemId !== null && extraIds.has(t.costItemId))
      .reduce((a, t) => a + t.amountBaseExVat, 0);
    expect(spent).toBe(toPence(21_859.62));
  });

  it('keeps the money already spent on unconfirmed extras visible', async () => {
    const p = await load(false);
    const r = rollup(p);

    // £21,859.62 left the business on extras nobody has confirmed the client
    // paid for. It is not in actualTotal, because it is not part of the agreed
    // position — but it must not vanish either. If these stay unconfirmed,
    // this figure is the loss.
    expect(r.proposedExtrasActualCost).toBe(toPence(21_859.62));
    expect(r.actualTotal).toBe(toPence(306_322.97));
    expect(r.proposedExtrasRevenue).toBe(toPence(33_958.38));
  });

  it('imports fifteen optional extras, not sixteen', async () => {
    const p = await load(false);
    const extras = p.costItems.filter((i) => i.origin === 'extra');

    // The section spans rows 192–207, which is sixteen rows. Row 207 is empty
    // — no description, no price, no cost — and is not a budget line. Counting
    // the rows instead of the lines is how a spreadsheet grows a phantom.
    expect(extras).toHaveLength(15);
    expect(extras.some((i) => i.import?.sourceReference?.endsWith('A207'))).toBe(false);

    // One of the fifteen is real but priced at zero: "Freelancers additional
    // hours - OT". A zero-value line is a line.
    const zero = extras.filter((i) => i.approved!.clientPrice === 0);
    expect(zero).toHaveLength(1);
    expect(zero[0].description).toContain('Freelancers');
  });
});

suite('C & D Wedding — with the optional extras agreed', () => {
  it('produces the corrected project position', async () => {
    const p = await load(true);
    const r = rollup(p);

    expect(r.forecastCost).toBe(toPence(328_182.59));
    expect(r.currentAgreedClientRevenue).toBe(toPence(457_497.13));
    expect(r.forecastProfit).toBe(toPence(129_314.54));
    expect(formatPercent(r.forecastMargin)).toBe('28.3%');
    expect(formatGBP(r.forecastProfit)).toBe('£129,314.54');

    // Approving the extras does not move the contingency. An extra is priced
    // with its own margin at the time, and Optional Extras is outside the base
    // besides — two independent reasons, both deliberate.
    expect(r.currentAgreedClientRevenue - toPence(33_958.38)).toBe(
      p.workbookTotals.eventTotalExVat,
    );
  });

  it('shows the £33,958 of extras the workbook leaves out of every total', async () => {
    const p = await load(true);
    const r = rollup(p);
    const extras = p.costItems.filter((i) => i.origin === 'extra');
    const extraIds = new Set(extras.map((i) => i.id));
    const extrasRevenue = extras.reduce((a, i) => a + i.approved!.clientPrice, 0);
    // Cost comes from the transactions, not from a budget — there was none.
    const extrasCost = p.transactions
      .filter((t) => t.costItemId !== null && extraIds.has(t.costItemId))
      .reduce((a, t) => a + t.amountBaseExVat, 0);

    expect(extrasRevenue).toBe(toPence(33_958.38));
    expect(extrasCost).toBe(toPence(21_859.62));
    expect(r.currentAgreedClientRevenue).toBeGreaterThan(p.workbookTotals.eventTotalExVat);
  });

  it('every line is completed, so forecast equals actual throughout', async () => {
    const p = await load(true);
    const r = rollup(p);
    expect(r.forecastCost).toBe(r.actualTotal);
    expect(r.committedRemaining).toBe(0);
  });

  it('reconciles sub-event totals to the project total', async () => {
    const p = await load(true);
    expect(subEventTotalsReconcile(rollup(p))).toBe(true);
  });
});

suite('C & D Wedding — the Admin Import pathway, unassisted', () => {
  it('detects the same section map a human verified by hand', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(WORKBOOK!);
    const ws = wb.getWorksheet('C & D wedding')!;
    const { sections, totalsRow } = detectSections(sheetReader(ws));

    // No phantom sections from the SUMMARY block, and no second contingency.
    expect(sections).toHaveLength(10);
    expect(sections.filter((s) => s.isContingency)).toHaveLength(1);
    expect(sections.filter((s) => s.isExtras)).toHaveLength(1);
    expect(totalsRow).toBe(186);

    const outsideBase = sections
      .filter((s) => s.includeInContingencyBase === false)
      .map((s) => s.name);
    expect(outsideBase).toEqual(['Creative', 'Optional Extras']);
  });

  it('reaches the verified position from the file alone', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(WORKBOOK!);
    const ws = wb.getWorksheet('C & D wedding')!;
    const detected = detectSections(sheetReader(ws));

    const plan = buildPlan(sheetReader(ws), detected.sections, {
      projectName: 'C & D Wedding',
      sourceFilename: 'C and D wedding - MASTER Budget v14 (1).xlsm',
      totalsRow: detected.totalsRow,
    });

    // Nobody told it where anything was. Same figures.
    expect(validatePlan(plan)).toEqual([]);
    expect(plan.lines.filter((l) => l.origin === 'extra')).toHaveLength(15);
    expect(plan.totals.agreedRevenue).toBe(toPence(423_538.75));
    expect(plan.totals.agreedRevenue).toBe(plan.workbookTotals.eventTotalExVat);
    expect(plan.totals.actualCost).toBe(toPence(306_322.97));
    expect(plan.totals.agreedProfit).toBe(toPence(117_215.78));
    expect(plan.totals.proposedExtrasRevenue).toBe(toPence(33_958.38));
    expect(plan.totals.proposedExtrasActualCost).toBe(toPence(21_859.62));

    // And the £36,820 the workbook's own cost column drops.
    expect(plan.totals.actualCost - plan.workbookTotals.costColumnSum).toBe(toPence(36_820));
  });
});

suite('C & D Wedding — what the import cannot know', () => {
  it('flags every euro amount buried in a description', async () => {
    const p = await load(true);
    const euro = p.warnings.filter((w) => w.includes('euro'));
    // Lunches, waste disposal, Sunday flights, garden centre rental, transfers.
    expect(euro.length).toBeGreaterThanOrEqual(4);
  });

  it('reports the budget as unknown rather than inventing one', async () => {
    const p = await load(true);
    const r = rollup(p);

    // The workbook has a client price column and an actual cost column and
    // nothing in between. Setting budget equal to actual would show every line
    // at zero variance — a budget met that was never set.
    expect(p.costItems.every((i) => i.approved!.budgetCost === null)).toBe(true);
    expect(r.budgetCostKnown).toBe(false);
    expect(r.budgetCost).toBe(0);
    expect(r.linesWithoutBudget).toBe(r.lineCount);

    // A line with no budget is never "over" it — that is unmeasurable, not
    // compliant.
    expect(r.linesOverBudget).toBe(0);
  });

  it('still reports real cost and real profit for an imported project', async () => {
    const p = await load(true);
    const r = rollup(p);
    expect(r.actualTotal).toBe(toPence(328_182.59));
    expect(r.forecastCost).toBe(toPence(328_182.59));
    expect(r.forecastProfit).toBe(toPence(129_314.54));
  });
});
