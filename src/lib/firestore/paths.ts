/**
 * Every collection path in one place, so no string literal for a Firestore
 * path appears anywhere else in the application.
 */

import {
  collection,
  collectionGroup,
  doc,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';

import {
  budgetVersionConverter,
  budgetVersionLineConverter,
  catalogueConverter,
  categoryConverter,
  commissionConverter,
  commitmentConverter,
  costItemConverter,
  projectConverter,
  subEventConverter,
  supplierConverter,
  transactionConverter,
} from './converters';

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

// ------------------------------------------------------------- top level

export const projects = (db: Firestore): CollectionReference<Project> =>
  collection(db, 'projects').withConverter(projectConverter);

export const projectDoc = (db: Firestore, id: string): DocumentReference<Project> =>
  doc(db, 'projects', id).withConverter(projectConverter);

export const suppliers = (db: Firestore): CollectionReference<Supplier> =>
  collection(db, 'suppliers').withConverter(supplierConverter);

/**
 * The line catalogue is account-wide, not per project. The whole point is that
 * a line typed on one event is offered on the next.
 */
export const catalogue = (db: Firestore): CollectionReference<CatalogueEntry> =>
  collection(db, 'lineCatalogue').withConverter(catalogueConverter);

export const commitments = (db: Firestore): CollectionReference<Commitment> =>
  collection(db, 'commitments').withConverter(commitmentConverter);

export const transactions = (db: Firestore): CollectionReference<Transaction> =>
  collection(db, 'transactions').withConverter(transactionConverter);

// -------------------------------------------------------------- per project

export const subEvents = (db: Firestore, projectId: string): CollectionReference<SubEvent> =>
  collection(db, 'projects', projectId, 'subEvents').withConverter(subEventConverter);

export const categories = (db: Firestore, projectId: string): CollectionReference<Category> =>
  collection(db, 'projects', projectId, 'categories').withConverter(categoryConverter);

export const costItems = (db: Firestore, projectId: string): CollectionReference<CostItem> =>
  collection(db, 'projects', projectId, 'costItems').withConverter(costItemConverter);

export const costItemDoc = (
  db: Firestore,
  projectId: string,
  costItemId: string,
): DocumentReference<CostItem> =>
  doc(db, 'projects', projectId, 'costItems', costItemId).withConverter(costItemConverter);

export const budgetVersions = (
  db: Firestore,
  projectId: string,
): CollectionReference<BudgetVersion> =>
  collection(db, 'projects', projectId, 'budgetVersions').withConverter(budgetVersionConverter);

/**
 * Line documents are keyed by cost item ID. That is what makes the link
 * between a historical budget and a live cost item unbreakable.
 */
export const budgetVersionLines = (
  db: Firestore,
  projectId: string,
  versionId: string,
): CollectionReference<BudgetVersionLine> =>
  collection(
    db,
    'projects',
    projectId,
    'budgetVersions',
    versionId,
    'lines',
  ).withConverter(budgetVersionLineConverter);

export const commissions = (db: Firestore, projectId: string): CollectionReference<Commission> =>
  collection(db, 'projects', projectId, 'commissions').withConverter(commissionConverter);

export const activity = (db: Firestore, projectId: string) =>
  collection(db, 'projects', projectId, 'activity');

/** "Which projects have we used this florist on" — across every project. */
export const allCostItems = (db: Firestore) =>
  collectionGroup(db, 'costItems').withConverter(costItemConverter);
