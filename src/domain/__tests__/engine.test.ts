import { describe, expect, it } from 'vitest';

import { toPence, formatGBP, formatPercent } from '../money';
import { forecastCostItem, remainingCommitted } from '../forecast';
import { revenueBreakdown } from '../revenue';
import { rollupProject, subEventTotalsReconcile } from '../rollup';
import {
  fenwickAndHale,
  makeCommitment,
  makeItem,
  makeSubEvent,
  makeTransaction,
} from './fixtures';

const AT = '2026-08-26T09:00:00.000Z';

// ---------------------------------------------------------------------------
// The worked example, line by line
// ---------------------------------------------------------------------------

describe('Fenwick & Hale — forecast per cost item', () => {
  const { costItems, commitments, transactions } = fenwickAndHale();
  const forecastFor = (id: string) =>
    forecastCostItem(costItems.find((i) => i.id === id)!, commitments, transactions);

  it('an in-progress line under its budget forecasts at budget', () => {
    const r = forecastFor('ci_florals');
    expect(r.committedRemaining).toBe(toPence(21_430));
    expect(r.actualTotal).toBe(toPence(18_420));
    // max(42,000, 18,420 + 21,430 = 39,850)
    expect(r.forecastCost).toBe(toPence(42_000));
  });

  it('a completed line forecasts at final actual, overspend and all', () => {
    const r = forecastFor('ci_structures');
    expect(r.forecastCost).toBe(toPence(23_940));
    expect(r.committedRemaining).toBe(0);
  });

  it('a committed line with no invoices yet still forecasts at budget', () => {
    const r = forecastFor('ci_vessels');
    expect(r.committedRemaining).toBe(toPence(8_115));
    expect(r.forecastCost).toBe(toPence(9_800));
  });

  it('a quoted line with nothing committed forecasts at budget', () => {
    expect(forecastFor('ci_assistants').forecastCost).toBe(toPence(4_800));
  });

  it('a commitment above budget raises the forecast immediately', () => {
    const r = forecastFor('ci_transport');
    // max(6,280, 1,900 + 5,500 = 7,400)
    expect(r.forecastCost).toBe(toPence(7_400));
  });

  it('a cancelled line keeps the costs already incurred', () => {
    const r = forecastFor('ci_ceiling');
    expect(r.forecastCost).toBe(toPence(850));
  });
});

describe('Fenwick & Hale — revenue composition', () => {
  const { costItems } = fenwickAndHale();
  const r = revenueBreakdown(costItems);

  it('reproduces the published figures', () => {
    expect(r.originalClientValue).toBe(toPence(148_500));
    expect(r.approvedExtras).toBe(toPence(9_750));
    expect(r.agreedReductions).toBe(toPence(16_000));
    expect(r.currentAgreedClientRevenue).toBe(toPence(142_250));
  });

  it('always reconciles: original + extras − reductions = current', () => {
    expect(r.originalClientValue + r.approvedExtras - r.agreedReductions).toBe(
      r.currentAgreedClientRevenue,
    );
  });

  it('reports proposed extras separately without blending them in', () => {
    expect(r.proposedExtrasRevenue).toBe(toPence(22_400));
    expect(r.proposedExtrasCost).toBe(toPence(11_900));
  });
});

