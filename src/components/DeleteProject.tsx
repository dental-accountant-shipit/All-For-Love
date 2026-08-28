'use client';

/**
 * Deleting a project, from inside the application.
 *
 * Deliberately at the very bottom of the overview, below everything worth
 * reading, behind a link rather than a button. Nothing else here destroys
 * anything, so this should not sit among the actions somebody uses daily — it
 * should take a small decision to reach.
 *
 * What it shows before it will do anything is the point: not "are you sure",
 * which nobody reads, but what is actually in this project. Somebody about to
 * delete the wrong one of two identically-named imports is stopped by seeing
 * £423,538.75 of agreed revenue listed, not by another dialog.
 *
 * When there is real money or an approved version in it, the name has to be
 * typed. When the project is empty or was plainly a mistake, it does not —
 * ceremony where nothing is at stake only teaches people to click through it.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '../lib/auth/AuthProvider';
import { firestore } from '../lib/firestore/client';
import { deleteProject } from '../lib/projects/deleteProject';
import { describeDeletion, hasRealWork, nameMatches } from '../domain/projectDeletion';
import type { ProjectContents } from '../domain/projectDeletion';
import type { Project, ProjectRollup } from '../domain/types';
import { colour, radius, type } from '../design/tokens';
import { buttonQuiet, buttonSecondary, hint, input as inputStyle } from '../design/ui';

export default function DeleteProject({
  project,
  rollup,
}: {
  project: Project;
  rollup: ProjectRollup;
}) {
  const { can } = useAuth();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<{ costItems: number; approvedVersions: number } | null>(
    null,
  );
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Counted only once somebody opens this, and never for anybody who cannot
  // see it. Two extra reads on every project screen, for a control most people
  // will never touch, is a cost with no benefit.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const { collection, getCountFromServer, query, where } = await import(
          'firebase/firestore'
        );
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
        if (cancelled) return;
        setCounts({
          costItems: items.data().count,
          approvedVersions: versions.data().count,
        });
      } catch {
        // Counting failed, which must not stop somebody clearing up a mistake.
        // Treating it as "we do not know" is the safe way round: unknown counts
        // still leave the money figures below, which are what matter.
        if (!cancelled) setCounts({ costItems: 0, approvedVersions: 0 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, project.id]);

  if (!can('deleteProject')) return null;

  if (!open) {
    return (
      <section style={S.closed}>
        <button type="button" style={S.reveal} onClick={() => setOpen(true)}>
          Delete this project
        </button>
      </section>
    );
  }

  if (!counts) {
    return (
      <section style={S.closed}>
        <p style={hint}>Working out what is in this project…</p>
      </section>
    );
  }

  const contents: ProjectContents = {
    costItems: counts.costItems,
    approvedVersions: counts.approvedVersions,
    committedTotal: rollup.committedTotal,
    actualTotal: rollup.actualTotal,
    agreedClientRevenue: rollup.currentAgreedClientRevenue,
  };

  const serious = hasRealWork(contents);
  const ready = serious ? nameMatches(typed, project.name) : true;

  return (
    <section style={S.panel}>
      <h2 style={S.title}>Delete {project.name}</h2>

      <p style={S.body}>This removes, permanently and for everyone:</p>
      <ul style={S.list}>
        {describeDeletion(contents).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <p style={S.body}>
        Nothing else in this system deletes — suppliers are retired, cost lines are
        cancelled, approved budgets cannot be edited by anybody. This is the exception,
        and there is no undo. A record of what was deleted, and by whom, is kept.
      </p>

      {serious ? (
        <label style={S.confirm}>
          <span style={S.confirmLabel}>
            This project has real money in it. Type its name to confirm:
          </span>
          <code style={S.name}>{project.name}</code>
          <input
            value={typed}
            autoFocus
            onChange={(event) => setTyped(event.target.value)}
            style={{ ...inputStyle, minWidth: 340, marginTop: 8 }}
            placeholder="Type the project name"
            aria-label="Type the project name to confirm"
          />
        </label>
      ) : null}

      {error ? <p style={S.error}>{error}</p> : null}

      <div style={S.actions}>
        <button
          type="button"
          style={{ ...S.destructive, opacity: ready && !busy ? 1 : 0.45 }}
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await deleteProject(project.id, serious ? typed : project.name);
              // The project screen would otherwise sit there reading its own
              // deleted document.
              router.push('/projects');
            } catch (err) {
              setError(err instanceof Error ? err.message : 'The project could not be deleted.');
              setBusy(false);
            }
          }}
        >
          {busy ? 'Deleting…' : 'Delete permanently'}
        </button>

        <button
          type="button"
          style={buttonQuiet}
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setTyped('');
            setError(null);
          }}
        >
          Keep it
        </button>
      </div>
    </section>
  );
}

const S: Record<string, React.CSSProperties> = {
  closed: { marginTop: 64, paddingTop: 22, borderTop: `1px solid ${colour.rule}` },
  reveal: { ...buttonQuiet, fontSize: 12, color: colour.muted, textDecoration: 'underline' },

  panel: {
    marginTop: 64,
    padding: '22px 24px',
    border: `1px solid ${colour.rule}`,
    // Black with a red rule down its edge, the same as the import undo. A red
    // fill would be a second meaning for red on screens where red already
    // means money going the wrong way.
    borderLeft: `3px solid ${colour.signature}`,
    borderRadius: radius.base,
    maxWidth: '68ch',
  },
  title: { fontFamily: type.serif, fontSize: 21, fontWeight: 400, margin: '0 0 14px' },
  body: { ...hint, fontSize: 13, maxWidth: '62ch', marginBottom: 10 },
  list: { ...hint, fontSize: 13, margin: '0 0 16px', paddingLeft: 20, lineHeight: 1.7 },

  confirm: { display: 'block', marginBottom: 18 },
  confirmLabel: { display: 'block', fontSize: 13, marginBottom: 6 },
  name: {
    display: 'inline-block',
    fontSize: 13,
    padding: '3px 7px',
    background: colour.ground,
    border: `1px solid ${colour.rule}`,
    borderRadius: radius.base,
    userSelect: 'all',
  },

  actions: { display: 'flex', gap: 12, alignItems: 'center' },
  destructive: {
    ...buttonSecondary,
    borderLeft: `3px solid ${colour.signature}`,
    borderRadius: radius.base,
  },
  error: { fontSize: 13, color: colour.signature, marginBottom: 14 },
};
