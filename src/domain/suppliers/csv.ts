/**
 * Bringing a supplier list in from a file.
 *
 * The realistic source is Xero's Contacts export, so the column names it writes
 * are recognised without anybody being asked to rename anything. But the parser
 * does not *require* Xero: it looks for a name column among several plausible
 * headings, and takes what else it finds. Somebody with a list in Numbers
 * should not have to reformat it to match an accounting package.
 *
 * The work happens here, in a pure module, and not in the screen — this is
 * exactly the kind of scaffolding that has been wrong every previous time,
 * where the engine never was.
 *
 * Two things it deliberately does not do:
 *
 *  - It does not guess whether a contact is a **supplier**. Xero's contacts
 *    export contains customers and suppliers in one file with nothing to tell
 *    them apart, so the screen shows what was found and lets a person decide,
 *    rather than inventing a rule that quietly loses half the list or imports
 *    the client as a florist.
 *  - It does not guess **company or freelancer**. Nothing in the file says, and
 *    a wrong guess on two hundred rows is worse than a blank on two hundred
 *    rows.
 */

export interface ParsedSupplier {
  name: string;
  /** Xero's own id, when the export carries one. Null otherwise. */
  xeroContactId: string | null;
  /** Which line of the file this came from, for reporting. 1-based, header included. */
  line: number;
}

export interface SkippedRow {
  line: number;
  name: string;
  reason: 'no name' | 'repeated in this file' | 'already a supplier';
}

export interface SupplierImportPlan {
  /** Which heading was used as the supplier name. */
  nameColumn: string | null;
  /** Headings that were recognised and used, in file order. */
  used: string[];
  /** Headings present in the file that nothing reads. Reported, not an error. */
  ignored: string[];
  toAdd: ParsedSupplier[];
  skipped: SkippedRow[];
  /** True when the file looks like a Xero contacts export. */
  looksLikeXero: boolean;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * A CSV reader that survives real files.
 *
 * Quoted fields containing commas, quoted fields containing newlines, doubled
 * quotes as an escape, CRLF, and a UTF-8 byte-order mark — all of which appear
 * in exports from accounting software and all of which turn a naive
 * `split(',')` into silent data loss rather than an error.
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // A trailing newline should not produce a row of one empty field.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      endField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

// ---------------------------------------------------------------------------
// Column detection
// ---------------------------------------------------------------------------

/** Compared without case, spaces or punctuation, so "Contact Name" finds ContactName. */
function key(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const NAME_COLUMNS = [
  'contactname', // Xero
  'name',
  'suppliername',
  'supplier',
  'company',
  'companyname',
  'businessname',
  'accountname',
];

const CONTACT_COLUMNS = ['poattentionto', 'attentionto', 'contact', 'primaryperson'];
const FIRST_NAME_COLUMNS = ['firstname'];
const LAST_NAME_COLUMNS = ['lastname'];
const EMAIL_COLUMNS = ['emailaddress', 'email', 'e-mail'];
const PHONE_COLUMNS = ['phonenumber', 'phone', 'telephone', 'tel', 'mobilenumber', 'mobile'];
const TAX_COLUMNS = ['taxnumber', 'vatnumber', 'vat', 'vatregistrationnumber'];
const XERO_ID_COLUMNS = ['contactid', 'xerocontactid'];

function findColumn(headings: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const index = headings.findIndex((h) => key(h) === candidate);
    if (index !== -1) return index;
  }
  return -1;
}

/** A supplier is the same supplier however it was punctuated on the day. */
export function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * Read the file and work out what would be added.
 *
 * Nothing is written here. The screen shows this plan, including everything it
 * intends to skip and why, and only then offers to go ahead — an import that
 * silently drops rows is how a supplier list ends up quietly incomplete, and
 * nobody finds out until a bill arrives from somebody who is not in it.
 */
export function planSupplierImport(
  text: string,
  existing: Array<{ id: string; name: string }> = [],
): SupplierImportPlan {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return {
      nameColumn: null,
      used: [],
      ignored: [],
      toAdd: [],
      skipped: [],
      looksLikeXero: false,
    };
  }

  const headings = rows[0];
  const nameAt = findColumn(headings, NAME_COLUMNS);

  if (nameAt === -1) {
    return {
      nameColumn: null,
      used: [],
      ignored: headings,
      toAdd: [],
      skipped: [],
      looksLikeXero: false,
    };
  }

  const contactAt = findColumn(headings, CONTACT_COLUMNS);
  const firstAt = findColumn(headings, FIRST_NAME_COLUMNS);
  const lastAt = findColumn(headings, LAST_NAME_COLUMNS);
  const emailAt = findColumn(headings, EMAIL_COLUMNS);
  const phoneAt = findColumn(headings, PHONE_COLUMNS);
  const taxAt = findColumn(headings, TAX_COLUMNS);
  const xeroAt = findColumn(headings, XERO_ID_COLUMNS);

  // Only the name and, where present, Xero's own id are read. The rest are
  // detected purely so the screen can say honestly which columns it looked at
  // and which it left alone.
  const usedIndexes = [nameAt, xeroAt].filter((index) => index !== -1);
  const recognisedButUnused = [contactAt, firstAt, lastAt, emailAt, phoneAt, taxAt].filter(
    (index) => index !== -1,
  );
  void recognisedButUnused;
  const used = usedIndexes.map((index) => headings[index]);
  const ignored = headings.filter((_, index) => !usedIndexes.includes(index) && headings[index]);

  // Xero writes these two next to each other and almost nothing else does.
  const looksLikeXero =
    key(headings[nameAt]) === 'contactname' &&
    headings.some((h) => key(h) === 'poaddressline1' || key(h) === 'accountspayabletaxcodename');

  const alreadyHave = new Set(existing.map((supplier) => normaliseName(supplier.name)));
  const seenInFile = new Set<string>();

  const toAdd: ParsedSupplier[] = [];
  const skipped: SkippedRow[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const line = r + 1;
    const name = (cells[nameAt] ?? '').trim();

    if (name === '') {
      // A blank line at the end of a file is not worth reporting; a row with
      // other content but no name is.
      if (cells.some((cell) => cell.trim() !== '')) {
        skipped.push({ line, name: '', reason: 'no name' });
      }
      continue;
    }

    const normalised = normaliseName(name);

    if (alreadyHave.has(normalised)) {
      skipped.push({ line, name, reason: 'already a supplier' });
      continue;
    }
    if (seenInFile.has(normalised)) {
      skipped.push({ line, name, reason: 'repeated in this file' });
      continue;
    }
    seenInFile.add(normalised);

    const at = (index: number) => (index === -1 ? '' : (cells[index] ?? '').trim());

    // Names only, by request. An accounting contact book holds people's direct
    // emails and mobile numbers, and copying all of that into a second system
    // that does not need it is a cost with no benefit — the details live in
    // Xero, which is where anybody would look for them anyway.
    toAdd.push({ name, xeroContactId: at(xeroAt) || null, line });
  }

  return { nameColumn: headings[nameAt], used, ignored, toAdd, skipped, looksLikeXero };
}
