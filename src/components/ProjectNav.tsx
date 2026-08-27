'use client';

/**
 * The project's own header: what this is, and the three ways to look at it.
 *
 * The tabs repeat the top navigation's gesture — uppercase serif, tracked,
 * blush underline on the current one — a step smaller, so the hierarchy reads
 * without a second visual language being invented for it.
 */

import Link from 'next/link';

import { useRoutePath } from '../lib/useRoutePath';
import type { Project } from '../domain/types';
import { colour, type } from '../design/tokens';

const STATUS_LABELS: Record<string, string> = {
  enquiry: 'Enquiry',
  proposal: 'Proposal',
  confirmed: 'Confirmed',
  delivered: 'Delivered',
  closed: 'Closed',
};

export default function ProjectNav({ project }: { project: Project }) {
  const pathname = useRoutePath();
  const tabs = [
    { href: `/project?id=${project.id}`, label: 'Overview', path: '/project' },
    { href: `/project/budget?id=${project.id}`, label: 'Budget', path: '/project/budget' },
    { href: `/project/versions?id=${project.id}`, label: 'Versions', path: '/project/versions' },
  ];

  const meta = [
    project.clientName,
    project.venue,
    project.eventDate ? formatEventDate(project.eventDate) : null,
  ].filter(Boolean);

  return (
    <header style={S.wrap}>
      <div style={S.titleRow}>
        <h1 style={S.title}>{project.name}</h1>
        <span style={S.status}>
          {STATUS_LABELS[project.status] ?? project.status.replace(/_/g, ' ')}
        </span>
      </div>

      {meta.length > 0 ? <p style={S.meta}>{meta.join('  ·  ')}</p> : null}

      <nav style={S.tabs}>
        {tabs.map((tab) => {
          const on = pathname === tab.path;
          return (
            <Link
              key={tab.path}
              href={tab.href}
              style={{ ...S.tab, ...(on ? S.tabOn : null) }}
              aria-current={on ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

/** 6 September 2026 — the way anybody in this office would write it. */
function formatEventDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

const S: Record<string, React.CSSProperties> = {
  wrap: { marginBottom: 30, borderBottom: `1px solid ${colour.rule}` },
  titleRow: { display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' },
  title: {
    fontFamily: type.serif,
    fontSize: 34,
    fontWeight: 400,
    lineHeight: 1.08,
    letterSpacing: '-0.015em',
    margin: 0,
  },
  status: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: type.trackingNav,
    textTransform: 'uppercase',
    color: colour.muted,
    border: `1px solid ${colour.rule}`,
    borderRadius: 2,
    padding: '3px 8px',
  },
  meta: { margin: '10px 0 0', fontSize: 13, color: colour.muted },
  tabs: { display: 'flex', gap: 22, marginTop: 22 },
  tab: {
    fontFamily: type.serif,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: type.trackingNav,
    textTransform: 'uppercase',
    color: colour.muted,
    paddingBottom: 10,
    marginBottom: -1,
    borderBottom: '2px solid transparent',
    textDecoration: 'none',
  },
  tabOn: { color: colour.ink, borderBottomColor: colour.blush },
};
