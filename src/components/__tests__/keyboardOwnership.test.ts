/**
 * Who owns a keystroke.
 *
 * The budget grid listens for keys on the element that wraps the whole table,
 * because that is how a spreadsheet has to work: you click a cell and type, and
 * there is nothing focused to listen on until you do.
 *
 * The cost of that is that anything rendered *inside* the grid gets its
 * keystrokes read by the grid first. The add-a-line form is rendered inside it
 * — deliberately, so the line being written sits among the lines it is being
 * written among — and every character typed into it was being swallowed: with a
 * cell selected, the grid read each printable character as "start editing that
 * cell", called preventDefault, and the field being typed into never saw it.
 *
 * The contract that fixes it is one attribute and one guard, in two files that
 * do not import each other. That is exactly the kind of pairing that gets
 * half-removed a year later, so it is written down here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const grid = readFileSync(join(process.cwd(), 'src/components/BudgetGrid.tsx'), 'utf8');
const form = readFileSync(join(process.cwd(), 'src/components/AddLineForm.tsx'), 'utf8');

describe('keys typed inside the add-a-line form', () => {
  it('are claimed by the form', () => {
    expect(form).toContain('data-afl-own-keys');
  });

  it('are let through by the grid', () => {
    expect(grid).toContain("closest?.('[data-afl-own-keys]')");
    // The guard has to come before the grid does anything with the event —
    // after handleKey has run, preventDefault has already happened.
    expect(grid.indexOf("data-afl-own-keys")).toBeLessThan(grid.indexOf('const result = handleKey'));
  });

  it('do not leave a cell selected behind the open form', () => {
    expect(grid).toContain('if (addingIn) setState(initialGridState)');
  });
});
