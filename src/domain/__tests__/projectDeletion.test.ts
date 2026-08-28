/**
 * When deleting a project asks for more than a click.
 *
 * The whole point of this module is that the system tells the difference
 * between clearing up a mistake and destroying somebody's work. If that
 * distinction is wrong, the button is either useless or dangerous.
 */

import { describe, expect, it } from 'vitest';

import { describeDeletion, hasRealWork, nameMatches } from '../projectDeletion';
import { toPence } from '../money';
import type { ProjectContents } from '../projectDeletion';

const contents = (overrides: Partial<ProjectContents> = {}): ProjectContents => ({
  costItems: 0,
  approvedVersions: 0,
  committedTotal: 0,
  actualTotal: 0,
  agreedClientRevenue: 0,
  ...overrides,
});

describe('telling a mistake from somebody’s work', () => {
  it('treats an empty project as a mistake', () => {
    expect(hasRealWork(contents())).toBe(false);
  });

  it('treats lines alone as a mistake', () => {
    // A hundred and thirty lines in the wrong project is still a mistake, and
    // making somebody type a name to undo it would be ceremony, not care.
    expect(hasRealWork(contents({ costItems: 133, agreedClientRevenue: toPence(423_538) }))).toBe(
      false,
    );
  });

  it('treats a recorded cost as real work', () => {
    expect(hasRealWork(contents({ actualTotal: toPence(1) }))).toBe(true);
  });

  it('treats a supplier commitment as real work', () => {
    // Somebody outside this system is now involved.
    expect(hasRealWork(contents({ committedTotal: toPence(500) }))).toBe(true);
  });

  it('treats an approved version as real work', () => {
    expect(hasRealWork(contents({ approvedVersions: 1 }))).toBe(true);
  });
});

describe('saying what will be destroyed', () => {
  it('lists only what is actually there', () => {
    const said = describeDeletion(contents({ costItems: 12, actualTotal: toPence(2_500) }));
    expect(said).toEqual(['12 budget lines', '£2,500.00 of recorded costs']);
  });

  it('says plainly when there is nothing in it', () => {
    expect(describeDeletion(contents())).toEqual(['nothing — this project is empty']);
  });

  it('counts one of something in the singular', () => {
    expect(describeDeletion(contents({ costItems: 1, approvedVersions: 1 }))).toEqual([
      '1 budget line',
      '1 approved budget version',
    ]);
  });

  it('describes the imported C & D project the way somebody would read it', () => {
    expect(
      describeDeletion(
        contents({
          costItems: 133,
          approvedVersions: 1,
          agreedClientRevenue: 42_353_875,
          actualTotal: 30_632_297,
        }),
      ),
    ).toEqual([
      '133 budget lines',
      '1 approved budget version',
      '£423,538.75 of agreed client revenue',
      '£306,322.97 of recorded costs',
    ]);
  });
});

describe('typing the name back', () => {
  it('accepts the name as written', () => {
    expect(nameMatches('Painted Hall', 'Painted Hall')).toBe(true);
  });

  it('forgives space and capitals, which are not the point', () => {
    expect(nameMatches('  painted   hall ', 'Painted Hall')).toBe(true);
  });

  it('refuses a different name', () => {
    expect(nameMatches('Painted', 'Painted Hall')).toBe(false);
    expect(nameMatches('', 'Painted Hall')).toBe(false);
  });

  it('refuses everything when the project has no name', () => {
    // Otherwise an empty box would match an empty name and delete it.
    expect(nameMatches('', '')).toBe(false);
    expect(nameMatches('   ', '  ')).toBe(false);
  });

  it('distinguishes two imports of the same workbook by their full names', () => {
    // The case this was written for: C & D went in twice, and the second is
    // named with a "(1)" on the end.
    const first = 'C and D wedding - MASTER Budget v14';
    const second = 'C and D wedding - MASTER Budget v14 (1)';
    expect(nameMatches(first, second)).toBe(false);
    expect(nameMatches(second, first)).toBe(false);
    expect(nameMatches(second, second)).toBe(true);
  });
});

describe('when the counts could not be read', () => {
  // The safe direction. A failed query must never make deleting easier than a
  // successful one — which is exactly what happened before: the screen caught
  // the error, set both counts to zero, and a project with an approved budget
  // and no recorded money became "empty" and deletable in one click.

  it('is treated as real work, so the name still has to be typed', () => {
    expect(hasRealWork(contents({ countsUnknown: true }))).toBe(true);
  });

  it('says so rather than reporting nothing', () => {
    const said = describeDeletion(contents({ countsUnknown: true }));
    expect(said[0]).toMatch(/count could not be read/);
    expect(said).not.toContain('nothing — this project is empty');
  });

  it('still reports the money, which comes from somewhere else', () => {
    const said = describeDeletion(
      contents({ countsUnknown: true, actualTotal: toPence(2_500) }),
    );
    expect(said).toContain('£2,500.00 of recorded costs');
  });
});
