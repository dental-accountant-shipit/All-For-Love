/**
 * The line catalogue, stored.
 *
 * Held in Firestore rather than compiled into the application for one reason:
 * the list is wrong the moment it ships. Not badly wrong — it came from a real
 * budget — but the third event will want a line nobody thought of, and a
 * catalogue that needs a developer and a deploy to add "Ice sculpture" is a
 * catalogue people stop using. It is theirs to edit.
 *
 * Seeding runs once, on first read, and is idempotent: ids are derived from
 * the category and description, so running it twice writes the same documents
 * rather than a second copy of everything. A seeded entry that somebody has
 * since edited is never overwritten.
 */

import {
  deleteDoc,
  doc,
  getDocs,
  increment,
  onSnapshot,
  query,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

import * as paths from './paths';
import { newAudit, touch } from './projects';
import { SEEDED_CATALOGUE, seedId, type CatalogueEntry } from '../../domain/catalogue';

export function watchCatalogue(
  db: Firestore,
  onChange: (entries: CatalogueEntry[]) => void,
): () => void {
  return onSnapshot(query(paths.catalogue(db)), (snap) =>
    onChange(snap.docs.map((d) => d.data())),
  );
}

/**
 * Write the starting catalogue, once.
 *
 * Returns the number of entries written, which is zero on every run after the
 * first. Called when the catalogue is found to be empty rather than on some
 * install step, because there is no install step — the application is a static
 * site and the first person to open a budget is the installer.
 *
 * Deliberately does NOT restore a seeded entry somebody has deleted. Deleting
 * "Ballast — allowance" because you never use it should not be undone by the
 * next person to open a budget screen.
 */
export async function seedCatalogueIfEmpty(db: Firestore, uid: string): Promise<number> {
  const existing = await getDocs(paths.catalogue(db));
  if (!existing.empty) return 0;

  const audit = newAudit(uid);
  const batch = writeBatch(db);

  for (const seed of SEEDED_CATALOGUE) {
    const id = seedId(seed);
    batch.set(doc(paths.catalogue(db), id), {
      ...seed,
      id,
      seeded: true,
      usageCount: 0,
      audit,
    });
  }

  await batch.commit();
  return SEEDED_CATALOGUE.length;
}

export interface NewCatalogueEntry {
  description: string;
  category: string;
  mode: CatalogueEntry['mode'];
  unit?: string | null;
}

export async function addCatalogueEntry(
  db: Firestore,
  uid: string,
  input: NewCatalogueEntry,
): Promise<string> {
  const description = input.description.trim();
  if (!description) throw new Error('A catalogue entry needs a description.');

  // Same derived id as a seeded entry, so adding something that already exists
  // under another category is a new entry, and adding the same thing twice is
  // one entry.
  const id = seedId({ category: input.category, description });
  await writeBatch(db)
    .set(doc(paths.catalogue(db), id), {
      id,
      description,
      category: input.category,
      mode: input.mode,
      unit: input.unit ?? null,
      seeded: false,
      usageCount: 1,
      audit: newAudit(uid),
    })
    .commit();
  return id;
}

/**
 * Note that an entry was used, so the picker can put it nearer the top.
 *
 * Fire-and-forget: a failed count is not worth interrupting somebody typing a
 * budget for, and the number is a convenience rather than a fact anybody
 * reports on.
 */
export function noteCatalogueUse(db: Firestore, entryId: string): void {
  void updateDoc(doc(paths.catalogue(db), entryId), {
    usageCount: increment(1),
  }).catch(() => {});
}

export async function renameCatalogueEntry(
  db: Firestore,
  uid: string,
  entryId: string,
  description: string,
): Promise<void> {
  await updateDoc(doc(paths.catalogue(db), entryId), {
    description: description.trim(),
    ...touch(uid),
  });
}

export async function removeCatalogueEntry(db: Firestore, entryId: string): Promise<void> {
  await deleteDoc(doc(paths.catalogue(db), entryId));
}
