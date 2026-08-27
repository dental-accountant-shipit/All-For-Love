'use client';

/**
 * Importing a supplier list from a file.
 *
 * Choose a file, see exactly what would happen, then decide. The reading is
 * done entirely in the browser by a pure module — nothing is uploaded anywhere
 * and nothing is written until the button is pressed — so a wrong file costs a
 * moment rather than an afternoon of undoing.
 *
 * The screen shows what it intends to *skip* as prominently as what it intends
 * to add. An import that silently drops rows is how a supplier list ends up
 * quietly incomplete, and nobody finds out until a bill arrives from somebody
 * who is not in it.
 */

import { useRef, useState } from 'react';

import {
  planSupplierImport,
  type SupplierImportPlan,
} from '../domain/suppliers/csv';
import { colour, radius, type } from '../design/tokens';
import { buttonPrimary, buttonQuiet, buttonSecondary, hint } from '../design/ui';

export interface SupplierImportProps {
  existing: Array<{ id: string; name: string }>;
  onImport: (
    suppliers: SupplierImportPlan['toAdd'],
    replaceExisting: boolean,
    onProgress: (written: number, total: number) => void,
  ) => Promise<number> | number;
  onClose: () => void;
}

/** Enough to see what kind of list this is without rendering sixteen hundred rows. */
const PREVIEW = 150;

