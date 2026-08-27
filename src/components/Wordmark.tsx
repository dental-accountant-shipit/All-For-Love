/**
 * A type-set stand-in for the wordmark.
 *
 * The real one is a fine-line serif with a script *for* and a heart in place of
 * the V, and it is not mine to draw. Nothing here traces it: this sets the same
 * words in the same serif, with *for* in italic at a smaller size, which is
 * enough to read as All for Love without pretending to be the mark itself.
 *
 * When the SVG arrives — light and dark, per the asset register — it replaces
 * the span here and nothing else changes.
 */

import { colour, type } from '../design/tokens';

export default function Wordmark({
  tone = 'ink',
  size = 17,
}: {
  tone?: 'ink' | 'paper';
  size?: number;
}) {
  const ground = tone === 'paper' ? colour.paper : colour.ink;

  return (
    <span
      style={{
        fontFamily: type.serif,
        fontSize: size,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: ground,
        whiteSpace: 'nowrap',
      }}
    >
      All{' '}
      <span
        style={{
          fontStyle: 'italic',
          fontSize: '0.82em',
          letterSpacing: '0.04em',
          textTransform: 'lowercase',
        }}
      >
        for
      </span>{' '}
      Love
    </span>
  );
}
