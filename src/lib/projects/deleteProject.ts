/**
 * Asking the server to destroy a project.
 *
 * It cannot happen in the browser. A project owns categories, sub-events, cost
 * items and their attachments, budget versions and the frozen line snapshots
 * beneath each one, an activity log, and — in top-level collections, because
 * money is queried across projects far more often than within one — its
 * commitments, transactions and client invoices. Deleting the project document
 * from here would leave every one of those behind: orphaned, unreachable from
 * any screen, and still being paid for every month.
 *
 * The name is sent back with the request and checked again server-side. That
 * is not the screen being polite twice; it is the actual guard, and it exists
 * because the two projects most likely to be deleted by mistake are two
 * imports of the same workbook, which differ by a "(1)" on the end.
 */

import { call, callableMessage } from '../functionsClient';

export async function deleteProject(
  projectId: string,
  confirmName: string,
): Promise<{ deleted: number }> {
  try {
    return await call<{ projectId: string; confirmName: string }, { deleted: number }>(
      'deleteProject',
      { projectId, confirmName },
    );
  } catch (error) {
    throw new Error(callableMessage(error, 'The project could not be deleted.'));
  }
}
