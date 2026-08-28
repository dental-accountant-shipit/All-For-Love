'use client';

import { useEffect, useState } from 'react';

import ProjectScreen from '../../../components/ProjectScreen';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { firestore } from '../../../lib/firestore/client';
import { watchCostItems } from '../../../lib/firestore/budget';
import {
  abandonDraft,
  approveVersion,
  diffAgainstApproved,
  diffTotals,
  getVersionLines,
  recordClientApproval,
  startRevision,
  watchVersions,
  type DiffLine,
} from '../../../lib/firestore/versions';
import { withdrawApproval } from '../../../lib/projects/deleteProject';
import { canWithdrawApproval, describeWithdrawal } from '../../../domain/approvalWithdrawal';
import { formatGBP } from '../../../domain/money';
import type { BudgetVersion, CostItem, Project } from '../../../domain/types';
import { colour, type as typeToken } from '../../../design/tokens';

export default function VersionsPage() {
  return <ProjectScreen>{(project) => <Versions project={project} />}</ProjectScreen>;
}

function Versions({ project }: { project: Project }) {
  const { user, can } = useAuth();
  const db = firestore();

  const [versions, setVersions] = useState<BudgetVersion[] | null>(null);
  const [items, setItems] = useState<CostItem[]>([]);
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  useEffect(() => watchVersions(db, project.id, setVersions), [db, project.id]);
  useEffect(() => watchCostItems(db, project.id, setItems), [db, project.id]);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!project.openDraftVersionId || !project.currentApprovedVersionId) {
        setDiff(null);
        return;
      }
      const lines = await getVersionLines(db, project.id, project.currentApprovedVersionId);
      if (live) setDiff(diffAgainstApproved(items, lines));
    })();
    return () => {
      live = false;
    };
  }, [db, project.id, project.openDraftVersionId, project.currentApprovedVersionId, items]);

  if (!versions || !user) return <p style={{ color: colour.muted }}>Loading versions…</p>;

  const draft = versions.find((v) => v.status === 'draft') ?? null;

  async function guard(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(
        /not-found|internal|unavailable|functions/i.test(text)
          ? 'Approval runs in a Cloud Function, which needs the Blaze plan. ' +
              'Budgets can be built and edited until then, but not approved.'
          : text,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={bar}>
        <span style={{ ...hint, marginRight: 'auto' }}>
          {draft
            ? `Draft v${draft.versionNo} open`
            : project.currentApprovedVersionId
              ? 'No open draft'
              : 'Not yet approved'}
        </span>

        {can('startRevision') && !draft ? (
          <button
            type="button"
            style={btn}
            disabled={busy}
            onClick={() =>
              guard(async () => {
                await startRevision(db, user.uid, project.id);
              })
            }
          >
            Start a revision
          </button>
        ) : null}

        {/*
          Only offered once there is an approved version to fall back to.
          On a budget that has never been approved there is nothing to abandon
          TO: the lines stay put and all that goes is the draft record, which
          leaves a project that cannot be approved until somebody works out
          that a revision has to be started from nothing.
        */}
        {draft && can('startRevision') && project.currentApprovedVersionId ? (
          <button
            type="button"
            style={btn}
            disabled={busy}
            onClick={() =>
              guard(async () => {
                if (!window.confirm('Abandon this draft and restore the approved values?')) return;
                await abandonDraft(db, user.uid, project.id, draft.id);
              })
            }
          >
            Abandon draft
          </button>
        ) : null}

        {draft && can('approveBudget') ? (
          <button
            type="button"
            style={{ ...btn, background: colour.ink, color: colour.paper, border: 'none' }}
            disabled={busy}
            onClick={() =>
              guard(async () => {
                const note = window.prompt('Note for this approval (optional)') ?? null;
                const { versionNo } = await approveVersion(project.id, draft.id, note);
                setMessage(`Version ${versionNo} approved.`);
              })
            }
          >
            Approve v{draft.versionNo}
          </button>
        ) : null}
      </div>

      {message ? <p style={warn}>{message}</p> : null}

      {can('withdrawApproval') && project.currentApprovedVersionId ? (
        <Withdraw
          project={project}
          versions={versions}
          open={withdrawing}
          busy={busy}
          onOpen={() => {
            setMessage(null);
            setWithdrawing(true);
          }}
          onClose={() => setWithdrawing(false)}
          onConfirm={(versionId) =>
            guard(async () => {
              const { nowApprovedVersionNo } = await withdrawApproval(project.id, versionId);
              setWithdrawing(false);
              setMessage(
                nowApprovedVersionNo === null
                  ? 'The approval was withdrawn. This project has no approved budget now.'
                  : `The approval was withdrawn. Version ${nowApprovedVersionNo} is the approved budget again.`,
              );
            })
          }
        />
      ) : null}

      {diff && diff.length > 0 ? <Diff lines={diff} /> : null}

      <h2 style={h2}>History</h2>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Version</th>
            <th style={th}>Status</th>
            <th style={th}>Approved</th>
            <th style={{ ...th, textAlign: 'right' }}>Budget cost</th>
            <th style={{ ...th, textAlign: 'right' }}>Client price</th>
            <th style={th}>Client</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id}>
              <td style={td}>
                v{v.versionNo}
                {v.import ? (
                  <em style={imported}>
                    {' '}
                    imported · {v.import.originalVersionRef ?? '—'} · {v.import.sourceFilename}
                  </em>
                ) : null}
              </td>
              <td style={td}>{v.status}</td>
              <td style={td}>{v.approvedAt ? v.approvedAt.slice(0, 10) : '—'}</td>
              {/* A version written without its totals is a data fault, not a
                  reason to take the whole application down with an unhandled
                  exception. It happened: the workbook import left the field
                  out entirely and this screen went white. Say "unavailable"
                  and let somebody see the rest of the history. */}
              <td style={num}>
                {v.totals ? formatGBP(v.totals.budgetCost) : <em style={missing}>unavailable</em>}
              </td>
              <td style={num}>
                {v.totals ? formatGBP(v.totals.clientPrice) : <em style={missing}>unavailable</em>}
              </td>
              <td style={td}>
                <ClientApproval
                  version={v}
                  canEdit={can('recordClientApproval')}
                  onRecord={(approval) =>
                    guard(async () => {
                      await recordClientApproval(db, user.uid, project.id, v.id, approval);
                    })
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ ...hint, marginTop: 20, maxWidth: '64ch' }}>
        Nobody can <em>edit</em> an approved version — not a director, not an owner, not
        through any screen. An owner can take the most recent approval back, which
        deletes that version and makes the one before it current again; it is recorded
        in the project&rsquo;s history and it never changes the budget you are working
        on.
      </p>
    </>
  );
}