describe('Fenwick & Hale — project rollup', () => {
  const fx = fenwickAndHale();
  const rollup = rollupProject(fx, AT, 1);

  it('totals budget, committed, actual and forecast', () => {
    expect(rollup.budgetCost).toBe(toPence(96_380));
    expect(rollup.committedTotal).toBe(toPence(79_305));
    expect(rollup.actualTotal).toBe(toPence(45_110));
    expect(rollup.committedRemaining).toBe(toPence(35_045));
    expect(rollup.forecastCost).toBe(toPence(88_790));
  });

  it('produces the published profit and margin', () => {
    expect(rollup.forecastProfit).toBe(toPence(53_460));
    expect(formatPercent(rollup.forecastMargin)).toBe('37.6%');
  });

  it('keeps commission out of cost and reports it separately', () => {
    expect(rollup.commissionTotal).toBe(toPence(7_112.5));
    expect(rollup.netProfitAfterCommission).toBe(toPence(46_347.5));
    expect(formatPercent(rollup.netMarginAfterCommission)).toBe('32.6%');
    expect(formatGBP(rollup.netProfitAfterCommission)).toBe('£46,347.50');
  });

  it('counts the lines forecasting above their approved budget', () => {
    // Structures & rigging, and Transport & logistics.
    expect(rollup.linesOverBudget).toBe(2);
  });

  it('excludes the proposed extra from every agreed figure', () => {
    expect(rollup.lineCount).toBe(6);
    expect(rollup.forecastCost).toBeLessThan(toPence(88_790) + toPence(11_900));
  });
});

// ---------------------------------------------------------------------------
// Sub-events
// ---------------------------------------------------------------------------

