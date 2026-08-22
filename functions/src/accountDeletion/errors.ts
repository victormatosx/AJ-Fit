/**
 * Error taxonomy for the Account Deletion workflow — see Fase 1 report §13.
 *
 * A closed vocabulary, never a raw provider error message or stack trace:
 * `AccountDeletionStepRecord.lastErrorCode` (types.ts) persists ONLY values
 * from `KNOWN_ERROR_CODES`, so a future executor must translate whatever a
 * provider (Firestore, Storage, RevenueCat, Apple, Google, Admin SDK auth)
 * actually threw into one of these before writing anything to the record.
 * That translation is Fase 2+ work — this module only defines the target
 * vocabulary and its classification.
 */

export type ErrorClassification = 'RETRYABLE' | 'TERMINAL' | 'LOGICAL_SUCCESS';

export const KNOWN_ERROR_CODES = [
  // Retryable — transient infrastructure conditions a later attempt can
  // reasonably expect to clear on its own.
  'TIMEOUT',
  'UNAVAILABLE',
  'DEADLINE_EXCEEDED',
  'RESOURCE_EXHAUSTED',
  'INTERNAL_TRANSIENT',
  // Terminal — the workflow cannot make progress without human/operator
  // intervention; retrying the same input will not help.
  'INVALID_CONTRACT',
  'IMPOSSIBLE_STATE',
  'WORKFLOW_CORRUPTION',
  'UNKNOWN_WORKFLOW_VERSION',
  'MISSING_REQUIRED_CONFIGURATION',
  'RETRY_BUDGET_EXHAUSTED',
  // Logical success — the step's OBJECTIVE is already satisfied; a provider
  // reporting "not found"/"already gone" for a delete/revoke is success, not
  // failure (see Fase 1 report §10 — idempotency).
  'ALREADY_ABSENT',
  'ALREADY_REVOKED',
  'ALREADY_DISABLED',
  'ALREADY_DELETED',
  // Fase 3 — provider revocation (Apple/Google). Terminal: none of these are
  // fixed by retrying the SAME material; the flow must restart from a fresh
  // client-side reauthentication capture, which is outside a backend retry's
  // reach — see providerRevocation/appleProviderRevocation.ts.
  /** Apple's `/auth/token` rejected the authorization code itself (`invalid_grant` — already used, or its ~5-minute lifetime expired). A NEW authorizationCode is required; retrying with the same one can never succeed. */
  'PROVIDER_AUTHORIZATION_INVALID',
  /** The uid a provider-revocation attempt would act on does not match the uid the material was captured for — see `providerRevocation/appleProviderRevocation.ts`'s identity guard. */
  'IDENTITY_MISMATCH',
  /** The provider returned HTTP success but a body this client cannot parse/trust — a code-level or provider-contract problem, not a transient one (mirrors `RevenueCatApiError`'s `invalid_response`, `functions/src/billing/revenueCatApi.ts`). */
  'PROVIDER_RESPONSE_INVALID',
] as const;

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

const CLASSIFICATION_BY_CODE: Readonly<Record<KnownErrorCode, ErrorClassification>> = {
  TIMEOUT: 'RETRYABLE',
  UNAVAILABLE: 'RETRYABLE',
  DEADLINE_EXCEEDED: 'RETRYABLE',
  RESOURCE_EXHAUSTED: 'RETRYABLE',
  INTERNAL_TRANSIENT: 'RETRYABLE',
  INVALID_CONTRACT: 'TERMINAL',
  IMPOSSIBLE_STATE: 'TERMINAL',
  WORKFLOW_CORRUPTION: 'TERMINAL',
  UNKNOWN_WORKFLOW_VERSION: 'TERMINAL',
  MISSING_REQUIRED_CONFIGURATION: 'TERMINAL',
  RETRY_BUDGET_EXHAUSTED: 'TERMINAL',
  ALREADY_ABSENT: 'LOGICAL_SUCCESS',
  ALREADY_REVOKED: 'LOGICAL_SUCCESS',
  ALREADY_DISABLED: 'LOGICAL_SUCCESS',
  ALREADY_DELETED: 'LOGICAL_SUCCESS',
  PROVIDER_AUTHORIZATION_INVALID: 'TERMINAL',
  IDENTITY_MISMATCH: 'TERMINAL',
  PROVIDER_RESPONSE_INVALID: 'TERMINAL',
};

export function classifyErrorCode(code: KnownErrorCode): ErrorClassification {
  return CLASSIFICATION_BY_CODE[code];
}

/**
 * What a (future) step executor reports after attempting one step. Kept
 * deliberately narrow: an executor never writes a step status directly — it
 * reports an outcome, and `resolveStepStatusFromOutcome` below is the single
 * place that turns an outcome into a status, so idempotency/logical-success
 * handling can't be duplicated (or forgotten) per executor.
 */
export type AccountDeletionStepOutcome =
  | { kind: 'SUCCEEDED' }
  | { kind: 'SKIPPED_BY_POLICY'; reason: string }
  | { kind: 'FAILED'; code: KnownErrorCode };

import type { AccountDeletionStepStatus } from './types';

/**
 * Turns an executor's outcome into the step status the state machine
 * accepts. This is where "already absent = success" actually takes effect:
 * a `FAILED` outcome carrying a `LOGICAL_SUCCESS`-classified code resolves to
 * `SUCCEEDED`, never to `FAILED_RETRYABLE`/`FAILED_TERMINAL` — an executor
 * that finds nothing left to delete does not need special-case logic of its
 * own, it just reports the provider's "not found" as a `FAILED` outcome with
 * the matching `ALREADY_*` code and this function does the rest.
 */
export function resolveStepStatusFromOutcome(
  outcome: AccountDeletionStepOutcome,
): AccountDeletionStepStatus {
  switch (outcome.kind) {
    case 'SUCCEEDED':
      return 'SUCCEEDED';
    case 'SKIPPED_BY_POLICY':
      return 'SKIPPED_BY_POLICY';
    case 'FAILED': {
      const classification = classifyErrorCode(outcome.code);
      if (classification === 'LOGICAL_SUCCESS') return 'SUCCEEDED';
      if (classification === 'RETRYABLE') return 'FAILED_RETRYABLE';
      return 'FAILED_TERMINAL';
    }
  }
}
