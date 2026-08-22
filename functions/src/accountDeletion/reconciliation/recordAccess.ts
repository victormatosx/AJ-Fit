/**
 * Real Firestore-backed read/query/CAS-write/lease primitives for the
 * reconciliation worker — Fase 14.
 *
 * Deliberately a NEW module rather than an extension of `../repository.ts`
 * (Fase 4, already approved): `repository.ts` owns exactly one concern —
 * "is there already an active operation for this uid, and if not, create
 * one" (`createOrReuse`). Nothing here duplicates that. This module owns the
 * opposite direction: "an operation already exists — read it, find others
 * like it, and safely advance one." Both modules share the SAME collections
 * (`ACCOUNT_DELETIONS_COLLECTION`/`ACCOUNT_DELETION_LOCKS_COLLECTION`,
 * imported from `../repository.ts`, never redefined) and the SAME pure
 * concurrency primitives (`compareAndSet`, `lockDocumentAfterStatusChange`,
 * `acquireLease`, `canAcquireLease` — all from `../concurrency.ts`, Fase 1,
 * unchanged).
 *
 * Every write in this file goes through a real `db.runTransaction` — never a
 * bare read-then-write — so the CAS guarantee `compareAndSet` describes is
 * actually enforced against concurrent writers (two worker instances, or a
 * worker racing a client's `requestAccountDeletion` retry against the same
 * uid's lock document), not just simulated in memory.
 */

import { db } from '../../lib/firebaseAdmin';
import {
  ACCOUNT_DELETIONS_COLLECTION,
  ACCOUNT_DELETION_LOCKS_COLLECTION,
  AccountDeletionRepositoryError,
} from '../repository';
import {
  acquireLease,
  canAcquireLease,
  compareAndSet,
  lockDocumentAfterStatusChange,
  type CompareAndSetResult,
} from '../concurrency';
import { isRetryDue } from '../retry';
import { nextRunnableStep } from '../steps';
import { nextRunnableProviderSubStep } from '../providerRevocation/types';
import type {
  AccountDeletionLockDocument,
  AccountDeletionRecord,
  AccountDeletionStatus,
  DeletionId,
  Uid,
} from '../types';

function recordRef(deletionId: DeletionId) {
  return db.collection(ACCOUNT_DELETIONS_COLLECTION).doc(deletionId);
}

function lockRef(uid: Uid) {
  return db.collection(ACCOUNT_DELETION_LOCKS_COLLECTION).doc(uid);
}

/**
 * Same shallow defensive shape check as `repository.ts`'s private
 * `isValidRecord` — intentionally re-declared rather than importing a
 * private symbol. This is a read-time "is this even the shape we wrote"
 * guard, not a business-logic decision; duplicating a five-field typeof
 * check is cheaper and safer than exporting internals of an already-approved
 * file just for this.
 */
function isValidRecordShape(data: unknown): data is AccountDeletionRecord {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.deletionId === 'string' &&
    typeof d.uid === 'string' &&
    typeof d.workflowVersion === 'number' &&
    typeof d.status === 'string' &&
    typeof d.revision === 'number' &&
    typeof d.requestedAt === 'number' &&
    typeof d.steps === 'object' &&
    d.steps !== null &&
    typeof d.policy === 'object' &&
    d.policy !== null &&
    typeof d.providerRevocation === 'object' &&
    d.providerRevocation !== null
  );
}

function isValidLockShape(data: unknown): data is AccountDeletionLockDocument {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.uid === 'string' &&
    typeof d.activeDeletionId === 'string' &&
    typeof d.status === 'string' &&
    typeof d.revision === 'number'
  );
}

export async function readAccountDeletionRecord(
  deletionId: DeletionId,
): Promise<AccountDeletionRecord | null> {
  const snap = await recordRef(deletionId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!isValidRecordShape(data)) {
    throw new AccountDeletionRepositoryError(`corrupted deletion record ${deletionId}`);
  }
  return data;
}

