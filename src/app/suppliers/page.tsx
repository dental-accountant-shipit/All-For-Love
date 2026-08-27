'use client';

import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '../../lib/auth/AuthProvider';
import { firestore } from '../../lib/firestore/client';
import {
  createSupplier,
  seedSuppliersIfEmpty,
  setSupplierActive,
  updateSupplier,
  watchSuppliers,
} from '../../lib/firestore/suppliers';
import { watchSupplierSpend } from '../../lib/firestore/money';
import { formatGBP } from '../../domain/money';
import type { Supplier, Transaction } from '../../domain/types';
import PageHeader from '../../components/PageHeader';
import { colour } from '../../design/tokens';

export default function SuppliersPage() {
  const { user, can } = useAuth();
  const db = firestore();
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Supplier | null>(null);

  useEffect(
    () => watchSuppliers(db, setSuppliers, showInactive),
    [db, showInactive],
  );

  // Seeded from the C & D workbook the first time somebody opens this screen,
  // and never again. An empty suppliers list on day one is a screen that tells
  // you nothing about whether it works.
  useEffect(() => {
    if (!user || !can('manageSuppliers')) return;
    void seedSuppliersIfEmpty(db, user.uid).catch(() => {});
  }, [db, user, can]);

  if (!user) return null;
  if (!suppliers) return <p style={{ color: colour.muted }}>Loading suppliers…</p>;

  const editable = can('manageSuppliers');

  return (
    <>
      <PageHeader
        title="Suppliers"
        actions={
          <>
            <label style={hint}>
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />{' '}
              Include inactive
            </label>
        {editable ? (
          <button type="button" style={btn} onClick={() => setAdding((v) => !v)}>
            {adding ? 'Cancel' : 'Add supplier'}
            </button>
            ) : null}
          </>
        }
      />

      {adding ? (
        <form
          style={panel}
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            await createSupplier(db, user.uid, {
              name: String(form.get('name') ?? ''),
              kind: String(form.get('kind') ?? '') || null,
              defaultCurrency: String(form.get('currency') ?? 'GBP').toUpperCase() || 'GBP',
              vatRegistered: form.get('vat') === 'on',
              contactName: String(form.get('contact') ?? '') || null,
              email: String(form.get('email') ?? '') || null,
            });
            setAdding(false);
          }}
        >
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field name="name" label="Name" required />
            <Field name="kind" label="Kind" placeholder="flowers, structures, crew" />
            <Field name="currency" label="Currency" defaultValue="GBP" />
            <Field name="contact" label="Contact" />
            <Field name="email" label="Email" type="email" />
          </div>
          <label style={{ ...hint, display: 'block', marginTop: 10 }}>
            <input type="checkbox" name="vat" defaultChecked /> VAT registered
          </label>
          <p style={{ ...hint, maxWidth: '58ch' }}>
            Whether a supplier is VAT registered is recorded rather than left blank,
            because empty and &ldquo;not registered&rdquo; mean different things when
            these records are reconciled against Xero.
          </p>
          <button type="submit" style={{ ...btn, background: colour.ink, color: colour.paper, border: 'none', marginTop: 8 }}>
            Add supplier
          </button>
        </form>
      ) : null}

      {suppliers.length === 0 ? (
        <p style={hint}>No suppliers yet.</p>
      ) : (
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Supplier</th>
              <th style={th}>Kind</th>
              <th style={th}>Currency</th>
              <th style={th}>VAT</th>
              <th style={th}>Contact</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id} style={s.active ? undefined : { opacity: 0.55 }}>
                <td style={td}>
                  <button type="button" style={link} onClick={() => setSelected(s)}>
                    {s.name}
                  </button>
                </td>
                <td style={td}>{s.kind ?? '—'}</td>
                <td style={td}>{s.defaultCurrency}</td>
                <td style={td}>{s.vatRegistered ? 'Registered' : 'Not registered'}</td>
                <td style={td}>{s.contactName ?? s.email ?? '—'}</td>
                <td style={td}>
                  {editable ? (
                    <button
                      type="button"
                      style={link}
                      onClick={() => void setSupplierActive(db, user.uid, s.id, !s.active)}
                    >
                      {s.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ ...hint, marginTop: 16, maxWidth: '64ch' }}>
        Suppliers are deactivated rather than deleted — one you stopped using two years
        ago is still attached to two years of costs.
      </p>

      {selected ? (
        <SupplierPanel
          supplier={selected}
          editable={editable}
          onClose={() => setSelected(null)}
          onRename={(name) => void updateSupplier(db, user.uid, selected.id, { name })}
        />
      ) : null}
    </>
  );
}

