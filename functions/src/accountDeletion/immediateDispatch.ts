/**
 * Immediate dispatch of a freshly-`REQUESTED` deletion — Fase 15 (produção
 * revelou que the 15-minute `cleanupPendingAccountDeletions` schedule was
 * the ONLY path that ever started processing; see
 * docs/25_exclusao_de_conta_arquitetura.md's Fase 15 section for the full
 * incident writeup).
 *
 * DESIGN: a Firestore `onDocumentCreated` trigger on
 * `accountDeletions/{deletionId}` (Eventarc, 2nd-gen Cloud Functions) —
 * NOT a call made from inside `requestAccountDeletion` itself.
 *
 * Why this satisfies every constraint at once:
 *   - COMMIT BOUNDARY: an `onDocumentCreated` event physically cannot fire
 *     before the triggering write is durably committed — Eventarc reads the
 *     change from Firestore's own commit log. There is no code path here
 *     that could ever run before `repository.ts`'s `createOrReuse` `tx.set`
 *     has succeeded, without writing a single line of "wait for commit"
 *     logic ourselves.
 *   - REQUEST vs PROCESSING stay separate: this is a SEPARATE Cloud Run
 *     revision from `requestAccountDeletion`. The callable returns to the
 *     client the instant its own transaction commits — it never awaits
 *     this trigger, never calls it, and has no reference to it. The client
 *     closing the app immediately after `accepted: true` has zero effect on
 *     whether this trigger fires: Eventarc's delivery is entirely
 *     server-side, driven by the Firestore write itself.
 *   - FIRES EXACTLY ONCE PER REAL NEW REQUEST: `createOrReuse` only ever
 *     `tx.set`s `accountDeletions/{deletionId}` on the `CREATED` branch —
 *     a deduplicated repeat call (same uid, existing non-terminal
 *     operation) never writes this document again, so `onDocumentCreated`
 *     never re-fires for it. No dedup logic had to be reimplemented here.
 *   - SAME ENGINE, NO SECOND STATE MACHINE: the handler below does exactly
 *     one thing — call `processAccountDeletionRecord` (Fase 14, unchanged)
 *     with a fresh `ownerId`. Every guard (`NOT_FOUND`/`ALREADY_TERMINAL`/
 *     `NOT_DUE`/`LEASE_HELD`/CAS-protected persistence) is the SAME code
 *     the scheduler calls — this file adds no business logic of its own.
 *   - CONCURRENCY WITH THE SCHEDULER: if `cleanupPendingAccountDeletions`
 *     happens to pick up the same record before this trigger's invocation
 *     acquires the lease (or vice versa), `tryAcquireReconciliationLease`'s
 *     transactional CAS (`concurrency.ts`, unchanged) guarantees only one
 *     of them proceeds; the other observes `LEASE_HELD` and returns
 *     immediately — proven at the `processAccountDeletionRecord` level
 *     already (`reconciliation/__tests__/processRecord.test.ts`), not
 *     re-proven here.
 *   - FAILURE OF THE FAST PATH ≠ LOST REQUEST: `retry: true` lets Eventarc
 *     redeliver this event (bounded, exponential backoff) on an uncaught
 *     exception — but even if every redelivery attempt is exhausted, the
 *     record itself is untouched (still `REQUESTED`, still fully durable):
 *     `cleanupPendingAccountDeletions` unconditionally includes
 *     `REQUESTED` in `RECONCILIATION_CANDIDATE_STATUSES` and finds it on
 *     its own next tick regardless of what happened here. This file never
 *     deletes, mutates, or "cancels" the record/lock on failure — it only
 *     ever calls the same read-then-CAS-write engine the scheduler already
 *     uses safely.
 *   - A step that legitimately resolves to `RETRY_SCHEDULED` (a transient
 *     failure the executor itself already classified as retryable) is NOT
 *     an exception here — `processAccountDeletionRecord` returns normally,
 *     this handler returns normally, and Eventarc does NOT redeliver. The
 *     step's own backoff (`policy.retry`, unchanged) is the only clock that
 *     governs when it's retried next — by this trigger never firing again
 *     for an unchanged document, and by the scheduler's `isRecordDueNow`.
 */

import { randomUUID } from 'node:crypto';

import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { logFunctionError, logInfo } from '../lib/logger';
import { REQUEST_ACCOUNT_DELETION_SECRETS } from './requestAccountDeletion';
import { ACCOUNT_DELETIONS_COLLECTION } from './repository';
import { processAccountDeletionRecord } from './reconciliation/processRecord';
import type { DeletionId } from './types';

const SCOPE = 'accountDeletion.immediateDispatch';

/** Testable core, independent of the `onDocumentCreated` wiring below. */
export async function handleAccountDeletionRequested(deletionId: DeletionId): Promise<void> {
  const ownerId = `immediate-${randomUUID()}`;
  logInfo(SCOPE, 'account_deletion_immediate_dispatch_started', { deletionId });

  let outcomeKind: string;
  try {
    const outcome = await processAccountDeletionRecord(deletionId, { ownerId });
    outcomeKind = outcome.kind;
  } catch (error) {
    // Never mutate/cancel the record here — see module doc comment. Rethrow
    // so Eventarc's own retry (bounded, exponential backoff) may redeliver;
    // the scheduler remains the unconditional backstop either way.
    logFunctionError(SCOPE, error, { deletionId });
    throw error;
  }

  logInfo(SCOPE, 'account_deletion_immediate_dispatch_finished', { deletionId, outcome: outcomeKind });
}

export const onAccountDeletionRequested = onDocumentCreated(
  {
    document: `${ACCOUNT_DELETIONS_COLLECTION}/{deletionId}`,
    // Same four Apple secrets `requestAccountDeletion`/`cleanupPendingAccountDeletions`
    // bind — this path can reach PROVIDER_REVOCATION's Apple sub-step just
    // like the other two entry points into the SAME engine.
    secrets: REQUEST_ACCOUNT_DELETION_SECRETS,
    retry: true,
    timeoutSeconds: 300,
  },
  async (event) => {
    await handleAccountDeletionRequested(event.params.deletionId);
  },
);
