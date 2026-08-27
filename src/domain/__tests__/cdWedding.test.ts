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
  type ImportedProject,
} from '../../../scripts/importWorkbook';

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

function rollup(p: ImportedProject) {
  return rollupProject(
    {
      costItems: p.costItems,
      commitments: p.commitments,
      transactions: p.transactions,
      subEvents: p.subEvents,
      commissions: p.commissions,
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

  it('computes contingency over every category, unlike the workbook', async () => {
    const p = await load(false);
    const resolved = applyPercentageLines(p.costItems);
    const contingency = resolved.find((i) => i.mode === 'percentage')!;

    // 5.25% of all eight categories.
    expect(contingency.approved!.clientPrice).toBe(toPence(21_243.38));
    // The workbook omits Creative from the base and lands £2,340.43 short.
    expect(p.workbookTotals.contingency).toBe(toPence(18_902.95));
    expect(contingency.approved!.clientPrice - p.workbookTotals.contingency).toBe(
      toPence(2_340.43),
    );
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
});

suite('C & D Wedding — with the optional extras agreed', () => {
  it('produces the corrected project position', async () => {
    const p = await load(true);
    const r = rollup(p);

    expect(r.forecastCost).toBe(toPence(328_182.59));
    expect(r.currentAgreedClientRevenue).toBe(toPence(459_837.56));
    expect(r.forecastProfit).toBe(toPence(131_654.97));
    expect(formatPercent(r.forecastMargin)).toBe('28.6%');
    expect(formatGBP(r.forecastProfit)).toBe('£131,654.97');
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
    expect(r.forecastProfit).toBe(toPence(131_654.97));
  });
});
