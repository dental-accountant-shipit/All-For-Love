/**
 * Project repository.
 *
 * The only interesting function here is `createProject`, which does more than
 * it looks like it should — because every project must land in a state the
 * rest of the system can rely on: one sub-event, one category, one open draft
 * version, all written together or not at all.
 */

import {
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

import * as paths from './paths';
import { keyBetween } from './sortKey';
import {
  DEFAULT_INCLUDE_IN_CONTINGENCY_BASE,
  DEFAULT_PROJECT_SETTINGS,
  type Audit,
  type Category,
  type Project,
  type ProjectStatus,
  type SubEvent,
} from '../../domain/types';

export function newAudit(uid: string): Audit {
  const now = new Date().toISOString();
  return { createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid };
}

export function touch(uid: string) {
  return { updatedAt: new Date().toISOString(), updatedBy: uid };
}

export interface NewProjectInput {
  name: string;
  clientName: string;
  eventType?: string | null;
  venue?: string | null;
  eventDate?: string | null;
  /** Names the user typed. Empty or one name means a single-event project. */
  subEventNames?: string[];
}

/**
 * The categories a new project starts with.
 *
 * Taken from All for Love's own master budget rather than invented, so a new
 * project already has the shape of the work. They are ordinary categories from
 * the moment they exist: rename them, delete them, add others, and nothing in
 * the engine knows the difference.
 *
 * Creative sits outside the contingency base, matching how All for Love price.
 * That travels with the category as a setting, so it survives a rename — the
 * engine never looks at what a category is called.
 */
export const STARTING_CATEGORIES: Array<{ name: string; includeInContingencyBase: boolean }> = [
  { name: 'Florals', includeInContingencyBase: true },
  { name: 'Labour / Team', includeInContingencyBase: true },
  { name: 'Catering', includeInContingencyBase: true },
  { name: 'Transport, Site Visits', includeInContingencyBase: true },
  { name: 'Admin, Equipment', includeInContingencyBase: true },
  { name: 'Creative', includeInContingencyBase: false },
  { name: 'Contingency', includeInContingencyBase: true },
];

const EMPTY_ROLLUP = {
  budgetCost: 0,
  budgetCostKnown: true,
  linesWithoutBudget: 0,
  committedTotal: 0,
  committedRemaining: 0,
  actualTotal: 0,
  forecastCost: 0,
  originalClientValue: 0,
  approvedExtras: 0,
  agreedReductions: 0,
  currentAgreedClientRevenue: 0,
  forecastProfit: 0,
  forecastMargin: null,
  proposedExtrasRevenue: 0,
  proposedExtrasCost: 0,
  proposedExtrasCostKnown: true,
  proposedExtrasActualCost: 0,
  lineCount: 0,
  linesOverBudget: 0,
  recomputedAt: new Date(0).toISOString(),
  recomputeSeq: 0,
};

/**
 * Creates the project and everything it cannot exist without, in one batch.
 *
 * A project with no sub-event would break every rollup, and a project with no
 * open draft would have nowhere to type. Neither is a state a user should ever
 * be able to reach, so neither is a separate write.
 */
export async function createProject(
  db: Firestore,
  uid: string,
  input: NewProjectInput,
): Promise<string> {
  const batch = writeBatch(db);
  const audit = newAudit(uid);

  const projectRef = doc(paths.projects(db));
  const names = (input.subEventNames ?? []).filter((n) => n.trim().length > 0);
  const multiple = names.length > 1;

  // Always at least one. For an ordinary event it is never shown.
  const subEventNames = multiple ? names : [names[0] ?? input.name];
  let sortKey: string | null = null;
  subEventNames.forEach((name, index) => {
    sortKey = keyBetween(sortKey, null);
    const ref = doc(paths.subEvents(db, projectRef.id));
    const subEvent: Omit<SubEvent, 'id'> = {
      projectId: projectRef.id,
      name,
      isDefault: index === 0,
      date: null,
      venue: null,
      sortKey,
      rollup: { ...EMPTY_ROLLUP },
      audit,
    };
    batch.set(ref, { ...subEvent, id: ref.id });
  });

  let categoryKey: string | null = null;
  for (const starter of STARTING_CATEGORIES) {
    categoryKey = keyBetween(categoryKey, null);
    const ref = doc(paths.categories(db, projectRef.id));
    const category: Omit<Category, 'id'> = {
      projectId: projectRef.id,
      name: starter.name,
      sortKey: categoryKey,
      includeInContingencyBase: starter.includeInContingencyBase,
      audit,
    };
    batch.set(ref, { ...category, id: ref.id });
  }

  const versionRef = doc(paths.budgetVersions(db, projectRef.id));
  batch.set(versionRef, {
    id: versionRef.id,
    projectId: projectRef.id,
    versionNo: 1,
    status: 'draft',
    note: null,
    approvedBy: null,
    approvedAt: null,
    supersededAt: null,
    clientApproval: {
      status: 'not_sent',
      sentAt: null,
      decidedAt: null,
      method: null,
      reference: null,
      notes: null,
      recordedBy: null,
      recordedAt: null,
    },
    totals: { budgetCost: 0, budgetCostKnown: true, linesWithoutBudget: 0, clientPrice: 0 },
    audit,
  });

  const project: Omit<Project, 'id'> = {
    name: input.name,
    clientName: input.clientName,
    eventType: input.eventType ?? null,
    venue: input.venue ?? null,
    eventDate: input.eventDate ?? null,
    status: 'enquiry',
    baseCurrency: 'GBP',
    subEventMode: multiple ? 'multiple' : 'single',
    settings: { ...DEFAULT_PROJECT_SETTINGS },
    originalApprovedVersionId: null,
    currentApprovedVersionId: null,
    openDraftVersionId: versionRef.id,
    rollup: { ...EMPTY_ROLLUP, subEvents: [], commissionTotal: 0,
      netProfitAfterCommission: 0, netMarginAfterCommission: null },
    audit,
  };
  batch.set(projectRef, { ...project, id: projectRef.id });

  await batch.commit();
  return projectRef.id;
}

export function watchProjects(
  db: Firestore,
  onChange: (projects: Project[]) => void,
  status?: ProjectStatus[],
) {
  const base = status?.length
    ? query(paths.projects(db), where('status', 'in', status))
    : paths.projects(db);
  return onSnapshot(query(base, orderBy('eventDate', 'desc')), (snap) =>
    onChange(snap.docs.map((d) => d.data())),
  );
}

export function watchProject(
  db: Firestore,
  projectId: string,
  onChange: (project: Project | null) => void,
) {
  return onSnapshot(paths.projectDoc(db, projectId), (snap) =>
    onChange(snap.exists() ? snap.data() : null),
  );
}

export function watchSubEvents(
  db: Firestore,
  projectId: string,
  onChange: (subEvents: SubEvent[]) => void,
) {
  return onSnapshot(query(paths.subEvents(db, projectId), orderBy('sortKey')), (snap) =>
    onChange(snap.docs.map((d) => d.data())),
  );
}

export function watchCategories(
  db: Firestore,
  projectId: string,
  onChange: (categories: Category[]) => void,
) {
  return onSnapshot(query(paths.categories(db, projectId), orderBy('sortKey')), (snap) =>
    onChange(snap.docs.map((d) => d.data())),
  );
}

export async function addCategory(
  db: Firestore,
  uid: string,
  projectId: string,
  name: string,
  includeInContingencyBase: boolean = DEFAULT_INCLUDE_IN_CONTINGENCY_BASE,
): Promise<string> {
  const existing = await getDocs(query(paths.categories(db, projectId), orderBy('sortKey')));
  const last = existing.docs.at(-1)?.data().sortKey ?? null;
  const ref = doc(paths.categories(db, projectId));
  const batch = writeBatch(db);
  batch.set(ref, {
    id: ref.id,
    projectId,
    name,
    sortKey: keyBetween(last, null),
    includeInContingencyBase,
    audit: newAudit(uid),
  });
  await batch.commit();
  return ref.id;
}

/**
 * Take a category in or out of the contingency base.
 *
 * This changes what the client is charged, so it belongs to whoever may edit a
 * budget rather than to whoever may rename things. The rules enforce that; this
 * is only the call.
 */
export async function setCategoryContingencyBase(
  db: Firestore,
  uid: string,
  projectId: string,
  categoryId: string,
  includeInContingencyBase: boolean,
): Promise<void> {
  await updateDoc(doc(paths.categories(db, projectId), categoryId), {
    includeInContingencyBase,
    ...touch(uid),
  });
}
