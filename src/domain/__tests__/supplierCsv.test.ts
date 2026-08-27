/**
 * Reading a supplier list out of a file.
 *
 * The cases here are the ones that turn an import into silent data loss rather
 * than an error: a comma inside a quoted company name, a byte-order mark, CRLF
 * line endings, the same supplier twice with different punctuation. Every one
 * of them appears in a real export, and every one of them is invisible
 * afterwards — a supplier that quietly did not arrive is only discovered when a
 * bill turns up from somebody who is not in the list.
 */

import { describe, expect, it } from 'vitest';

import { parseCsv, planSupplierImport, normaliseName } from '../suppliers/csv';

describe('reading the file', () => {
  it('keeps a comma that is inside a company name', () => {
    const rows = parseCsv('Name,Email\n"Hydra Flowers, Ltd",a@b.com\n');
    expect(rows[1]).toEqual(['Hydra Flowers, Ltd', 'a@b.com']);
  });

  it('handles doubled quotes, newlines inside fields, CRLF and a byte-order mark', () => {
    const rows = parseCsv('﻿Name,Notes\r\n"The ""Good"" Florist","Line one\nLine two"\r\n');
    expect(rows[0]).toEqual(['Name', 'Notes']);
    expect(rows[1]).toEqual(['The "Good" Florist', 'Line one\nLine two']);
  });

  it('does not invent a final empty row from a trailing newline', () => {
    expect(parseCsv('Name\nA\n')).toHaveLength(2);
  });
});

describe('a Xero contacts export', () => {
  const xero = [
    'ContactName,AccountNumber,EmailAddress,FirstName,LastName,POAttentionTo,POAddressLine1,PhoneNumber,TaxNumber,AccountsPayableTaxCodeName',
    'Vianen All Flowers,SUP-001,orders@vianen.nl,,,Marieke,Aalsmeer 12,+31 20 555 0100,NL8123456B01,20% (VAT on Expenses)',
    'Smilex,SUP-002,hire@smilex.co.uk,Tom,Weller,,Unit 4,020 7946 0000,,20% (VAT on Expenses)',
  ].join('\n');

  it('recognises it', () => {
    const plan = planSupplierImport(xero);
    expect(plan.looksLikeXero).toBe(true);
    expect(plan.nameColumn).toBe('ContactName');
  });

  it('takes the names and nothing else', () => {
    // Names only, by request. An accounting contact book holds people's direct
    // emails and mobile numbers; copying all of that into a second system that
    // does not need it is a cost with no benefit. The details stay in Xero,
    // which is where anybody would look for them.
    const [first, second] = planSupplierImport(xero).toAdd;
    expect(first.name).toBe('Vianen All Flowers');
    expect(second.name).toBe('Smilex');
    expect(Object.keys(first).sort()).toEqual(['line', 'name', 'xeroContactId']);
  });

  it('reports the columns it left alone rather than pretending it read them', () => {
    const plan = planSupplierImport(xero);
    expect(plan.ignored).toContain('EmailAddress');
    expect(plan.ignored).toContain('AccountsPayableTaxCodeName');
    expect(plan.used).toEqual(['ContactName']);
  });

  it('reads Xero\'s asterisk on a required column', () => {
    // Xero marks required columns with a leading asterisk, so a real export
    // says *ContactName rather than ContactName. Comparing headings without
    // punctuation is what makes that a non-event.
    const plan = planSupplierImport('*ContactName,EmailAddress\nHydra,a@b.com');
    expect(plan.nameColumn).toBe('*ContactName');
    expect(plan.toAdd[0].name).toBe('Hydra');
  });
});

describe('a list that is not from Xero', () => {
  it('finds the name column under another heading', () => {
    const plan = planSupplierImport('Supplier Name,E-mail\nCrescent Moon,hello@crescent.co.uk');
    expect(plan.nameColumn).toBe('Supplier Name');
    expect(plan.looksLikeXero).toBe(false);
    expect(plan.toAdd[0].name).toBe('Crescent Moon');
  });

  it('says so when there is no name column at all', () => {
    const plan = planSupplierImport('Reference,Amount\nX-1,100');
    expect(plan.nameColumn).toBeNull();
    expect(plan.toAdd).toEqual([]);
    // The headings come back so the screen can show what it did find.
    expect(plan.ignored).toEqual(['Reference', 'Amount']);
  });

  it('reads an empty file without falling over', () => {
    expect(planSupplierImport('').toAdd).toEqual([]);
  });
});

describe('what it refuses to add', () => {
  it('leaves out anybody already on the supplier list', () => {
    const plan = planSupplierImport('Name\nCrescent Moon\nHydra', [
      { id: 's1', name: 'crescent  moon' },
    ]);
    expect(plan.toAdd.map((s) => s.name)).toEqual(['Hydra']);
    expect(plan.skipped[0]).toMatchObject({ name: 'Crescent Moon', reason: 'already a supplier' });
  });

  it('adds a supplier once when the file lists it twice', () => {
    const plan = planSupplierImport('Name\nN.J.M.\nNJM');
    expect(plan.toAdd).toHaveLength(1);
    expect(plan.skipped[0].reason).toBe('repeated in this file');
  });

  it('reports a row that has content but no name', () => {
    const plan = planSupplierImport('Name,Email\n,orphan@example.com');
    expect(plan.toAdd).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({ line: 2, reason: 'no name' });
  });

  it('ignores blank lines silently', () => {
    const plan = planSupplierImport('Name\nHydra\n\n');
    expect(plan.toAdd).toHaveLength(1);
    expect(plan.skipped).toEqual([]);
  });

  it('reports the line number, counting the header, so it can be found in the file', () => {
    const plan = planSupplierImport('Name\nHydra\nHydra');
    expect(plan.skipped[0].line).toBe(3);
  });
});

describe('matching names', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(normaliseName('N.J.M.')).toBe(normaliseName('njm'));
    expect(normaliseName('Crescent Moon')).toBe(normaliseName('crescent-moon'));
  });

  it('does not merge two suppliers that merely look alike', () => {
    expect(normaliseName('Hydra')).not.toBe(normaliseName('Hydra 2'));
  });
});
