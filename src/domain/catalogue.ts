/**
 * The line catalogue — the things All for Love budget for, over and over.
 *
 * Every entry here was derived from the C & D Wedding master budget rather
 * than imagined. That matters, because the obvious way to build a list like
 * this is to picture a florist's job and write down what comes to mind, and
 * the result reads plausibly and is subtly wrong: it has "centrepieces" and no
 * "ballast allowance", "delivery" and no "carnet", and it forgets that half a
 * wedding's cost is people standing in a field for seven days.
 *
 * What the workbook could NOT supply is a catalogue directly. Its descriptions
 * are one-offs — "Onsite - Sunday 7 Dec - 13 Dec - 7 days - FIN" is never
 * typed twice. What repeats is the KIND of line, and its shape: dressing is
 * priced per metre, crew per day, per diems per person per day. So each entry
 * carries the mode it should arrive in, which is the part that saves real time
 * — a line that knows it is a per-metre line stops somebody typing a total
 * into a rate column, which is the single ambiguity that cost the reference
 * workbook £36,820.
 *
 * This is a starting point, not a rule. Every entry is editable, the list is
 * stored per-account rather than compiled in, and anything typed that is not
 * in it can be added in one click. A catalogue that cannot grow is a catalogue
 * that is wrong by the third event.
 */

import type { Audit, CostMode } from './types';

export interface CatalogueEntry {
  id: string;
  /** What goes in the description cell. */
  description: string;
  /** Which category this usually belongs to, by name. A hint, never a rule. */
  category: string;
  /** The shape the line should arrive in. */
  mode: CostMode;
  /**
   * What one unit is, on a quantity line: "metre", "day", "stem", "person".
   * Shown beside the quantity so nobody has to remember what 24 means.
   */
  unit: string | null;
  /** Seeded entries can be told from ones somebody added. */
  seeded: boolean;
  /** Bumped when the entry is used, so the picker can put common things first. */
  usageCount: number;
  audit?: Audit;
}

type Seed = Omit<CatalogueEntry, 'id' | 'seeded' | 'usageCount' | 'audit'>;

const lump = (category: string, description: string): Seed => ({
  description,
  category,
  mode: 'lump',
  unit: null,
});

const per = (category: string, description: string, unit: string): Seed => ({
  description,
  category,
  mode: 'quantity',
  unit,
});

/**
 * The seeded catalogue, grouped as it is grouped in the budget.
 *
 * Names are deliberately generic where the workbook was specific: "Church
 * arch — external" rather than "External Church Arch", because the next one is
 * a cathedral, a barn or a marquee. The point is to save the typing and set
 * the shape, not to describe C & D twice.
 */
export const SEEDED_CATALOGUE: Seed[] = [
  // ------------------------------------------------------------- florals
  lump('Florals', 'Ceremony arch — external'),
  lump('Florals', 'Ceremony arch — internal'),
  lump('Florals', 'Entrance archway'),
  per('Florals', 'Steps dressing', 'metre'),
  per('Florals', 'Aisle runner', 'metre'),
  per('Florals', 'Outside runner to border carpet', 'metre'),
  per('Florals', 'Railing dressing', 'metre'),
  per('Florals', 'Entrance urns', 'urn'),
  per('Florals', 'Large urns', 'urn'),
  per('Florals', 'Bar urns', 'urn'),
  per('Florals', 'Pillar and column dressing', 'column'),
  per('Florals', 'Archway dressing with florals', 'archway'),
  lump('Florals', 'Feature wall'),
  lump('Florals', 'Letters and signage florals'),
  lump('Florals', 'Marquee dressing'),
  per('Florals', 'Poseur table arrangements', 'table'),
  per('Florals', 'Coffee and lounge table arrangements', 'table'),
  per('Florals', 'Dining table centrepieces', 'table'),
  lump('Florals', 'Top table dressing'),
  lump('Florals', 'Reflexed roses in glass vases'),
  lump('Florals', 'Stage design and dressing'),
  lump('Florals', 'Back bar dressing'),
  lump('Florals', 'Toilets and washroom florals'),
  lump('Florals', 'Bridal bouquet'),
  per('Florals', 'Bridesmaid bouquets', 'bouquet'),
  per('Florals', 'Flower girl crowns', 'crown'),
  per('Florals', 'Buttonholes', 'buttonhole'),
  per('Florals', 'Corsages', 'corsage'),
  lump('Florals', 'Candles allowance'),
  per('Florals', 'Hurricane candles', 'candle'),
  lump('Florals', 'Hotel suite flowers — allowance'),
  lump('Florals', 'Ballast — allowance'),

  // -------------------------------------------------------- labour / team
  per('Labour / Team', 'Onsite florist — day rate', 'day'),
  per('Labour / Team', 'Onsite freelance florist — day rate', 'day'),
  per('Labour / Team', 'Onsite crew — day rate', 'day'),
  per('Labour / Team', 'Crew overnight shift', 'shift'),
  per('Labour / Team', 'Crew overtime', 'hour'),
  per('Labour / Team', 'Pre-planning — days', 'day'),
  per('Labour / Team', 'Prep at studio — florists', 'day'),
  per('Labour / Team', 'Prep at studio — cleaners', 'day'),
  per('Labour / Team', 'Pack down at studio, post event', 'day'),
  per('Labour / Team', 'Post-event reconciliation', 'day'),
  lump('Labour / Team', 'Photographer'),

  // ------------------------------------------------------------ catering
  per('Catering', 'Per diems — team meals', 'person-day'),
  lump('Catering', 'Onsite catering — breakfast, lunch, dinner'),
  lump('Catering', 'Lunches on site'),
  lump('Catering', 'Crew catering — allowance'),

  // --------------------------------------------- transport, site visits
  lump('Transport, Site Visits', 'Arctic lorry — there and back'),
  lump('Transport, Site Visits', 'Luton van'),
  lump('Transport, Site Visits', 'Flower truck to site'),
  per('Transport, Site Visits', 'Taxis and transfers — allowance', 'journey'),
  lump('Transport, Site Visits', 'Carnet'),
  lump('Transport, Site Visits', 'Site visit — travel and accommodation'),
  per('Transport, Site Visits', 'Flights — florist team', 'flight'),
  per('Transport, Site Visits', 'Flights — crew', 'flight'),
  lump('Transport, Site Visits', 'Transport between venues'),

  // --------------------------------------------------- admin, equipment
  lump('Admin, Equipment', 'Crates and boxes'),
  lump('Admin, Equipment', 'Equipment hire'),
  lump('Admin, Equipment', 'Waste disposal'),
  lump('Admin, Equipment', 'Accommodation'),
  lump('Admin, Equipment', 'Security'),
  lump('Admin, Equipment', 'General onsite expenses — allowance'),
  lump('Admin, Equipment', 'Studio consumables'),

  // ------------------------------------------------------------ creative
  per('Creative', 'Creative direction and design', 'day'),
  lump('Creative', 'Renders and visuals'),
  lump('Creative', 'Mood boards and proposal'),
  per('Creative', 'Designer time', 'day'),

  // --------------------------------------------------------- contingency
  {
    description: 'Contingency',
    category: 'Contingency',
    mode: 'percentage',
    unit: null,
  },
];