/**
 * Statuses the reconciler ever needs to look at. `COMPLETED`/`FAILED_TERMINAL`
 * are deliberately excluded from the query itself (not just filtered after
 * fetch) — Fase 14 rule: a terminal record must never be re-examined on
 * every scheduler run just to be immediately discarded; excluding it from
 * the query is both the efficiency answer and the "never touch a terminal
 * record" answer at once.
 */
const RECONCILIATION_CANDIDATE_STATUSES: readonly AccountDeletionStatus[] = [
  'REQUESTED',
  'PROCESSING',
  'RETRY_SCHEDULED',
];

/**
 * Bounded candidate query. A single-field `in` query on `status` (three
 * values) plus `.limit()` — Firestore auto-indexes every single field by
 * default, so this needs NO composite index (verified against the real
 * Emulator in this phase's integration test; nothing was added to
 * `firestore.indexes.json`). This is deliberately NOT a full collection
 * scan: only documents whose `status` is one of the three non-terminal
 * values are ever read, and at most `limit` of them.
 *
 * Time-filtering `RETRY_SCHEDULED` records against `nextAttemptAt` happens
 * separately, in memory, via `isRecordDueNow` below — that value lives
 * nested per-step (and, for `PROVIDER_REVOCATION`, nested per-sub-step)
 * inside `steps`/`providerRevocation`, not as a queryable top-level field,
 * so Firestore cannot filter on it directly without denormalizing the
 * schema (a larger change this phase does not make).
 */
export async function queryReconciliationCandidates(
  limit: number,
): Promise<AccountDeletionRecord[]> {
  const snap = await db
    .collection(ACCOUNT_DELETIONS_COLLECTION)
    .where('status', 'in', RECONCILIATION_CANDIDATE_STATUSES)
    .limit(limit)
    .get();

  return snap.docs
    .map((doc) => doc.data())
    .filter((data): data is AccountDeletionRecord => isValidRecordShape(data));
}

/**
 * The effective `nextAttemptAt` for whatever this record would do next, or
 * `null` if there is nothing to wait for (immediately runnable). Resolves
 * through `nextRunnableStep`/`nextRunnableProviderSubStep` — the SAME
 * dependency-ordering functions every executor/precondition already uses —
 * never a second "what's next" derivation.
 */
export function effectiveNextAttemptAt(record: AccountDeletionRecord): number | null {
  const step = nextRunnableStep(record.policy, record.steps);
  if (step === null) return null;
  if (step === 'PROVIDER_REVOCATION') {
    const provider = nextRunnableProviderSubStep(record.providerRevocation);
    if (provider === null) return null;
    const sub = provider === 'apple.com' ? record.providerRevocation.apple : record.providerRevocation.google;
    return sub.step.nextAttemptAt;
  }
  return record.steps[step].nextAttemptAt;
}

/**
 * Whether a candidate record is actually due for processing right now.
 * `REQUESTED`/`PROCESSING` are always due (nothing to wait for by
 * definition — an abandoned `REQUESTED` or a stuck `PROCESSING` record must
 * be picked up immediately, never held back by a backoff clock that only
 * applies to `RETRY_SCHEDULED`). Reuses `retry.ts`'s `isRetryDue` — never a
 * second backoff-arithmetic implementation.
 */
export function isRecordDueNow(record: AccountDeletionRecord, now: number): boolean {
  if (record.status !== 'RETRY_SCHEDULED') return true;
  const nextAttemptAt = effectiveNextAttemptAt(record);
  return nextAttemptAt === null || isRetryDue(nextAttemptAt, now);
}

export type PersistRecordChangeResult = CompareAndSetResult<AccountDeletionRecord>;

/**
 * CAS-protected update of an existing record, transactionally mirrored onto
 * the uid-keyed lock document's `status` whenever the global status actually
 * changed (Fase 1's `lockDocumentAfterStatusChange` — defined since Fase 1,
 * never previously called by any production code; this is its first real
 * caller). The lock document itself is never deleted here — see this
 * module's doc comment on why `accountDeletionLocks/{uid}` must persist
 * forever once created, including after `COMPLETED`.
 *
 * `mutate` receives the record freshly read INSIDE the transaction — never
 * the caller's possibly-stale in-memory copy — so `expectedRevision` is
 * checked against genuinely current state.
 */
