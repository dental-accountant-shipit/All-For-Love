/**
 * Typed converters between Firestore documents and the domain model.
 *
 * Two jobs, both boring and both important:
 *
 *   1. Timestamps in, ISO strings out. The domain layer is pure and must not
 *      import Firebase; it deals in strings.
 *   2. The document ID is carried on the object as `id`, and stripped again on
 *      write, so nothing ever writes an `id` field into a document whose ID it
 *      already is.
 */

import {
  Timestamp,
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type SnapshotOptions,
  type WithFieldValue,
} from 'firebase/firestore';

import {
  DEFAULT_INCLUDE_IN_CONTINGENCY_BASE,
} from '../../domain/types';
import type { CatalogueEntry } from '../../domain/catalogue';
import type {
  BudgetVersion,
  BudgetVersionLine,
  Category,
  Commission,
  Commitment,
  CostItem,
  Project,
  SubEvent,
  Supplier,
  Transaction,
} from '../../domain/types';

/** Firestore Timestamps → ISO strings, recursively, leaving everything else. */
function fromFirestore<T>(value: unknown): T {
  if (value instanceof Timestamp) return value.toDate().toISOString() as T;
  if (Array.isArray(value)) return value.map((v) => fromFirestore(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = fromFirestore(v);
    return out as T;
  }
  return value as T;
}

/**
 * ISO strings stay strings on the way in. Firestore sorts them correctly
 * because ISO 8601 is lexicographically ordered, and keeping one
 * representation means no code has to ask which form it is holding.
 */
function toFirestore<T extends { id?: string }>(model: WithFieldValue<T>): DocumentData {
  const { id: _ignored, ...rest } = model as Record<string, unknown>;
  return rest;
}

const base = {
  toFirestore(model: WithFieldValue<Category>): DocumentData {
    return toFirestore(model as WithFieldValue<Category & { id?: string }>);
  },
  fromFirestore(snapshot: QueryDocumentSnapshot, options?: SnapshotOptions): Category {
    const data = fromFirestore<Record<string, unknown>>(snapshot.data(options));
    return { ...data, id: snapshot.id } as Category;
  },
};

function converter<T extends { id: string }>(): FirestoreDataConverter<T> {
  return {
    toFirestore(model: WithFieldValue<T>): DocumentData {
      return toFirestore(model as WithFieldValue<T & { id?: string }>);
    },
    fromFirestore(snapshot: QueryDocumentSnapshot, options: SnapshotOptions): T {
      const data = fromFirestore<Record<string, unknown>>(snapshot.data(options));
      return { ...data, id: snapshot.id } as T;
    },
  };
}

export const projectConverter = converter<Project>();
export const subEventConverter = converter<SubEvent>();

/**
 * Categories carry one default. `includeInContingencyBase` was added after the
 * first documents were written, and a category document saved without it means
 * "nobody has expressed a view", which is the same as included. Filling it in
 * here means the domain never has to reason about a missing field.
 */
export const categoryConverter: FirestoreDataConverter<Category> = {
  toFirestore: base.toFirestore,
  fromFirestore(snapshot, options) {
    const category = base.fromFirestore(snapshot, options);
    return {
      ...category,
      includeInContingencyBase:
        category.includeInContingencyBase ?? DEFAULT_INCLUDE_IN_CONTINGENCY_BASE,
    };
  },
};
export const costItemConverter = converter<CostItem>();
export const budgetVersionConverter = converter<BudgetVersion>();
export const budgetVersionLineConverter = converter<BudgetVersionLine>();
export const commitmentConverter = converter<Commitment>();
export const transactionConverter = converter<Transaction>();
export const commissionConverter = converter<Commission>();
export const supplierConverter = converter<Supplier>();
export const catalogueConverter = converter<CatalogueEntry>();
