/**
 * Calling the import.
 *
 * The write itself happens in a Cloud Function using the Admin SDK, because
 * the security rules give no client — the owner included — permission to
 * create an approved budget version. That is not an obstacle being worked
 * around; it is the design. There is no client path to approved history at
 * all, so the import cannot become one.
 *
 * Cloud Functions need the Blaze plan. On the free plan the call fails, and it
 * fails in a specific and recognisable way, so the screen can say so plainly
 * instead of showing "internal error" and leaving somebody to guess.
 */

import { call } from '../functionsClient';
import type { ImportPlan } from '../../domain/import/plan';

export interface ImportCounts {
  categories: number;
  costItems: number;
  transactions: number;
  warnings: number;
}

export interface ImportResult {
  projectId: string;
  importBatchId: string;
  counts: ImportCounts;
}

/** Thrown when the pathway is unavailable rather than when the plan is wrong. */
export class ImportUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportUnavailableError';
  }
}

export async function runImport(plan: ImportPlan): Promise<ImportResult> {
  try {
    return await call<{ plan: ImportPlan }, ImportResult>('adminImportProject', { plan });
  } catch (error) {
    throw translate(error);
  }
}

export async function reverseImport(importBatchId: string): Promise<{ deleted: number }> {
  try {
    return await call<{ importBatchId: string }, { deleted: number }>('adminReverseImport', {
      importBatchId,
    });
  } catch (error) {
    throw translate(error);
  }
}

/**
 * Turn a callable's error into something worth reading.
 *
 * `not-found` and `internal` from a callable almost always mean the function
 * is not deployed, which on this project means Blaze is not switched on yet.
 * Reporting that as an internal error would send somebody looking for a bug in
 * a spreadsheet.
 */
function translate(error: unknown): Error {
  const code = (error as { code?: string })?.code ?? '';
  const message = (error as { message?: string })?.message ?? String(error);

  if (code.includes('not-found') || code.includes('internal') || code.includes('unavailable')) {
    return new ImportUnavailableError(
      'The import service is not running. It is a Cloud Function, which needs the ' +
        'Blaze plan — everything else in the application works without it. Switch ' +
        'Blaze on, deploy the functions, and this screen will work unchanged.',
    );
  }
  if (code.includes('permission-denied')) {
    return new Error('Your account is not an owner, so it cannot run an import.');
  }
  return new Error(message);
}
