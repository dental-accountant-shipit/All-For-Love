/**
 * Guessing a workbook's shape.
 *
 * Every case here is a mistake this made against the real C & D workbook
 * before it was corrected. A budget workbook has no schema, so the detector
 * will always be a guess — but it should be wrong in ways a reviewer can see,
 * not in ways that silently double a category.
 */

import { describe, expect, it } from 'vitest';

import { detectSections } from '../import/readWorkbook';
import type { SheetReader } from '../../domain/import/plan';

/** Columns: A description, B quantity, C unit price, D line total, H unit cost. */
type Row = [string, number | null, number | null, number | null, number | null];

function sheet(rows: Record<number, Row>): SheetReader {
  const columns: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 8: 4 };
  return {
    name: 'Budget',
    rowCount: Math.max(...Object.keys(rows).map(Number)),
    cell: (row, col) => {
      const index = columns[col];
      return index === undefined ? null : (rows[row]?.[index] ?? null);
    },
  };
}

describe('detectSections', () => {
  it('finds a category and trims it to its last real line', () => {
    const { sections } = detectSections(
      sheet({
        1: ['VATICAN FLORALS', null, null, null, null],
        2: ['Arch', 1, 4800, 4800, 1200],
        3: ['Urns', 2, 4000, 8000, 3000],
        4: ['', 1, 0, 0, 0],
        5: ['SUB TOTAL', null, null, 12800, 4200],
      }),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ firstRow: 2, lastRow: 4, name: 'Vatican Florals' });
  });

  it('does not mistake a summary block for eight more categories', () => {
    // The failure that mattered. The reference workbook ends with one row per
    // category carrying a total and a cost and nothing else. Read as lines,
    // that is a second copy of the entire budget; read as headings, it is a
    // fistful of phantom sections. Both happened.
    const { sections, ignored } = detectSections(
      sheet({
        1: ['VATICAN FLORALS', null, null, null, null],
        2: ['Arch', 1, 4800, 4800, 1200],
        4: ['SUMMARY', null, null, null, null],
        5: ['Vatican Florals', null, null, 4800, 1200],
        6: ['Creative', null, null, 44579, 14599],
        7: ['Contingency', null, null, 18902, 0],
        8: ['EVENT TOTAL', null, null, 68281, 15799],
      }),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe('Vatican Florals');
    expect(ignored.map((i) => i.name)).toContain('SUMMARY');
  });

  it('takes the first event total, which is the one carrying a cost', () => {
    const { totalsRow } = detectSections(
      sheet({
        1: ['FLORALS', null, null, null, null],
        2: ['Arch', 1, 4800, 4800, 1200],
        4: ['EVENT TOTAL, in GBP', null, null, 4800, 1200],
        6: ['INVOICING', null, null, null, null],
        7: ['EVENT TOTAL', null, null, 4800, null],
      }),
    );

    // The later one repeats the total without the cost. Taking it would lose
    // the cost comparison, which is the most useful figure on the review
    // screen — it is where the £36,820 shows up.
    expect(totalsRow).toBe(4);
  });

  it('suggests flags for contingency and extras, and leaves them editable', () => {
    const { sections } = detectSections(
      sheet({
        1: ['FLORALS', null, null, null, null],
        2: ['Arch', 1, 4800, 4800, 0],
        4: ['CONTINGENCY', null, null, null, null],
        5: ['Contingency at 5.25%', 1, 0.0525, 252, 0],
        7: ['OPTIONAL EXTRAS', null, null, null, null],
        8: ['Extra lorry', 1, 9500, 9500, 9500],
        10: ['CREATIVE', null, null, null, null],
        11: ['Direction', 1, 1200, 1200, 1200],
      }),
    );

    const byName = Object.fromEntries(sections.map((s) => [s.name, s]));
    expect(byName['Contingency'].isContingency).toBe(true);
    expect(byName['Optional Extras'].isExtras).toBe(true);
    // Extras and Creative out of the contingency base; Florals in it. These
    // are suggestions the reviewer confirms — after which the behaviour rides
    // on the flag, never on the name.
    expect(byName['Optional Extras'].includeInContingencyBase).toBe(false);
    expect(byName['Creative'].includeInContingencyBase).toBe(false);
    expect(byName['Florals'].includeInContingencyBase).toBe(true);
  });

  it('drops a heading with nothing underneath it', () => {
    const { sections } = detectSections(
      sheet({
        1: ['FLORALS', null, null, null, null],
        2: ['Arch', 1, 4800, 4800, 0],
        4: ['RESERVED FOR LATER', null, null, null, null],
        5: ['', null, null, null, null],
      }),
    );
    expect(sections.map((s) => s.name)).toEqual(['Florals']);
  });
});