describe('sub-events', () => {
  it('an ordinary project has one sub-event and needs no special handling', () => {
    const fx = fenwickAndHale();
    const rollup = rollupProject(fx, AT, 1);
    expect(rollup.subEvents).toHaveLength(1);
    expect(rollup.subEvents[0].forecastProfit).toBe(rollup.forecastProfit);
    expect(subEventTotalsReconcile(rollup)).toBe(true);
  });

  it('a multi-day project rolls each sub-event up to the project total', () => {
    const P = 'p_smith_jones';
    const subEvents = [
      makeSubEvent('se_welcome', 'Welcome Dinner', 'a0', false, P),
      makeSubEvent('se_wedding', 'Wedding Day', 'a1', true, P),
      makeSubEvent('se_brunch', 'Day 2 Brunch', 'a2', false, P),
    ];

    const v = (budgetCost: number, clientPrice: number) => ({
      quantity: null,
      unitCost: null,
      unitPrice: null,
      percentageRate: null,
      budgetCost: toPence(budgetCost),
      clientPrice: toPence(clientPrice),
    });

    const costItems = [
      makeItem(
        {
          id: 'ci_w1',
          description: 'Welcome dinner tablescape',
          status: 'committed',
          subEventId: 'se_welcome',
          original: v(8_000, 13_000),
          approved: v(8_000, 13_000),
          draft: v(8_000, 13_000),
        },
        P,
      ),
      makeItem(
        {
          id: 'ci_d1',
          description: 'Ceremony & reception florals',
          status: 'in_progress',
          subEventId: 'se_wedding',
          original: v(46_000, 72_000),
          approved: v(46_000, 72_000),
          draft: v(46_000, 72_000),
        },
        P,
      ),
      makeItem(
        {
          id: 'ci_b1',
          description: 'Brunch table flowers',
          status: 'planned',
          subEventId: 'se_brunch',
          original: v(4_500, 7_200),
          approved: v(4_500, 7_200),
          draft: v(4_500, 7_200),
        },
        P,
      ),
    ];

    const commitments = [
      makeCommitment('c_w1', 'ci_w1', 9_100, 'accepted', 'se_welcome', P),
      makeCommitment('c_d1', 'ci_d1', 44_000, 'accepted', 'se_wedding', P),
    ];
    const transactions = [
      makeTransaction('t_d1', 'ci_d1', 20_000, 'c_d1', 'bill', 'se_wedding', P),
    ];

    const rollup = rollupProject(
      { costItems, commitments, transactions, subEvents, commissions: [] },
      AT,
      1,
    );

    const byName = Object.fromEntries(rollup.subEvents.map((s) => [s.name, s]));

    // Welcome Dinner: committed 9,100 above its 8,000 budget → forecast 9,100
    expect(byName['Welcome Dinner'].forecastCost).toBe(toPence(9_100));
    expect(byName['Welcome Dinner'].forecastProfit).toBe(toPence(3_900));

    // Wedding Day: max(46,000, 20,000 + 24,000) = 46,000
    expect(byName['Wedding Day'].forecastCost).toBe(toPence(46_000));

    // Brunch: nothing committed → budget stands
    expect(byName['Day 2 Brunch'].forecastCost).toBe(toPence(4_500));

    // And the whole thing adds up.
    expect(rollup.forecastCost).toBe(toPence(59_600));
    expect(rollup.currentAgreedClientRevenue).toBe(toPence(92_200));
    expect(rollup.forecastProfit).toBe(toPence(32_600));
    expect(subEventTotalsReconcile(rollup)).toBe(true);
  });

  it('preserves sub-event display order', () => {
    const P = 'p_order';
    const subEvents = [
      makeSubEvent('se_c', 'Day 2 Brunch', 'a2', false, P),
      makeSubEvent('se_a', 'Welcome Dinner', 'a0', false, P),
      makeSubEvent('se_b', 'Wedding Day', 'a1', true, P),
    ];
    const rollup = rollupProject(
      { costItems: [], commitments: [], transactions: [], subEvents, commissions: [] },
      AT,
      1,
    );
    expect(rollup.subEvents.map((s) => s.name)).toEqual([
      'Welcome Dinner',
      'Wedding Day',
      'Day 2 Brunch',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Edge cases that decide whether the numbers can be trusted
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  const v = (budgetCost: number, clientPrice: number) => ({
    quantity: null,
    unitCost: null,
    unitPrice: null,
    percentageRate: null,
    budgetCost: toPence(budgetCost),
    clientPrice: toPence(clientPrice),
  });

  it('an over-invoiced commitment cannot offset an outstanding one', () => {
    const commitments = [
      makeCommitment('c_a', 'ci_x', 10_000, 'accepted'),
      makeCommitment('c_b', 'ci_x', 5_000, 'accepted'),
    ];
    const transactions = [makeTransaction('t_a', 'ci_x', 12_000, 'c_a')];
    // c_a is fully drawn (over-drawn, contributing 0 not −2,000); c_b is untouched.
    expect(remainingCommitted(commitments, transactions)).toBe(toPence(5_000));
  });

  it('spend with no commitment still moves the forecast', () => {
    const item = makeItem({
      id: 'ci_x',
      description: 'Last-minute freelancers',
      status: 'in_progress',
      original: v(3_000, 5_000),
      approved: v(3_000, 5_000),
      draft: v(3_000, 5_000),
    });
    const r = forecastCostItem(item, [], [makeTransaction('t_x', 'ci_x', 4_200, null)]);
    expect(r.forecastCost).toBe(toPence(4_200));
  });

  it('a credit note reduces the actual and the forecast', () => {
    const item = makeItem({
      id: 'ci_x',
      description: 'Returned vessels',
      status: 'completed',
      original: v(3_000, 5_000),
      approved: v(3_000, 5_000),
      draft: v(3_000, 5_000),
    });
    const r = forecastCostItem(item, [], [
      makeTransaction('t_bill', 'ci_x', 3_400, null),
      makeTransaction('t_credit', 'ci_x', -600, null, 'credit'),
    ]);
    expect(r.actualTotal).toBe(toPence(2_800));
    expect(r.forecastCost).toBe(toPence(2_800));
  });

  it('a completed line under budget releases the underspend', () => {
    const item = makeItem({
      id: 'ci_x',
      description: 'Storage',
      status: 'completed',
      original: v(2_500, 4_000),
      approved: v(2_500, 4_000),
      draft: v(2_500, 4_000),
    });
    const r = forecastCostItem(item, [], [makeTransaction('t_x', 'ci_x', 1_800, null)]);
    expect(r.forecastCost).toBe(toPence(1_800));
  });

  it('a cancelled line with nothing spent forecasts zero', () => {
    const item = makeItem({
      id: 'ci_x',
      description: 'Dropped installation',
      status: 'cancelled',
      original: v(9_000, 14_000),
      approved: v(9_000, 14_000),
      draft: v(9_000, 14_000),
    });
    expect(forecastCostItem(item, [], []).forecastCost).toBe(0);
  });

  it('an override replaces the forecast but never destroys the calculation', () => {
    const item = makeItem({
      id: 'ci_x',
      description: 'Ceremony florals',
      status: 'in_progress',
      original: v(42_000, 63_000),
      approved: v(42_000, 63_000),
      draft: v(42_000, 63_000),
      override: { value: 38_000, reason: 'Supplier confirmed final quantities down' },
    });
    const r = forecastCostItem(item, [], []);
    expect(r.forecastCost).toBe(toPence(38_000));
    expect(r.forecastSource).toBe('override');
    expect(r.calculatedForecast).toBe(toPence(42_000));
  });

  it('flags an override that the calculation has drifted away from', () => {
    const item = makeItem({
      id: 'ci_x',
      description: 'Rigging',
      status: 'in_progress',
      original: v(20_000, 30_000),
      approved: v(20_000, 30_000),
      draft: v(20_000, 30_000),
      override: { value: 20_000, reason: 'Expect to hold budget' },
    });
    const quiet = forecastCostItem(item, [], []);
    expect(quiet.overrideMayBeStale).toBe(false);

    const noisy = forecastCostItem(
      item,
      [makeCommitment('c_x', 'ci_x', 26_000, 'accepted')],
      [],
    );
    expect(noisy.calculatedForecast).toBe(toPence(26_000));
    expect(noisy.overrideMayBeStale).toBe(true);
  });

  it('a rejected extra contributes to nothing at all', () => {
    const items = [
      makeItem({
        id: 'ci_ok',
        description: 'Ceremony florals',
        status: 'planned',
        original: v(10_000, 15_000),
        approved: v(10_000, 15_000),
        draft: v(10_000, 15_000),
      }),
      makeItem({
        id: 'ci_no',
        description: 'Declined chandelier',
        status: 'planned',
        origin: 'extra',
        extraStatus: 'rejected',
        draft: v(8_000, 12_000),
      }),
    ];
    const rollup = rollupProject(
      {
        costItems: items,
        commitments: [],
        transactions: [],
        subEvents: [makeSubEvent('se_main', 'Wedding Day', 'a0', true)],
        commissions: [],
      },
      AT,
      1,
    );
    expect(rollup.lineCount).toBe(1);
    expect(rollup.forecastCost).toBe(toPence(10_000));
    expect(rollup.currentAgreedClientRevenue).toBe(toPence(15_000));
    expect(rollup.proposedExtrasRevenue).toBe(0);
  });

  it('a draft revision does not move the forecast before it is approved', () => {
    const item = makeItem({
      id: 'ci_x',
      description: 'Ceremony florals',
      status: 'planned',
      original: v(42_000, 63_000),
      approved: v(42_000, 63_000),
      draft: v(51_000, 63_000), // someone is mid-revision
    });
    expect(forecastCostItem(item, [], []).forecastCost).toBe(toPence(42_000));
  });

  it('zero revenue yields no margin rather than an infinity', () => {
    const rollup = rollupProject(
      {
        costItems: [],
        commitments: [],
        transactions: [],
        subEvents: [makeSubEvent('se_main', 'Wedding Day', 'a0', true)],
        commissions: [],
      },
      AT,
      1,
    );
    expect(rollup.forecastMargin).toBeNull();
    expect(formatPercent(rollup.forecastMargin)).toBe('—');
  });

  it('holds money in integer pence so long budgets cannot drift', () => {
    const rollup = rollupProject(fenwickAndHale(), AT, 1);
    expect(Number.isInteger(rollup.forecastProfit)).toBe(true);
    expect(Number.isInteger(rollup.commissionTotal)).toBe(true);
    expect(rollup.commissionTotal).toBe(711_250); // £7,112.50 exactly
  });
});

// ---------------------------------------------------------------------------
// Percentage lines (contingency) — driven by the C & D Wedding workbook
// ---------------------------------------------------------------------------

describe('percentage lines', () => {
  const pv = (rate: number) => ({
    quantity: null,
    unitCost: null,
    unitPrice: null,
    percentageRate: rate,
    budgetCost: 0,
    clientPrice: 0,
  });
  const v = (budgetCost: number, clientPrice: number) => ({
    quantity: null,
    unitCost: null,
    unitPrice: null,
    percentageRate: null,
    budgetCost: toPence(budgetCost),
    clientPrice: toPence(clientPrice),
  });

  function build(rate: number) {
    const items = [
      makeItem({ id: 'ci_a', description: 'Florals', status: 'planned',
        original: v(40_000, 60_000), approved: v(40_000, 60_000), draft: v(40_000, 60_000) }),
      makeItem({ id: 'ci_b', description: 'Creative', status: 'planned',
        original: v(10_000, 40_000), approved: v(10_000, 40_000), draft: v(10_000, 40_000) }),
      { ...makeItem({ id: 'ci_cont', description: 'Contingency', status: 'planned',
        original: pv(rate), approved: pv(rate), draft: pv(rate) }), mode: 'percentage' as const },
    ];
    return rollupProject(
      { costItems: items, commitments: [], transactions: [],
        subEvents: [makeSubEvent('se_main', 'Wedding Day', 'a0', true)], commissions: [] },
      AT, 1,
    );
  }

  it('computes contingency over every other line, omitting none', () => {
    // The workbook omits one category from its base. This does not.
    const rollup = build(5.25);
    expect(rollup.currentAgreedClientRevenue).toBe(toPence(100_000 + 5_250));
  });

  it('does not let a percentage line inflate its own base', () => {
    const a = build(10);
    expect(a.currentAgreedClientRevenue).toBe(toPence(110_000));
  });
});

describe('commission on cost — how the existing workbook does it', () => {
  it('computes commission as a percentage of forecast cost', () => {
    const fx = fenwickAndHale();
    const onCost = rollupProject(
      { ...fx, commissions: [{ ...fx.commissions[0], basis: 'percent_of_cost' as const, ratePercent: 10 }] },
      AT, 1,
    );
    // 10% of the 88,790 forecast cost
    expect(onCost.commissionTotal).toBe(toPence(8_879));
  });
});

// ---------------------------------------------------------------------------
// A budget that was never recorded
// ---------------------------------------------------------------------------

describe('unknown budget cost', () => {
  const v = (budgetCost: number | null, clientPrice: number) => ({
    quantity: null,
    unitCost: null,
    unitPrice: null,
    percentageRate: null,
    budgetCost: budgetCost === null ? null : toPence(budgetCost),
    clientPrice: toPence(clientPrice),
  });

  function project(items: ReturnType<typeof makeItem>[], transactions = []) {
    return rollupProject(
      {
        costItems: items,
        commitments: [],
        transactions,
        subEvents: [makeSubEvent('se_main', 'Wedding Day', 'a0', true)],
        commissions: [],
      },
      AT,
      1,
    );
  }

  it('forecasts from spend and commitment when there is no budget to beat', () => {
    const item = makeItem({
      id: 'ci_x',
      description: 'Imported line',
      status: 'in_progress',
      original: v(null, 20_000),
      approved: v(null, 20_000),
      draft: v(null, 20_000),
    });
    const r = forecastCostItem(item, [makeCommitment('c_x', 'ci_x', 9_000, 'accepted')], []);
    expect(r.forecastCost).toBe(toPence(9_000));
  });

  it('never reports a line without a budget as over or under it', () => {
    const item = makeItem({
      id: 'ci_x',
      description: 'Imported line',
      status: 'completed',
      original: v(null, 20_000),
      approved: v(null, 20_000),
      draft: v(null, 20_000),
    });
    const rollup = project([item], [makeTransaction('t_x', 'ci_x', 14_000, null)] as never);
    expect(rollup.linesOverBudget).toBe(0);
    expect(rollup.linesWithoutBudget).toBe(1);
    expect(rollup.budgetCostKnown).toBe(false);
  });

  it('still reports real cost and real profit', () => {
    const item = makeItem({
      id: 'ci_x',
      description: 'Imported line',
      status: 'completed',
      original: v(null, 20_000),
      approved: v(null, 20_000),
      draft: v(null, 20_000),
    });
    const rollup = project([item], [makeTransaction('t_x', 'ci_x', 14_000, null)] as never);
    expect(rollup.forecastCost).toBe(toPence(14_000));
    expect(rollup.currentAgreedClientRevenue).toBe(toPence(20_000));
    expect(rollup.forecastProfit).toBe(toPence(6_000));
  });

  it('marks the whole rollup unmeasurable if even one line is missing a budget', () => {
    const known = makeItem({
      id: 'ci_a',
      description: 'Typed here',
      status: 'planned',
      original: v(5_000, 8_000),
      approved: v(5_000, 8_000),
      draft: v(5_000, 8_000),
    });
    const unknown = makeItem({
      id: 'ci_b',
      description: 'Imported',
      status: 'planned',
      original: v(null, 4_000),
      approved: v(null, 4_000),
      draft: v(null, 4_000),
    });
    const rollup = project([known, unknown]);
    expect(rollup.budgetCostKnown).toBe(false);
    // The known budget is still totalled — it is simply not the whole picture.
    expect(rollup.budgetCost).toBe(toPence(5_000));
    expect(rollup.linesWithoutBudget).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Contingency on approved extras — a project setting
// ---------------------------------------------------------------------------

describe('applyContingencyToApprovedExtras', () => {
  const v = (budgetCost: number, clientPrice: number) => ({
    quantity: null,
    unitCost: null,
    unitPrice: null,
    percentageRate: null,
    budgetCost: toPence(budgetCost),
    clientPrice: toPence(clientPrice),
  });
  const pv = (rate: number) => ({
    quantity: null,
    unitCost: null,
    unitPrice: null,
    percentageRate: rate,
    budgetCost: 0,
    clientPrice: 0,
  });

  const items = [
    makeItem({
      id: 'ci_core',
      description: 'Original scope',
      status: 'planned',
      original: v(60_000, 100_000),
      approved: v(60_000, 100_000),
      draft: v(60_000, 100_000),
    }),
    makeItem({
      id: 'ci_extra',
      description: 'Agreed extra',
      status: 'planned',
      origin: 'extra',
      extraStatus: 'approved',
      approved: v(12_000, 20_000),
      draft: v(12_000, 20_000),
    }),
    {
      ...makeItem({
        id: 'ci_cont',
        description: 'Contingency',
        status: 'planned',
        original: pv(10),
        approved: pv(10),
        draft: pv(10),
      }),
      mode: 'percentage' as const,
    },
  ];

  function run(applyContingencyToApprovedExtras: boolean) {
    return rollupProject(
      {
        costItems: items,
        commitments: [],
        transactions: [],
        subEvents: [makeSubEvent('se_main', 'Wedding Day', 'a0', true)],
        commissions: [],
        settings: { applyContingencyToApprovedExtras },
      },
      AT,
      1,
    );
  }

  it('defaults to excluding approved extras from the base', () => {
    // 10% of the £100,000 original scope only.
    expect(run(false).currentAgreedClientRevenue).toBe(toPence(130_000));
  });

  it('includes them when the project is set up that way', () => {
    // 10% of £120,000.
    expect(run(true).currentAgreedClientRevenue).toBe(toPence(132_000));
  });

  it('uses the default when a project carries no settings', () => {
    const withoutSettings = rollupProject(
      {
        costItems: items,
        commitments: [],
        transactions: [],
        subEvents: [makeSubEvent('se_main', 'Wedding Day', 'a0', true)],
        commissions: [],
      },
      AT,
      1,
    );
    expect(withoutSettings.currentAgreedClientRevenue).toBe(toPence(130_000));
  });
});