function SupplierPanel({
  supplier,
  editable,
  onClose,
  onRename,
}: {
  supplier: Supplier;
  editable: boolean;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const db = firestore();
  const [spend, setSpend] = useState<Transaction[]>([]);

  useEffect(() => watchSupplierSpend(db, supplier.id, setSpend), [db, supplier.id]);

  const total = useMemo(() => spend.reduce((a, t) => a + t.amountBaseExVat, 0), [spend]);
  const projects = useMemo(
    () => new Set(spend.map((t) => t.projectId).filter(Boolean)).size,
    [spend],
  );

  return (
    <aside style={drawer}>
      <header style={{ display: 'flex', alignItems: 'baseline', marginBottom: 14 }}>
        <strong style={{ fontSize: 15 }}>{supplier.name}</strong>
        <button type="button" onClick={onClose} style={close} aria-label="Close">
          ×
        </button>
      </header>

      <p style={hint}>
        {formatGBP(total)} across {projects} {projects === 1 ? 'project' : 'projects'} ·{' '}
        {spend.length} {spend.length === 1 ? 'entry' : 'entries'}
      </p>

      {editable ? (
        <label style={{ ...hint, display: 'block', marginBottom: 14 }}>
          Name
          <input
            defaultValue={supplier.name}
            onBlur={(e) => {
              if (e.target.value.trim() && e.target.value !== supplier.name) {
                onRename(e.target.value.trim());
              }
            }}
            style={input}
          />
        </label>
      ) : null}

      {spend.length === 0 ? (
        <p style={hint}>Nothing recorded against this supplier yet.</p>
      ) : (
        <table style={table}>
          <tbody>
            {spend.slice(0, 60).map((t) => (
              <tr key={t.id}>
                <td style={td}>
                  {t.date.slice(0, 10)}
                  {t.reference ? <em style={hint}> {t.reference}</em> : null}
                </td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {formatGBP(t.amountBaseExVat)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </aside>
  );
}

function Field({
  name,
  label,
  type = 'text',
  required,
  defaultValue,
  placeholder,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <label style={hint}>
      {label}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        style={input}
      />
    </label>
  );
}

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
const hint: React.CSSProperties = { fontSize: 12, color: colour.muted };
const panel: React.CSSProperties = { border: `1px solid ${colour.rule}`, padding: 16, marginBottom: 24 };
const input: React.CSSProperties = {
  display: 'block',
  font: 'inherit',
  fontSize: 14,
  padding: '6px 8px',
  marginTop: 4,
  border: `1px solid ${colour.rule}`,
  borderRadius: 4,
  color: colour.ink,
};
const btn: React.CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  fontWeight: 600,
  padding: '8px 14px',
  background: 'transparent',
  color: colour.ink,
  border: `1px solid ${colour.rule}`,
  borderRadius: 2,
  cursor: 'pointer',
};
const link: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  color: colour.signature,
  cursor: 'pointer',
  textDecoration: 'underline',
};
const drawer: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: 'min(460px, 100vw)',
  background: colour.paper,
  borderLeft: `1px solid ${colour.rule}`,
  boxShadow: '-8px 0 24px rgba(0,0,0,.06)',
  padding: 20,
  overflowY: 'auto',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 14,
  zIndex: 10,
};
const close: React.CSSProperties = {
  marginLeft: 'auto',
  background: 'none',
  border: 'none',
  fontSize: 22,
  lineHeight: 1,
  cursor: 'pointer',
  color: colour.muted,
};
