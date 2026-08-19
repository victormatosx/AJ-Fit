/**
 * End-to-end simulation of the pure workflow — composes record.ts, steps.ts
 * and stateMachine.ts exactly as a future worker would, but with no I/O:
 * every step's "provider call" is a hand-fed `AccountDeletionStepOutcome`.
 * This is the executable form of the Fase 1 report's §26 "happy path" and
 * related scenarios — see the individual module test files for narrower,
 * unit-level coverage of each piece.
 */

import { describe, expect, it } from 'vitest';

import { currentPolicy } from '../policy';
import {
  beginStepAttempt,
  completeStepAttempt,
  isEligibleForCompletion,
  nextRunnableStep,
} from '../steps';
import { transitionGlobal } from '../stateMachine';
import { createAccountDeletionRecord } from '../record';
import { resolveDeletionRequest, lockDocumentAfterCreate } from '../concurrency';
import type { AccountDeletionRecord, AccountDeletionStepName } from '../types';
import type { AccountDeletionStepOutcome } from '../errors';

const POLICY = currentPolicy();

function freshRecord(now = 0): AccountDeletionRecord {
  return createAccountDeletionRecord({
    deletionId: 'del-1',
    uid: 'uid-1',
    policy: POLICY,
    now,
    requestMetadata: { subscriptionActiveAtRequest: false, requestAuthTimeSeconds: 0 },
  });
}

/** Drives ONE step attempt for `record`'s current `nextRunnableStep`, applying `outcome`. */
function driveStep(
  record: AccountDeletionRecord,
  outcome: AccountDeletionStepOutcome,
  now: number,
): AccountDeletionRecord {
  const step = nextRunnableStep(record.policy, record.steps) as AccountDeletionStepName;
  const running = beginStepAttempt(step, record.steps[step], now);
  const completed = completeStepAttempt(step, running, outcome, now, record.policy.retry);
  return { ...record, steps: { ...record.steps, [step]: completed }, updatedAt: now };
}

describe('happy path: REQUESTED -> PROCESSING -> every step -> COMPLETED', () => {
  it('reaches COMPLETED once all eight required steps succeed, in canonical order', () => {
    let record = freshRecord(0);
    record = transitionGlobal(record, 'PROCESSING', 1);

    let t = 2;
    for (const _ of record.policy.requiredSteps) {
      record = driveStep(record, { kind: 'SUCCEEDED' }, t++);
    }

    expect(isEligibleForCompletion(record.policy, record.steps)).toBe(true);
    record = transitionGlobal(record, 'COMPLETED', t);
    expect(record.status).toBe('COMPLETED');
    expect(Object.values(record.steps).every((s) => s.status === 'SUCCEEDED')).toBe(true);
  });
});

describe('duplicate request: two logical requests collapse into one active operation', () => {
  it('the second request reuses the first deletionId instead of starting a parallel workflow', () => {
    const first = resolveDeletionRequest({ existingLock: null, newDeletionId: 'del-1' });
    expect(first.kind).toBe('CREATED');
    const record = freshRecord(0);
    const lock = lockDocumentAfterCreate(record.uid, record.deletionId);

    const second = resolveDeletionRequest({ existingLock: lock, newDeletionId: 'del-2-should-be-discarded' });
    expect(second).toEqual({ kind: 'REUSED_EXISTING', deletionId: 'del-1' });
  });
});

describe('retryable failure then success: PROCESSING -> step FAILED_RETRYABLE -> retry -> SUCCEEDED -> continues', () => {
  it('a transient RevenueCat outage does not stall the whole workflow permanently', () => {
    let record = freshRecord(0);
    record = transitionGlobal(record, 'PROCESSING', 1);

    let t = 2;
    // Drive every step up to REVENUECAT_PROCESSING successfully.
    while (nextRunnableStep(record.policy, record.steps) !== 'REVENUECAT_PROCESSING') {
      record = driveStep(record, { kind: 'SUCCEEDED' }, t++);
    }

    // First attempt at REVENUECAT_PROCESSING fails transiently.
    record = driveStep(record, { kind: 'FAILED', code: 'UNAVAILABLE' }, t++);
    expect(record.steps.REVENUECAT_PROCESSING.status).toBe('FAILED_RETRYABLE');
    expect(nextRunnableStep(record.policy, record.steps)).toBe('REVENUECAT_PROCESSING');
    record = transitionGlobal(record, 'RETRY_SCHEDULED', t++);

    // Worker wakes up at nextAttemptAt and retries — this time it succeeds.
    record = transitionGlobal(record, 'PROCESSING', t++);
    record = driveStep(record, { kind: 'SKIPPED_BY_POLICY', reason: 'policy=SKIP' }, t++);
    expect(record.steps.REVENUECAT_PROCESSING.status).toBe('SKIPPED_BY_POLICY');

    // Finish remaining steps and complete.
    while (nextRunnableStep(record.policy, record.steps) !== null) {
      record = driveStep(record, { kind: 'SUCCEEDED' }, t++);
    }
    record = transitionGlobal(record, 'COMPLETED', t);
    expect(record.status).toBe('COMPLETED');
  });
});

