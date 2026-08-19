import { describe, expect, it } from 'vitest';

import { currentPolicy, resolveWorkflowPolicy } from '../policy';
import { transitionGlobal } from '../stateMachine';
import {
  ImmutableFieldViolationError,
  StateRegressionError,
  assertImmutableFieldsUnchanged,
  assertNoGlobalRegression,
  createAccountDeletionRecord,
  isAuditRecordExpired,
  minimizeCompletedRecord,
} from '../record';
import type { AccountDeletionRecord } from '../types';

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

describe('createAccountDeletionRecord', () => {
  it('starts REQUESTED, revision 0, every step PENDING', () => {
    const record = freshRecord(100);
    expect(record.status).toBe('REQUESTED');
    expect(record.revision).toBe(0);
    expect(record.completedAt).toBeNull();
    expect(record.requestedAt).toBe(100);
    for (const step of Object.values(record.steps)) {
      expect(step.status).toBe('PENDING');
      expect(step.attemptCount).toBe(0);
    }
  });

  it('freezes the resolved policy onto the record (workflowVersion mirrors policy.workflowVersion)', () => {
    const record = freshRecord();
    expect(record.workflowVersion).toBe(POLICY.workflowVersion);
    expect(record.policy).toEqual(POLICY);
  });

  it('rejects an invalid policy at creation time (e.g. AUTH_DELETION missing)', () => {
    const broken = {
      ...POLICY,
      requiredSteps: POLICY.requiredSteps.filter((s) => s !== 'AUTH_DELETION'),
    };
    expect(() =>
      createAccountDeletionRecord({
        deletionId: 'del-1',
        uid: 'uid-1',
        policy: broken,
        now: 0,
        requestMetadata: { subscriptionActiveAtRequest: null, requestAuthTimeSeconds: 0 },
      }),
    ).toThrow(/AUTH_DELETION/);
  });
});

describe('immutability invariants', () => {
  it('accepts a mutation that only changes status/steps/updatedAt', () => {
    const before = freshRecord(0);
    const after: AccountDeletionRecord = { ...before, status: 'PROCESSING', updatedAt: 10 };
    expect(() => assertImmutableFieldsUnchanged(before, after)).not.toThrow();
  });

  it('rejects a uid change', () => {
    const before = freshRecord(0);
    const after: AccountDeletionRecord = { ...before, uid: 'someone-elses-uid' };
    expect(() => assertImmutableFieldsUnchanged(before, after)).toThrow(ImmutableFieldViolationError);
  });

  it('rejects a workflowVersion change', () => {
    const before = freshRecord(0);
    const after: AccountDeletionRecord = { ...before, workflowVersion: 999 };
    expect(() => assertImmutableFieldsUnchanged(before, after)).toThrow(ImmutableFieldViolationError);
  });

  it('rejects a policy change mid-retry — e.g. support silently flipping from RETAIN to DELETE', () => {
    const before = freshRecord(0);
    const mutatedPolicy = {
      ...before.policy,
      retention: { ...before.policy.retention, support: 'DELETE' as const },
    };
    const after: AccountDeletionRecord = { ...before, policy: mutatedPolicy };
    expect(() => assertImmutableFieldsUnchanged(before, after)).toThrow(ImmutableFieldViolationError);
  });

  it('a policy resolved from a DIFFERENT (but structurally distinct) workflow version also violates immutability', () => {
    // Guards against "swap the whole policy object for another version's" as
    // much as against editing a single field.
    const before = freshRecord(0);
    const otherVersionPolicy = { ...resolveWorkflowPolicy(1), retry: { ...resolveWorkflowPolicy(1).retry, maxAttempts: 999 } };
    const after: AccountDeletionRecord = { ...before, policy: otherVersionPolicy };
    expect(() => assertImmutableFieldsUnchanged(before, after)).toThrow(ImmutableFieldViolationError);
  });
});

describe('global regression guard', () => {
  it('allows a legal forward transition', () => {
    expect(() => assertNoGlobalRegression('REQUESTED', 'PROCESSING')).not.toThrow();
  });

  it('rejects SUCCEEDED-like regression: PROCESSING back to REQUESTED', () => {
    expect(() => assertNoGlobalRegression('PROCESSING', 'REQUESTED')).toThrow(StateRegressionError);
  });

  it('rejects COMPLETED "transitioning" to itself — terminal accepts no outgoing transition at all', () => {
    expect(() => assertNoGlobalRegression('COMPLETED', 'COMPLETED')).toThrow(StateRegressionError);
  });

  it('is a no-op for any other identical non-terminal status', () => {
    expect(() => assertNoGlobalRegression('PROCESSING', 'PROCESSING')).not.toThrow();
  });
});

describe('minimizeCompletedRecord — post-completion lifecycle', () => {
  function completedRecord(): AccountDeletionRecord {
    let record = freshRecord(0);
    record = transitionGlobal(record, 'PROCESSING', 10);
    const steps = { ...record.steps };
    for (const name of POLICY.requiredSteps) {
      (steps as any)[name] = {
        ...steps[name],
        status: 'SUCCEEDED',
        attemptCount: 3,
        lastErrorCode: null,
        completedAt: 15,
      };
    }
    record = { ...record, steps };
    return transitionGlobal(record, 'COMPLETED', 20);
  }

  it('throws when the record has not reached COMPLETED', () => {
    expect(() => minimizeCompletedRecord(freshRecord(0))).toThrow(/COMPLETED/);
  });

  it('drops per-attempt detail and keeps only the audit-relevant shape', () => {
    const audit = minimizeCompletedRecord(completedRecord());
    expect(audit).toEqual({
      deletionId: 'del-1',
      uid: 'uid-1',
      workflowVersion: POLICY.workflowVersion,
      status: 'COMPLETED',
      requestedAt: 0,
      completedAt: 20,
      stepsSummary: Object.fromEntries(POLICY.requiredSteps.map((name) => [name, 'SUCCEEDED'])),
      recordRetentionExpiresAt: null,
    });
  });

  it('does not invent a retention prazo — null unless explicitly supplied', () => {
    const audit = minimizeCompletedRecord(completedRecord());
    expect(audit.recordRetentionExpiresAt).toBeNull();
    expect(isAuditRecordExpired(audit, Date.now())).toBe(false);
  });

  it('supports expiry once a prazo IS supplied (architecture allows it without asserting a number)', () => {
    const audit = minimizeCompletedRecord(completedRecord(), 1_000);
    expect(isAuditRecordExpired(audit, 999)).toBe(false);
    expect(isAuditRecordExpired(audit, 1_000)).toBe(true);
  });
});
