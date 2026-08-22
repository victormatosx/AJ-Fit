/**
 * Concurrency control — Fase 1 report §11.
 *
 * Two independent problems, two independent mechanisms:
 *
 *   1. Two logical `requestAccountDeletion()` calls for the same uid must
 *      never create two independent `deletionId`s — `resolveDeletionRequest`
 *      below, meant to run inside a Firestore transaction against a
 *      uid-keyed lock document (`AccountDeletionLockDocument`, doc id ==
 *      uid). Firestore transactions already give this a atomic
 *      read-then-write; this function is the pure decision logic a
 *      transaction body calls.
 *
 *   2. Two workers processing the SAME `deletionId` must never both mutate
 *      it — `compareAndSet` (optimistic concurrency via `revision`) plus the
 *      optional `AccountDeletionLease` (pessimistic short-term ownership
 *      while a worker is actively mid-step) below. Firestore transactions
 *      could also enforce this alone; the lease exists so a worker can hold
 *      exclusivity across a multi-await step body without re-transacting on
 *      every internal await — still ultimately validated by `compareAndSet`
 *      at write time either way, so a lease is an optimization, never the
 *      sole guarantee.
 */

import type { AccountDeletionLease, AccountDeletionLockDocument, AccountDeletionStatus, DeletionId } from './types';

// ── 1. Duplicate logical request ───────────────────────────────────────────

export type ResolveDeletionRequestResult =
  | { kind: 'CREATED'; deletionId: DeletionId }
  | { kind: 'REUSED_EXISTING'; deletionId: DeletionId }
  /**
   * A previous deletion for this uid ended `FAILED_TERMINAL`. A brand-new
   * request must NOT silently spawn a second independent workflow — a
   * terminal failure means the workflow may have partially destroyed data
   * and needs operator reconciliation, not a naive retry racing the
   * original's already-applied side effects. (In practice this state is
   * unlikely to be reachable from the client at all once `AUTH_DELETION`
   * exists as a required step, because a terminal failure most often means
   * the Auth user still exists and could theoretically call again — this
   * result exists specifically to make that case safe rather than assume it
   * cannot happen.)
   */
  | { kind: 'BLOCKED_TERMINAL_FAILURE'; deletionId: DeletionId };

export function resolveDeletionRequest(params: {
  existingLock: AccountDeletionLockDocument | null;
  newDeletionId: DeletionId;
}): ResolveDeletionRequestResult {
  const { existingLock, newDeletionId } = params;

  if (existingLock === null) {
    return { kind: 'CREATED', deletionId: newDeletionId };
  }
  if (existingLock.status === 'FAILED_TERMINAL') {
    return { kind: 'BLOCKED_TERMINAL_FAILURE', deletionId: existingLock.activeDeletionId };
  }
  // REQUESTED, PROCESSING, RETRY_SCHEDULED, or COMPLETED: idempotent reuse.
  // Never create a second concurrent workflow for the same uid — including
  // when already COMPLETED, since the caller can safely treat the reused id
  // as "your deletion was already accepted/finished".
  return { kind: 'REUSED_EXISTING', deletionId: existingLock.activeDeletionId };
}

export function lockDocumentAfterCreate(
  uid: string,
  deletionId: DeletionId,
): AccountDeletionLockDocument {
  return { uid, activeDeletionId: deletionId, status: 'REQUESTED', revision: 0 };
}

export function lockDocumentAfterStatusChange(
  lock: AccountDeletionLockDocument,
  status: AccountDeletionStatus,
): AccountDeletionLockDocument {
  return { ...lock, status, revision: lock.revision + 1 };
}

// ── 2. Optimistic concurrency for the deletion record itself ───────────────

export type CompareAndSetResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'REVISION_MISMATCH'; currentRevision: number };

/**
 * Applies `mutate` only if `current.revision === expectedRevision`,
 * returning a new value with `revision` incremented by exactly 1. A caller
 * that read `current` at revision 5 and lost a race to a worker that already
 * wrote revision 6 gets `{ ok: false }` and must re-read before retrying —
 * it must never blindly overwrite.
 */
export function compareAndSet<T extends { revision: number }>(
  current: T,
  expectedRevision: number,
  mutate: (current: T) => Omit<T, 'revision'>,
): CompareAndSetResult<T> {
  if (current.revision !== expectedRevision) {
    return { ok: false, reason: 'REVISION_MISMATCH', currentRevision: current.revision };
  }
  const mutated = mutate(current);
  return { ok: true, value: { ...mutated, revision: current.revision + 1 } as T };
}

// ── 2b. Short-term worker lease (optimization on top of compareAndSet) ─────

export function isLeaseActive(lease: AccountDeletionLease | null, now: number): boolean {
  return lease !== null && lease.expiresAt > now;
}

/** A worker may acquire the lease only when no other lease is currently active. */
export function canAcquireLease(current: { lease: AccountDeletionLease | null }, now: number): boolean {
  return !isLeaseActive(current.lease, now);
}

export function acquireLease(ownerId: string, now: number, leaseDurationMs: number): AccountDeletionLease {
  return { ownerId, expiresAt: now + leaseDurationMs };
}

/** Only the current lease holder may release/renew it — a stale worker cannot clear another worker's active lease. */
export function isLeaseOwnedBy(lease: AccountDeletionLease | null, ownerId: string, now: number): boolean {
  return lease !== null && lease.ownerId === ownerId && isLeaseActive(lease, now);
}
