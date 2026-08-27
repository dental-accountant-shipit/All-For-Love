/**
 * The three or four numbers the whole screen is about.
 *
 * Set large, in the serif, across the top — because the question somebody opens
 * a project to answer is almost always "where are we on this", and the answer
 * should not require reading a table first.
 *
 * The serif is doing real work here rather than decoration: at 30px the brand
 * face is perfectly readable, and these figures are read one at a time rather
 * than compared down a column, which is the only reason a serif is allowed
 * anywhere near a number in this application. Everything in a table stays in
 * the tabular sans.
 *
 * Colour follows the one rule: a figure is red only when the money has gone the
 * wrong way, and `tone` is the caller saying which figures are even capable of
 * that. A large cost is not bad news; a negative profit is.
 */

import { colour, type } from '../design/tokens';

export interface Figure {
  label: string;
  value: string;
  /**
   * `signed` means this figure carries good and bad news — colour it. `plain`
   * means it is just a quantity, however large. Default is plain, because most
   * figures are.
   */
  tone?: 'plain' | 'signed';
  /** Used with `signed` to decide the colour. Ignored otherwise. */
  negative?: boolean;
  /** A smaller figure or qualifier beside the value: a margin, a count. */
  note?: string;
  /** Shown under the label when the figure is unavailable rather than zero. */
  unavailable?: boolean;
}

export default function FigureStrip({ figures }: { figures: Figure[] }) {
  return (
    <dl style={S.strip} className="afl-figures">
      {figures.map((figure) => (
        <div key={figure.label} style={S.item}>
          <dt style={S.label}>{figure.label}</dt>
          <dd style={S.valueWrap}>
            <span
              style={{
                ...S.value,
                ...(figure.unavailable ? S.unavailable : null),
                ...(figure.tone === 'signed' && figure.negative ? S.negative : null),
              }}
            >
              {figure.value}
            </span>
            {figure.note ? <span style={S.note}>{figure.note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const S: Record<string, React.CSSProperties> = {
  strip: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 0,
    margin: '0 0 34px',
    padding: 0,
  },
  // A hairline between figures rather than boxes around them. Boxes would make
  // four cards; these are one statement in four parts.
  item: {
    padding: '2px 34px 2px 0',
    marginRight: 34,
    borderRight: `1px solid ${colour.rule}`,
    minWidth: 0,
  },
  label: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: type.trackingNav,
    textTransform: 'uppercase',
    color: colour.muted,
    marginBottom: 10,
  },
  valueWrap: { margin: 0, display: 'flex', alignItems: 'baseline', gap: 10 },
  value: {
    fontFamily: type.serif,
    fontSize: 30,
    fontWeight: 400,
    lineHeight: 1.1,
    letterSpacing: '-0.01em',
    whiteSpace: 'nowrap',
  },
  negative: { color: colour.signature },
  unavailable: { color: colour.ruleStrong },
  note: { fontSize: 13, color: colour.muted, whiteSpace: 'nowrap' },
};
