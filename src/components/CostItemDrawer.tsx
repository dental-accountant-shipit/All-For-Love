'use client';

/**
 * The cost item drawer — everything about one budget line that does not belong
 * in the everyday grid.
 *
 * Two jobs. The top half is the four-figure ledger: Budget · Committed ·
 * Actual · Forecast, with the commitments and bills that produce them. The
 * bottom half is the More Details fields — supplier, currency, VAT, dates,
 * notes — which exist so the grid can stay four columns wide.
 *
 * Unstyled. The interaction comes first.
 */

import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '../lib/auth/AuthProvider';
import { firestore } from '../lib/firestore/client';
import {
  cancelLine,
  clearForecastOverride,
  createCommitment,
  createTransaction,
  deleteTransaction,
  setCommitmentStatus,
  setForecastOverride,
  updateDetails,
  updateExtraStatus,
} from '../lib/firestore/money';
import { watchSuppliers } from '../lib/firestore/suppliers';
import { forecastCostItem, budgetForForecast } from '../domain/forecast';
import { formatGBP, toPence, toBaseCurrency } from '../domain/money';
import { parseMoney } from '../domain/values';
import type {
  Commitment,
  CostItem,
  CostItemStatus,
  Supplier,
  Transaction,
} from '../domain/types';
import { colour } from '../design/tokens';

const STATUSES: CostItemStatus[] = [
  'planned',
  'quoted',
  'committed',
  'in_progress',
  'completed',
  'cancelled',
];

export interface CostItemDrawerProps {
  item: CostItem;
  commitments: Commitment[];
  transactions: Transaction[];
  onClose: () => void;
  onSetStatus: (status: CostItemStatus) => void;
}

