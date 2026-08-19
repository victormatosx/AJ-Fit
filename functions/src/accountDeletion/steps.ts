/**
 * Step-level state machine, ordering and completion rules — Fase 1 report
 * §4/§8/§9/§10.
 */

import {
  ACCOUNT_DELETION_STEP_NAMES,
  STEP_ACCEPTABLE_FOR_COMPLETION,
} from './types';
import type {
  AccountDeletionPolicy,
  AccountDeletionStepName,
  AccountDeletionStepRecord,
  AccountDeletionStepStatus,
} from './types';
import { resolveStepStatusFromOutcome } from './errors';
import type { AccountDeletionStepOutcome, KnownErrorCode } from './errors';
import { computeRetryDecision } from './retry';
import type { RetryConfig } from './types';

/** Canonical, dependency-ordered list — re-exported here for call sites that only need step logic. */
export const ACCOUNT_DELETION_STEP_ORDER: readonly AccountDeletionStepName[] =
  ACCOUNT_DELETION_STEP_NAMES;

const STEP_STATUS_TRANSITIONS: Readonly<
  Record<AccountDeletionStepStatus, ReadonlySet<AccountDeletionStepStatus>>
> = {
  PENDING: new Set(['RUNNING']),
  RUNNING: new Set(['SUCCEEDED', 'SKIPPED_BY_POLICY', 'FAILED_RETRYABLE', 'FAILED_TERMINAL']),
  FAILED_RETRYABLE: new Set(['RUNNING']),
  // Terminal — no outgoing transition. A step that reached one of these
  // three never moves again; that is the regression guard.
  SUCCEEDED: new Set([]),
  SKIPPED_BY_POLICY: new Set([]),
  FAILED_TERMINAL: new Set([]),
};

export function canTransitionStep(
  from: AccountDeletionStepStatus,
  to: AccountDeletionStepStatus,
): boolean {
  return STEP_STATUS_TRANSITIONS[from].has(to);
}

/**
 * `step` is a plain `string` label, not `AccountDeletionStepName` — it is
 * used for error identification only (never switched on), which lets Fase 3
 * reuse this exact class/transition table for provider revocation
 * sub-steps (e.g. `'PROVIDER_REVOCATION:apple'`,
 * `functions/src/accountDeletion/providerRevocation/`) without duplicating
 * this state machine. Every existing Fase 1 caller already passes an
 * `AccountDeletionStepName`, which satisfies `string` — no behavior change
 * for them.
 */
export class InvalidStepTransitionError extends Error {
  constructor(
    public readonly step: string,
    public readonly from: AccountDeletionStepStatus,
    public readonly to: AccountDeletionStepStatus,
  ) {
    super(`Invalid step transition for ${step}: ${from} -> ${to}`);
    this.name = 'InvalidStepTransitionError';
  }
}

function newStepRecord(): AccountDeletionStepRecord {
  return {
    status: 'PENDING',
    attemptCount: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    lastErrorCode: null,
    completedAt: null,
  };
}

export function initialStepRecords(): Readonly<Record<AccountDeletionStepName, AccountDeletionStepRecord>> {
  return Object.fromEntries(
    ACCOUNT_DELETION_STEP_NAMES.map((name) => [name, newStepRecord()]),
  ) as Record<AccountDeletionStepName, AccountDeletionStepRecord>;
}

/**
 * `PENDING`/`FAILED_RETRYABLE` -> `RUNNING`. Marks the start of one attempt —
 * a worker calls this immediately before performing the step's actual I/O
 * (Fase 2+), never after.
 */
export function beginStepAttempt(
  step: string,
  current: AccountDeletionStepRecord,
  now: number,
): AccountDeletionStepRecord {
  if (!canTransitionStep(current.status, 'RUNNING')) {
    throw new InvalidStepTransitionError(step, current.status, 'RUNNING');
  }
  return {
    ...current,
    status: 'RUNNING',
    attemptCount: current.attemptCount + 1,
    lastAttemptAt: now,
    nextAttemptAt: null,
  };
}

/**
 * `RUNNING` -> terminal-acceptable status, `FAILED_RETRYABLE`, or
 * `FAILED_TERMINAL`. This is the ONLY place an executor's outcome becomes a
 * persisted step status — see `errors.ts`'s `resolveStepStatusFromOutcome`
 * for the logical-success collapse, and `retry.ts`'s `computeRetryDecision`
 * for backoff scheduling when the resolved status is `FAILED_RETRYABLE`.
 *
 * A retryable failure whose retry budget is exhausted is escalated to
 * `FAILED_TERMINAL` here — a step never stays `FAILED_RETRYABLE` forever
 * with no further attempt scheduled (Fase 1 report §15).
 */
