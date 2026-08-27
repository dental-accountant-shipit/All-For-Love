'use client';

import Link from 'next/link';
import { useRoutePath } from '../lib/useRoutePath';

import type { Project } from '../domain/types';
import { colour } from '../design/tokens';

export default function ProjectNav({ project }: { project: Project }) {
  const pathname = useRoutePath();
  const tabs = [
    { href: `/project?id=${project.id}`, label: 'Overview', path: '/project' },
    { href: `/project/budget?id=${project.id}`, label: 'Budget', path: '/project/budget' },
    { href: `/project/versions?id=${project.id}`, label: 'Versions', path: '/project/versions' },
  ];

  return (
    <header style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
        <h1 style={{ fontWeight: 400, fontSize: 22, margin: 0 }}>{project.name}</h1>
        <span style={{ fontSize: 13, color: colour.muted }}>
          {project.clientName}
          {project.eventDate ? ` · ${project.eventDate.slice(0, 10)}` : ''}
          {project.venue ? ` · ${project.venue}` : ''}
        </span>
      </div>
      <nav style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 14 }}>
        {tabs.map((t) => (
          <Link key={t.path} href={t.href} style={pathname === t.path ? { fontWeight: 600 } : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
