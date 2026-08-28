/**
 * Every query the application makes has an index that can serve it.
 *
 * This is the single most dangerous gap between running locally and running
 * live, because the Firestore **emulator does not enforce indexes at all**. A
 * query combining an equality filter with an order-by on a different field runs
 * perfectly on this Mac and fails on the live site with "The query requires an
 * index" — which surfaces as an empty screen, not as an error anybody sees.
 *
 * Two of these were missing on the day of go-live. `watchSuppliers` filters on
 * `active` and orders by `name`, which is every load of the suppliers screen
 * and every supplier picker in the application; the transactions-by-project
 * query is behind the costs on a project. Both would have been blank, silently.
 *
 * The test is deliberately a hand-written list rather than something clever
 * that parses the source. It cannot catch a query added tomorrow — nothing
 * short of running against real Firestore can — but it says out loud which
 * queries are known to need help, and it fails loudly if an index is deleted
 * because it "looked unused".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

interface IndexField {
  fieldPath: string;
  order?: string;
}

interface CompositeIndex {
  collectionGroup: string;
  queryScope?: string;
  fields: IndexField[];
}

const indexes: CompositeIndex[] = JSON.parse(
  readFileSync(join(process.cwd(), 'firestore.indexes.json'), 'utf8'),
).indexes;

/** Every composite query in the application, and where it is made from. */
const REQUIRED: Array<{ where: string; collection: string; fields: string[] }> = [
  {
    where: 'watchSuppliers — the suppliers screen and every supplier picker',
    collection: 'suppliers',
    fields: ['active', 'name'],
  },
  {
    where: 'watchProjectTransactions — costs recorded against a project',
    collection: 'transactions',
    fields: ['projectId', 'date'],
  },
  {
    where: 'watchSupplierTransactions — what has been spent with one supplier',
    collection: 'transactions',
    fields: ['supplierId', 'date'],
  },
  {
    where: 'transactions allocated against a particular line',
    collection: 'transactions',
    fields: ['projectId', 'costItemId', 'date'],
  },
  {
    where: 'unallocated costs',
    collection: 'transactions',
    fields: ['allocationStatus', 'date'],
  },
  {
    where: 'watchProjects, when a status filter is applied',
    collection: 'projects',
    fields: ['status', 'eventDate'],
  },
  {
    where: 'watchCostItems — the budget grid, within one sub-event',
    collection: 'costItems',
    fields: ['subEventId', 'sortKey'],
  },
  {
    where: 'commitments against a line',
    collection: 'commitments',
    fields: ['projectId', 'costItemId'],
  },
  {
    where: 'open commitments with one supplier',
    collection: 'commitments',
    fields: ['supplierId', 'status'],
  },
];

describe('composite indexes', () => {
  for (const required of REQUIRED) {
    it(`serves ${required.collection} (${required.fields.join(' + ')}) — ${required.where}`, () => {
      const found = indexes.some(
        (index) =>
          index.collectionGroup === required.collection &&
          index.fields.length === required.fields.length &&
          index.fields.every((field, at) => field.fieldPath === required.fields[at]),
      );
      expect(found, `no index in firestore.indexes.json can serve this query`).toBe(true);
    });
  }

  it('orders every date field newest first', () => {
    // Every date-ordered query in the application reads backwards, and an
    // index built the other way round will not serve it.
    for (const index of indexes) {
      const date = index.fields.find((field) => field.fieldPath === 'date');
      if (date) expect(date.order, `${index.collectionGroup}.date`).toBe('DESCENDING');
    }
  });

  it('has no duplicates', () => {
    const seen = indexes.map(
      (index) => `${index.collectionGroup}:${index.fields.map((f) => f.fieldPath).join(',')}`,
    );
    expect(new Set(seen).size).toBe(seen.length);
  });
});
