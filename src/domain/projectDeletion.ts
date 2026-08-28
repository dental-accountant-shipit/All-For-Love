/**
 * Deleting a project.
 *
 * Everything else in this system refuses to destroy things. Suppliers are
 * deactivated because one named on a bill from two years ago cannot be allowed
 * to vanish. A cost line carrying money is cancelled, not removed. Approved
 * budget versions cannot be edited by anybody, through any screen, ever.
 *
 * So a delete button needs a reason, and it has one: mistakes. A workbook
 * imported twice. A project created to try something. A name typed wrong before
 * anybody knew the real one. Those are not history worth keeping, and the
 * alternative — living with them for ever, or a service-account key and a
 * script — is worse than a guarded button.
 *
 * What makes it safe is not a confirmation dialog. It is that the system knows
 * the difference between a project nobody has worked on and one carrying real
 * money, and asks for more before destroying the second kind. This module is
 * where that difference is decided, so it can be tested rather than trusted.
 */

import { formatGBP } from './money';
import type { Pence } from './money';

export interface ProjectContents {
  /** Budget lines. */
  costItems: number;
  /** Approved or superseded versions — the part that is otherwise immutable. */
  approvedVersions: number;
  /** Money promised to suppliers. */
  committedTotal: Pence;
  /** Money actually spent. */
  actualTotal: Pence;
  /** What the client agreed to pay. */
  agreedClientRevenue: Pence;
}

/**
 * Has this project been worked on, or is it a mistake being cleared up?
 *
 * Real money is the test that matters — a commitment or a recorded cost means
 * somebody outside this system is involved. An approved version counts too: it
 * is a decision that was taken, and taking one back deserves a moment's pause.
 *
 * Lines alone do not count. A hundred and thirty lines typed into the wrong
 * project are still a mistake, and making somebody type a name to fix it would
 * be ceremony rather than care.
 */
export function hasRealWork(contents: ProjectContents): boolean {
  return (
    contents.committedTotal > 0 || contents.actualTotal > 0 || contents.approvedVersions > 0
  );
}

/**
 * What deleting this destroys, in the order somebody would want to hear it.
 *
 * Only what is actually there. A list padded with "0 commitments" reads as a
 * form, and a form is skimmed.
 */
export function describeDeletion(contents: ProjectContents): string[] {
  const parts: string[] = [];

  if (contents.costItems > 0) {
    parts.push(`${contents.costItems} budget ${contents.costItems === 1 ? 'line' : 'lines'}`);
  }
  if (contents.approvedVersions > 0) {
    parts.push(
      `${contents.approvedVersions} approved budget ${
        contents.approvedVersions === 1 ? 'version' : 'versions'
      }`,
    );
  }
  if (contents.agreedClientRevenue > 0) {
    parts.push(`${formatGBP(contents.agreedClientRevenue)} of agreed client revenue`);
  }
  if (contents.committedTotal > 0) {
    parts.push(`${formatGBP(contents.committedTotal)} committed to suppliers`);
  }
  if (contents.actualTotal > 0) {
    parts.push(`${formatGBP(contents.actualTotal)} of recorded costs`);
  }

  if (parts.length === 0) parts.push('nothing — this project is empty');
  return parts;
}

/**
 * Does the typed name match the project's?
 *
 * Loose on the things that are not the point — surrounding space, capitals,
 * a double space between words — and strict on the name itself. Somebody who
 * has read the name and typed it back has demonstrated what this asks for;
 * making them match a stray capital as well would only teach them to
 * copy and paste, which demonstrates nothing.
 */
export function nameMatches(typed: string, projectName: string): boolean {
  const tidy = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const wanted = tidy(projectName);
  return wanted.length > 0 && tidy(typed) === wanted;
}
