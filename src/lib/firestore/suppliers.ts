/**
 * Supplier repository.
 *
 * Suppliers are deactivated, never deleted — a florist you stopped using in
 * 2024 is still attached to 2024's costs, and removing the record would orphan
 * them. `xeroContactId` is present and unused until phase 2, so connecting
 * Xero is a matter of filling it in rather than restructuring anything.
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
import { newAudit, touch } from './projects';
import type { Supplier } from '../../domain/types';

/**
 * The suppliers All for Love have already used, from the C & D workbook.
 *
 * Its supplier column is not a supplier list — it is a scratch column. It
 * holds companies, team members, placeholders like "Various" and "Roberto??",
 * and working notes such as "£885.16 - FIN; £1275.93 PS expenses". So this is
 * the readable part of it, transcribed by hand rather than imported by rule,
 * because a rule that could tell "Boomerang" from "13 EK Crew @ £100 = £1300"
 * would be a longer and less reliable piece of work than typing them out.
 *
 * Crescent Moon appears twice in the workbook, spelled two ways. It is one
 * supplier here — which is the argument for supplier records in the first
 * place, since neither spelling could ever have been totalled with the other.
 *
 * Freelancers are suppliers. That is not a statement about employment, it is
 * how the money moves: a day rate is invoiced and paid like any other cost,
 * and a project needs to show what it paid Fin the same way it shows what it
 * paid Hydra.
 */
export const SEEDED_SUPPLIERS: Array<{ name: string; kind: string }> = [
  { name: 'Crescent Moon', kind: 'production' },
  { name: 'Hydra', kind: 'production' },
  { name: 'NJM', kind: 'transport' },
  { name: 'EK', kind: 'crew' },
  { name: 'Vianen All Flowers', kind: 'flowers' },
  { name: 'Smilex', kind: 'equipment' },
  { name: 'Boomerang', kind: 'transport' },
  { name: 'IVB', kind: 'crew' },
  { name: 'Technomat', kind: 'equipment' },
  { name: 'Fin', kind: 'freelance florist' },
  { name: 'Vijay', kind: 'freelance florist' },
  { name: 'Penelope', kind: 'freelance florist' },
  { name: 'Sarah', kind: 'freelance florist' },
  { name: 'Kate', kind: 'freelance florist' },
  { name: 'Sunghee', kind: 'freelance florist' },
];

/** Stable, readable, and the same every time for the same name. */
function seedId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Write the starting suppliers, once, if there are none at all.
 *
 * Returns how many were written — zero on every run after the first. A
 * supplier somebody has since deactivated or renamed is never restored: the
 * seed is a starting point, not a definition.
 */
export async function seedSuppliersIfEmpty(db: Firestore, uid: string): Promise<number> {
  const existing = await getDocs(paths.suppliers(db));
  if (!existing.empty) return 0;

  const audit = newAudit(uid);
  const batch = writeBatch(db);

  for (const seed of SEEDED_SUPPLIERS) {
    // A fixed id per name, rather than a fresh one each time.
    //
    // This used to take a random id, which made the read-then-write above a
    // race: two tabs opening the suppliers screen at the same moment both saw
    // an empty collection and both seeded it, giving fifteen suppliers twice
    // over. With the name deciding the id, a second run overwrites the first
    // and there is nothing to duplicate.
    const ref = doc(paths.suppliers(db), `seed_${seedId(seed.name)}`);
    batch.set(ref, {
      id: ref.id,
      name: seed.name,
      kind: seed.kind,
      defaultCurrency: 'GBP',
      vatRegistered: false,
      contactName: null,
      email: null,
      phone: null,
      notes: 'From the C & D Wedding workbook.',
      active: true,
      xeroContactId: null,
      audit,
    });
  }

  await batch.commit();
  return SEEDED_SUPPLIERS.length;
}

export function watchSuppliers(
  db: Firestore,
  onChange: (suppliers: Supplier[]) => void,
  includeInactive = false,
) {
  const base = includeInactive
    ? paths.suppliers(db)
    : query(paths.suppliers(db), where('active', '==', true));
  return onSnapshot(query(base, orderBy('name')), (snap) =>
    onChange(snap.docs.map((d) => d.data())),
  );
}

