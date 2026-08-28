'use client';

/**
 * Every import that has happened, and a way to undo one.
 *
 * An import writes a whole project — a hundred and thirty lines, its
 * categories, its costs and an approved budget version — in one press. Until
 * now there was a Cloud Function that could take all of that back and no way
 * to call it, which made the import a one-way door. The first real use put the
 * same workbook in twice within a minute, which is exactly what a one-way door
 * feels like from the other side.
 *
 * Undoing refuses if the project has been worked on since: a commitment, a cost
 * that was not part of the import, or a second budget version all stop it. The
 * function decides that, not this screen — a client cannot be the thing that
 * protects the data.
 *
 * The batch record itself is never deleted, only marked reversed. An import
 * that happened and was undone is part of the history of the system.
 */

import { useEffect, useState } from 'react';

import { firestore } from '../lib/firestore/client';
import { reverseImport } from '../lib/import/runImport';
import { colour, radius, type } from '../design/tokens';
import { buttonQuiet, buttonSecondary, hint, tableCell, tableHead } from '../design/ui';

export interface ImportBatch {
  id: string;
  projectId: string;
  projectName: string;
  sourceFilename: string;
  importedAt: string;
  counts?: { categories: number; costItems: number; transactions: number };
  reversedAt: string | null;
}

export default function ImportHistory() {
  const [batches, setBatches] = useState<ImportBatch[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { collection, getDocs, orderBy, query } = await import('firebase/firestore');
        const snap = await getDocs(
          query(collection(firestore(), 'importBatches'), orderBy('importedAt', 'desc')),
        );
        if (cancelled) return;
        setBatches(snap.docs.map((d) => ({ ...(d.data() as Omit<ImportBatch, 'id'>), id: d.id })));
      } catch {
        if (!cancelled) setBatches([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message]);

  if (batches === null) return <p style={hint}>Looking up what has been imported…</p>;
  if (batches.length === 0) return null;

  return (
    <section style={S.wrap}>
      <h2 style={S.title}>Imports so far</h2>

      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Project</th>
            <th style={S.th}>From</th>
            <th style={S.th}>When</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Lines</th>
            <th style={S.th} />
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.id}>
              <td style={S.td}>
                {batch.projectName}
                {batch.reversedAt ? <em style={S.reversed}> · undone</em> : null}
              </td>
              <td style={{ ...S.td, color: colour.muted }}>{batch.sourceFilename}</td>
              <td style={{ ...S.td, color: colour.muted, whiteSpace: 'nowrap' }}>
                {batch.importedAt?.slice(0, 16).replace('T', ' ') ?? '—'}
              </td>
              <td style={{ ...S.td, textAlign: 'right' }}>{batch.counts?.costItems ?? '—'}</td>
              <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {batch.reversedAt ? null : confirming === batch.id ? (
                  <>
                    <button
                      type="button"
                      style={S.destructive}
                      disabled={busy !== null}
                      onClick={async () => {
                        setBusy(batch.id);
                        setError(null);
                        try {
                          const { deleted } = await reverseImport(batch.id);
                          setConfirming(null);
                          setMessage(
                            `Undone. ${deleted} records removed, and ${batch.projectName} is gone.`,
                          );
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'It could not be undone.');
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      {busy === batch.id ? 'Undoing…' : 'Yes, undo it'}
                    </button>{' '}
                    <button
                      type="button"
                      style={buttonQuiet}
                      onClick={() => setConfirming(null)}
                      disabled={busy !== null}
                    >
                      Keep it
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    style={buttonSecondary}
                    onClick={() => {
                      setError(null);
                      setConfirming(batch.id);
                    }}
                  >
                    Undo
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {confirming ? (
        <p style={{ ...hint, marginTop: 12, maxWidth: '70ch' }}>
          This deletes the whole project — every line, category, recorded cost and the approved
          budget version. It will refuse if anybody has worked on the project since it was
          imported.
        </p>
      ) : null}

      {message ? <p style={S.message}>{message}</p> : null}
      {error ? <p style={S.error}>{error}</p> : null}
    </section>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 48, paddingTop: 28, borderTop: `1px solid ${colour.rule}` },
  title: { fontFamily: type.serif, fontSize: 19, fontWeight: 400, margin: '0 0 14px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: tableHead,
  td: { ...tableCell, height: 38, padding: '4px 10px 4px 0' },
  reversed: { fontStyle: 'normal', fontSize: 12, color: colour.muted },
  // Black with a red rule down its edge. A red fill would be a second meaning
  // for red on a screen that already uses it for money going the wrong way.
  destructive: {
    ...buttonSecondary,
    fontSize: 11,
    padding: '8px 13px',
    borderLeft: `3px solid ${colour.signature}`,
    borderRadius: radius.base,
  },
  message: { marginTop: 14, fontSize: 14 },
  error: { marginTop: 14, fontSize: 13, color: colour.signature },
};
