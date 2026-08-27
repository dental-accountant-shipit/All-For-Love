'use client';

import { useSearchParams } from 'next/navigation';

/**
 * Project screens address a project with `?id=`, not a path segment.
 *
 * The application is a static export served by Firebase Hosting, and a dynamic
 * path segment would need every project's ID known at build time. A query
 * parameter costs nothing and keeps deployment to a single upload.
 */
export function useProjectId(): string | null {
  return useSearchParams().get('id');
}
