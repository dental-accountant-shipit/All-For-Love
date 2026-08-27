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
