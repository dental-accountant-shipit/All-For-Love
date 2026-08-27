'use client';

import { usePathname } from 'next/navigation';

/**
 * The current route, normalised.
 *
 * A static export can be served either through Firebase Hosting's rewrite
 * (`/sign-in`) or straight off disk (`/sign-in.html`). Comparing the raw
 * pathname would make navigation highlighting and the sign-in gate behave
 * differently depending on how the build is being served.
 */
export function normaliseRoute(raw: string): string {
  const withoutExtension = raw.replace(/\.html$/, '');
  const withoutIndex = withoutExtension.replace(/\/index$/, '');
  const trimmed = withoutIndex.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export function useRoutePath(): string {
  return normaliseRoute(usePathname() ?? '/');
}