export async function persistAccountDeletionRecordChange(
  deletionId: DeletionId,
  expectedRevision: number,
  mutate: (current: AccountDeletionRecord) => Omit<AccountDeletionRecord, 'revision'>,
): Promise<PersistRecordChangeResult> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(recordRef(deletionId));
    if (!snap.exists) {
      throw new AccountDeletionRepositoryError(`record ${deletionId} does not exist`);
    }
    const data = snap.data();
    if (!isValidRecordShape(data)) {
      throw new AccountDeletionRepositoryError(`corrupted deletion record ${deletionId}`);
    }
    const current = data;

    const result = compareAndSet(current, expectedRevision, mutate);
    if (!result.ok) return result;

    // Read the lock BEFORE any write (Firestore transactions require every
    // read before every write) — only when the global status is actually
    // changing; a step-only update that leaves status unchanged never
    // touches the lock document at all.
    let lockUpdate: { ref: FirebaseFirestore.DocumentReference; value: AccountDeletionLockDocument } | null =
      null;
    if (result.value.status !== current.status) {
      const lockSnap = await tx.get(lockRef(current.uid));
      if (lockSnap.exists) {
        const lockData = lockSnap.data();
        if (isValidLockShape(lockData)) {
          lockUpdate = {
            ref: lockRef(current.uid),
            value: lockDocumentAfterStatusChange(lockData, result.value.status),
          };
        }
      }
    }

    tx.set(recordRef(deletionId), result.value as unknown as FirebaseFirestore.DocumentData);
    if (lockUpdate) {
      tx.set(lockUpdate.ref, lockUpdate.value as unknown as FirebaseFirestore.DocumentData);
    }

    return result;
  });
}

export type AcquireLeaseResult =
  | { ok: true; record: AccountDeletionRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'LEASE_HELD' };

/**
 * Transactionally acquires the short-term worker lease on `deletionId` —
 * Fase 1's `AccountDeletionLease`/`canAcquireLease`/`acquireLease`
 * (`../concurrency.ts`), given its first real caller here. Fairness (Fase 14
 * rule): if another owner's lease is currently active, this returns
 * `LEASE_HELD` immediately rather than blocking — the caller is expected to
 * move on to the next candidate, never retry-loop against one busy record.
 *
 * Firestore's own transaction serialization is the actual correctness
 * guarantee here (two concurrent `tryAcquireReconciliationLease` calls for
 * the same `deletionId` cannot both observe `canAcquireLease === true` and
 * both commit — one transaction is aborted and retried by the SDK, and on
 * retry it re-reads the now-updated lease and correctly sees it held); the
 * `revision` bump this write causes is also what makes a later stale-worker
 * write fail via `persistAccountDeletionRecordChange`'s CAS check.
 */
export async function tryAcquireReconciliationLease(
  deletionId: DeletionId,
  ownerId: string,
  now: number,
  leaseDurationMs: number,
): Promise<AcquireLeaseResult> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(recordRef(deletionId));
    if (!snap.exists) return { ok: false, reason: 'NOT_FOUND' };
    const data = snap.data();
    if (!isValidRecordShape(data)) return { ok: false, reason: 'NOT_FOUND' };
    const current = data;

    if (!canAcquireLease(current, now)) {
      return { ok: false, reason: 'LEASE_HELD' };
    }

    const result = compareAndSet(current, current.revision, (c) => ({
      ...c,
      lease: acquireLease(ownerId, now, leaseDurationMs),
      updatedAt: now,
    }));
    if (!result.ok) {
      // Unreachable in practice (expectedRevision is the value just read in
      // this same transaction) — kept as a safe fallback, never a silent
      // lease grant on a mismatch.
      return { ok: false, reason: 'LEASE_HELD' };
    }

    tx.set(recordRef(deletionId), result.value as unknown as FirebaseFirestore.DocumentData);
    return { ok: true, record: result.value };
  });
}
