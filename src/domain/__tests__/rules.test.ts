/**
 * The security rules, run against the emulator.
 *
 * These had no coverage, and the first thing a real user did was hit a rule
 * that denied every create in the application. The rules are the actual
 * enforcement — `src/lib/auth/roles.ts` only decides which buttons to draw —
 * so of everything in this repository they are the least acceptable thing to
 * take on trust.
 *
 * Needs the Firestore emulator, which needs Java. Skips when it cannot reach
 * one, so a machine without Java still gets a green suite:
 *
 *   npx firebase-tools emulators:exec --only firestore "npx vitest run rules"
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const HOST = '127.0.0.1';
const PORT = 8080;

async function emulatorRunning(): Promise<boolean> {
  try {
    const response = await fetch(`http://${HOST}:${PORT}/`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

const available = await emulatorRunning();
const suite = available ? describe : describe.skip;

let env: RulesTestEnvironment;

// --------------------------------------------------------------------------
// Fixtures — the exact shapes the application writes
// --------------------------------------------------------------------------

const EMPTY_FINANCIALS = {
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
  recomputedAt: '1970-01-01T00:00:00.000Z',
  recomputeSeq: 0,
};

const AUDIT = {
  createdAt: '2026-08-27T00:00:00.000Z',
  createdBy: 'u1',
  updatedAt: '2026-08-27T00:00:00.000Z',
  updatedBy: 'u1',
};

const newSubEvent = (overrides: Record<string, unknown> = {}) => ({
  projectId: 'p1',
  name: 'Whole event',
  isDefault: true,
  date: null,
  venue: null,
  sortKey: 'a0',
  rollup: { ...EMPTY_FINANCIALS },
  audit: AUDIT,
  ...overrides,
});

const newCostItem = (overrides: Record<string, unknown> = {}) => ({
  projectId: 'p1',
  subEventId: 'se1',
  categoryId: 'c1',
  sortKey: 'a0',
  description: 'Arch',
  mode: 'lump',
  status: 'planned',
  origin: 'original',
  extraStatus: null,
  clientValueWithdrawn: false,
  draft: { quantity: null, unitCost: null, unitPrice: null, percentageRate: null, budgetCost: 480000, clientPrice: 960000 },
  approved: null,
  original: null,
  details: {},
  rollup: {
    committedTotal: 0,
    committedRemaining: 0,
    actualTotal: 0,
    calculatedForecast: 0,
    forecastCost: 0,
    forecastSource: 'calculated',
    recomputedAt: '1970-01-01T00:00:00.000Z',
    recomputeSeq: 0,
  },
  forecastOverride: null,
  copiedFromCostItemId: null,
  audit: AUDIT,
  ...overrides,
});

function as(role: string | null) {
  return role === null
    ? env.unauthenticatedContext().firestore()
    : env.authenticatedContext(`uid_${role}`, { role }).firestore();
}

beforeAll(async () => {
  if (!available) return;
  env = await initializeTestEnvironment({
    projectId: 'afl-rules-test',
    firestore: { host: HOST, port: PORT, rules: readFileSync('firestore.rules', 'utf8') },
  });
});

afterAll(async () => {
  if (env) await env.cleanup();
});

beforeEach(async () => {
  if (env) await env.clearFirestore();
});

// --------------------------------------------------------------------------

suite('creating a project', () => {
  it('lets a director create the whole thing in one batch', async () => {
    // The exact write `createProject` makes. This is the case that was broken:
    // every field was correct, the role was right, and the rules denied it
    // because a create has no `resource` to compare a rollup against.
    const db = as('director');
    const batch = writeBatch(db);
    batch.set(doc(db, 'projects/p1'), {
      name: 'Painted Hall',
      clientName: 'Ruth Davis',
      status: 'enquiry',
      rollup: { ...EMPTY_FINANCIALS, subEvents: [], commissionTotal: 0 },
      audit: AUDIT,
    });
    batch.set(doc(db, 'projects/p1/subEvents/se1'), newSubEvent());
    batch.set(doc(db, 'projects/p1/categories/c1'), {
      projectId: 'p1',
      name: 'General',
      sortKey: 'a0',
      includeInContingencyBase: true,
      audit: AUDIT,
    });
    batch.set(doc(db, 'projects/p1/budgetVersions/v1'), {
      projectId: 'p1',
      versionNo: 1,
      status: 'draft',
      totals: { budgetCost: 0, budgetCostKnown: true, linesWithoutBudget: 0, clientPrice: 0 },
      audit: AUDIT,
    });
    await assertSucceeds(batch.commit());
  });

  it('lets a producer create one too', async () => {
    await assertSucceeds(
      setDoc(doc(as('producer'), 'projects/p1/subEvents/se1'), newSubEvent()),
    );
  });

  it('refuses finance, viewer, admin and the signed-out', async () => {
    for (const role of ['finance', 'viewer', 'admin', null]) {
      await assertFails(setDoc(doc(as(role), 'projects/p1/subEvents/se1'), newSubEvent()));
    }
  });
});

suite('the rollup is server-owned', () => {
  it('refuses a create carrying a fabricated rollup', async () => {
    // A zeroed rollup is fine on create; one already claiming a profit is not.
    await assertFails(
      setDoc(
        doc(as('director'), 'projects/p1/subEvents/se1'),
        newSubEvent({
          rollup: { ...EMPTY_FINANCIALS, forecastCost: 999_00, forecastProfit: 50_000_00 },
        }),
      ),
    );
  });

  it('refuses a create claiming a recompute already happened', async () => {
    await assertFails(
      setDoc(
        doc(as('director'), 'projects/p1/subEvents/se1'),
        newSubEvent({ rollup: { ...EMPTY_FINANCIALS, recomputeSeq: 7 } }),
      ),
    );
  });

  it('refuses an update that rewrites the rollup', async () => {
    const db = as('director');
    await assertSucceeds(setDoc(doc(db, 'projects/p1/subEvents/se1'), newSubEvent()));
    await assertFails(
      updateDoc(doc(db, 'projects/p1/subEvents/se1'), {
        rollup: { ...EMPTY_FINANCIALS, forecastProfit: 1_000_00 },
      }),
    );
  });

  it('allows an update that leaves the rollup alone', async () => {
    const db = as('director');
    await assertSucceeds(setDoc(doc(db, 'projects/p1/subEvents/se1'), newSubEvent()));
    await assertSucceeds(updateDoc(doc(db, 'projects/p1/subEvents/se1'), { name: 'Day 2' }));
  });
});

suite('import provenance is server-owned', () => {
  it('refuses a client claiming a record was imported', async () => {
    // Imports run through the Admin SDK, which bypasses rules entirely. A
    // client-side write carrying provenance is always a false claim.
    await assertFails(
      setDoc(
        doc(as('director'), 'projects/p1/costItems/ci1'),
        newCostItem({
          import: { imported: true, sourceFilename: 'invented.xlsx', importBatchId: 'b1' },
        }),
      ),
    );
  });

  it('allows a cost item without it', async () => {
    await assertSucceeds(
      setDoc(doc(as('director'), 'projects/p1/costItems/ci1'), newCostItem()),
    );
  });
});

suite('approved budget history', () => {
  it('is closed to every role, administrators included', async () => {
    // The whole approval model rests on this. If any client can write an
    // approved version, the audit trail is decoration.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'projects/p1/budgetVersions/v1'), {
        projectId: 'p1',
        versionNo: 1,
        status: 'approved',
        approvedAt: '2026-08-01T00:00:00.000Z',
        audit: AUDIT,
      });
    });

    for (const role of ['director', 'producer', 'finance', 'viewer', 'admin']) {
      await assertFails(
        updateDoc(doc(as(role), 'projects/p1/budgetVersions/v1'), { status: 'draft' }),
      );
    }
  });

  it('refuses a client writing the frozen line snapshot', async () => {
    await assertFails(
      setDoc(doc(as('director'), 'projects/p1/budgetVersions/v1/lines/ci1'), {
        description: 'Arch',
      }),
    );
  });

  it('refuses creating a version that is already approved', async () => {
    await assertFails(
      setDoc(doc(as('director'), 'projects/p1/budgetVersions/v1'), {
        projectId: 'p1',
        versionNo: 1,
        status: 'approved',
        audit: AUDIT,
      }),
    );
  });
});

suite('a cost item cannot rewrite its own approved figures', () => {
  it('refuses an update to the approved block', async () => {
    const db = as('director');
    await assertSucceeds(setDoc(doc(db, 'projects/p1/costItems/ci1'), newCostItem()));
    await assertFails(
      updateDoc(doc(db, 'projects/p1/costItems/ci1'), {
        approved: { clientPrice: 1, budgetCost: 1, versionId: 'v1' },
      }),
    );
  });

  it('allows an update to the draft block', async () => {
    const db = as('director');
    await assertSucceeds(setDoc(doc(db, 'projects/p1/costItems/ci1'), newCostItem()));
    await assertSucceeds(
      updateDoc(doc(db, 'projects/p1/costItems/ci1'), { description: 'Larger arch' }),
    );
  });
});

suite('commission is director-level', () => {
  it('is hidden from a producer', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'projects/p1/commissions/cm1'), {
        payeeName: 'Introducer',
        basis: 'percent_of_revenue',
        ratePercent: 10,
      });
    });
    await assertFails(getDoc(doc(as('producer'), 'projects/p1/commissions/cm1')));
    await assertSucceeds(getDoc(doc(as('director'), 'projects/p1/commissions/cm1')));
  });
});

suite('the admin role can do nothing but read', () => {
  it('cannot edit a budget', async () => {
    await assertFails(
      setDoc(doc(as('admin'), 'projects/p1/costItems/ci1'), newCostItem()),
    );
  });

  it('cannot write an import batch record', async () => {
    // Even the import's own bookkeeping is written by the function, not by
    // whoever ran it — otherwise the record of a run could be edited by the
    // person undoing it.
    await assertFails(
      setDoc(doc(as('admin'), 'importBatches/b1'), { projectId: 'p1', reversedAt: null }),
    );
  });

  it('can read one', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'importBatches/b1'), { projectId: 'p1' });
    });
    await assertSucceeds(getDoc(doc(as('admin'), 'importBatches/b1')));
  });
});