export default function SupplierImport({ existing, onImport, onClose }: SupplierImportProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [plan, setPlan] = useState<SupplierImportPlan | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ written: number; total: number } | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const read = async (file: File) => {
    setError(null);
    setDone(null);
    try {
      const text = await file.text();
      setFileName(file.name);
      // Replacing means the current list is on its way out, so nothing in it
      // should count as "already a supplier" and hold a name back.
      setPlan(planSupplierImport(text, replace ? [] : existing));
    } catch {
      setError('That file could not be read.');
    }
  };

  return (
    <section style={S.panel}>
      <p style={S.title}>Import suppliers from a file</p>

      {done !== null ? (
        <>
          <p style={S.result}>
            Added {done} {done === 1 ? 'supplier' : 'suppliers'}.
          </p>
          <div style={S.actions}>
            <button type="button" style={buttonSecondary} onClick={onClose}>
              Done
            </button>
            <button
              type="button"
              style={buttonQuiet}
              onClick={() => {
                setDone(null);
                setPlan(null);
                setFileName(null);
              }}
            >
              Import another file
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ ...hint, maxWidth: '66ch', marginTop: 0 }}>
            In Xero: <strong>Contacts → Suppliers → Export</strong>. The file it produces
            works as it is — no need to rename anything. Any spreadsheet with a column of
            supplier names will do just as well.
          </p>

          <div style={S.actions}>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv,text/plain"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void read(file);
              }}
            />
            <button type="button" style={buttonSecondary} onClick={() => fileInput.current?.click()}>
              Choose a file
            </button>
            {fileName ? <span style={hint}>{fileName}</span> : null}
            <button type="button" style={{ ...buttonQuiet, marginLeft: 'auto' }} onClick={onClose}>
              Cancel
            </button>
          </div>

          {error ? <p style={S.error}>{error}</p> : null}

          {plan ? (
            <Review
              plan={plan}
              busy={busy}
              existingCount={existing.length}
              replace={replace}
              onReplaceChange={(next) => {
                setReplace(next);
                // The plan depends on it, so it is re-read rather than patched.
                if (fileInput.current) fileInput.current.value = '';
                setPlan(null);
                setFileName(null);
              }}
              onConfirm={async () => {
                setBusy(true);
                setError(null);
                setProgress({ written: 0, total: plan.toAdd.length });
                try {
                  const written = await onImport(plan.toAdd, replace, (done, total) =>
                    setProgress({ written: done, total }),
                  );
                  setDone(written);
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : 'The suppliers could not be saved.',
                  );
                } finally {
                  setBusy(false);
                  setProgress(null);
                }
              }}
              progress={progress}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function Review({
  plan,
  busy,
  existingCount,
  replace,
  onReplaceChange,
  onConfirm,
  progress,
}: {
  plan: SupplierImportPlan;
  busy: boolean;
  existingCount: number;
  replace: boolean;
  onReplaceChange: (next: boolean) => void;
  onConfirm: () => void;
  progress: { written: number; total: number } | null;
}) {
  const [showSkipped, setShowSkipped] = useState(false);

  if (plan.nameColumn === null) {
    return (
      <div style={S.review}>
        <p style={S.problem}>No column of supplier names in that file.</p>
        <p style={{ ...hint, maxWidth: '62ch' }}>
          A heading called <strong>ContactName</strong>, <strong>Name</strong> or{' '}
          <strong>Supplier</strong> is what it looks for.
          {plan.ignored.length > 0 ? (
            <>
              {' '}
              This file has: {plan.ignored.slice(0, 12).join(', ')}
              {plan.ignored.length > 12 ? '…' : ''}.
            </>
          ) : null}
        </p>
      </div>
    );
  }

  const alreadyHave = plan.skipped.filter((row) => row.reason === 'already a supplier').length;
  const repeated = plan.skipped.filter((row) => row.reason === 'repeated in this file').length;
  const nameless = plan.skipped.filter((row) => row.reason === 'no name').length;

  return (
    <div style={S.review}>
      <p style={S.summary}>
        <strong style={S.count}>{plan.toAdd.length}</strong> to add
        {alreadyHave > 0 ? <span style={S.also}> · {alreadyHave} already on the list</span> : null}
        {repeated > 0 ? <span style={S.also}> · {repeated} repeated in the file</span> : null}
        {nameless > 0 ? <span style={S.also}> · {nameless} with no name</span> : null}
      </p>

      <p style={{ ...hint, maxWidth: '68ch' }}>
        Read from <strong>{plan.nameColumn}</strong>
        {plan.used.length > 1 ? <> and {plan.used.length - 1} other columns</> : null}.{' '}
        {plan.looksLikeXero ? (
          <>
            This is a Xero contacts export, which holds customers and suppliers in one file
            with nothing to tell them apart — so check the list below before adding it. Every
            one of these becomes a supplier.
          </>
        ) : null}
      </p>

      {plan.toAdd.length > 0 ? (
        <div style={S.scroll}>
          <ul style={S.names}>
            {plan.toAdd.slice(0, PREVIEW).map((supplier) => (
              <li key={`${supplier.line}-${supplier.name}`} style={S.name}>
                {supplier.name}
              </li>
            ))}
          </ul>
          {plan.toAdd.length > PREVIEW ? (
            <p style={{ ...hint, margin: '10px 2px 0' }}>
              …and {plan.toAdd.length - PREVIEW} more. All of them will be added.
            </p>
          ) : null}
        </div>
      ) : (
        <p style={{ ...hint, marginTop: 14 }}>
          Nothing new in that file — everything in it is already a supplier.
        </p>
      )}

      {plan.skipped.length > 0 ? (
        <p style={{ marginTop: 12 }}>
          <button type="button" style={buttonQuiet} onClick={() => setShowSkipped((v) => !v)}>
            {showSkipped ? 'Hide' : 'Show'} the {plan.skipped.length} being skipped
          </button>
        </p>
      ) : null}

      {showSkipped ? (
        <ul style={S.skipped}>
          {plan.skipped.map((row) => (
            <li key={`${row.line}-${row.name}`}>
              Line {row.line}
              {row.name ? <> — {row.name}</> : null} · {row.reason}
            </li>
          ))}
        </ul>
      ) : null}

      {existingCount > 0 ? (
        <div style={S.replace}>
          <label style={{ fontSize: 14 }}>
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => onReplaceChange(e.target.checked)}
            />{' '}
            Retire the {existingCount} {existingCount === 1 ? 'supplier' : 'suppliers'} already
            on the list
          </label>
          <p style={{ ...hint, margin: '6px 0 0', maxWidth: '66ch' }}>
            Retired, not deleted, and that is deliberate. A supplier named on a commitment or
            a bill from two years ago cannot be allowed to vanish, or the record of what was
            spent stops making sense. They disappear from the list and from every picker, and
            come back the moment you tick <strong>Include inactive</strong>.
          </p>
        </div>
      ) : null}

      {plan.toAdd.length > 0 ? (
        <>
          <div style={S.actions}>
            <button type="button" style={buttonPrimary} disabled={busy} onClick={onConfirm}>
              {busy
                ? progress
                  ? `Adding… ${progress.written} of ${progress.total}`
                  : 'Adding…'
                : replace
                  ? `Replace the list with ${plan.toAdd.length}`
                  : `Add ${plan.toAdd.length} ${plan.toAdd.length === 1 ? 'supplier' : 'suppliers'}`}
            </button>
          </div>
          <p style={{ ...hint, marginTop: 10, maxWidth: '66ch' }}>
            Names only. Contact details stay in Xero, which is where anybody would look for
            them, and they arrive without a kind — nothing in a contacts file says whether
            somebody is a company or a freelancer. Set that on the ones you use most; the
            rest can wait.
          </p>
        </>
      ) : null}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  panel: {
    border: `1px solid ${colour.rule}`,
    borderLeft: `3px solid ${colour.ink}`,
    borderRadius: radius.base,
    background: colour.ground,
    padding: '18px 20px 16px',
    margin: '0 0 30px',
  },
  title: {
    margin: '0 0 12px',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: type.trackingLabel,
    textTransform: 'uppercase',
    color: colour.muted,
  },
  actions: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 },
  review: { marginTop: 18, paddingTop: 16, borderTop: `1px solid ${colour.rule}` },
  replace: { marginTop: 16, paddingTop: 14, borderTop: `1px solid ${colour.rule}` },
  summary: { margin: '0 0 6px', fontSize: 15 },
  count: { fontFamily: type.serif, fontSize: 26, fontWeight: 400, marginRight: 6 },
  also: { color: colour.muted, fontSize: 14 },
  problem: { margin: '0 0 6px', fontSize: 15, fontWeight: 600 },
  result: { margin: 0, fontFamily: type.serif, fontSize: 22 },
  error: { color: colour.signature, fontSize: 13, marginTop: 12 },

  scroll: { maxHeight: 300, overflowY: 'auto', marginTop: 14 },
  // Names in columns rather than rows: a list of sixteen hundred is a wall
  // either way, but in columns you can find the shape of it at a glance.
  names: {
    columns: 3,
    columnGap: 24,
    listStyle: 'none',
    margin: 0,
    padding: '12px 14px',
    background: colour.paper,
    border: `1px solid ${colour.rule}`,
    borderRadius: radius.base,
    fontSize: 13,
  },
  name: { padding: '2px 0', breakInside: 'avoid' },
  skipped: {
    margin: '10px 0 0',
    padding: '0 0 0 18px',
    fontSize: 13,
    color: colour.muted,
    maxHeight: 200,
    overflowY: 'auto',
  },
};
