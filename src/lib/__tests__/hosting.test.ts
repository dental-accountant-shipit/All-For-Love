/**
 * The gap between what the build produces and what Hosting will serve.
 *
 * This exists because of a bug that was invisible in normal use. The static
 * export writes `out/projects.html`; Firebase Hosting, without `cleanUrls`,
 * does not serve that file at `/projects`. The request fell through to the
 * catch-all rewrite and got the home page instead — so every route in the
 * application returned the wrong screen on a fresh load or a refresh.
 *
 * Nobody noticed because clicking a link never asks the server: the router
 * handles it in the browser and the right screen appears. It only broke on
 * reload, on a bookmark, and on a link someone was sent — which is to say, in
 * exactly the situations that matter and none of the ones you try while
 * building.
 *
 * Neither the test suite nor the type checker could see it. Both halves were
 * correct on their own; the mismatch was between them.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const firebaseConfig = JSON.parse(readFileSync('firebase.json', 'utf8')) as {
  hosting: {
    cleanUrls?: boolean;
    trailingSlash?: boolean;
    rewrites?: Array<{ source: string; destination: string }>;
  };
};

/** Every route the application defines, from the app directory. */
function routes(dir = 'src/app', prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...routes(path, `${prefix}/${entry}`));
    } else if (entry === 'page.tsx') {
      found.push(prefix === '' ? '/' : prefix);
    }
  }
  return found.sort();
}

describe('Firebase Hosting can serve what the build produces', () => {
  it('has cleanUrls on, so /projects resolves to projects.html', () => {
    // Without this, every route except "/" silently serves the home page.
    expect(firebaseConfig.hosting.cleanUrls).toBe(true);
  });

  it('keeps a catch-all rewrite for genuinely unknown paths', () => {
    const catchAll = firebaseConfig.hosting.rewrites?.find((r) => r.source === '**');
    expect(catchAll?.destination).toBe('/index.html');
  });

  it('finds every route in the app directory', () => {
    // A sanity check on the walker itself — if this stops finding routes, the
    // test below would pass vacuously.
    const found = routes();
    expect(found).toContain('/');
    expect(found).toContain('/projects');
    expect(found).toContain('/project/budget');
    expect(found).toContain('/admin/import');
    expect(found.length).toBeGreaterThanOrEqual(8);
  });

  it.skipIf(!existsSync('out'))('exports an HTML file for every route', () => {
    // Only meaningful after `npm run build`. In CI the build runs first.
    for (const route of routes()) {
      const file = route === '/' ? 'out/index.html' : `out${route}.html`;
      expect(existsSync(file), `${route} → ${file} is missing from the export`).toBe(true);
    }
  });
});
