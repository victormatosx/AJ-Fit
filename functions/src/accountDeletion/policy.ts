/**
 * Versioned policy registry — see Fase 1 report §7/§18.
 *
 * A deletion request resolves and freezes exactly ONE `AccountDeletionPolicy`
 * at creation time (`resolveWorkflowPolicy(CURRENT_WORKFLOW_VERSION)`), and
 * that snapshot travels with the record for its whole lifetime — a later
 * backend deploy that changes `CURRENT_WORKFLOW_VERSION` or edits
 * `WORKFLOW_POLICIES` must never retroactively change the semantics of an
 * in-flight deletion (`record.ts`'s `assertImmutableFieldsUnchanged` is the
 * enforcement point).
 *
 * `support`/`couponRedemptions`/`revenueCat` are set to `RETAIN`/`SKIP` in
 * v1 deliberately: Fase 0 left their legal/business treatment pending, and
 * "no new decision" (Fase 1's own instruction) means the safe default is to
 * not touch them, not to assume `DELETE`. Changing any of the three to
 * `DELETE`/`ANONYMIZE` is a Fase 0 legal/business decision that becomes a new
 * policy version (`WORKFLOW_POLICIES[2]`, etc.) — never a silent edit of an
 * existing version's behavior.
 */

import { ACCOUNT_DELETION_STEP_NAMES } from './types';
import type { AccountDeletionPolicy } from './types';

export const CURRENT_WORKFLOW_VERSION = 1;

const POLICY_V1: AccountDeletionPolicy = {
  workflowVersion: 1,
  retention: {
    // Fase 0: DECISÃO JURÍDICA/NEGÓCIO NECESSÁRIA. Safe default: retain,
    // touch nothing, until that decision lands as a new policy version.
    support: 'RETAIN',
    couponRedemptions: 'RETAIN',
    // Fase 0: RevenueCat customer treatment pending + depends on
    // RevenueCat Dashboard/API capabilities not yet confirmed
    // (NÃO DETERMINÁVEL PELO REPOSITÓRIO). SKIP = no RevenueCat customer
    // mutation performed by this workflow version at all.
    revenueCat: 'SKIP',
  },
  // v1 requires every step. A future version could in principle mark a step
  // as not required (see `validatePolicy` for the two that can never be
  // dropped), but nothing today motivates doing so.
  requiredSteps: ACCOUNT_DELETION_STEP_NAMES,
  retry: {
    maxAttempts: 8,
    initialDelayMs: 30_000,
    maxDelayMs: 6 * 60 * 60 * 1000,
    backoffMultiplier: 2,
  },
};

const WORKFLOW_POLICIES: Readonly<Record<number, AccountDeletionPolicy>> = {
  1: POLICY_V1,
};

/**
 * Thrown when a record references a `workflowVersion` this build of the
 * backend no longer (or not yet) understands. Classified `TERMINAL` — no
 * amount of retrying resolves an unknown version; it needs an operator to
 * either restore the version's policy definition or migrate the record.
 */
export class UnknownWorkflowVersionError extends Error {
  constructor(public readonly workflowVersion: number) {
    super(`Unknown account deletion workflow version: ${workflowVersion}`);
    this.name = 'UnknownWorkflowVersionError';
  }
}

export function resolveWorkflowPolicy(workflowVersion: number): AccountDeletionPolicy {
  const policy = WORKFLOW_POLICIES[workflowVersion];
  if (!policy) throw new UnknownWorkflowVersionError(workflowVersion);
  return policy;
}

/** The policy a brand-new `requestAccountDeletion` call resolves and freezes today. */
export function currentPolicy(): AccountDeletionPolicy {
  return resolveWorkflowPolicy(CURRENT_WORKFLOW_VERSION);
}

/**
 * Structural guardrails every policy version must satisfy, regardless of how
 * `support`/`couponRedemptions`/`revenueCat` end up being configured.
 * Violating any of these is a programming error in a new policy version, not
 * a runtime condition a retry can fix — always thrown as an
 * `INVALID_CONTRACT`-shaped error.
 */
export function validatePolicy(policy: AccountDeletionPolicy): void {
  if (!policy.requiredSteps.includes('AUTH_DELETION')) {
    throw new Error('Invalid policy: AUTH_DELETION must always be a required step');
  }
  if (!policy.requiredSteps.includes('VAULT_KEY_DESTRUCTION')) {
    throw new Error('Invalid policy: VAULT_KEY_DESTRUCTION must always be a required step');
  }
  if (policy.retry.maxAttempts < 1) {
    throw new Error('Invalid policy: retry.maxAttempts must be >= 1');
  }
  if (policy.retry.initialDelayMs <= 0 || policy.retry.maxDelayMs <= 0) {
    throw new Error('Invalid policy: retry delays must be positive');
  }
  if (policy.retry.maxDelayMs < policy.retry.initialDelayMs) {
    throw new Error('Invalid policy: retry.maxDelayMs must be >= retry.initialDelayMs');
  }
  if (policy.retry.backoffMultiplier < 1) {
    throw new Error('Invalid policy: retry.backoffMultiplier must be >= 1');
  }
}