export default function CostItemDrawer({
  item,
  commitments,
  transactions,
  onClose,
  onSetStatus,
}: CostItemDrawerProps) {
  const { user, can } = useAuth();
  const db = firestore();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => watchSuppliers(db, setSuppliers), [db]);

  const mine = useMemo(
    () => ({
      commitments: commitments.filter((c) => c.costItemId === item.id),
      transactions: transactions.filter((t) => t.costItemId === item.id),
    }),
    [commitments, transactions, item.id],
  );

  const result = useMemo(
    () => forecastCostItem(item, mine.commitments, mine.transactions),
    [item, mine],
  );

  const budget = budgetForForecast(item);
  const editable = can('editBudget');
  const canRecord = can('recordCommitment');

  async function guard(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!user) return null;

  return (
    <aside style={S.drawer} aria-label={`Details for ${item.description || 'untitled line'}`}>
      <header style={S.head}>
        <strong style={{ fontSize: 15 }}>{item.description || 'Untitled line'}</strong>
        <button type="button" onClick={onClose} style={S.close} aria-label="Close">
          ×
        </button>
      </header>

      {error ? <p style={S.error}>{error}</p> : null}

      {/* ---------------------------------------------------- four figures */}
      <dl style={S.figures}>
        <Figure
          label="Budget"
          value={budget === null ? 'Not recorded' : formatGBP(budget)}
          muted={budget === null}
        />
        <Figure label="Committed" value={formatGBP(result.committedTotal)} />
        <Figure label="Actual" value={formatGBP(result.actualTotal)} />
        <Figure
          label="Forecast"
          value={formatGBP(result.forecastCost)}
          note={
            result.forecastSource === 'override'
              ? `overridden · calculated ${formatGBP(result.calculatedForecast)}`
              : result.committedRemaining > 0
                ? `${formatGBP(result.committedRemaining)} still to invoice`
                : undefined
          }
        />
      </dl>

      {budget !== null && result.forecastCost > budget ? (
        <p style={S.over}>
          Forecasting {formatGBP(result.forecastCost - budget)} over budget.
        </p>
      ) : null}

      {result.overrideMayBeStale ? (
        <p style={S.warn}>
          The calculation has moved away from this override. It now reads{' '}
          {formatGBP(result.calculatedForecast)}.
        </p>
      ) : null}

      {/* ------------------------------------------------------------ status */}
      <section style={S.section}>
        <h3 style={S.h3}>Status</h3>
        <select
          value={item.status}
          disabled={!editable}
          onChange={(e) => {
            const status = e.target.value as CostItemStatus;
            if (status === 'cancelled') {
              const withdrawn = window.confirm(
                'Does the client stop paying for this line?\n\n' +
                  'OK — the client value is withdrawn and counts as an agreed reduction.\n' +
                  'Cancel — the work is dropped but the price stands.',
              );
              void guard(() => cancelLine(db, user.uid, item.projectId, item.id, withdrawn));
              return;
            }
            onSetStatus(status);
          }}
          style={S.select}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <p style={S.hint}>
          Completed switches the forecast to final actual. Cancelled keeps whatever has
          already been spent.
        </p>
      </section>

      {/* ------------------------------------------------------- commitments */}
      <section style={S.section}>
        <h3 style={S.h3}>Supplier commitments</h3>
        {mine.commitments.length === 0 ? (
          <p style={S.hint}>Nothing committed yet.</p>
        ) : (
          <table style={S.table}>
            <tbody>
              {mine.commitments.map((c) => {
                const invoiced = mine.transactions
                  .filter((t) => t.commitmentId === c.id)
                  .reduce((a, t) => a + t.amountBaseExVat, 0);
                const remaining = Math.max(0, c.amountBaseExVat - invoiced);
                return (
                  <tr key={c.id}>
                    <td style={S.td}>
                      {c.supplierName ?? 'No supplier'}
                      {c.reference ? <em style={S.hint}> {c.reference}</em> : null}
                      {c.currency !== 'GBP' ? (
                        <em style={S.hint}>
                          {' '}
                          {c.currency} {(c.amountExVat / 100).toFixed(2)} @ {c.fxRate}
                        </em>
                      ) : null}
                    </td>
                    <td style={S.num}>{formatGBP(c.amountBaseExVat)}</td>
                    <td style={S.num}>
                      {remaining > 0 ? `${formatGBP(remaining)} left` : 'fully invoiced'}
                    </td>
                    <td style={S.td}>
                      <select
                        value={c.status}
                        disabled={!canRecord}
                        onChange={(e) =>
                          void guard(() =>
                            setCommitmentStatus(
                              db,
                              user.uid,
                              c.id,
                              e.target.value as Commitment['status'],
                            ),
                          )
                        }
                        style={S.selectSmall}
                      >
                        {['draft', 'issued', 'accepted', 'part_delivered', 'closed', 'cancelled'].map(
                          (s) => (
                            <option key={s} value={s}>
                              {s.replace(/_/g, ' ')}
                            </option>
                          ),
                        )}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {canRecord ? (
          <MoneyForm
            kind="commitment"
            suppliers={suppliers}
            commitments={mine.commitments}
            onSubmit={(input) =>
              guard(async () => {
                await createCommitment(db, user.uid, item, {
                  supplierId: input.supplierId,
                  supplierName: input.supplierName,
                  reference: input.reference,
                  amountExVat: input.amountExVat,
                  vatAmount: input.vatAmount,
                  currency: input.currency,
                  fxRate: input.fxRate,
                  expectedInvoiceDate: input.date || null,
                  notes: null,
                });
              })
            }
          />
        ) : null}
      </section>

      {/* ------------------------------------------------------ actual costs */}
      <section style={S.section}>
        <h3 style={S.h3}>Actual costs</h3>
        {mine.transactions.length === 0 ? (
          <p style={S.hint}>Nothing invoiced yet.</p>
        ) : (
          <table style={S.table}>
            <tbody>
              {mine.transactions.map((t) => (
                <tr key={t.id}>
                  <td style={S.td}>
                    {t.date.slice(0, 10)} · {t.supplierName ?? 'No supplier'}
                    {t.reference ? <em style={S.hint}> {t.reference}</em> : null}
                    {t.type === 'credit' ? <em style={S.hint}> credit</em> : null}
                    {t.source !== 'manual' ? <em style={S.hint}> from {t.source}</em> : null}
                  </td>
                  <td style={S.num}>{formatGBP(t.amountBaseExVat)}</td>
                  <td style={S.td}>
                    {t.source === 'manual' && canRecord ? (
                      <button
                        type="button"
                        style={S.link}
                        onClick={() => void guard(() => deleteTransaction(db, t))}
                      >
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canRecord ? (
          <MoneyForm
            kind="cost"
            suppliers={suppliers}
            commitments={mine.commitments}
            onSubmit={(input) =>
              guard(async () => {
                await createTransaction(db, user.uid, item, {
                  type: input.isCredit ? 'credit' : 'bill',
                  supplierId: input.supplierId,
                  supplierName: input.supplierName,
                  commitmentId: input.commitmentId,
                  reference: input.reference,
                  date: input.date || new Date().toISOString(),
                  amountExVat: input.amountExVat,
                  vatAmount: input.vatAmount,
                  currency: input.currency,
                  fxRate: input.fxRate,
                  paymentStatus: 'unpaid',
                });
              })
            }
          />
        ) : null}
      </section>

      {/* --------------------------------------------------------- override */}
      {editable ? (
        <section style={S.section}>
          <h3 style={S.h3}>Forecast override</h3>
          {item.forecastOverride ? (
            <p style={S.hint}>
              {formatGBP(item.forecastOverride.value)} — &ldquo;{item.forecastOverride.reason}
              &rdquo;, {item.forecastOverride.at.slice(0, 10)}.{' '}
              <button
                type="button"
                style={S.link}
                onClick={() =>
                  void guard(() => clearForecastOverride(db, user.uid, item.projectId, item.id))
                }
              >
                Revert to calculated
              </button>
            </p>
          ) : (
            <p style={S.hint}>
              Calculated at {formatGBP(result.calculatedForecast)}.{' '}
              <button
                type="button"
                style={S.link}
                onClick={() => {
                  const raw = window.prompt('Forecast cost for this line');
                  if (raw === null) return;
                  const amount = parseMoney(raw);
                  if (amount === null) {
                    setError('That figure could not be read.');
                    return;
                  }
                  const reason = window.prompt('Why? This is recorded against your name.');
                  if (!reason) return;
                  void guard(() =>
                    setForecastOverride(db, user.uid, item.projectId, item.id, amount, reason),
                  );
                }}
              >
                Override it
              </button>
            </p>
          )}
        </section>
      ) : null}

      {/* ---------------------------------------------------- more details */}
      <section style={S.section}>
        <h3 style={S.h3}>More details</h3>
        <div style={S.fields}>
          <label style={S.label}>
            Supplier
            <select
              value={item.details.supplierId ?? ''}
              disabled={!editable}
              onChange={(e) => {
                const supplier = suppliers.find((s) => s.id === e.target.value) ?? null;
                void guard(() =>
                  updateDetails(db, user.uid, item.projectId, item.id, {
                    supplierId: supplier?.id ?? null,
                    supplierName: supplier?.name ?? null,
                    currency: supplier?.defaultCurrency ?? item.details.currency,
                  }),
                );
              }}
              style={S.select}
            >
              <option value="">—</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <TextField
            label="Currency"
            value={item.details.currency}
            disabled={!editable}
            onCommit={(v) =>
              guard(() =>
                updateDetails(db, user.uid, item.projectId, item.id, {
                  currency: v.toUpperCase() || 'GBP',
                }),
              )
            }
          />
          <TextField
            label="VAT rate %"
            value={String(item.details.vatRate)}
            disabled={!editable}
            onCommit={(v) =>
              guard(() =>
                updateDetails(db, user.uid, item.projectId, item.id, {
                  vatRate: Number(v) || 0,
                }),
              )
            }
          />
          <TextField
            label="Responsibility"
            value={item.details.responsibility ?? ''}
            disabled={!editable}
            onCommit={(v) =>
              guard(() =>
                updateDetails(db, user.uid, item.projectId, item.id, {
                  responsibility: v || null,
                }),
              )
            }
          />
          <TextField
            label="Starts"
            type="date"
            value={item.details.startDate?.slice(0, 10) ?? ''}
            disabled={!editable}
            onCommit={(v) =>
              guard(() =>
                updateDetails(db, user.uid, item.projectId, item.id, {
                  startDate: v ? new Date(v).toISOString() : null,
                }),
              )
            }
          />
          <TextField
            label="Ends"
            type="date"
            value={item.details.endDate?.slice(0, 10) ?? ''}
            disabled={!editable}
            onCommit={(v) =>
              guard(() =>
                updateDetails(db, user.uid, item.projectId, item.id, {
                  endDate: v ? new Date(v).toISOString() : null,
                }),
              )
            }
          />
        </div>

        <label style={{ ...S.label, display: 'block', marginTop: 12 }}>
          Notes
          <textarea
            defaultValue={item.details.notes ?? ''}
            disabled={!editable}
            rows={3}
            onBlur={(e) =>
              void guard(() =>
                updateDetails(db, user.uid, item.projectId, item.id, {
                  notes: e.target.value || null,
                }),
              )
            }
            style={{ ...S.input, width: '100%', fontFamily: 'inherit' }}
          />
        </label>
      </section>

      {/* ------------------------------------------------------------ extra */}
      <section style={S.section}>
        <h3 style={S.h3}>Optional extra</h3>
        <label style={S.label}>
          <input
            type="checkbox"
            checked={item.origin === 'extra'}
            disabled={!editable}
            onChange={(e) =>
              void guard(() =>
                updateExtraStatus(
                  db,
                  user.uid,
                  item.projectId,
                  item.id,
                  e.target.checked ? 'extra' : 'original',
                  e.target.checked ? 'proposed' : null,
                ),
              )
            }
          />{' '}
          This line is an optional extra rather than original scope
        </label>
        {item.origin === 'extra' ? (
          <>
            <select
              value={item.extraStatus ?? 'proposed'}
              disabled={!editable}
              onChange={(e) =>
                void guard(() =>
                  updateExtraStatus(
                    db,
                    user.uid,
                    item.projectId,
                    item.id,
                    'extra',
                    e.target.value as CostItem['extraStatus'],
                  ),
                )
              }
              style={S.select}
            >
              <option value="proposed">Proposed — awaiting the client</option>
              <option value="approved">Approved by the client</option>
              <option value="rejected">Rejected</option>
            </select>
            <p style={S.hint}>
              A proposed extra counts towards neither revenue nor cost. It appears on the
              overview in its own block until the client says yes.
            </p>
          </>
        ) : null}
      </section>
    </aside>
  );
}

// ---------------------------------------------------------------------------

interface MoneyInput {
  supplierId: string | null;
  supplierName: string | null;
  commitmentId: string | null;
  reference: string | null;
  date: string;
  amountExVat: number;
  vatAmount: number;
  currency: string;
  fxRate: number;
  isCredit: boolean;
}

/**
 * One form for both a commitment and a bill — they carry the same fields, and
 * two nearly-identical forms would drift apart.
 */
function MoneyForm({
  kind,
  suppliers,
  commitments,
  onSubmit,
}: {
  kind: 'commitment' | 'cost';
  suppliers: Supplier[];
  commitments: Commitment[];
  onSubmit: (input: MoneyInput) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [vat, setVat] = useState('');
  const [currency, setCurrency] = useState('GBP');
  const [fxRate, setFxRate] = useState('1');
  const [date, setDate] = useState('');
  const [commitmentId, setCommitmentId] = useState('');
  const [isCredit, setIsCredit] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" style={S.button} onClick={() => setOpen(true)}>
        {kind === 'commitment' ? 'Record a commitment' : 'Record a cost'}
      </button>
    );
  }

  const parsedAmount = parseMoney(amount);
  const parsedVat = vat.trim() === '' ? 0 : parseMoney(vat);
  const rate = Number(fxRate) || 1;
  const preview =
    parsedAmount !== null && currency !== 'GBP'
      ? formatGBP(toBaseCurrency(parsedAmount, rate))
      : null;

  return (
    <form
      style={S.form}
      onSubmit={async (e) => {
        e.preventDefault();
        if (parsedAmount === null || parsedVat === null) {
          setProblem('That amount could not be read.');
          return;
        }
        const supplier = suppliers.find((s) => s.id === supplierId) ?? null;
        await onSubmit({
          supplierId: supplier?.id ?? null,
          supplierName: supplier?.name ?? null,
          commitmentId: commitmentId || null,
          reference: reference || null,
          date: date ? new Date(date).toISOString() : '',
          amountExVat: parsedAmount,
          vatAmount: parsedVat,
          currency,
          fxRate: rate,
          isCredit,
        });
        setOpen(false);
        setAmount('');
        setVat('');
        setReference('');
        setProblem(null);
      }}
    >
      <div style={S.fields}>
        <label style={S.label}>
          Supplier
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} style={S.select}>
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <TextInput label="Reference" value={reference} onChange={setReference} />
        <TextInput label="Amount ex VAT" value={amount} onChange={setAmount} required />
        <TextInput label="VAT" value={vat} onChange={setVat} />
        <TextInput label="Currency" value={currency} onChange={(v) => setCurrency(v.toUpperCase())} />
        {currency !== 'GBP' ? (
          <TextInput label="Rate to GBP" value={fxRate} onChange={setFxRate} />
        ) : null}
        <TextInput
          label={kind === 'commitment' ? 'Expected invoice date' : 'Date'}
          type="date"
          value={date}
          onChange={setDate}
        />
      </div>

      {kind === 'cost' ? (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
          {commitments.length > 0 ? (
            <label style={S.label}>
              Against commitment
              <select
                value={commitmentId}
                onChange={(e) => setCommitmentId(e.target.value)}
                style={S.select}
              >
                <option value="">None — uncommitted spend</option>
                {commitments.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.reference ?? c.supplierName ?? 'Commitment'} ·{' '}
                    {formatGBP(c.amountBaseExVat)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label style={{ ...S.label, alignSelf: 'end' }}>
            <input
              type="checkbox"
              checked={isCredit}
              onChange={(e) => setIsCredit(e.target.checked)}
            />{' '}
            This is a credit note
          </label>
        </div>
      ) : null}

      {preview ? (
        <p style={S.hint}>
          {currency} {amount} at {rate} is {preview}. The original amount, currency and rate
          are all kept.
        </p>
      ) : null}
      {problem ? <p style={S.error}>{problem}</p> : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="submit" style={{ ...S.button, background: colour.ink, color: colour.paper, border: 'none' }}>
          Save
        </button>
        <button type="button" style={S.button} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Figure({
  label,
  value,
  note,
  muted,
}: {
  label: string;
  value: string;
  note?: string;
  muted?: boolean;
}) {
  return (
    <div>
      <dt style={S.figureLabel}>{label}</dt>
      <dd style={{ ...S.figureValue, color: muted ? colour.ruleStrong : colour.ink }}>
        {value}
        {note ? <em style={{ ...S.hint, display: 'block', fontStyle: 'normal' }}>{note}</em> : null}
      </dd>
    </div>
  );
}

function TextField({
  label,
  value,
  onCommit,
  type = 'text',
  disabled,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label style={S.label}>
      {label}
      <input
        type={type}
        defaultValue={value}
        disabled={disabled}
        onBlur={(e) => {
          if (e.target.value !== value) onCommit(e.target.value);
        }}
        style={S.input}
      />
    </label>
  );
}

function TextInput({
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label style={S.label}>
      {label}
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        style={S.input}
      />
    </label>
  );
}

const S: Record<string, React.CSSProperties> = {
  drawer: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: 'min(560px, 100vw)',
    background: colour.paper,
    borderLeft: `1px solid ${colour.rule}`,
    boxShadow: '-8px 0 24px rgba(0,0,0,.06)',
    padding: 20,
    overflowY: 'auto',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 14,
    zIndex: 10,
  },
  head: { display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 },
  close: {
    marginLeft: 'auto',
    background: 'none',
    border: 'none',
    fontSize: 22,
    lineHeight: 1,
    cursor: 'pointer',
    color: colour.muted,
  },
  figures: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
    gap: 16,
    margin: '0 0 12px',
    paddingBottom: 14,
    borderBottom: `1px solid ${colour.rule}`,
  },
  figureLabel: {
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: colour.muted,
  },
  figureValue: { margin: '3px 0 0', fontSize: 16, fontVariantNumeric: 'tabular-nums' },
  section: { marginBottom: 22 },
  h3: {
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    fontWeight: 600,
    marginBottom: 8,
  },
  table: {
    borderCollapse: 'collapse',
    width: '100%',
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
    marginBottom: 8,
  },
  td: { padding: '5px 6px', borderBottom: `1px solid ${colour.rule}`, verticalAlign: 'top' },
  num: { padding: '5px 6px', borderBottom: `1px solid ${colour.rule}`, textAlign: 'right', whiteSpace: 'nowrap' },
  fields: { display: 'flex', flexWrap: 'wrap', gap: 12 },
  label: { fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: colour.muted },
  input: {
    display: 'block',
    font: 'inherit',
    fontSize: 14,
    padding: '5px 7px',
    marginTop: 3,
    border: `1px solid ${colour.rule}`,
    borderRadius: 4,
    color: colour.ink,
    minWidth: 120,
  },
  select: { display: 'block', font: 'inherit', fontSize: 14, marginTop: 3, padding: '5px 6px' },
  selectSmall: { font: 'inherit', fontSize: 12 },
  form: { border: `1px solid ${colour.rule}`, padding: 12, marginTop: 8 },
  button: {
    font: 'inherit',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    fontWeight: 600,
    padding: '6px 12px',
    background: 'transparent',
    border: `1px solid ${colour.rule}`,
    borderRadius: 2,
    cursor: 'pointer',
    color: colour.ink,
  },
  link: {
    background: 'none',
    border: 'none',
    padding: 0,
    font: 'inherit',
    fontSize: 12,
    color: colour.signature,
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  hint: { fontSize: 11, color: colour.muted, marginTop: 4 },
  error: { fontSize: 13, color: colour.signature },
  warn: { fontSize: 12, color: colour.ink, background: colour.blush, padding: '8px 10px' },
  over: { fontSize: 13, color: colour.signature, fontWeight: 600 },
};

void toPence;
