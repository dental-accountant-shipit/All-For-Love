/**
 * Nothing here yet.
 *
 * An empty screen is the one a person meets first and the one most likely to be
 * abandoned, so it gets room, a serif line that says what this place is for,
 * and the action that fills it. The alternative — a grey sentence and a table
 * with no rows — reads as something being broken.
 *
 * Deliberately not a dashed box. A dashed box says "a thing is missing"; this
 * should say "here is where you begin".
 */

import type { ReactNode } from 'react';

import { colour, type } from '../design/tokens';

export default function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div style={S.wrap}>
      <h2 style={S.title}>{title}</h2>
      {children ? <div style={S.body}>{children}</div> : null}
      {action ? <div style={S.action}>{action}</div> : null}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: '54px 0 60px', maxWidth: '52ch' },
  title: {
    fontFamily: type.serif,
    fontSize: 26,
    fontWeight: 400,
    lineHeight: 1.2,
    margin: 0,
  },
  body: { marginTop: 12, fontSize: 14, color: colour.muted, lineHeight: 1.6 },
  action: { marginTop: 22 },
};