/**
 * Taking the most recent approval back.
 *
 * Below the buttons people press every week rather than beside them, because
 * this is the only control on the screen that removes something. It says what
 * will happen in terms of version numbers — &ldquo;v3 goes, v2 is current
 * again&rdquo; — which is what somebody needs in order to know whether it is
 * what they meant.
 */
function Withdraw({
  project,
  versions,
  open,
  busy,
  onOpen,
  onClose,
  onConfirm,
}: {
  project: Project;
  versions: BudgetVersion[];
  open: boolean;
  busy: boolean;
  onOpen: () => void;
  onClose: () => void;
  onConfirm: (versionId: string) => void;
}) {
  const versionId = project.currentApprovedVersionId!;
  const decision = canWithdrawApproval(
    versions,
    {
      currentApprovedVersionId: project.currentApprovedVersionId ?? null,
      openDraftVersionId: project.openDraftVersionId ?? null,
    },
    versionId,
  );

  if (!open) {
    const current = versions.find((v) => v.id === versionId);
    return (
      <p style={{ marginTop: 6, marginBottom: 18 }}>
        <button type="button" style={quietLink} onClick={onOpen} disabled={busy}>
          Undo the approval of v{current?.versionNo ?? '?'}
        </button>
      </p>
    );
  }

  return (
    <section style={withdrawPanel}>
      {decision.allowed ? (
        <>
          <p style={{ margin: '0 0 12px', fontSize: 14 }}>{describeWithdrawal(decision)}</p>
          <p style={{ ...hint, margin: '0 0 16px', maxWidth: '62ch' }}>
            Recorded in the project&rsquo;s history, with what the version totalled and who
            approved it, so the fact that it happened survives the version itself.
          </p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              type="button"
              style={destructive}
              disabled={busy}
              onClick={() => onConfirm(versionId)}
            >
              {busy ? 'Withdrawing…' : `Withdraw v${decision.version.versionNo}`}
            </button>
            <button type="button" style={quietLink} onClick={onClose} disabled={busy}>
              Leave it approved
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 12px', fontSize: 14 }}>{decision.reason}</p>
          <button type="button" style={quietLink} onClick={onClose}>
            Close
          </button>
        </>
      )}
    </section>
  );
}

