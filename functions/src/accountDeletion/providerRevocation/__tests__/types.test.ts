import { describe, expect, it } from 'vitest';

import {
  deriveProviderRevocationOutcome,
  initialProviderRevocationState,
  nextRunnableProviderSubStep,
  providerSubStepLabel,
} from '../types';
import type { ProviderRevocationState } from '../types';

const NOW = 1_000;

function withStatus(
  state: ProviderRevocationState,
  provider: 'apple' | 'google',
  status: ProviderRevocationState['apple']['step']['status'],
): ProviderRevocationState {
  return {
    ...state,
    [provider]: { ...state[provider], step: { ...state[provider].step, status } },
  };
}

describe('initialProviderRevocationState', () => {
  it('marks an unlinked provider as SKIPPED_BY_POLICY immediately, never PENDING', () => {
    const state = initialProviderRevocationState([], NOW);
    expect(state.apple).toEqual({
      linked: false,
      step: {
        status: 'SKIPPED_BY_POLICY',
        attemptCount: 0,
        lastAttemptAt: null,
        nextAttemptAt: null,
        lastErrorCode: null,
        completedAt: NOW,
      },
    });
    expect(state.google.linked).toBe(false);
  });

  it('marks a linked provider PENDING, never pre-emptively skipped', () => {
    const state = initialProviderRevocationState(['apple.com'], NOW);
    expect(state.apple.linked).toBe(true);
    expect(state.apple.step.status).toBe('PENDING');
    expect(state.google.linked).toBe(false);
    expect(state.google.step.status).toBe('SKIPPED_BY_POLICY');
  });

  it('handles both linked (password + apple + google user)', () => {
    const state = initialProviderRevocationState(['apple.com', 'google.com'], NOW);
    expect(state.apple.linked).toBe(true);
    expect(state.google.linked).toBe(true);
    expect(state.apple.step.status).toBe('PENDING');
    expect(state.google.step.status).toBe('PENDING');
  });

  it('handles password-only (neither linked) — both immediately skipped', () => {
    const state = initialProviderRevocationState([], NOW);
    expect(state.apple.step.status).toBe('SKIPPED_BY_POLICY');
    expect(state.google.step.status).toBe('SKIPPED_BY_POLICY');
  });
});

describe('deriveProviderRevocationOutcome', () => {
  it('SUCCEEDED once both sub-steps are terminal-acceptable', () => {
    const state = initialProviderRevocationState([], NOW); // both SKIPPED_BY_POLICY
    expect(deriveProviderRevocationOutcome(state)).toBe('SUCCEEDED');
  });

  it('NOT_DONE while a linked provider is still PENDING/RUNNING/FAILED_RETRYABLE', () => {
    const state = initialProviderRevocationState(['apple.com'], NOW);
    expect(deriveProviderRevocationOutcome(state)).toBe('NOT_DONE');
  });

  it('Apple SUCCEEDED, Google FAILED_RETRYABLE -> NOT_DONE, preserving Apple progress', () => {
    let state = initialProviderRevocationState(['apple.com', 'google.com'], NOW);
    state = withStatus(state, 'apple', 'SUCCEEDED');
    state = withStatus(state, 'google', 'FAILED_RETRYABLE');
    expect(deriveProviderRevocationOutcome(state)).toBe('NOT_DONE');
    // Apple's progress is untouched — this is the "retry independent" guarantee.
    expect(state.apple.step.status).toBe('SUCCEEDED');
  });

  it('Google SUCCEEDED, Apple FAILED_RETRYABLE -> NOT_DONE, preserving Google progress', () => {
    let state = initialProviderRevocationState(['apple.com', 'google.com'], NOW);
    state = withStatus(state, 'google', 'SUCCEEDED');
    state = withStatus(state, 'apple', 'FAILED_RETRYABLE');
    expect(deriveProviderRevocationOutcome(state)).toBe('NOT_DONE');
    expect(state.google.step.status).toBe('SUCCEEDED');
  });

  it('any FAILED_TERMINAL sub-step makes the whole outer step FAILED_TERMINAL, even if the other succeeded', () => {
    let state = initialProviderRevocationState(['apple.com', 'google.com'], NOW);
    state = withStatus(state, 'apple', 'SUCCEEDED');
    state = withStatus(state, 'google', 'FAILED_TERMINAL');
    expect(deriveProviderRevocationOutcome(state)).toBe('FAILED_TERMINAL');
  });

  it('both linked and both succeeded -> SUCCEEDED', () => {
    let state = initialProviderRevocationState(['apple.com', 'google.com'], NOW);
    state = withStatus(state, 'apple', 'SUCCEEDED');
    state = withStatus(state, 'google', 'SUCCEEDED');
    expect(deriveProviderRevocationOutcome(state)).toBe('SUCCEEDED');
  });
});

describe('nextRunnableProviderSubStep', () => {
  it('returns null when nothing is linked', () => {
    expect(nextRunnableProviderSubStep(initialProviderRevocationState([], NOW))).toBeNull();
  });

  it('returns apple.com first when both are pending', () => {
    expect(
      nextRunnableProviderSubStep(initialProviderRevocationState(['apple.com', 'google.com'], NOW)),
    ).toBe('apple.com');
  });

  it('returns google.com once apple.com is done, never re-selecting apple.com', () => {
    let state = initialProviderRevocationState(['apple.com', 'google.com'], NOW);
    state = withStatus(state, 'apple', 'SUCCEEDED');
    expect(nextRunnableProviderSubStep(state)).toBe('google.com');
  });

  it('returns null once both are done', () => {
    let state = initialProviderRevocationState(['apple.com', 'google.com'], NOW);
    state = withStatus(state, 'apple', 'SUCCEEDED');
    state = withStatus(state, 'google', 'SKIPPED_BY_POLICY');
    expect(nextRunnableProviderSubStep(state)).toBeNull();
  });
});

describe('providerSubStepLabel', () => {
  it('produces a distinct, non-colliding label per provider', () => {
    expect(providerSubStepLabel('apple.com')).toBe('PROVIDER_REVOCATION:apple.com');
    expect(providerSubStepLabel('google.com')).toBe('PROVIDER_REVOCATION:google.com');
  });
});
