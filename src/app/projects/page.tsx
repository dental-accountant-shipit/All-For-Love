'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useAuth } from '../../lib/auth/AuthProvider';
import { firestore } from '../../lib/firestore/client';
import { createProject, watchProjects } from '../../lib/firestore/projects';
import { formatGBP, formatPercent } from '../../domain/money';
import type { Project } from '../../domain/types';
import { colour } from '../../design/tokens';

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
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 20 }}>
        <h1 style={{ fontWeight: 400, fontSize: 22, marginRight: 'auto' }}>Projects</h1>
        {can('createProject') ? (
          <button type="button" onClick={() => setCreating((v) => !v)} style={btn}>
            {creating ? 'Cancel' : 'New project'}
          </button>
        ) : null}
      </header>

      {creating ? <NewProjectForm onDone={() => setCreating(false)} /> : null}

      {projects.length === 0 ? (
        <p style={{ color: colour.muted, maxWidth: '56ch' }}>
          No projects yet.{' '}
          {can('createProject')
            ? 'Create one to start a budget — it opens straight into the grid.'
            : 'A director or producer creates the first one.'}
        </p>
      ) : (
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
                    <Link href={`/project?id=${p.id}`}>{p.name}</Link>
                    {p.subEventMode === 'multiple' ? (
                      <em style={hint}> {p.rollup.subEvents?.length ?? 0} sub-events</em>
                    ) : null}
                  </td>
                  <td style={td}>{p.clientName}</td>
                  <td style={td}>{p.eventDate ? p.eventDate.slice(0, 10) : '—'}</td>
                  <td style={td}>{p.status.replace(/_/g, ' ')}</td>
                  <td style={num}>{formatGBP(p.rollup.currentAgreedClientRevenue)}</td>
                  <td style={num}>{formatGBP(p.rollup.forecastCost)}</td>
                  <td style={num}>
                    {can('viewProfit') ? formatGBP(p.rollup.forecastProfit) : '—'}
                  </td>
                  <td style={num}>
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
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Field label="Project name" value={name} onChange={setName} required />
        <Field label="Client" value={clientName} onChange={setClientName} required />
        <Field label="Event date" value={eventDate} onChange={setEventDate} type="date" />
        <Field label="Venue" value={venue} onChange={setVenue} />
      </div>

      <label style={{ ...hint, display: 'block', marginTop: 12 }}>
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

      <button type="submit" disabled={busy} style={{ ...btn, marginTop: 12 }}>
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
    <label style={{ ...hint, display: 'block' }}>
      {label}
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
  padding: '8px',
  borderBottom: `1px solid ${colour.ruleStrong}`,
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '8px', borderBottom: `1px solid ${colour.rule}` };
const num: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
const hint: React.CSSProperties = { fontSize: 12, color: colour.muted };
const panel: React.CSSProperties = {
  border: `1px solid ${colour.rule}`,
  padding: 16,
  marginBottom: 24,
};
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
  background: colour.ink,
  color: colour.paper,
  border: 'none',
  borderRadius: 2,
  cursor: 'pointer',
};
