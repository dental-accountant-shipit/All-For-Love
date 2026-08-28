'use client';

/**
 * The settings area's own header and tabs.
 *
 * People and the workbook import used to sit in the top navigation beside
 * Projects and Suppliers, which put two things nobody touches in a normal week
 * next to the two things everybody touches every day. Worse, the one control
 * that deletes a project was at the bottom of that project — findable only if
 * you already knew where to look, and only after finding the right one of two
 * identically-named imports.
 *
 * They are one thing: running the system rather than running an event. So they
 * are one place, with the same tab gesture the project screens use, a step
 * smaller than the top navigation.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

import { useAuth } from '../lib/auth/AuthProvider';
import { useRoutePath } from '../lib/useRoutePath';
import EmptyState from './EmptyState';
import PageHeader from './PageHeader';
import { colour, type } from '../design/tokens';

const TABS = [
  { href: '/settings', label: 'Projects', path: '/settings' },
  { href: '/settings/people', label: 'People', path: '/settings/people' },
  { href: '/settings/import', label: 'Import', path: '/settings/import' },
];

export default function SettingsShell({
  title,
  meta,
  actions,
  children,
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { user, can } = useAuth();
  const pathname = useRoutePath();

  if (!user) return null;

  // One gate for the whole area rather than three that could drift apart.
  if (!can('manageUsers')) {
    return (
      <>
        <PageHeader title="Settings" />
        <EmptyState title="This one is not yours">
          <p>
            Settings is where accounts, roles and whole projects are changed, so it is kept
            to the owner. If that should be you, ask whoever set the system up.
          </p>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <header style={S.wrap}>
        <p style={S.eyebrow}>Settings</p>
        <div style={S.titleRow}>
          <h1 style={S.title}>{title}</h1>
          {actions ? <div style={S.actions}>{actions}</div> : null}
        </div>
        {meta ? <p style={S.meta}>{meta}</p> : null}

        <nav style={S.tabs}>
          {TABS.map((tab) => {
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

      {children}
    </>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { paddingBottom: 0, marginBottom: 26, borderBottom: `1px solid ${colour.rule}` },
  eyebrow: {
    margin: '0 0 8px',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: type.trackingNav,
    textTransform: 'uppercase',
    color: colour.muted,
  },
  titleRow: { display: 'flex', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' },
  title: {
    fontFamily: type.serif,
    fontSize: 32,
    fontWeight: 400,
    lineHeight: 1.1,
    letterSpacing: '-0.01em',
    margin: 0,
    marginRight: 'auto',
  },
  actions: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  meta: { margin: '8px 0 0', fontSize: 13, color: colour.muted },

  tabs: { display: 'flex', gap: 24, marginTop: 20 },
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
