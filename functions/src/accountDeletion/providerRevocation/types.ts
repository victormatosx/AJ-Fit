/**
 * Types for provider (Apple/Google) revocation — Fase 3. Pure only; no
 * network/KMS/Firestore call lives in this file.
 *
 * `PROVIDER_REVOCATION` remains ONE step in the Fase 1 machine
 * (`functions/src/accountDeletion/types.ts`'s `ACCOUNT_DELETION_STEP_NAMES`)
 * — this module does NOT add `APPLE_PROVIDER_REVOCATION`/
 * `GOOGLE_PROVIDER_REVOCATION` as new top-level steps. Instead it models the
 * two providers as independent SUB-steps inside that one step, each reusing
 * the exact same `AccountDeletionStepRecord` shape and the exact same
 * transition functions from `../steps.ts` (widened in Fase 3 to accept a
 * plain string label) — see the Fase 3 report §"integração com
 * PROVIDER_REVOCATION" for the full reasoning.
 */

import type { AccountDeletionStepRecord } from '../types';

export type ProviderId = 'apple.com' | 'google.com';

export const PROVIDER_IDS: readonly ProviderId[] = ['apple.com', 'google.com'];

/**
 * Per-provider sub-step state. `linked` is a snapshot taken at deletion-record
 * CREATION time (from the Firebase Auth user's `providerData`, server-side,
 * never from client input) — it never changes afterward, mirroring the
 * immutability the Fase 1 record already gives `uid`/`policy`. A provider
 * that was linked at creation time but gets unlinked mid-workflow (should
 * not happen — nothing in this workflow unlinks providers, see §"Firebase
 * unlink" below) is still processed according to the ORIGINAL snapshot.
 */
export interface ProviderRevocationSubState {
  readonly linked: boolean;
  step: AccountDeletionStepRecord;
}

export interface ProviderRevocationState {
  apple: ProviderRevocationSubState;
  google: ProviderRevocationSubState;
}

/** Sub-step label passed to `../steps.ts`'s transition functions — never a real top-level `AccountDeletionStepName`. */
export function providerSubStepLabel(provider: ProviderId): string {
  return `PROVIDER_REVOCATION:${provider}`;
}

/**
 * Builds the initial sub-state for one provider at record-creation time. A
 * provider NOT linked is immediately `SKIPPED_BY_POLICY` — Fase 3 §17: never
 * open a provider sheet, never call a provider backend, never treat "not
 * linked" as an error. A linked provider starts `PENDING`, exactly like any
 * other Fase 1 step.
 */
export function initialProviderRevocationSubState(
  linked: boolean,
  now: number,
): ProviderRevocationSubState {
  return {
    linked,
    step: linked
      ? {
          status: 'PENDING',
          attemptCount: 0,
          lastAttemptAt: null,
          nextAttemptAt: null,
          lastErrorCode: null,
          completedAt: null,
        }
      : {
          status: 'SKIPPED_BY_POLICY',
          attemptCount: 0,
          lastAttemptAt: null,
          nextAttemptAt: null,
          lastErrorCode: null,
          completedAt: now,
        },
  };
}

export function initialProviderRevocationState(
  linkedProviders: readonly ProviderId[],
  now: number,
): ProviderRevocationState {
  return {
    apple: initialProviderRevocationSubState(linkedProviders.includes('apple.com'), now),
    google: initialProviderRevocationSubState(linkedProviders.includes('google.com'), now),
  };
}

const ACCEPTABLE_FOR_COMPLETION: ReadonlySet<string> = new Set(['SUCCEEDED', 'SKIPPED_BY_POLICY']);

/**
 * The aggregate status the OUTER `steps.PROVIDER_REVOCATION` entry
 * (Fase 1's flat `steps` map) should be written as, given both sub-steps'
 * current status. A future worker calls this after each sub-step attempt to
 * decide whether the outer step can advance — `../steps.ts`'s
 * `isEligibleForCompletion`/`nextRunnableStep` never need to know providers
 * exist at all.
 *
 * Priority: any sub-step `FAILED_TERMINAL` makes the whole outer step
 * terminal-failed immediately — Fase 3 §28: the workflow must not advance
 * past `PROVIDER_REVOCATION` (and therefore never reach the
 * `VAULT_KEY_DESTRUCTION` point of no return) while an obligatory
 * revocation has failed terminally. Otherwise, if either sub-step is still
 * retryable/pending/running, the outer step is `PENDING`-equivalent
 * (callers keep it `PENDING`/`RUNNING` as appropriate — this function only
 * distinguishes "done" from "not done" from "terminally broken"). Only once
 * BOTH are `SUCCEEDED`/`SKIPPED_BY_POLICY` is the outer step `SUCCEEDED`.
 */
export function deriveProviderRevocationOutcome(
  state: ProviderRevocationState,
): 'SUCCEEDED' | 'FAILED_TERMINAL' | 'NOT_DONE' {
  if (state.apple.step.status === 'FAILED_TERMINAL' || state.google.step.status === 'FAILED_TERMINAL') {
    return 'FAILED_TERMINAL';
  }
  if (
    ACCEPTABLE_FOR_COMPLETION.has(state.apple.step.status) &&
    ACCEPTABLE_FOR_COMPLETION.has(state.google.step.status)
  ) {
    return 'SUCCEEDED';
  }
  return 'NOT_DONE';
}

/**
 * Which linked sub-step(s) still need an attempt — Fase 3 §26/§27: retry
 * only what has not succeeded, in a fixed order (Apple before Google,
 * arbitrary but deterministic — never incidental), never re-running one
 * that already reached `SUCCEEDED`/`SKIPPED_BY_POLICY`.
 */
export function nextRunnableProviderSubStep(state: ProviderRevocationState): ProviderId | null {
  if (!ACCEPTABLE_FOR_COMPLETION.has(state.apple.step.status)) return 'apple.com';
  if (!ACCEPTABLE_FOR_COMPLETION.has(state.google.step.status)) return 'google.com';
  return null;
}
