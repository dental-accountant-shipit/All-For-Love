'use client';

/**
 * Shared plumbing for every project screen: read the id, load the project,
 * handle the states that are not the happy path.
 */

import { Suspense, type ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { useAuth } from '../lib/auth/AuthProvider';
import { useProjectId } from '../lib/useProjectId';
import { firestore } from '../lib/firestore/client';
import { watchProject } from '../lib/firestore/projects';
import ProjectNav from './ProjectNav';
import type { Project } from '../domain/types';

function Inner({ children }: { children: (project: Project) => ReactNode }) {
  const { user } = useAuth();
  const projectId = useProjectId();
  const [project, setProject] = useState<Project | null | undefined>(undefined);

  useEffect(() => {
    if (!user || !projectId) return;
    return watchProject(firestore(), projectId, setProject);
  }, [user, projectId]);

  if (!projectId) return <p style={{ color: '#666' }}>No project selected.</p>;
  if (project === undefined) return <p style={{ color: '#666' }}>Loading…</p>;
  if (project === null) return <p style={{ color: '#666' }}>That project no longer exists.</p>;

  return (
    <>
      <ProjectNav project={project} />
      {children(project)}
    </>
  );
}

export default function ProjectScreen({ children }: { children: (project: Project) => ReactNode }) {
  return (
    <Suspense fallback={<p style={{ color: '#666' }}>Loading…</p>}>
      <Inner>{children}</Inner>
    </Suspense>
  );
}