/** Deterministic ids, so seeding twice cannot produce two of anything. */
export function seedId(entry: { category: string; description: string }): string {
  return `${entry.category}::${entry.description}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

export function seededCatalogue(): CatalogueEntry[] {
  return SEEDED_CATALOGUE.map((entry) => ({
    ...entry,
    id: seedId(entry),
    seeded: true,
    usageCount: 0,
  }));
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

/** Words, lowercased, punctuation dropped. "per-metre" matches "per metre". */
function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Score an entry against what has been typed so far.
 *
 * Every typed word must appear somewhere, so "table arr" finds "Poseur table
 * arrangements" and "urn flight" finds nothing rather than everything. Beyond
 * that the ranking is unglamorous and predictable, which is what a picker
 * wants: a description starting with the query beats one merely containing it,
 * the current category beats another category, and something used often beats
 * something never used. Predictable ordering means the second time you add a
 * line you can type two letters and press Enter without looking.
 *
 * Returns null when the entry does not match at all.
 */
export function scoreEntry(
  entry: CatalogueEntry,
  query: string,
  currentCategory?: string,
): number | null {
  const terms = words(query);
  const haystack = `${entry.description} ${entry.category} ${entry.unit ?? ''}`.toLowerCase();

  if (terms.length === 0) {
    // An empty query lists everything, best-known first.
    return 100 + Math.min(entry.usageCount, 50) + (entry.category === currentCategory ? 200 : 0);
  }

  for (const term of terms) {
    if (!haystack.includes(term)) return null;
  }

  const description = entry.description.toLowerCase();
  const descriptionWords = words(entry.description);
  let score = 0;

  if (description.startsWith(query.trim().toLowerCase())) score += 1000;

  // Every term is scored against the DESCRIPTION separately from the rest of
  // the haystack, and this is the part that matters. An entry can match
  // through its category or its unit — typing "day" reaches every line priced
  // per day, which is useful — but a match on the words somebody can actually
  // see must always outrank a match on metadata they cannot. Without this,
  // typing "day" in Creative surfaced "Designer time" above "Onsite crew — day
  // rate", because the category bonus happened to be bigger than the word
  // bonus. Ranking by whichever constant is larger is not ranking.
  for (const term of terms) {
    if (descriptionWords.includes(term)) score += 120;
    else if (description.includes(term)) score += 40;
  }

  // Only ever a tie-breaker between comparable matches.
  if (entry.category === currentCategory) score += 60;

  score += Math.min(entry.usageCount, 50);
  // Shorter descriptions win ties: "Bridal bouquet" over "Bridal bouquet and
  // three bridesmaid bouquets, ivory".
  score += Math.max(0, 60 - entry.description.length);
  return score;
}

export interface SearchOptions {
  currentCategory?: string;
  limit?: number;
}

export function searchCatalogue(
  entries: CatalogueEntry[],
  query: string,
  options: SearchOptions = {},
): CatalogueEntry[] {
  const limit = options.limit ?? 8;
  const scored: Array<{ entry: CatalogueEntry; score: number }> = [];

  for (const entry of entries) {
    const score = scoreEntry(entry, query, options.currentCategory);
    if (score !== null) scored.push({ entry, score });
  }

  return scored
    .sort((a, b) =>
      b.score !== a.score ? b.score - a.score : a.entry.description.localeCompare(b.entry.description),
    )
    .slice(0, limit)
    .map((s) => s.entry);
}

/**
 * Is this description already in the catalogue?
 *
 * Compared on words rather than characters, so "Bridal Bouquet", "bridal
 * bouquet" and "Bridal  bouquet" are one thing. Otherwise the catalogue fills
 * up with the same line in four capitalisations, which is exactly what the
 * workbook's supplier column did with Crescent Moon.
 */
export function isInCatalogue(entries: CatalogueEntry[], description: string): boolean {
  const target = words(description).join(' ');
  if (target === '') return true;
  return entries.some((entry) => words(entry.description).join(' ') === target);
}