function ClientApproval({
  version,
  canEdit,
  onRecord,
}: {
  version: BudgetVersion;
  canEdit: boolean;
  onRecord: (approval: Partial<BudgetVersion['clientApproval']>) => void;
}) {
  const a = version.clientApproval;
  const label =
    a.status === 'approved'
      ? `Approved${a.decidedAt ? ` ${a.decidedAt.slice(0, 10)}` : ''}`
      : a.status === 'rejected'
        ? 'Rejected'
        : a.status === 'sent'
          ? 'Sent, awaiting reply'
          : 'Not sent';

  if (!canEdit) return <span style={hint}>{label}</span>;

  return (
    <span style={hint}>
      {label}{' '}
      <select
        value={a.status}
        style={{ ...select, marginLeft: 6 }}
        onChange={(e) => {
          const status = e.target.value as BudgetVersion['clientApproval']['status'];
          const reference =
            status === 'approved' || status === 'rejected'
              ? (window.prompt('Evidence — email subject, PDF name, or how it was agreed') ?? null)
              : null;
          onRecord({
            ...a,
            status,
            sentAt: status === 'sent' ? new Date().toISOString() : a.sentAt,
            decidedAt:
              status === 'approved' || status === 'rejected'
                ? new Date().toISOString()
                : null,
            method: reference ? 'email' : a.method,
            reference: reference ?? a.reference,
          });
        }}
      >
        <option value="not_sent">Not sent</option>
        <option value="sent">Sent</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
      </select>
    </span>
  );
}

function Diff({ lines }: { lines: DiffLine[] }) {
  const moved = lines.filter((l) => l.kind !== 'unchanged');
  const totals = diffTotals(lines);

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={h2}>What this revision changes</h2>
      <p style={hint}>
        {totals.added} added · {totals.changed} changed · {totals.removed} removed ·
        client price {totals.priceMovement >= 0 ? '+' : '−'}
        {formatGBP(Math.abs(totals.priceMovement))} · budget cost{' '}
        {totals.budgetMovementKnown
          ? `${totals.budgetMovement >= 0 ? '+' : '−'}${formatGBP(Math.abs(totals.budgetMovement))}`
          : 'unavailable'}
      </p>
      {moved.length === 0 ? (
        <p style={hint}>Nothing has changed yet.</p>
      ) : (
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Line</th>
              <th style={th}>Change</th>
              <th style={{ ...th, textAlign: 'right' }}>Budget cost</th>
              <th style={{ ...th, textAlign: 'right' }}>Client price</th>
            </tr>
          </thead>
          <tbody>
            {moved.map((l) => (
              <tr key={l.costItemId}>
                <td style={td}>{l.description || <em style={hint}>(untitled)</em>}</td>
                <td style={td}>{l.kind}</td>
                <td style={num}>
                  {l.budgetDelta === null
                    ? '—'
                    : `${l.budgetDelta >= 0 ? '+' : '−'}${formatGBP(Math.abs(l.budgetDelta))}`}
                </td>
                <td style={num}>
                  {l.priceDelta >= 0 ? '+' : '−'}
                  {formatGBP(Math.abs(l.priceDelta))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const bar: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 16 };
const missing: React.CSSProperties = { fontStyle: 'normal', color: colour.muted };
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
const th: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: colour.muted,
  padding: 8,
  borderBottom: `1px solid ${colour.ruleStrong}`,
};
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: `1px solid ${colour.rule}` };
const num: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
const hint: React.CSSProperties = { fontSize: 12, color: colour.muted };
const imported: React.CSSProperties = { fontSize: 11, color: colour.signature, fontStyle: 'normal' };
const warn: React.CSSProperties = {
  fontSize: 13,
  color: colour.ink,
  background: colour.blush,
  padding: '10px 12px',
  maxWidth: '68ch',
};
const select: React.CSSProperties = { font: 'inherit', fontSize: 12 };
const btn: React.CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  fontWeight: 600,
  padding: '6px 12px',
  background: 'transparent',
  color: colour.ink,
  border: `1px solid ${colour.rule}`,
  borderRadius: 2,
  cursor: 'pointer',
};

// Quiet enough to sit below the weekly buttons without competing with them.
const quietLink: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  fontSize: 12,
  color: colour.muted,
  textDecoration: 'underline',
  cursor: 'pointer',
};

const withdrawPanel: React.CSSProperties = {
  margin: '6px 0 20px',
  padding: '16px 18px',
  border: `1px solid ${colour.rule}`,
  // The same red rule down the edge as the import undo and the project delete.
  // Anything that removes something is marked the same way, and never with a
  // red fill, because inside a data region red already means over budget.
  borderLeft: `3px solid ${colour.signature}`,
  maxWidth: '70ch',
};

const destructive: React.CSSProperties = {
  ...btn,
  borderLeft: `3px solid ${colour.signature}`,
};
