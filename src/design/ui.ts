/**
 * Shared component styling.
 *
 * Buttons, inputs, labels and table parts, in one place, so that a screen built
 * next month looks like the screens built today without anybody having to
 * remember a set of numbers.
 */

import type { CSSProperties } from 'react';

import { colour, radius, type } from './tokens';

/**
 * Primary actions are black.
 *
 * The live site's own buttons are already black and square, so this costs the
 * brand nothing — and it leaves red free to mean over budget, which is the one
 * signal in a costing application that must never be ambiguous.
 */
export const buttonPrimary: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: type.trackingLabel,
  textTransform: 'uppercase',
  padding: '10px 18px',
  color: colour.paper,
  background: colour.ink,
  border: `1px solid ${colour.ink}`,
  borderRadius: radius.base,
  cursor: 'pointer',
};

export const buttonSecondary: CSSProperties = {
  ...buttonPrimary,
  color: colour.ink,
  background: 'transparent',
  border: `1px solid ${colour.ruleStrong}`,
};

/** Quiet enough to sit inside a table without competing with the figures. */
export const buttonQuiet: CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  padding: '4px 0',
  color: colour.muted,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
};

/**
 * Destructive: black, with a red rule down its edge.
 *
 * A red fill would be a second meaning for red on a screen that already uses it
 * for money going the wrong way.
 */
export const buttonDestructive: CSSProperties = {
  ...buttonSecondary,
  borderLeft: `3px solid ${colour.signature}`,
};

export const input: CSSProperties = {
  width: '100%',
  font: 'inherit',
  fontSize: 15,
  padding: '9px 10px',
  color: colour.ink,
  background: colour.paper,
  border: `1px solid ${colour.rule}`,
  borderRadius: radius.base,
};

export const inputMoney: CSSProperties = {
  ...input,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

/** The small uppercase caption above a field or a section. */
export const label: CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: type.trackingLabel,
  textTransform: 'uppercase',
  color: colour.muted,
  marginBottom: 5,
};

/** Section headings on working screens: serif, quiet, not shouted. */
export const sectionTitle: CSSProperties = {
  fontFamily: type.serif,
  fontSize: 20,
  fontWeight: 400,
  margin: 0,
};

export const hint: CSSProperties = {
  fontSize: 13,
  color: colour.muted,
};

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
//
// No zebra striping, no card wrapper, no vertical rules. Rows are separated by
// a hairline and nothing else: a dense table of money is read down the columns,
// and every extra line drawn across it is one more thing between the eye and
// the figures.

export const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontVariantNumeric: 'tabular-nums',
};

export const tableHead: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: type.trackingLabel,
  textTransform: 'uppercase',
  color: colour.muted,
  textAlign: 'left',
  padding: '0 6px 9px',
  borderBottom: `1px solid ${colour.ink}`,
  whiteSpace: 'nowrap',
};

export const tableCell: CSSProperties = {
  height: 40,
  padding: '3px 6px',
  borderBottom: `1px solid ${colour.rule}`,
};

/** Totals sit under a black rule, so the eye can find them without a search. */
export const tableTotal: CSSProperties = {
  borderTop: `1px solid ${colour.ink}`,
  borderBottom: 'none',
  fontWeight: 600,
};

/** Wide tables scroll inside themselves. The page never scrolls sideways. */
export const tableScroll: CSSProperties = {
  overflowX: 'auto',
  maxWidth: '100%',
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function statusPill(kind: 'provisional' | 'committed' | 'settled'): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: type.trackingLabel,
    textTransform: 'uppercase',
    padding: '3px 8px',
    borderRadius: radius.base,
    whiteSpace: 'nowrap',
  };
  switch (kind) {
    case 'committed':
      return { ...base, background: colour.blush, color: colour.ink };
    case 'settled':
      return { ...base, background: '#e8f0ec', color: colour.verdant };
    default:
      return { ...base, border: `1px solid ${colour.ruleStrong}`, color: colour.muted };
  }
}