export function completeStepAttempt(
  step: string,
  current: AccountDeletionStepRecord,
  outcome: AccountDeletionStepOutcome,
  now: number,
  retry: RetryConfig,
): AccountDeletionStepRecord {
  const resolved = resolveStepStatusFromOutcome(outcome);
  const errorCode: KnownErrorCode | null = outcome.kind === 'FAILED' ? outcome.code : null;

  if (resolved !== 'FAILED_RETRYABLE') {
    if (!canTransitionStep(current.status, resolved)) {
      throw new InvalidStepTransitionError(step, current.status, resolved);
    }
    return {
      ...current,
      status: resolved,
      // A logical-success SUCCEEDED still clears the error code — it is no
      // longer relevant once the step's objective is confirmed satisfied.
      lastErrorCode: resolved === 'FAILED_TERMINAL' ? errorCode : null,
      nextAttemptAt: null,
      completedAt: now,
    };
  }

  const decision = computeRetryDecision({
    attemptCount: current.attemptCount - 1, // beginStepAttempt already incremented for THIS attempt
    now,
    retry,
  });

  if (decision.exhausted) {
    if (!canTransitionStep(current.status, 'FAILED_TERMINAL')) {
      throw new InvalidStepTransitionError(step, current.status, 'FAILED_TERMINAL');
    }
    return {
      ...current,
      status: 'FAILED_TERMINAL',
      lastErrorCode: 'RETRY_BUDGET_EXHAUSTED',
      nextAttemptAt: null,
      completedAt: now,
    };
  }

  if (!canTransitionStep(current.status, 'FAILED_RETRYABLE')) {
    throw new InvalidStepTransitionError(step, current.status, 'FAILED_RETRYABLE');
  }
  return {
    ...current,
    status: 'FAILED_RETRYABLE',
    lastErrorCode: errorCode,
    nextAttemptAt: decision.nextAttemptAt,
    completedAt: null,
  };
}

/**
 * First step (in canonical order) among `policy.requiredSteps` that has not
 * yet reached an acceptable-for-completion status. Returns `null` once every
 * required step is done. This IS the dependency enforcement: a worker that
 * always asks "what's next?" through this function can never run a later
 * step while an earlier required one is still pending/running/retrying.
 */
export function nextRunnableStep(
  policy: AccountDeletionPolicy,
  steps: Readonly<Record<AccountDeletionStepName, AccountDeletionStepRecord>>,
): AccountDeletionStepName | null {
  for (const name of ACCOUNT_DELETION_STEP_ORDER) {
    if (!policy.requiredSteps.includes(name)) continue;
    if (STEP_ACCEPTABLE_FOR_COMPLETION.has(steps[name].status)) continue;
    return name;
  }
  return null;
}

export function isEligibleForCompletion(
  policy: AccountDeletionPolicy,
  steps: Readonly<Record<AccountDeletionStepName, AccountDeletionStepRecord>>,
): boolean {
  return policy.requiredSteps.every((name) =>
    STEP_ACCEPTABLE_FOR_COMPLETION.has(steps[name].status),
  );
}

/**
 * The step whose success makes user data unrecoverable regardless of any
 * later action — see Fase 1 report §9 for the full analysis. Destroying the
 * Photo Vault key does not, by itself, delete any Firestore/Storage object;
 * it makes every remaining encrypted object permanently undecipherable, so
 * once this step is `SUCCEEDED` the workflow is committed: a `FAILED_TERMINAL`
 * outcome from this point forward must be reconciled by continuing/retrying
 * the SAME deletion, never by attempting to "undo" it.
 *
 * `ACCOUNT_ACCESS_LOCK` and `PROVIDER_REVOCATION` (both ordered before this
 * step) are individually hard to fully undo too (a revoked provider token
 * cannot be un-revoked), but neither one destroys USER DATA — a disabled
 * Auth user can be re-enabled, and a revoked provider link can be re-linked
 * by the user signing in again. That is the distinction this constant
 * captures: irreversibility of DATA, not irreversibility of every individual
 * action.
 */
export const POINT_OF_NO_RETURN_STEP: AccountDeletionStepName = 'VAULT_KEY_DESTRUCTION';

export function isPastPointOfNoReturn(
  steps: Readonly<Record<AccountDeletionStepName, AccountDeletionStepRecord>>,
): boolean {
  return steps[POINT_OF_NO_RETURN_STEP].status === 'SUCCEEDED';
}

/**
 * Pure helper for a future `RETAINED_DATA_PROCESSING`/`REVENUECAT_PROCESSING`
 * executor: given the retention actions that step is responsible for, is
 * there anything destructive to actually run, or does the whole step resolve
 * to `SKIPPED_BY_POLICY` without touching any provider? `DELETE`/`ANONYMIZE`
 * require real execution (Fase 2+, not implemented here); `RETAIN`/`SKIP`
 * never do.
 */
export function stepOutcomeForRetentionActions(
  actions: readonly ('DELETE' | 'ANONYMIZE' | 'RETAIN' | 'SKIP')[],
): 'SKIPPED_BY_POLICY' | 'MUST_EXECUTE' {
  const mustExecute = actions.some((a) => a === 'DELETE' || a === 'ANONYMIZE');
  return mustExecute ? 'MUST_EXECUTE' : 'SKIPPED_BY_POLICY';
}