export interface NewSupplier {
  name: string;
  kind?: string | null;
  defaultCurrency?: string;
  vatRegistered?: boolean;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export async function createSupplier(
  db: Firestore,
  uid: string,
  input: NewSupplier,
): Promise<string> {
  const ref = doc(paths.suppliers(db));
  const supplier: Omit<Supplier, 'id'> = {
    name: input.name.trim(),
    kind: input.kind ?? null,
    defaultCurrency: input.defaultCurrency ?? 'GBP',
    // Never left undefined: empty and "not VAT registered" mean different
    // things when the time comes to reconcile with Xero.
    vatRegistered: input.vatRegistered ?? true,
    contactName: input.contactName ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    notes: input.notes ?? null,
    active: true,
    xeroContactId: null,
    audit: newAudit(uid),
  };
  await writeBatch(db).set(ref, { ...supplier, id: ref.id }).commit();
  return ref.id;
}

/**
 * Write a whole imported list.
 *
 * In batches of 400, under Firestore's limit of 500 writes per batch, because a
 * contacts export from an established studio is not going to be twenty rows and
 * the failure at 501 would come after some of the list had already landed —
 * leaving somebody to work out which half.
 *
 * `xeroContactId` is carried through when the file had one. That is what will
 * let a supplier here be matched to the same contact in Xero later without
 * anybody re-keying anything.
 */
export async function createSuppliers(
  db: Firestore,
  uid: string,
  suppliers: Array<{
    name: string;
    contactName?: string | null;
    email?: string | null;
    phone?: string | null;
    vatRegistered?: boolean;
    xeroContactId?: string | null;
  }>,
  /** Called after each batch, so a long import can say where it has got to. */
  onProgress?: (written: number, total: number) => void,
): Promise<number> {
  const audit = newAudit(uid);
  let written = 0;

  for (let start = 0; start < suppliers.length; start += 400) {
    const slice = suppliers.slice(start, start + 400);
    const batch = writeBatch(db);

    for (const input of slice) {
      const ref = doc(paths.suppliers(db));
      const supplier: Omit<Supplier, 'id'> = {
        name: input.name.trim(),
        // Nothing in a contacts export says whether this is a company or a
        // freelancer, and a wrong guess on two hundred rows is worse than a
        // blank on two hundred rows.
        kind: null,
        defaultCurrency: 'GBP',
        vatRegistered: input.vatRegistered ?? false,
        contactName: input.contactName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        notes: null,
        active: true,
        xeroContactId: input.xeroContactId ?? null,
        audit,
      };
      batch.set(ref, { ...supplier, id: ref.id });
      written += 1;
    }

    await batch.commit();
  }

  return written;
}

/**
 * Retire every supplier currently on the list.
 *
 * Deactivated, not deleted — and that is deliberate rather than a limitation.
 * A supplier named on a commitment or a bill from two years ago cannot be
 * allowed to vanish, or the record of what was spent stops making sense; the
 * security rules refuse deletion outright for the same reason. A retired
 * supplier disappears from the list and from every picker, and comes back the
 * moment somebody ticks "include inactive".
 *
 * Used when a real list arrives to replace the starting one.
 */
export async function retireAllSuppliers(db: Firestore, uid: string): Promise<number> {
  const existing = await getDocs(paths.suppliers(db));
  if (existing.empty) return 0;

  const audit = newAudit(uid);
  const docs = existing.docs;
  let retired = 0;

  for (let start = 0; start < docs.length; start += 400) {
    const batch = writeBatch(db);
    for (const snapshot of docs.slice(start, start + 400)) {
      if (snapshot.get('active') === false) continue;
      batch.update(snapshot.ref, { active: false, audit });
      retired += 1;
    }
    await batch.commit();
  }

  return retired;
}

export async function updateSupplier(
  db: Firestore,
  uid: string,
  supplierId: string,
  patch: Partial<Omit<Supplier, 'id' | 'audit'>>,
): Promise<void> {
  await updateDoc(doc(paths.suppliers(db), supplierId), { ...patch, ...touch(uid) });
}

export async function setSupplierActive(
  db: Firestore,
  uid: string,
  supplierId: string,
  active: boolean,
): Promise<void> {
  await updateSupplier(db, uid, supplierId, { active });
}
