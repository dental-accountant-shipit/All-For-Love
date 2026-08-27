/**
 * The top of a working screen.
 *
 * A serif title, an optional line of context beside it, and the actions pushed
 * to the right. Nothing else — a working screen earns its brand from the header
 * strip above it and from the typeface, and spends the rest of its budget on
 * the figures.
 *
 * It exists so that every screen has the same first inch. Screens that each
 * invent their own heading drift apart within a month, and the drift is always
 * downwards.
 */

import type { ReactNode } from 'react';

import { colour, type } from '../design/tokens';

export default function PageHeader({
  title,
  meta,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  /** Client, venue, date — the things that identify what you are looking at. */
  meta?: ReactNode;
  actions?: ReactNode;
  /** Small tracked label above the title, for screens that need locating. */
  eyebrow?: string;
}) {
  return (
    <header style={S.wrap}>
      <div style={S.left}>
        {eyebrow ? <p style={S.eyebrow}>{eyebrow}</p> : null}
        <h1 style={S.title}>{title}</h1>
        {meta ? <p style={S.meta}>{meta}</p> : null}
      </div>
      {actions ? <div style={S.actions}>{actions}</div> : null}
    </header>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 24,
    flexWrap: 'wrap',
    paddingBottom: 18,
    marginBottom: 26,
    borderBottom: `1px solid ${colour.rule}`,
  },
  left: { marginRight: 'auto', minWidth: 0 },
  eyebrow: {
    margin: '0 0 8px',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: type.trackingNav,
    textTransform: 'uppercase',
    color: colour.muted,
  },
  title: {
    fontFamily: type.serif,
    fontSize: 32,
    fontWeight: 400,
    lineHeight: 1.1,
    letterSpacing: '-0.01em',
    margin: 0,
  },
  meta: { margin: '8px 0 0', fontSize: 13, color: colour.muted },
  actions: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
};
