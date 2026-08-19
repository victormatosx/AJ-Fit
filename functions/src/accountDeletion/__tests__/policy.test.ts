import { describe, expect, it } from 'vitest';

import {
  CURRENT_WORKFLOW_VERSION,
  UnknownWorkflowVersionError,
  currentPolicy,
  resolveWorkflowPolicy,
  validatePolicy,
} from '../policy';
import type { AccountDeletionPolicy } from '../types';

describe('workflow policy registry', () => {
  it('resolves the current workflow version', () => {
    const policy = resolveWorkflowPolicy(CURRENT_WORKFLOW_VERSION);
    expect(policy.workflowVersion).toBe(CURRENT_WORKFLOW_VERSION);
    expect(currentPolicy()).toEqual(policy);
  });

  it('throws an UnknownWorkflowVersionError for an unregistered version', () => {
    expect(() => resolveWorkflowPolicy(999)).toThrow(UnknownWorkflowVersionError);
  });

  it('v1 never lets the client choose destructive treatment for pending Fase 0 categories', () => {
    const policy = currentPolicy();
    expect(policy.retention.support).toBe('RETAIN');
    expect(policy.retention.couponRedemptions).toBe('RETAIN');
    expect(policy.retention.revenueCat).toBe('SKIP');
  });

  it('v1 requires every step, including the two that can never be dropped', () => {
    const policy = currentPolicy();
    expect(policy.requiredSteps).toContain('AUTH_DELETION');
    expect(policy.requiredSteps).toContain('VAULT_KEY_DESTRUCTION');
    expect(policy.requiredSteps).toHaveLength(8);
  });

  describe('validatePolicy', () => {
    function basePolicy(overrides: Partial<AccountDeletionPolicy> = {}): AccountDeletionPolicy {
      return {
        workflowVersion: 1,
        retention: { support: 'RETAIN', couponRedemptions: 'RETAIN', revenueCat: 'SKIP' },
        requiredSteps: currentPolicy().requiredSteps,
        retry: { maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 5000, backoffMultiplier: 2 },
        ...overrides,
      };
    }

    it('accepts a well-formed policy', () => {
      expect(() => validatePolicy(basePolicy())).not.toThrow();
    });

    it('rejects a policy missing AUTH_DELETION from requiredSteps', () => {
      expect(() =>
        validatePolicy(
          basePolicy({ requiredSteps: currentPolicy().requiredSteps.filter((s) => s !== 'AUTH_DELETION') }),
        ),
      ).toThrow(/AUTH_DELETION/);
    });

    it('rejects a policy missing VAULT_KEY_DESTRUCTION from requiredSteps', () => {
      expect(() =>
        validatePolicy(
          basePolicy({
            requiredSteps: currentPolicy().requiredSteps.filter((s) => s !== 'VAULT_KEY_DESTRUCTION'),
          }),
        ),
      ).toThrow(/VAULT_KEY_DESTRUCTION/);
    });

    it('rejects non-positive retry configuration', () => {
      expect(() =>
        validatePolicy(basePolicy({ retry: { maxAttempts: 0, initialDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 1 } })),
      ).toThrow(/maxAttempts/);
      expect(() =>
        validatePolicy(basePolicy({ retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 1, backoffMultiplier: 1 } })),
      ).toThrow(/positive/);
      expect(() =>
        validatePolicy(basePolicy({ retry: { maxAttempts: 1, initialDelayMs: 100, maxDelayMs: 10, backoffMultiplier: 1 } })),
      ).toThrow(/maxDelayMs/);
      expect(() =>
        validatePolicy(basePolicy({ retry: { maxAttempts: 1, initialDelayMs: 100, maxDelayMs: 100, backoffMultiplier: 0 } })),
      ).toThrow(/backoffMultiplier/);
    });
  });
});
