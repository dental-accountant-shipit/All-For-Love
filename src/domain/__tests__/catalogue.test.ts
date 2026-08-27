/**
 * The line catalogue and its search.
 *
 * The search is the part worth testing hard. A picker that returns the right
 * answer second is worse than useless: you learn not to trust it, look at the
 * list every time, and end up slower than typing. So these assert ORDER, not
 * just membership.
 */

import { describe, expect, it } from 'vitest';

import {
  SEEDED_CATALOGUE,
  isInCatalogue,
  scoreEntry,
  searchCatalogue,
  seedId,
  seededCatalogue,
  type CatalogueEntry,
} from '../catalogue';

const entries = seededCatalogue();
const find = (description: string) => {
  const entry = entries.find((e) => e.description === description);
  if (!entry) throw new Error(`No catalogue entry "${description}"`);
  return entry;
};

describe('the seeded catalogue', () => {
  it('covers every starting category', () => {
    const categories = new Set(entries.map((e) => e.category));
    for (const expected of [
      'Florals',
      'Labour / Team',
      'Catering',
      'Transport, Site Visits',
      'Admin, Equipment',
      'Creative',
      'Contingency',
    ]) {
      expect(categories).toContain(expected);
    }
  });

  it('is big enough to be worth having and small enough to scan', () => {
    expect(entries.length).toBeGreaterThanOrEqual(50);
    expect(entries.length).toBeLessThanOrEqual(120);
  });

  it('gives every quantity line a unit, and no lump line one', () => {
    // A quantity of 24 means nothing without "metre" beside it. This is the
    // whole reason the catalogue sets the mode rather than just the words.
    for (const entry of entries) {
      if (entry.mode === 'quantity') {
        expect(entry.unit, `${entry.description} is a quantity line with no unit`).toBeTruthy();
      } else {
        expect(entry.unit, `${entry.description} is not a quantity line but has a unit`).toBeNull();
      }
    }
  });

  it('prices dressing per metre and people per day', () => {
    // The two shapes the reference workbook got into trouble over.
    expect(find('Steps dressing').mode).toBe('quantity');
    expect(find('Steps dressing').unit).toBe('metre');
    expect(find('Onsite florist — day rate').unit).toBe('day');
    expect(find('Per diems — team meals').unit).toBe('person-day');
  });

  it('has exactly one percentage line', () => {
    const percentage = entries.filter((e) => e.mode === 'percentage');
    expect(percentage).toHaveLength(1);
    expect(percentage[0].description).toBe('Contingency');
  });

  it('has no duplicates, by id or by description within a category', () => {
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);

    const pairs = entries.map((e) => `${e.category}::${e.description.toLowerCase()}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('generates the same id twice for the same entry', () => {
    // Seeding must be idempotent or a second run doubles the catalogue.
    const a = seedId({ category: 'Florals', description: 'Bridal bouquet' });
    const b = seedId({ category: 'Florals', description: 'Bridal bouquet' });
    expect(a).toBe(b);
    expect(a).toBe('florals-bridal-bouquet');
  });

  it('is not the generic florist list you would write from imagination', () => {
    // The tell that it came from a real budget: the unglamorous half.
    const all = entries.map((e) => e.description).join(' | ').toLowerCase();
    expect(all).toContain('carnet');
    expect(all).toContain('ballast');
    expect(all).toContain('per diems');
    expect(all).toContain('arctic lorry');
    expect(all).toContain('crates');
  });
});

describe('searching', () => {
  it('finds a line from the first few letters', () => {
    const results = searchCatalogue(entries, 'brid');
    expect(results[0].description).toBe('Bridal bouquet');
  });

  it('requires every typed word to appear', () => {
    expect(searchCatalogue(entries, 'table arr')[0].description).toBe(
      'Poseur table arrangements',
    );
    // Two words from unrelated lines match nothing, rather than everything.
    expect(searchCatalogue(entries, 'urn flight')).toEqual([]);
  });

  it('ignores case and punctuation', () => {
    expect(searchCatalogue(entries, 'DAY-RATE').length).toBeGreaterThan(0);
    expect(searchCatalogue(entries, 'per diems')[0].description).toBe('Per diems — team meals');
  });

  it('prefers a line in the category being typed into', () => {
    // "florist" appears in the description of lines in both Labour and
    // Transport, so the two are comparable and only the category separates
    // them. That is what a tie-breaker is for.
    const inTransport = searchCatalogue(entries, 'florist', {
      currentCategory: 'Transport, Site Visits',
    });
    expect(inTransport[0].description).toBe('Flights — florist team');

    const inLabour = searchCatalogue(entries, 'florist', {
      currentCategory: 'Labour / Team',
    });
    expect(inLabour[0].category).toBe('Labour / Team');
  });

  it('never lets the category outrank a better match elsewhere', () => {
    // Typing "day" in Creative reaches Creative's day-rate lines through their
    // unit, but "Onsite crew — day rate" says the word. The visible match wins,
    // whatever category you happen to be in — otherwise the picker looks like
    // it is ignoring what you typed.
    const results = searchCatalogue(entries, 'day', { currentCategory: 'Creative' });
    expect(results[0].description.toLowerCase()).toContain('day');
  });

  it('puts a line used often above one never used', () => {
    const used: CatalogueEntry[] = entries.map((e) =>
      e.description === 'Coffee and lounge table arrangements' ? { ...e, usageCount: 40 } : e,
    );
    const results = searchCatalogue(used, 'table');
    expect(results[0].description).toBe('Coffee and lounge table arrangements');
  });

  it('lists everything on an empty query, capped', () => {
    const results = searchCatalogue(entries, '', { limit: 5 });
    expect(results).toHaveLength(5);
  });

  it('returns nothing for a description that is not in the list', () => {
    expect(searchCatalogue(entries, 'helicopter')).toEqual([]);
  });

  it('scores a non-match as null rather than zero', () => {
    // Zero is a score. Null is an absence. Conflating them puts every
    // unrelated line at the bottom of the list instead of off it.
    expect(scoreEntry(find('Bridal bouquet'), 'helicopter')).toBeNull();
    expect(scoreEntry(find('Bridal bouquet'), 'bridal')).toBeGreaterThan(0);
  });
});

describe('knowing what is already in the catalogue', () => {
  it('matches on words, not characters', () => {
    expect(isInCatalogue(entries, 'Bridal bouquet')).toBe(true);
    expect(isInCatalogue(entries, 'BRIDAL BOUQUET')).toBe(true);
    expect(isInCatalogue(entries, '  bridal   bouquet  ')).toBe(true);
  });

  it('spots something genuinely new', () => {
    expect(isInCatalogue(entries, 'Ice sculpture')).toBe(false);
  });

  it('treats an empty description as already there, so nothing is offered', () => {
    expect(isInCatalogue(entries, '')).toBe(true);
    expect(isInCatalogue(entries, '   ')).toBe(true);
  });
});

describe('the raw seed list', () => {
  it('carries no ids of its own', () => {
    // Ids are derived, so the list cannot drift out of step with them.
    for (const seed of SEEDED_CATALOGUE) {
      expect(seed).not.toHaveProperty('id');
    }
  });
});