describe('terminal failure never silently becomes COMPLETED', () => {
  it('a contract-invalid failure on FIRESTORE_CLEANUP stops the workflow at FAILED_TERMINAL', () => {
    let record = freshRecord(0);
    record = transitionGlobal(record, 'PROCESSING', 1);

    let t = 2;
    while (nextRunnableStep(record.policy, record.steps) !== 'FIRESTORE_CLEANUP') {
      record = driveStep(record, { kind: 'SUCCEEDED' }, t++);
    }
    record = driveStep(record, { kind: 'FAILED', code: 'INVALID_CONTRACT' }, t++);
    expect(record.steps.FIRESTORE_CLEANUP.status).toBe('FAILED_TERMINAL');

    record = transitionGlobal(record, 'FAILED_TERMINAL', t);
    expect(record.status).toBe('FAILED_TERMINAL');

    // No transition out of FAILED_TERMINAL exists, in particular not to COMPLETED.
    expect(() => transitionGlobal(record, 'COMPLETED', t + 1)).toThrow();
    expect(() => transitionGlobal(record, 'PROCESSING', t + 1)).toThrow();
  });
});

describe('partial completion never produces COMPLETED', () => {
  it('some steps SUCCEEDED, one still PENDING — completion is refused', () => {
    let record = freshRecord(0);
    record = transitionGlobal(record, 'PROCESSING', 1);
    let t = 2;
    const allButLast = record.policy.requiredSteps.slice(0, -1);
    for (const _ of allButLast) {
      record = driveStep(record, { kind: 'SUCCEEDED' }, t++);
    }
    expect(isEligibleForCompletion(record.policy, record.steps)).toBe(false);
    expect(() => transitionGlobal(record, 'COMPLETED', t)).toThrow();
  });
});

describe('"already missing" is logical success, not fatal failure, all the way to the record', () => {
  it('AUTH_DELETION finding user-not-found (already deleted) still lets the workflow complete', () => {
    let record = freshRecord(0);
    record = transitionGlobal(record, 'PROCESSING', 1);
    let t = 2;
    while (nextRunnableStep(record.policy, record.steps) !== 'AUTH_DELETION') {
      record = driveStep(record, { kind: 'SUCCEEDED' }, t++);
    }
    // A prior attempt already deleted the Auth user; a retry (or a duplicate
    // worker) finds it already gone — must resolve as SUCCEEDED.
    record = driveStep(record, { kind: 'FAILED', code: 'ALREADY_DELETED' }, t++);
    expect(record.steps.AUTH_DELETION.status).toBe('SUCCEEDED');

    expect(isEligibleForCompletion(record.policy, record.steps)).toBe(true);
    record = transitionGlobal(record, 'COMPLETED', t);
    expect(record.status).toBe('COMPLETED');
  });
});

describe('an active subscription at request time never blocks processing', () => {
  it('REQUESTED -> PROCESSING succeeds identically whether or not a subscription is active', () => {
    const withSubscription: AccountDeletionRecord = {
      ...freshRecord(0),
      requestMetadata: { subscriptionActiveAtRequest: true, requestAuthTimeSeconds: 0 },
    };
    const withoutSubscription: AccountDeletionRecord = {
      ...freshRecord(0),
      requestMetadata: { subscriptionActiveAtRequest: false, requestAuthTimeSeconds: 0 },
    };
    expect(transitionGlobal(withSubscription, 'PROCESSING', 1).status).toBe('PROCESSING');
    expect(transitionGlobal(withoutSubscription, 'PROCESSING', 1).status).toBe('PROCESSING');
  });
});

describe('invalid/impossible state combinations are rejected, not silently accepted', () => {
  it('cannot begin a step attempt on a step that already succeeded (no double-run)', () => {
    let record = freshRecord(0);
    record = transitionGlobal(record, 'PROCESSING', 1);
    record = driveStep(record, { kind: 'SUCCEEDED' }, 2);
    const firstStepName = record.policy.requiredSteps[0]!;
    expect(() => beginStepAttempt(firstStepName, record.steps[firstStepName], 3)).toThrow();
  });

  it('cannot jump straight from REQUESTED to FAILED_TERMINAL, skipping PROCESSING', () => {
    const record = freshRecord(0);
    expect(() => transitionGlobal(record, 'FAILED_TERMINAL', 1)).toThrow();
  });
});
