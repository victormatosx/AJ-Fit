/**
 * Fase 13 — reusable, TEST-ONLY workflow harness for fault injection.
 *
 * Deliberately NOT a worker/scheduler (Fase 14): it has no polling loop, no
 * "wake up when nextAttemptAt arrives" behavior, and is never imported by
 * any production file. It only gives fault-injection tests a small, shared
 * way to build an artificial `AccountDeletionRecord`-shaped state, ask "what
 * step is runnable next" (delegating to the REAL `steps.ts`), and apply a
 * step's outcome through the REAL transition functions
 * (`beginStepAttempt`/`completeStepAttempt`) — the exact same functions any
 * future real worker would call. Every executor is still invoked directly
 * by each test, using real Emulators or fakes as that test chooses; this
 * module only removes the boilerplate of driving the state machine itself.
 */
import {
  beginStepAttempt,
  completeStepAttempt,
  initialStepRecords,
  nextRunnableStep,
} from '../steps';
import { currentPolicy } from '../policy';
import {
  initialProviderRevocationState,
  type ProviderId,
  type ProviderRevocationState,
} from '../providerRevocation/types';
import type {
  AccountDeletionPolicy,
  AccountDeletionStepName,
  AccountDeletionStepRecord,
} from '../types';
import type { AccountDeletionStepOutcome } from '../errors';

export interface FaultHarnessState {
  policy: AccountDeletionPolicy;
  steps: Readonly<Record<AccountDeletionStepName, AccountDeletionStepRecord>>;
  providerRevocation: ProviderRevocationState;
}

export function createHarness(
  linkedProviders: readonly ProviderId[] = [],
  policy: AccountDeletionPolicy = currentPolicy(),
  now = Date.now(),
): FaultHarnessState {
  return {
    policy,
    steps: initialStepRecords(),
    providerRevocation: initialProviderRevocationState(linkedProviders, now),
  };
}

/** What `nextRunnableStep` says right now — never reimplemented by a test. */
export function runnableStep(state: FaultHarnessState): AccountDeletionStepName | null {
  return nextRunnableStep(state.policy, state.steps);
}

/**
 * Applies one attempt's outcome to a top-level step, via the REAL
 * `beginStepAttempt`/`completeStepAttempt` transition functions — the exact
 * mechanism `resolveStepStatusFromOutcome`/retry-budget/CAS-adjacent logic
 * already goes through in production code.
 */
export function applyStepOutcome(
  state: FaultHarnessState,
  step: AccountDeletionStepName,
  outcome: AccountDeletionStepOutcome,
  now: number,
): FaultHarnessState {
  const running = beginStepAttempt(step, state.steps[step], now);
  const completed = completeStepAttempt(step, running, outcome, now, state.policy.retry);
  return { ...state, steps: { ...state.steps, [step]: completed } };
}

/** Same as `applyStepOutcome`, for one Apple/Google provider sub-step (a plain string label, not a top-level step — Fase 3's own widened transition contract). */
export function applyProviderSubStepOutcome(
  state: FaultHarnessState,
  provider: 'apple' | 'google',
  outcome: AccountDeletionStepOutcome,
  now: number,
): FaultHarnessState {
  const sub = state.providerRevocation[provider];
  const running = beginStepAttempt(`PROVIDER_REVOCATION:${provider}`, sub.step, now);
  const completed = completeStepAttempt(`PROVIDER_REVOCATION:${provider}`, running, outcome, now, state.policy.retry);
  return {
    ...state,
    providerRevocation: { ...state.providerRevocation, [provider]: { ...sub, step: completed } },
  };
}
