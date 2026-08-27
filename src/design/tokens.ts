/**
 * The design tokens, for code.
 *
 * Every value is a reference to a custom property declared in
 * `src/app/globals.css` — never a literal. A hex typed into a component is a
 * decision made twice, and the second one drifts. A test checks that each name
 * here exists there.
 *
 * Why inline styles at all: this application has no CSS framework and no build
 * step beyond Next's own, and the screens are few. Referencing variables keeps
 * the single source of truth in the stylesheet where a designer can find it.
 */

export const colour = {
  ink: 'var(--afl-ink)',
  paper: 'var(--afl-paper)',
  /** Brand red. Inside a data region this means over budget and nothing else. */
  signature: 'var(--afl-signature)',
  blush: 'var(--afl-blush)',
  /** Semantic only: under budget, settled. Never decorative. */
  verdant: 'var(--afl-verdant)',
  ground: 'var(--afl-ground)',
  rule: 'var(--afl-rule)',
  ruleStrong: 'var(--afl-rule-strong)',
  muted: 'var(--afl-muted)',
} as const;

export const type = {
  serif: 'var(--afl-serif)',
  sans: 'var(--afl-sans)',
  trackingNav: 'var(--afl-tracking-nav)',
  trackingLabel: 'var(--afl-tracking-label)',
} as const;

export const radius = {
  base: 'var(--afl-radius)',
  panel: 'var(--afl-radius-panel)',
} as const;

/**
 * The colour a figure should be.
 *
 * The entire ruling on red, in one function, so that no screen has to remember
 * it. Over budget is red; under budget is verdant only where being under is
 * itself the news; everything else is plain ink. A figure that is merely large
 * is not coloured.
 */
export function figureColour(state: 'over' | 'under' | 'neutral'): string {
  switch (state) {
    case 'over':
      return colour.signature;
    case 'under':
      return colour.verdant;
    default:
      return colour.ink;
  }
}
