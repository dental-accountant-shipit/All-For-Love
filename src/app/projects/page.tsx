'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import EmptyState from '../../components/EmptyState';
import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../lib/auth/AuthProvider';
import { firestore } from '../../lib/firestore/client';
import { createProject, watchProjects } from '../../lib/firestore/projects';
import { formatGBP, formatPercent } from '../../domain/money';
import type { Project } from '../../domain/types';
import { colour, type as typeToken } from '../../design/tokens';
import {
  buttonPrimary,
  buttonSecondary,
  hint as hintStyle,
  input as inputStyle,
  label as labelStyle,
  tableCell,
  tableHead,
} from '../../design/ui';

export default function ProjectsPage() {
  const { user, can } = useAuth();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!user) return;
    return watchProjects(firestore(), setProjects);
  }, [user]);

  if (!projects) return <p style={{ color: colour.muted }}>Loading projects…</p>;

  return (
    <>
      <PageHeader
        title="Projects"
        meta={
          projects.length > 0
            ? `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`
            : undefined
        }
        actions={
          can('createProject') ? (
            <button
              type="button"
              onClick={() => setCreating((v) => !v)}
              style={creating ? buttonSecondary : buttonPrimary}
            >
              {creating ? 'Cancel' : 'New project'}
            </button>
          ) : null
        }
      />

      {creating ? <NewProjectForm onDone={() => setCreating(false)} /> : null}

      {projects.length === 0 && !creating ? (
        <EmptyState
          title="No projects yet"
          action={
            can('createProject') ? (
              <button type="button" onClick={() => setCreating(true)} style={buttonPrimary}>
                Create the first project
              </button>
            ) : null
          }
        >
          <p style={{ margin: 0 }}>
            {can('createProject')
              ? 'A project holds one event: its budget, what has been committed to suppliers, what has actually been spent, and what it is forecast to make. It opens straight into the budget.'
              : 'A director or producer creates the first one.'}
          </p>
        </EmptyState>
      ) : projects.length === 0 ? null : (
        <div style={{ overflowX: 'auto' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Project</th>
                <th style={th}>Client</th>
                <th style={th}>Date</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Revenue</th>
                <th style={{ ...th, textAlign: 'right' }}>Forecast cost</th>
                <th style={{ ...th, textAlign: 'right' }}>Forecast profit</th>
                <th style={{ ...th, textAlign: 'right' }}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td style={td}>
                    <Link href={`/project?id=${p.id}`} style={projectLink}>
                      {p.name}
                    </Link>
                    {p.subEventMode === 'multiple' ? (
                      <em style={hint}> · {p.rollup.subEvents?.length ?? 0} sub-events</em>
                    ) : null}
                  </td>
                  <td style={{ ...td, color: colour.muted }}>{p.clientName}</td>
                  <td style={{ ...td, color: colour.muted, whiteSpace: 'nowrap' }}>
                    {p.eventDate ? formatShortDate(p.eventDate) : '—'}
                  </td>
                  <td style={td}>
                    <span style={statusChip}>{p.status.replace(/_/g, ' ')}</span>
                  </td>
                  <td style={num}>{formatGBP(p.rollup.currentAgreedClientRevenue)}</td>
                  <td style={{ ...num, color: colour.muted }}>
                    {formatGBP(p.rollup.forecastCost)}
                  </td>
                  <td
                    style={{
                      ...num,
                      // The one figure on this screen that carries good and bad
                      // news, and the only one that is ever coloured.
                      ...(can('viewProfit') && p.rollup.forecastProfit < 0
                        ? { color: colour.signature }
                        : null),
                      fontWeight: 500,
                    }}
                  >
                    {can('viewProfit') ? formatGBP(p.rollup.forecastProfit) : '—'}
                  </td>
                  <td style={{ ...num, color: colour.muted }}>
                    {can('viewProfit') ? formatPercent(p.rollup.forecastMargin) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ ...hint, marginTop: 20, maxWidth: '64ch' }}>
        Figures here come from each project&rsquo;s stored rollup, which the Cloud
        Function maintains. Until Blaze is enabled they update when a project screen is
        open rather than continuously.
      </p>
    </>
  );
}

function NewProjectForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [venue, setVenue] = useState('');
  const [multiDay, setMultiDay] = useState(false);
  const [subEvents, setSubEvents] = useState('Welcome Dinner\nWedding Day\nDay 2 Brunch');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      style={panel}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!user) return;
        setBusy(true);
        setError(null);
        try {
          await createProject(firestore(), user.uid, {
            name,
            clientName,
            venue: venue || null,
            eventDate: eventDate ? new Date(eventDate).toISOString() : null,
            subEventNames: multiDay ? subEvents.split('\n') : [],
          });
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not create the project.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p style={formTitle}>New project</p>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Field label="Project name" value={name} onChange={setName} required />
        <Field label="Client" value={clientName} onChange={setClientName} required />
        <Field label="Event date" value={eventDate} onChange={setEventDate} type="date" />
        <Field label="Venue" value={venue} onChange={setVenue} />
      </div>

      <label style={{ ...hint, display: 'block', marginTop: 16 }}>
        <input
          type="checkbox"
          checked={multiDay}
          onChange={(e) => setMultiDay(e.target.checked)}
        />{' '}
        This event runs over more than one occasion
      </label>

      {multiDay ? (
        <label style={{ ...hint, display: 'block', marginTop: 8 }}>
          One per line
          <textarea
            value={subEvents}
            onChange={(e) => setSubEvents(e.target.value)}
            rows={4}
            style={{ ...input, fontFamily: 'inherit' }}
          />
        </label>
      ) : (
        <p style={{ ...hint, maxWidth: '58ch', marginTop: 8 }}>
          Leave this unticked for an ordinary event. Sub-events can be added later
          without disturbing anything already budgeted.
        </p>
      )}

      {error ? <p style={{ color: colour.signature, fontSize: 13 }}>{error}</p> : null}

      <button type="submit" disabled={busy} style={{ ...btn, marginTop: 18 }}>
        {busy ? 'Creating…' : 'Create project'}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label style={{ display: 'block', flex: '1 1 200px', minWidth: 170 }}>
      <span style={fieldLabel}>{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        style={input}
      />
    </label>
  );
}

/** 6 Sept 2026 — short enough for a column, unambiguous about the month. */
function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const table: React.CSSProperties = {
  borderCollapse: 'collapse',
  width: '100%',
  fontSize: 14,
  fontVariantNumeric: 'tabular-nums',
};
const th: React.CSSProperties = tableHead;
const td: React.CSSProperties = { ...tableCell, padding: '3px 10px' };
const num: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
const hint: React.CSSProperties = hintStyle;

/** A project name is the one piece of text on this screen worth setting well. */
const projectLink: React.CSSProperties = {
  fontFamily: typeToken.serif,
  fontSize: 17,
  color: colour.ink,
  textDecoration: 'none',
};

const statusChip: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: typeToken.trackingLabel,
  textTransform: 'uppercase',
  color: colour.muted,
  whiteSpace: 'nowrap',
};

const panel: React.CSSProperties = {
  border: `1px solid ${colour.rule}`,
  borderLeft: `3px solid ${colour.ink}`,
  background: colour.ground,
  padding: '20px 22px',
  marginBottom: 30,
};
const input: React.CSSProperties = { ...inputStyle, marginTop: 0 };
const btn: React.CSSProperties = buttonPrimary;
const fieldLabel: React.CSSProperties = labelStyle;
const formTitle: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: typeToken.trackingLabel,
  textTransform: 'uppercase',
  color: colour.muted,
};
