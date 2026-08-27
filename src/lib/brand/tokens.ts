/**
 * All for Love — brand tokens.
 *
 * PLACEHOLDERS. Every value here was sampled from the live All for Love London
 * website (allforlovelondon.com) because no formal brand pack exists yet.
 * When one arrives, this file is the only place that changes.
 *
 * Nothing else in the application may hard-code a colour, a typeface or a
 * radius. If you find yourself typing a hex value in a component, it belongs
 * here instead.
 *
 * No logo is invented. `wordmark.assetPath` is null until a real file exists;
 * until then the header type-sets the name in the display serif.
 */

export interface BrandTokens {
  productName: string;
  wordmark: {
    /** Set to an SVG path once All for Love supply one. */
    assetPath: string | null;
    /** Used while assetPath is null. */
    typesetFallback: string;
  };
  colour: {
    ink: string;
    paper: string;
    canvas: string;
    signature: string;
    signatureSoft: string;
    positive: string;
    positiveSoft: string;
    rule: string;
    ruleStrong: string;
    muted: string;
  };
  type: {
    /** Charter on the website. Charis SIL is drawn from it and open-licensed. */
    serif: string;
    /** Helvetica Neue on the website. Archivo has true tabular figures. */
    sans: string;
    mono: string;
    /** The website's navigation gesture: uppercase, widely tracked. */
    navTracking: string;
  };
  radius: {
    /** Working screens. The website uses 0; 2px is kinder beside inputs. */
    control: string;
    input: string;
    /** Front-of-house panels only, echoing the website's colour blocks. */
    panel: string;
  };
  density: {
    /** Budget grid row height. Everything else follows from this. */
    rowHeight: string;
    dataFontSize: string;
    labelFontSize: string;
  };
}

export const brand: BrandTokens = {
  productName: 'All for Love — Projects',

  wordmark: {
    assetPath: null,
    typesetFallback: 'All for Love',
  },

  colour: {
    ink: '#000000',
    paper: '#FFFFFF',
    canvas: '#F7F4F3',
    // Sampled from the live site. Confirm against a master spec if one appears.
    signature: '#C10001',
    signatureSoft: '#FDD1D2',
    // Semantic, NOT brand. Under budget, settled, profit held.
    positive: '#1F5D45',
    positiveSoft: '#E4EFEA',
    rule: '#E4DEDC',
    ruleStrong: '#C8BFBC',
    muted: '#7A716E',
  },

  type: {
    serif: '"Charis SIL", "Source Serif 4", Charter, Georgia, serif',
    sans: 'Archivo, "Helvetica Neue", Helvetica, Arial, sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    navTracking: '0.24em',
  },

  radius: {
    control: '2px',
    input: '4px',
    panel: '20px',
  },

  density: {
    rowHeight: '40px',
    dataFontSize: '13px',
    labelFontSize: '11px',
  },
};

/**
 * The one rule that keeps a red brand usable in a financial application:
 *
 *   Primary actions are BLACK, not red.
 *   Red inside a data region always means over budget, over-committed, or a
 *   loss. Nothing else in a table is ever red.
 *
 * The website's own buttons are already black and square, so this costs
 * nothing and buys an unambiguous signal on the screens where ambiguity is
 * expensive.
 */
export const SEMANTIC_RED_IS_RESERVED_FOR_VARIANCE = true;

/** Emit the tokens as CSS custom properties for the app shell. */
export function brandCssVariables(t: BrandTokens = brand): string {
  return [
    `--afl-ink: ${t.colour.ink}`,
    `--afl-paper: ${t.colour.paper}`,
    `--afl-canvas: ${t.colour.canvas}`,
    `--afl-signature: ${t.colour.signature}`,
    `--afl-signature-soft: ${t.colour.signatureSoft}`,
    `--afl-positive: ${t.colour.positive}`,
    `--afl-positive-soft: ${t.colour.positiveSoft}`,
    `--afl-rule: ${t.colour.rule}`,
    `--afl-rule-strong: ${t.colour.ruleStrong}`,
    `--afl-muted: ${t.colour.muted}`,
    `--afl-serif: ${t.type.serif}`,
    `--afl-sans: ${t.type.sans}`,
    `--afl-mono: ${t.type.mono}`,
    `--afl-nav-tracking: ${t.type.navTracking}`,
    `--afl-radius-control: ${t.radius.control}`,
    `--afl-radius-input: ${t.radius.input}`,
    `--afl-radius-panel: ${t.radius.panel}`,
    `--afl-row-height: ${t.density.rowHeight}`,
    `--afl-data-size: ${t.density.dataFontSize}`,
    `--afl-label-size: ${t.density.labelFontSize}`,
  ].join(';\n  ');
}
