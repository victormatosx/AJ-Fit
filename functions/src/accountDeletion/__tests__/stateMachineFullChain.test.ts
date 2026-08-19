/**
 * Fase 12.5 §40 — proves the ORDERING of `nextRunnableStep` across the full
 * canonical chain now that `VAULT_KEY_DESTRUCTION` has a real executor.
 * No real I/O anywhere in this file — every step outcome is synthetic,
 * applied through the SAME transition functions (`beginStepAttempt`/
 * `completeStepAttempt`) every real executor's outcome would go through.
 * This test proves the STATE MACHINE's ordering, not any executor's
 * behavior (each executor already has its own dedicated test suite).
 */
import { describe, expect, it } from 'vitest';

import { initialStepRecords, beginStepAttempt, completeStepAttempt, nextRunnableStep } from '../steps';
import { currentPolicy } from '../policy';
import type { AccountDeletionStepName, AccountDeletionStepRecord } from '../types';
import type { AccountDeletionStepOutcome } from '../errors';

const CHAIN: readonly AccountDeletionStepName[] = [
  'ACCOUNT_ACCESS_LOCK',
  'PROVIDER_REVOCATION',
  'VAULT_KEY_DESTRUCTION',
  'FIRESTORE_CLEANUP',
  'STORAGE_CLEANUP',
  'RETAINED_DATA_PROCESSING',
  'REVENUECAT_PROCESSING',
  'AUTH_DELETION',
];

function applyOutcome(
  record: AccountDeletionStepRecord,
  outcome: AccountDeletionStepOutcome,
  now: number,
): AccountDeletionStepRecord {
  const running = beginStepAttempt('x', record, now);
  return completeStepAttempt('x', running, outcome, now, currentPolicy().retry);
}

describe('full chain ordering — every step legitimately reachable (Fase 12.5 §40/§41)', () => {
  it('walks ACCOUNT_ACCESS_LOCK through AUTH_DELETION, one step at a time, via nextRunnableStep', () => {
    const policy = currentPolicy();
    let steps = initialStepRecords();
    let now = 1;
    const order: AccountDeletionStepName[] = [];

    for (let i = 0; i < CHAIN.length; i++) {
      const runnable = nextRunnableStep(policy, steps);
      expect(runnable).toBe(CHAIN[i]);
      order.push(runnable as AccountDeletionStepName);

      // policy v1: RETAINED_DATA_PROCESSING (support/couponRedemptions
      // RETAIN) and REVENUECAT_PROCESSING (SKIP) both resolve to
      // SKIPPED_BY_POLICY in the real executors (Fases 8/9) — reproduced
      // here as the synthetic outcome so this test matches real behavior,
      // not just a happy-path SUCCEEDED everywhere.
      const outcome: AccountDeletionStepOutcome =
        runnable === 'RETAINED_DATA_PROCESSING'
          ? { kind: 'SKIPPED_BY_POLICY', reason: 'support=RETAIN, couponRedemptions=RETAIN' }
          : runnable === 'REVENUECAT_PROCESSING'
            ? { kind: 'SKIPPED_BY_POLICY', reason: 'revenueCat=SKIP' }
            : { kind: 'SUCCEEDED' };

      steps = { ...steps, [runnable as AccountDeletionStepName]: applyOutcome(steps[runnable as AccountDeletionStepName], outcome, now) };
      now += 1;
    }

    expect(order).toEqual(CHAIN);
    expect(nextRunnableStep(policy, steps)).toBeNull(); // every required step done — workflow eligible for COMPLETED
  });

  it('VAULT_KEY_DESTRUCTION completing legitimately unblocks FIRESTORE_CLEANUP (the specific chain link this phase fixes)', () => {
    const policy = currentPolicy();
    let steps = initialStepRecords();
    let now = 1;

    steps = { ...steps, ACCOUNT_ACCESS_LOCK: applyOutcome(steps.ACCOUNT_ACCESS_LOCK, { kind: 'SUCCEEDED' }, now++) };
    steps = { ...steps, PROVIDER_REVOCATION: applyOutcome(steps.PROVIDER_REVOCATION, { kind: 'SUCCEEDED' }, now++) };

    // Before this phase, no executor existed for this step at all — the
    // chain could never legitimately advance past this point.
    expect(nextRunnableStep(policy, steps)).toBe('VAULT_KEY_DESTRUCTION');

    steps = {
      ...steps,
      VAULT_KEY_DESTRUCTION: applyOutcome(steps.VAULT_KEY_DESTRUCTION, { kind: 'SUCCEEDED' }, now++),
    };

    expect(nextRunnableStep(policy, steps)).toBe('FIRESTORE_CLEANUP');
  });

  it('a still-PENDING VAULT_KEY_DESTRUCTION blocks every later step, including AUTH_DELETION', () => {
    const policy = currentPolicy();
    let steps = initialStepRecords();
    let now = 1;
    for (const name of CHAIN) {
      if (name === 'VAULT_KEY_DESTRUCTION' || name === 'AUTH_DELETION') continue;
      steps = { ...steps, [name]: applyOutcome(steps[name], { kind: 'SUCCEEDED' }, now++) };
    }
    expect(nextRunnableStep(policy, steps)).toBe('VAULT_KEY_DESTRUCTION');
    expect(nextRunnableStep(policy, steps)).not.toBe('AUTH_DELETION');
  });
});
