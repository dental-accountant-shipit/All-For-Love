'use client';

/**
 * Every project, and a way to remove one.
 *
 * The Projects screen is for working: it shows revenue, forecast cost and
 * margin, because that is what somebody is there to find out. This one is for
 * housekeeping, so it shows the things that matter when deciding whether a
 * project should exist — when it was created, whether it came from a workbook,
 * whether anybody has recorded money against it — and nothing about
 * profitability at all.
 *
 * It exists because the first thing anybody needed to delete was one of two
 * imports of the same workbook, and finding the right one meant opening each in
 * turn. Side by side, with their dates and their line counts, the duplicate is
 * obvious.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import SettingsShell from '../../components/SettingsNav';
import EmptyState from '../../components/EmptyState';
import { useAuth } from '../../lib/auth/AuthProvider';
import { firestore } from '../../lib/firestore/client';
import { watchProjects } from '../../lib/firestore/projects';
import { deleteProject } from '../../lib/projects/deleteProject';
import { describeDeletion, hasRealWork, nameMatches } from '../../domain/projectDeletion';
import type { ProjectContents } from '../../domain/projectDeletion';
import { formatGBP } from '../../domain/money';
import type { Project } from '../../domain/types';
import { colour, radius, type as typeToken } from '../../design/tokens';
import { buttonQuiet, buttonSecondary, hint, input as inputStyle, tableCell, tableHead } from '../../design/ui';

export default function SettingsProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return watchProjects(firestore(), setProjects);
  }, [user]);

  return (
    <SettingsShell
      title="Projects"
      meta={
        projects
          ? `${projects.length} ${projects.length === 1 ? 'project' : 'projects'} · everything the system holds`
          : undefined
      }
    >
      {notice ? <p style={S.notice}>{notice}</p> : null}

      {!projects ? (
        <p style={hint}>Loading projects…</p>
      ) : projects.length === 0 ? (
        <EmptyState title="Nothing to look after yet">
          <p>Projects created on the Projects screen, or loaded from a workbook, appear here.</p>
        </EmptyState>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Project</th>
              <th style={S.th}>Client</th>
              <th style={S.th}>Created</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Recorded costs</th>
              <th style={S.th} />
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id}>
                <td style={S.td}>
                  <Link href={`/project?id=${project.id}`} style={S.link}>
                    {project.name}
                  </Link>
                  {project.import?.imported ? (
                    <em style={S.imported}>imported · {project.import.sourceFilename}</em>
                  ) : null}
                </td>
                <td style={{ ...S.td, color: colour.muted }}>{project.clientName || '—'}</td>
                <td style={{ ...S.td, color: colour.muted, whiteSpace: 'nowrap' }}>
                  {project.audit?.createdAt?.slice(0, 10) ?? '—'}
                </td>
                <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {formatGBP(project.rollup?.actualTotal ?? 0)}
                </td>
                <td style={{ ...S.td, textAlign: 'right' }}>
                  <button
                    type="button"
                    style={S.deleteLink}
                    onClick={() => {
                      setNotice(null);
                      setConfirming(confirming === project.id ? null : project.id);
                    }}
                  >
                    {confirming === project.id ? 'Cancel' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {confirming && projects ? (
        <ConfirmDelete
          project={projects.find((candidate) => candidate.id === confirming)!}
          onCancel={() => setConfirming(null)}
          onDeleted={(name) => {
            setConfirming(null);
            setNotice(`${name} has been deleted, along with everything in it.`);
          }}
        />
      ) : null}

      <p style={{ ...hint, marginTop: 24, maxWidth: '66ch' }}>
        Deleting a project takes its budget, every version of it, its recorded costs and its
        supplier commitments with it. Nothing else in this system deletes — suppliers are
        retired, cost lines are cancelled — and there is no undo. What was deleted, and by
        whom, is kept.
      </p>
    </SettingsShell>
  );
}

/**
 * The confirmation.
 *
 * It shows what is in the project rather than asking whether you are sure.
 * "Are you sure" is answered yes by everybody, always; "£306,322.97 of
 * recorded costs" is read.
 */
