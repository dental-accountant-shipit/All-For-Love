/**
 * Project rollup computed on read.
 *
 * The stored `rollup` on each document is a cache maintained by a Cloud
 * Function. Cloud Functions require the Blaze plan, so while the project is on
 * Spark this computes the same figures in the browser from the same pure
 * engine — identical arithmetic, no server.
 *
 * This is not a stopgap that gets thrown away. Even with the function running,
 * an open project screen wants live figures the instant a cell changes rather
 * than after a function round-trip, so this path stays. The stored rollup
 * exists for the projects list, where reading every line of every project
 * would be wasteful.
 *
 * Cost: one project is roughly 600 documents. That is a fraction of a penny
 * and well inside Spark's daily read quota.
 */

import { getDocs, onSnapshot, query, where, type Firestore } from 'firebase/firestore';

import * as paths from './paths';
import { rollupProject } from '../../domain/rollup';
import type { ProjectRollup } from '../../domain/types';

async function loadProjectFinancials(db: Firestore, projectId: string) {
  const [items, subEvents, commissions, commitments, transactions] = await Promise.all([
    getDocs(paths.costItems(db, projectId)),
    getDocs(paths.subEvents(db, projectId)),
    getDocs(paths.commissions(db, projectId)),
    getDocs(query(paths.commitments(db), where('projectId', '==', projectId))),
    getDocs(query(paths.transactions(db), where('projectId', '==', projectId))),
  ]);

  return {
    costItems: items.docs.map((d) => d.data()),
    subEvents: subEvents.docs.map((d) => d.data()),
    commissions: commissions.docs.map((d) => d.data()),
    commitments: commitments.docs.map((d) => d.data()),
    transactions: transactions.docs.map((d) => d.data()),
  };
}

export async function computeProjectRollup(
  db: Firestore,
  projectId: string,
): Promise<ProjectRollup> {
  const data = await loadProjectFinancials(db, projectId);
  return rollupProject(data, new Date().toISOString(), 0);
}

/**
 * Live figures for an open project screen. Recomputes whenever any of the four
 * underlying collections changes, so the dashboard moves the moment a
 * commitment is recorded.
 */
export function watchProjectRollup(
  db: Firestore,
  projectId: string,
  onChange: (rollup: ProjectRollup) => void,
): () => void {
  let pending = false;

  const refresh = async () => {
    if (pending) return;
    pending = true;
    // Coalesce the burst of snapshots a batched write produces.
    await Promise.resolve();
    pending = false;
    onChange(await computeProjectRollup(db, projectId));
  };

  const unsubscribes = [
    onSnapshot(paths.costItems(db, projectId), refresh),
    onSnapshot(paths.subEvents(db, projectId), refresh),
    onSnapshot(paths.commissions(db, projectId), refresh),
    onSnapshot(query(paths.commitments(db), where('projectId', '==', projectId)), refresh),
    onSnapshot(query(paths.transactions(db), where('projectId', '==', projectId)), refresh),
  ];

  return () => unsubscribes.forEach((u) => u());
}
