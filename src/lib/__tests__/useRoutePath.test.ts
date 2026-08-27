import { describe, expect, it } from 'vitest';

import { normaliseRoute } from '../useRoutePath';

describe('route normalisation', () => {
  it('treats the hosted and on-disk forms of a route as the same', () => {
    // Firebase Hosting rewrites /sign-in; opening the export off disk gives
    // /sign-in.html. The sign-in gate and the active-tab highlight must not
    // depend on which one you are looking at.
    expect(normaliseRoute('/sign-in')).toBe('/sign-in');
    expect(normaliseRoute('/sign-in.html')).toBe('/sign-in');
    expect(normaliseRoute('/project/budget.html')).toBe('/project/budget');
  });

  it('collapses index and trailing slashes to the root', () => {
    expect(normaliseRoute('/')).toBe('/');
    expect(normaliseRoute('/index.html')).toBe('/');
    expect(normaliseRoute('/projects/')).toBe('/projects');
  });
});
