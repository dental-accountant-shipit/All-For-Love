'use client';

/**
 * Admin Import.
 *
 * Loading a finished project out of a spreadsheet, in four steps, with the
 * numbers on screen before anything is written.
 *
 * The shape of this screen is an argument about trust. An import that just says
 * "Imported 312 lines" has told nobody anything: the figures it produced could
 * be wrong by £36,820 and look exactly the same. So the last step before the
 * button is a full financial position, side by side with what the workbook
 * itself claims, with every difference named. If the two disagree, that is
 * information — usually about the workbook — and it belongs in front of a human
 * rather than in a log.
 */

import { useMemo, useState } from 'react';

import { useAuth } from '../../../lib/auth/AuthProvider';
import { loadWorkbook, detectSections, type LoadedWorkbook } from '../../../lib/import/readWorkbook';
import { ImportUnavailableError, runImport, type ImportResult } from '../../../lib/import/runImport';
import {
  buildPlan,
  validatePlan,
  type ImportPlan,
  type PlanSection,
} from '../../../domain/import/plan';
import { formatGBP } from '../../../domain/money';
import { colour, type as typeToken } from '../../../design/tokens';

export default function AdminImportPage() {
  const { user, can } = useAuth();

  const [workbook, setWorkbook] = useState<LoadedWorkbook | null>(null);
  const [filename, setFilename] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [sections, setSections] = useState<PlanSection[]>([]);
  const [totalsRow, setTotalsRow] = useState<number | null>(null);
  const [projectName, setProjectName] = useState('');
  const [clientName, setClientName] = useState('');
  const [versionRef, setVersionRef] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const plan = useMemo<ImportPlan | null>(() => {
    if (!workbook || !sheetName || sections.length === 0) return null;
    try {
      return buildPlan(workbook.sheet(sheetName), sections, {
        projectName,
        clientName,
        sourceFilename: filename,
        originalVersionRef: versionRef.trim() || null,
        totalsRow,
      });
    } catch {
      return null;
    }
  }, [workbook, sheetName, sections, projectName, clientName, filename, versionRef, totalsRow]);

  const problems = plan ? validatePlan(plan) : [];

  if (!user) return null;
  if (!can('adminImport')) {
    return (
      <p style={prose}>
        Historical import is restricted to the administrator role. It is a separate role on
        purpose — it can load old projects and nothing else, and no other role can reach this
        screen.
      </p>
    );
  }

  async function chooseFile(file: File) {
    setError(null);
    setResult(null);
    setBusy('Reading the workbook…');
    try {
      const loaded = await loadWorkbook(await file.arrayBuffer());
      setWorkbook(loaded);
      setFilename(file.name);
      setProjectName((current) => current || file.name.replace(/\.[^.]+$/, ''));
      const first = loaded.sheetNames[0] ?? '';
      selectSheet(loaded, first);
    } catch {
      setError('That file could not be read as a workbook. It needs to be .xlsx or .xlsm.');
    } finally {
      setBusy(null);
    }
  }

  function selectSheet(loaded: LoadedWorkbook, name: string) {
    setSheetName(name);
    if (!name) return;
    const detected = detectSections(loaded.sheet(name));
    setSections(detected.sections);
    setTotalsRow(detected.totalsRow);
  }

  const updateSection = (index: number, patch: Partial<PlanSection>) =>
    setSections((all) => all.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  async function submit() {
    if (!plan) return;
    setBusy('Writing…');
    setError(null);
    try {
      setResult(await runImport(plan));
    } catch (e) {
      setError(
        e instanceof ImportUnavailableError ? e.message : (e as Error).message,
      );
    } finally {
      setBusy(null);
    }
  }

  if (result) {
    return (
      <>
        <h1 style={h1}>Imported</h1>
        <p style={prose}>
          <strong>{plan?.projectName}</strong> is in the system: {result.counts.costItems} budget
          lines across {result.counts.categories} categories, with {result.counts.transactions}{' '}
          recorded costs.
        </p>
        <p style={prose}>
          Its budgeted costs read as unavailable rather than as zero, because the workbook never
          recorded any. Actual cost and profitability are real.
        </p>
        <p style={hint}>Import reference {result.importBatchId}</p>
        <p style={{ marginTop: 24 }}>
          <a href="./projects.html" style={link}>
            Open the projects list
          </a>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 style={h1}>Import a past project</h1>
      <p style={{ ...prose, maxWidth: '64ch' }}>
        For loading finished events out of the old workbooks. Everything is shown before anything
        is written, and the whole run can be undone afterwards.
      </p>

      <Step n={1} title="Choose the workbook">
        <input
          type="file"
          accept=".xlsx,.xlsm"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void chooseFile(file);
          }}
          style={{ font: 'inherit', fontSize: 13 }}
        />
        {filename ? <p style={hint}>{filename}</p> : null}
      </Step>

      {workbook ? (
        <Step n={2} title="Choose the sheet">
          <select
            value={sheetName}
            onChange={(e) => selectSheet(workbook, e.target.value)}
            style={input}
          >
            {workbook.sheetNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Step>
      ) : null}

      {workbook && sheetName ? (
        <Step n={3} title="Check the categories">
          <p style={{ ...hint, maxWidth: '62ch', marginBottom: 12 }}>
            These were guessed from the sheet&rsquo;s layout, so they are worth a look. The row
            numbers are the first and last budget line in each category — not the heading.
            &ldquo;In contingency&rdquo; decides whether a category counts towards the contingency
            percentage; it is stored on the category, so renaming one later changes nothing.
          </p>

          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Category</th>
                <th style={{ ...th, ...numeric }}>From</th>
                <th style={{ ...th, ...numeric }}>To</th>
                <th style={th}>Kind</th>
                <th style={th}>In contingency</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {sections.map((section, index) => (
                <tr key={`${section.headerRow}_${index}`}>
                  <td style={td}>
                    <input
                      value={section.name}
                      onChange={(e) => updateSection(index, { name: e.target.value })}
                      style={{ ...input, width: '100%' }}
                    />
                  </td>
                  <td style={{ ...td, ...numeric }}>
                    <input
                      type="number"
                      value={section.firstRow}
                      onChange={(e) => updateSection(index, { firstRow: Number(e.target.value) })}
                      style={{ ...input, width: 64 }}
                    />
                  </td>
                  <td style={{ ...td, ...numeric }}>
                    <input
                      type="number"
                      value={section.lastRow}
                      onChange={(e) => updateSection(index, { lastRow: Number(e.target.value) })}
                      style={{ ...input, width: 64 }}
                    />
                  </td>
                  <td style={td}>
                    <select
                      value={section.isContingency ? 'contingency' : section.isExtras ? 'extras' : 'normal'}
                      onChange={(e) =>
                        updateSection(index, {
                          isContingency: e.target.value === 'contingency',
                          isExtras: e.target.value === 'extras',
                        })
                      }
                      style={input}
                    >
                      <option value="normal">Budget lines</option>
                      <option value="extras">Optional extras</option>
                      <option value="contingency">Contingency %</option>
                    </select>
                  </td>
                  <td style={td}>
                    <input
                      type="checkbox"
                      checked={section.includeInContingencyBase !== false}
                      disabled={section.isContingency === true}
                      onChange={(e) =>
                        updateSection(index, { includeInContingencyBase: e.target.checked })
                      }
                    />
                  </td>
                  <td style={td}>
                    <button
                      type="button"
                      style={linkBtn}
                      onClick={() => setSections((all) => all.filter((_, i) => i !== index))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Step>
      ) : null}

      {plan ? (
        <Step n={4} title="Check the figures">
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 20 }}>
            <label style={field}>
              <span style={hint}>Project name</span>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                style={input}
              />
            </label>
            <label style={field}>
              <span style={hint}>Client</span>
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                style={input}
              />
            </label>
            <label style={field}>
              <span style={hint}>Workbook version</span>
              <input
                value={versionRef}
                onChange={(e) => setVersionRef(e.target.value)}
                placeholder="v14"
                style={input}
              />
            </label>
          </div>

          <Figures plan={plan} />
          <Differences plan={plan} />
          <Warnings plan={plan} />

          {problems.length > 0 ? (
            <ul style={{ ...prose, color: colour.signature }}>
              {problems.map((p) => (
                <li key={p.field + p.message}>{p.message}</li>
              ))}
            </ul>
          ) : null}

          <button
            type="button"
            style={{ ...primaryBtn, marginTop: 16 }}
            disabled={problems.length > 0 || busy !== null}
            onClick={() => void submit()}
          >
            {busy ?? `Import ${plan.lines.length} lines`}
          </button>
        </Step>
      ) : null}

      {error ? (
        <p style={{ ...prose, color: colour.signature, maxWidth: '62ch' }}>{error}</p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

function Figures({ plan }: { plan: ImportPlan }) {
  const t = plan.totals;
  return (
    <table style={{ ...table, maxWidth: 560 }}>
      <tbody>
        <Row label="Priced lines" value={t.pricedOriginal} />
        <Row label="Contingency" value={t.contingency} />
        <Row label="Client revenue ex VAT" value={t.agreedRevenue} strong />
        <Row label="Actual cost ex VAT" value={t.actualCost} />
        <Row label="Profit" value={t.agreedProfit} strong />
        <tr>
          <td style={td}>Budget cost</td>
          <td style={{ ...td, ...numeric, color: colour.muted }}>Not recorded</td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * The comparison that makes the import worth trusting.
 *
 * Every line here is a place where the recalculated position and the workbook's
 * own displayed figure disagree. Silence would be the dangerous outcome: a
 * workbook that undercounts its cost by £36,820 looks identical to one that
 * does not, right up until somebody reports a margin.
 */
function Differences({ plan }: { plan: ImportPlan }) {
  const rows: Array<{ label: string; note: string }> = [];
  const w = plan.workbookTotals;
  const t = plan.totals;

  if (w.eventTotalExVat !== 0 && w.eventTotalExVat !== t.agreedRevenue) {
    rows.push({
      label: 'Client revenue',
      note: `The workbook shows ${formatGBP(w.eventTotalExVat)}; recalculated, it is ${formatGBP(t.agreedRevenue)}.`,
    });
  }
  if (w.costColumnSum !== 0 && w.costColumnSum !== t.actualCost) {
    rows.push({
      label: 'Cost',
      note:
        `The workbook's cost column adds up to ${formatGBP(w.costColumnSum)}, but that sums ` +
        `unit costs without their quantities. Costed properly it is ${formatGBP(t.actualCost)} — ` +
        `a difference of ${formatGBP(t.actualCost - w.costColumnSum)}.`,
    });
  }
  if (t.proposedExtrasRevenue !== 0) {
    rows.push({
      label: 'Optional extras',
      note:
        `${plan.totals.extraCount} extras worth ${formatGBP(t.proposedExtrasRevenue)} sit outside ` +
        `the workbook's own total, so nothing says the client was charged. They import as ` +
        `Proposed and stay out of revenue. ` +
        (t.proposedExtrasActualCost !== 0
          ? `${formatGBP(t.proposedExtrasActualCost)} was already spent on them; if they are never ` +
            `confirmed, that is the loss.`
          : ''),
    });
  }

  if (rows.length === 0) return null;

  return (
    <div style={{ ...panel, marginTop: 20 }}>
      <h3 style={h3}>Where this differs from the workbook</h3>
      {rows.map((r) => (
        <p key={r.label} style={{ ...prose, maxWidth: '64ch' }}>
          <strong>{r.label}.</strong> {r.note}
        </p>
      ))}
      <p style={{ ...hint, maxWidth: '64ch' }}>
        None of this changes the spreadsheet. It is reported so the difference is a decision
        rather than a surprise.
      </p>
    </div>
  );
}

function Warnings({ plan }: { plan: ImportPlan }) {
  const [open, setOpen] = useState(false);
  if (plan.warnings.length === 0) return null;
  return (
    <div style={{ marginTop: 20 }}>
      <button type="button" style={linkBtn} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'Show'} {plan.warnings.length} things worth a look
      </button>
      {open ? (
        <ul style={{ ...prose, maxWidth: '70ch' }}>
          {plan.warnings.map((w, i) => (
            <li key={`${w.sourceRow}_${i}`} style={{ marginBottom: 4 }}>
              {w.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <tr>
      <td style={{ ...td, fontWeight: strong ? 600 : 400 }}>{label}</td>
      <td style={{ ...td, ...numeric, fontWeight: strong ? 600 : 400 }}>{formatGBP(value)}</td>
    </tr>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={h2}>
        <span style={{ color: colour.signature, marginRight: 10 }}>{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------

const h1: React.CSSProperties = {
  fontFamily: typeToken.serif,
  fontSize: 32,
  fontWeight: 400,
  lineHeight: 1.1,
  margin: '0 0 10px',
};
const h2: React.CSSProperties = {
  fontFamily: typeToken.serif,
  fontSize: 19,
  fontWeight: 400,
  margin: '0 0 12px',
};
const h3: React.CSSProperties = { fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px' };
const prose: React.CSSProperties = { fontSize: 14, lineHeight: 1.55, margin: '0 0 10px' };
const hint: React.CSSProperties = { fontSize: 12, color: colour.muted };
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const input: React.CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  padding: '5px 7px',
  border: `1px solid ${colour.rule}`,
  borderRadius: 2,
};
const table: React.CSSProperties = { borderCollapse: 'collapse', fontSize: 13, width: '100%' };
const th: React.CSSProperties = {
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: colour.muted,
  padding: '4px 8px 8px 0',
  borderBottom: `1px solid ${colour.rule}`,
};
const td: React.CSSProperties = { padding: '5px 8px 5px 0', borderBottom: `1px solid ${colour.rule}` };
const numeric: React.CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};
const panel: React.CSSProperties = {
  border: `1px solid ${colour.rule}`,
  borderRadius: 2,
  padding: '16px 18px',
  background: colour.ground,
};
const primaryBtn: React.CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  fontWeight: 600,
  padding: '10px 20px',
  background: colour.ink,
  color: colour.paper,
  border: `1px solid ${colour.ink}`,
  borderRadius: 2,
  cursor: 'pointer',
};
const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  fontSize: 13,
  color: colour.signature,
  cursor: 'pointer',
  textDecoration: 'underline',
};
const link: React.CSSProperties = { color: colour.signature };
