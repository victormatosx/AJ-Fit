/**
 * Global state machine — Fase 1 report §3/§7.
 *
 * Kept deliberately small (5 values) and separate from the per-step machine
 * in `steps.ts`. The architectural decision (Fase 1 report §7) is that
 * per-step detail (which of the eight steps failed, how many times, when it
 * retries next) belongs ONLY in `AccountDeletionRecord.steps`, never
 * flattened into new global statuses — a global status per failure mode
 * (`CLEANUP_FAILED`, `REVOCATION_FAILED`, ...) would grow linearly with the
 * step count and stop being reviewable as a single diagram, while telling an
 * operator nothing the step map doesn't already say more precisely.
 */

import { TERMINAL_ACCOUNT_DELETION_STATUSES } from './types';
import type { AccountDeletionRecord, AccountDeletionStatus } from './types';
import { isEligibleForCompletion } from './steps';

const GLOBAL_TRANSITIONS: Readonly<Record<AccountDeletionStatus, ReadonlySet<AccountDeletionStatus>>> = {
  REQUESTED: new Set(['PROCESSING']),
  PROCESSING: new Set(['RETRY_SCHEDULED', 'COMPLETED', 'FAILED_TERMINAL']),
  RETRY_SCHEDULED: new Set(['PROCESSING', 'FAILED_TERMINAL']),
  // Terminal — no outgoing transition (see `TERMINAL_ACCOUNT_DELETION_STATUSES`).
  COMPLETED: new Set([]),
  FAILED_TERMINAL: new Set([]),
};

export function canTransitionGlobal(
  from: AccountDeletionStatus,
  to: AccountDeletionStatus,
): boolean {
  return GLOBAL_TRANSITIONS[from].has(to);
}

export function isTerminalGlobalStatus(status: AccountDeletionStatus): boolean {
  return TERMINAL_ACCOUNT_DELETION_STATUSES.has(status);
}

export class InvalidGlobalTransitionError extends Error {
  constructor(
    public readonly from: AccountDeletionStatus,
    public readonly to: AccountDeletionStatus,
  ) {
    super(`Invalid account deletion transition: ${from} -> ${to}`);
    this.name = 'InvalidGlobalTransitionError';
  }
}

/**
 * Thrown when `COMPLETED` is attempted while at least one required step is
 * not yet in an acceptable-for-completion status. This is the enforcement of
 * Fase 1 report §24: `COMPLETED` can never mean merely "`users/{uid}` no
 * longer exists" — it means every step the active policy requires ended
 * `SUCCEEDED` or `SKIPPED_BY_POLICY`.
 */
export class IncompleteRequiredStepsError extends Error {
  constructor() {
    super('Cannot transition to COMPLETED: not every required step is terminal-acceptable');
    this.name = 'IncompleteRequiredStepsError';
  }
}

/**
 * Applies one global transition, returning a NEW record (never mutates
 * `record` in place — callers persist the result via `concurrency.ts`'s
 * `compareAndSet`). Deliberately does not accept a `subscriptionActive`
 * parameter of any kind: an active subscription is request-time telemetry
 * only (`AccountDeletionRequestMetadata.subscriptionActiveAtRequest`) and
 * must never influence this function — see Fase 1 report §19 and rule §34.
 */
export function transitionGlobal(
  record: AccountDeletionRecord,
  to: AccountDeletionStatus,
  now: number,
): AccountDeletionRecord {
  if (!canTransitionGlobal(record.status, to)) {
    throw new InvalidGlobalTransitionError(record.status, to);
  }
  if (to === 'COMPLETED' && !isEligibleForCompletion(record.policy, record.steps)) {
    throw new IncompleteRequiredStepsError();
  }
  return {
    ...record,
    status: to,
    updatedAt: now,
    completedAt: to === 'COMPLETED' ? now : record.completedAt,
  };
}
