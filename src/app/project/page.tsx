'use client';

import { useEffect, useState } from 'react';

import FigureStrip from '../../components/FigureStrip';
import ProjectScreen from '../../components/ProjectScreen';
import { useAuth } from '../../lib/auth/AuthProvider';
import { firestore } from '../../lib/firestore/client';
import { watchProjectRollup } from '../../lib/firestore/liveRollup';
import { formatGBP, formatPercent } from '../../domain/money';
import type { Project, ProjectRollup } from '../../domain/types';
import { colour, type as typeToken } from '../../design/tokens';
import { tableCell, tableHead } from '../../design/ui';

export default function ProjectOverviewPage() {
  return <ProjectScreen>{(project) => <Overview project={project} />}</ProjectScreen>;
}

function Overview({ project }: { project: Project }) {
  const { can } = useAuth();
  const [rollup, setRollup] = useState<ProjectRollup | null>(null);

  useEffect(() => {
    // Computed live from the underlying documents, so the figures move the
    // moment a cell changes rather than after a function round-trip. The same
    // pure engine runs server-side once Blaze is enabled.
    return watchProjectRollup(firestore(), project.id, setRollup);
  }, [project.id]);

  if (!rollup) return <p style={{ color: colour.muted }}>Calculating…</p>;

  const budgetAvailable = rollup.budgetCostKnown;

  return (
    <>
      <FigureStrip
        figures={[
          {
            label: 'Agreed client revenue',
            value: formatGBP(rollup.currentAgreedClientRevenue),
          },
          { label: 'Forecast final cost', value: formatGBP(rollup.forecastCost) },
          // Forecast Profit is never typed and never stored: it is agreed
          // revenue minus forecast cost, worked out every time it is shown.
          ...(can('viewProfit')
            ? [
                {
                  label: 'Forecast profit',
                  value: formatGBP(rollup.forecastProfit),
                  tone: 'signed' as const,
                  negative: rollup.forecastProfit < 0,
                  note: formatPercent(rollup.forecastMargin),
                },
              ]
            : []),
        ]}
      />

      <section style={block}>
        <h2 style={h2}>Budget, committed, actual, forecast</h2>
        <table style={table}>
          <tbody>
            <Row
              label="Approved budget"
              value={budgetAvailable ? formatGBP(rollup.budgetCost) : 'Unavailable'}
              note={
                budgetAvailable
                  ? undefined
                  : `${rollup.linesWithoutBudget} imported ${
                      rollup.linesWithoutBudget === 1 ? 'line has' : 'lines have'
                    } no recorded budget`
              }
            />
            <Row label="Supplier committed" value={formatGBP(rollup.committedTotal)} />
            <Row label="Still to be invoiced" value={formatGBP(rollup.committedRemaining)} />
            <Row label="Actual cost to date" value={formatGBP(rollup.actualTotal)} />
            <Row label="Forecast final cost" value={formatGBP(rollup.forecastCost)} />
            <Row
              label="Lines forecasting over budget"
              value={budgetAvailable ? String(rollup.linesOverBudget) : 'Unavailable'}
            />
          </tbody>
        </table>
        {!budgetAvailable ? (
          <p style={note}>
            This project was imported from a workbook that recorded a client price and an
            actual cost but no budgeted cost. Budget versus actual is therefore
            unavailable — not zero. Cost and profitability above are real.
          </p>
        ) : null}
      </section>

      {project.subEventMode === 'multiple' ? (
        <section style={block}>
          <h2 style={h2}>By sub-event</h2>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Sub-event</th>
                <th style={{ ...th, textAlign: 'right' }}>Revenue</th>
                <th style={{ ...th, textAlign: 'right' }}>Forecast cost</th>
                {can('viewProfit') ? (
                  <>
                    <th style={{ ...th, textAlign: 'right' }}>Profit</th>
                    <th style={{ ...th, textAlign: 'right' }}>Margin</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rollup.subEvents.map((se) => (
                <tr key={se.subEventId}>
                  <td style={td}>{se.name}</td>
                  <td style={num}>{formatGBP(se.currentAgreedClientRevenue)}</td>
                  <td style={num}>{formatGBP(se.forecastCost)}</td>
                  {can('viewProfit') ? (
                    <>
                      <td style={num}>{formatGBP(se.forecastProfit)}</td>
                      <td style={num}>{formatPercent(se.forecastMargin)}</td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          <p style={note}>
            Sub-event profitability is stated before commission, which is a project-level
            obligation. Splitting it across days would be an invented number.
          </p>
        </section>
      ) : null}

      <section style={block}>
        <h2 style={h2}>Client revenue</h2>
        <table style={table}>
          <tbody>
            <Row label="Original approved client value" value={formatGBP(rollup.originalClientValue)} />
            <Row label="Approved extras and changes" value={`+ ${formatGBP(rollup.approvedExtras)}`} />
            <Row label="Agreed reductions" value={`− ${formatGBP(rollup.agreedReductions)}`} />
            <Row
              label="Current agreed client revenue"
              value={formatGBP(rollup.currentAgreedClientRevenue)}
              strong
            />
          </tbody>
        </table>
      </section>

      {rollup.proposedExtrasRevenue > 0 ? (
        <section style={block}>
          <h2 style={h2}>Proposed extras — not included above</h2>
          <table style={table}>
            <tbody>
              <Row label="Client value" value={formatGBP(rollup.proposedExtrasRevenue)} />
              <Row
                label="Cost"
                value={
                  rollup.proposedExtrasCostKnown
                    ? formatGBP(rollup.proposedExtrasCost)
                    : 'Not recorded'
                }
              />
              {can('viewProfit') ? (
                <Row
                  label="Potential profit"
                  value={
                    rollup.proposedExtrasCostKnown
                      ? formatGBP(rollup.proposedExtrasRevenue - rollup.proposedExtrasCost)
                      : 'Unavailable until a cost is recorded'
                  }
                />
              ) : null}
            </tbody>
          </table>
        </section>
      ) : null}

      {can('viewCommission') && rollup.commissionTotal > 0 ? (
        <section style={block}>
          <h2 style={h2}>Commission</h2>
          <table style={table}>
            <tbody>
              <Row label="Profit before commission" value={formatGBP(rollup.forecastProfit)} />
              <Row label="Commission" value={`− ${formatGBP(rollup.commissionTotal)}`} />
              <Row
                label="Net profit after commission"
                value={`${formatGBP(rollup.netProfitAfterCommission)} · ${formatPercent(
                  rollup.netMarginAfterCommission,
                )}`}
                strong
              />
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}

function Row({
  label,
  value,
  note: rowNote,
  strong,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
}) {
  return (
    <tr>
      <td
        style={{
          ...td,
          fontWeight: strong ? 600 : 400,
          // The line that answers the section sits under a black rule, the same
          // way a total does in the budget grid.
          ...(strong ? { borderTop: `1px solid ${colour.ink}`, borderBottom: 'none' } : null),
        }}
      >
        {label}
        {rowNote ? <em style={{ ...note, display: 'block', margin: 0 }}>{rowNote}</em> : null}
      </td>
      <td
        style={{
          ...num,
          fontWeight: strong ? 600 : 400,
          ...(strong ? { borderTop: `1px solid ${colour.ink}`, borderBottom: 'none' } : null),
        }}
      >
        {value}
      </td>
    </tr>
  );
}

const block: React.CSSProperties = { marginBottom: 40, maxWidth: 760 };

/**
 * Section headings on this screen are serif and quiet.
 *
 * They are labels on groups of figures, not announcements. The figures are the
 * loud part, and they are loud enough already.
 */
const h2: React.CSSProperties = {
  fontFamily: typeToken.serif,
  fontSize: 19,
  fontWeight: 400,
  margin: '0 0 12px',
};
const table: React.CSSProperties = {
  borderCollapse: 'collapse',
  width: '100%',
  fontSize: 14,
  fontVariantNumeric: 'tabular-nums',
};
const th: React.CSSProperties = tableHead;
const td: React.CSSProperties = { ...tableCell, height: 36, padding: '4px 10px 4px 0' };
const num: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
const note: React.CSSProperties = { fontSize: 12, color: colour.muted, maxWidth: '62ch' };
