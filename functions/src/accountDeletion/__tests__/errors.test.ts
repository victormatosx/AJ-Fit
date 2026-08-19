import { describe, expect, it } from 'vitest';

import { classifyErrorCode, resolveStepStatusFromOutcome } from '../errors';

describe('account deletion error taxonomy', () => {
  it('classifies transient infrastructure codes as retryable', () => {
    expect(classifyErrorCode('TIMEOUT')).toBe('RETRYABLE');
    expect(classifyErrorCode('UNAVAILABLE')).toBe('RETRYABLE');
    expect(classifyErrorCode('DEADLINE_EXCEEDED')).toBe('RETRYABLE');
    expect(classifyErrorCode('RESOURCE_EXHAUSTED')).toBe('RETRYABLE');
    expect(classifyErrorCode('INTERNAL_TRANSIENT')).toBe('RETRYABLE');
  });

  it('classifies contract/workflow corruption codes as terminal', () => {
    expect(classifyErrorCode('INVALID_CONTRACT')).toBe('TERMINAL');
    expect(classifyErrorCode('IMPOSSIBLE_STATE')).toBe('TERMINAL');
    expect(classifyErrorCode('WORKFLOW_CORRUPTION')).toBe('TERMINAL');
    expect(classifyErrorCode('UNKNOWN_WORKFLOW_VERSION')).toBe('TERMINAL');
    expect(classifyErrorCode('MISSING_REQUIRED_CONFIGURATION')).toBe('TERMINAL');
    expect(classifyErrorCode('RETRY_BUDGET_EXHAUSTED')).toBe('TERMINAL');
  });

  it('classifies "already done" codes as logical success', () => {
    expect(classifyErrorCode('ALREADY_ABSENT')).toBe('LOGICAL_SUCCESS');
    expect(classifyErrorCode('ALREADY_REVOKED')).toBe('LOGICAL_SUCCESS');
    expect(classifyErrorCode('ALREADY_DISABLED')).toBe('LOGICAL_SUCCESS');
    expect(classifyErrorCode('ALREADY_DELETED')).toBe('LOGICAL_SUCCESS');
  });

  describe('resolveStepStatusFromOutcome', () => {
    it('maps SUCCEEDED and SKIPPED_BY_POLICY outcomes straight through', () => {
      expect(resolveStepStatusFromOutcome({ kind: 'SUCCEEDED' })).toBe('SUCCEEDED');
      expect(
        resolveStepStatusFromOutcome({ kind: 'SKIPPED_BY_POLICY', reason: 'policy=RETAIN' }),
      ).toBe('SKIPPED_BY_POLICY');
    });

    it('collapses a logical-success failure code into SUCCEEDED (idempotency)', () => {
      // "delete avatar" finding no avatar to delete must be success, not a
      // fatal error — Fase 1 report §10.
      expect(resolveStepStatusFromOutcome({ kind: 'FAILED', code: 'ALREADY_ABSENT' })).toBe(
        'SUCCEEDED',
      );
      expect(resolveStepStatusFromOutcome({ kind: 'FAILED', code: 'ALREADY_DELETED' })).toBe(
        'SUCCEEDED',
      );
    });

    it('maps a retryable failure code to FAILED_RETRYABLE', () => {
      expect(resolveStepStatusFromOutcome({ kind: 'FAILED', code: 'UNAVAILABLE' })).toBe(
        'FAILED_RETRYABLE',
      );
    });

    it('maps a terminal failure code to FAILED_TERMINAL', () => {
      expect(resolveStepStatusFromOutcome({ kind: 'FAILED', code: 'INVALID_CONTRACT' })).toBe(
        'FAILED_TERMINAL',
      );
    });
  });
});