function ConfirmDelete({
  project,
  onCancel,
  onDeleted,
}: {
  project: Project;
  onCancel: () => void;
  onDeleted: (name: string) => void;
}) {
  const [counts, setCounts] = useState<{
    costItems: number;
    approvedVersions: number;
    unknown?: boolean;
  } | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLElement | null>(null);

  // The confirmation appears below the table. With twenty projects, pressing
  // Delete on the last row would otherwise put it off the bottom of the screen
  // and look as though nothing happened.
  useEffect(() => {
    panel.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [counts]);

  useEffect(() => {
    let cancelled = false;
    setCounts(null);
    setTyped('');
    setError(null);
    void (async () => {
      try {
        const { collection, getCountFromServer, query, where } = await import('firebase/firestore');
        const db = firestore();
        const [items, versions] = await Promise.all([
          getCountFromServer(collection(db, `projects/${project.id}/costItems`)),
          getCountFromServer(
            query(
              collection(db, `projects/${project.id}/budgetVersions`),
              where('status', 'in', ['approved', 'superseded']),
            ),
          ),
        ]);
        if (!cancelled) {
          setCounts({ costItems: items.data().count, approvedVersions: versions.data().count });
        }
      } catch {
        // Not knowing must not stop somebody clearing up a mistake — but it
        // must not make deleting EASIER than knowing. Zeroes would have said
        // "this project is empty" and waved the confirmation through on the
        // strength of a query that did not run.
        if (!cancelled) setCounts({ costItems: 0, approvedVersions: 0, unknown: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  if (!counts) return <p style={{ ...hint, marginTop: 20 }}>Working out what is in it…</p>;

  const contents: ProjectContents = {
    costItems: counts.costItems,
    approvedVersions: counts.approvedVersions,
    countsUnknown: counts.unknown,
    committedTotal: project.rollup?.committedTotal ?? 0,
    actualTotal: project.rollup?.actualTotal ?? 0,
    agreedClientRevenue: project.rollup?.currentAgreedClientRevenue ?? 0,
  };
  const serious = hasRealWork(contents);
  const ready = serious ? nameMatches(typed, project.name) : true;

  return (
    <section style={S.panel} ref={panel}>
      <h2 style={S.panelTitle}>Delete {project.name}</h2>

      <p style={{ ...hint, fontSize: 13, marginBottom: 8 }}>
        This removes, permanently and for everyone:
      </p>
      <ul style={S.list}>
        {describeDeletion(contents).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {serious ? (
        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
            This project has real money in it. Type its name to confirm:
          </span>
          <code style={S.name}>{project.name}</code>
          <input
            value={typed}
            autoFocus
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Type the project name"
            aria-label="Type the project name to confirm"
            style={{ ...inputStyle, minWidth: 340, marginTop: 8 }}
          />
        </label>
      ) : null}

      {error ? <p style={S.error}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          type="button"
          style={{ ...S.destructive, opacity: ready && !busy ? 1 : 0.45 }}
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await deleteProject(project.id, serious ? typed : project.name);
              onDeleted(project.name);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'The project could not be deleted.');
              setBusy(false);
            }
          }}
        >
          {busy ? 'Deleting…' : 'Delete permanently'}
        </button>
        <button type="button" style={buttonQuiet} disabled={busy} onClick={onCancel}>
          Keep it
        </button>
      </div>
    </section>
  );
}

const S: Record<string, React.CSSProperties> = {
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: tableHead,
  td: { ...tableCell, height: 44, padding: '6px 10px 6px 0' },
  link: { color: colour.ink, textDecoration: 'none', borderBottom: `1px solid ${colour.rule}` },
  imported: {
    display: 'block',
    fontStyle: 'normal',
    fontSize: 11,
    color: colour.signature,
    marginTop: 3,
  },
  deleteLink: { ...buttonQuiet, fontSize: 12, color: colour.muted, textDecoration: 'underline' },

  panel: {
    marginTop: 26,
    padding: '20px 22px',
    border: `1px solid ${colour.rule}`,
    borderLeft: `3px solid ${colour.signature}`,
    borderRadius: radius.base,
    maxWidth: '68ch',
  },
  panelTitle: { fontFamily: typeToken.serif, fontSize: 20, fontWeight: 400, margin: '0 0 14px' },
  list: { ...hint, fontSize: 13, margin: '0 0 16px', paddingLeft: 20, lineHeight: 1.7 },
  name: {
    display: 'inline-block',
    fontSize: 13,
    padding: '3px 7px',
    background: colour.ground,
    border: `1px solid ${colour.rule}`,
    borderRadius: radius.base,
    userSelect: 'all',
  },
  destructive: {
    ...buttonSecondary,
    borderLeft: `3px solid ${colour.signature}`,
    borderRadius: radius.base,
  },
  notice: { fontSize: 14, marginBottom: 16 },
  error: { fontSize: 13, color: colour.signature, marginBottom: 14 },
};
