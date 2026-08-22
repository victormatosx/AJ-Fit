import { describe, expect, it } from 'vitest';

import { currentPolicy } from '../policy';
import {
  IncompleteRequiredStepsError,
  InvalidGlobalTransitionError,
  canTransitionGlobal,
  isTerminalGlobalStatus,
  transitionGlobal,
} from '../stateMachine';
import { createAccountDeletionRecord } from '../record';
import type { AccountDeletionRecord } from '../types';

const POLICY = currentPolicy();

function freshRecord(now = 0): AccountDeletionRecord {
  return createAccountDeletionRecord({
    deletionId: 'del-1',
    uid: 'uid-1',
    policy: POLICY,
    now,
    requestMetadata: { subscriptionActiveAtRequest: null, requestAuthTimeSeconds: 0 },
  });
}

function allStepsSucceeded(record: AccountDeletionRecord, now: number): AccountDeletionRecord {
  const steps = { ...record.steps };
  for (const name of POLICY.requiredSteps) {
    (steps as any)[name] = { ...steps[name], status: 'SUCCEEDED', completedAt: now };
  }
  return { ...record, steps };
}

describe('global transition graph', () => {
  it('permits the happy path REQUESTED -> PROCESSING -> COMPLETED', () => {
    expect(canTransitionGlobal('REQUESTED', 'PROCESSING')).toBe(true);
    expect(canTransitionGlobal('PROCESSING', 'COMPLETED')).toBe(true);
  });

  it('permits PROCESSING <-> RETRY_SCHEDULED', () => {
    expect(canTransitionGlobal('PROCESSING', 'RETRY_SCHEDULED')).toBe(true);
    expect(canTransitionGlobal('RETRY_SCHEDULED', 'PROCESSING')).toBe(true);
  });

  it('permits escalation to FAILED_TERMINAL from PROCESSING or RETRY_SCHEDULED', () => {
    expect(canTransitionGlobal('PROCESSING', 'FAILED_TERMINAL')).toBe(true);
    expect(canTransitionGlobal('RETRY_SCHEDULED', 'FAILED_TERMINAL')).toBe(true);
  });

  it('rejects REQUESTED -> COMPLETED (must pass through PROCESSING)', () => {
    expect(canTransitionGlobal('REQUESTED', 'COMPLETED')).toBe(false);
  });

  it('rejects any outgoing transition from a terminal status, including to itself', () => {
    for (const terminal of ['COMPLETED', 'FAILED_TERMINAL'] as const) {
      expect(isTerminalGlobalStatus(terminal)).toBe(true);
      for (const to of ['REQUESTED', 'PROCESSING', 'RETRY_SCHEDULED', 'COMPLETED', 'FAILED_TERMINAL'] as const) {
        expect(canTransitionGlobal(terminal, to)).toBe(false);
      }
    }
  });

  it('rejects regression PROCESSING -> REQUESTED', () => {
    expect(canTransitionGlobal('PROCESSING', 'REQUESTED')).toBe(false);
  });
});

describe('transitionGlobal', () => {
  it('happy path: REQUESTED -> PROCESSING -> COMPLETED once every required step is done', () => {
    let record = freshRecord(0);
    record = transitionGlobal(record, 'PROCESSING', 10);
    expect(record.status).toBe('PROCESSING');

    record = allStepsSucceeded(record, 20);
    record = transitionGlobal(record, 'COMPLETED', 30);
    expect(record.status).toBe('COMPLETED');
    expect(record.completedAt).toBe(30);
  });

  it('throws IncompleteRequiredStepsError for COMPLETED with steps still pending (no partial completion)', () => {
    let record = freshRecord(0);
    record = transitionGlobal(record, 'PROCESSING', 10);
    expect(() => transitionGlobal(record, 'COMPLETED', 20)).toThrow(IncompleteRequiredStepsError);
  });

  it('throws IncompleteRequiredStepsError even when only ONE required step is still pending', () => {
    let record = freshRecord(0);
    record = transitionGlobal(record, 'PROCESSING', 10);
    const steps = { ...record.steps };
    for (const name of POLICY.requiredSteps.slice(0, -1)) {
      (steps as any)[name] = { ...steps[name], status: 'SUCCEEDED', completedAt: 15 };
    }
    record = { ...record, steps };
    expect(() => transitionGlobal(record, 'COMPLETED', 20)).toThrow(IncompleteRequiredStepsError);
  });

  it('a required step in FAILED_TERMINAL blocks COMPLETED, even if every other step succeeded', () => {
    let record = freshRecord(0);
    record = transitionGlobal(record, 'PROCESSING', 10);
    record = allStepsSucceeded(record, 15);
    const steps = { ...record.steps, AUTH_DELETION: { ...record.steps.AUTH_DELETION, status: 'FAILED_TERMINAL' as const, completedAt: 15 } };
    record = { ...record, steps };
    expect(() => transitionGlobal(record, 'COMPLETED', 20)).toThrow(IncompleteRequiredStepsError);
  });

  it('rejects an illegal transition with InvalidGlobalTransitionError', () => {
    const record = freshRecord(0);
    expect(() => transitionGlobal(record, 'COMPLETED', 10)).toThrow(InvalidGlobalTransitionError);
  });

  it('rejects mutating a COMPLETED workflow back into processing', () => {
    let record = freshRecord(0);
    record = transitionGlobal(record, 'PROCESSING', 10);
    record = allStepsSucceeded(record, 15);
    record = transitionGlobal(record, 'COMPLETED', 20);
    expect(() => transitionGlobal(record, 'PROCESSING', 30)).toThrow(InvalidGlobalTransitionError);
  });

  it('an active subscription at request time never blocks REQUESTED -> PROCESSING', () => {
    const record = freshRecord(0);
    // subscriptionActiveAtRequest is metadata only — transitionGlobal takes
    // no such parameter at all, so this test asserts the transition succeeds
    // regardless of what the metadata says.
    const withActiveSubscription: AccountDeletionRecord = {
      ...record,
      requestMetadata: { ...record.requestMetadata, subscriptionActiveAtRequest: true },
    };
    expect(() => transitionGlobal(withActiveSubscription, 'PROCESSING', 10)).not.toThrow();
  });
});
