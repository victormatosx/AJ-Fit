/**
 * `REVENUECAT_PROCESSING` step executor — Fase 9.
 *
 * Applies the FROZEN `retention.revenueCat` action from the deletion record
 * — never `currentPolicy()` (same rule as `../retainedDataProcessing`).
 * Policy v1 is `SKIP` (`../policy.ts`): this executor performs ZERO
 * RevenueCat I/O for it — `SKIPPED_BY_POLICY` is reported without ever
 * constructing a RevenueCat API client, exactly mirroring how
 * `../../billing/revenuecat.ts`'s webhook resolver is lazy about
 * constructing `RevenueCatV2Client` (see `resolveWebhookIdentity`'s doc
 * comment there) — no secret is read, no network call is made, for a
 * step whose policy says "do nothing".
 *
 * ABSOLUTE RULE (Fase 9 §39/§40): this step must NEVER cancel the
 * underlying Apple/Google native subscription, and must NEVER perform
 * `PROVIDER_REVOCATION`'s job — see `RevenueCatProcessingAction`'s doc
 * comment (`../types.ts`).
 */

import type { AccountDeletionStepOutcome } from '../errors';
import type { RevenueCatProcessingAction } from '../types';
import { UnsupportedRevenueCatActionError } from './types';
import type { RevenueCatProcessingResult } from './types';

/**
 * Applies one action for the RevenueCat customer identity. `SKIP`/`RETAIN`
 * never construct or call a RevenueCat client — see the module doc comment.
 * `DELETE`/`ANONYMIZE` always throw `UnsupportedRevenueCatActionError`: no
 * confirmed administrative operation exists in this codebase yet (Fase 9
 * §31 — never invent an endpoint).
 */
async function applyRevenueCatAction(
  action: RevenueCatProcessingAction,
): Promise<RevenueCatProcessingResult> {
  if (action === 'DELETE' || action === 'ANONYMIZE') {
    throw new UnsupportedRevenueCatActionError(action);
  }

  // SKIP / RETAIN: no RevenueCat customer identity is touched, no network
  // call, no secret read.
  return { action, outcome: 'SKIPPED' };
}

export async function runRevenueCatProcessing(
  action: RevenueCatProcessingAction,
  options: { onCompleted?: (result: RevenueCatProcessingResult) => void } = {},
): Promise<AccountDeletionStepOutcome> {
  let result: RevenueCatProcessingResult;
  try {
    result = await applyRevenueCatAction(action);
  } catch (error) {
    if (error instanceof UnsupportedRevenueCatActionError) {
      return { kind: 'FAILED', code: 'MISSING_REQUIRED_CONFIGURATION' };
    }
    throw error;
  }

  options.onCompleted?.(result);

  // Distinct from `SUCCEEDED`: this reports that the step's destructive
  // action was intentionally not performed (`../types.ts`'s doc comment on
  // `AccountDeletionStepStatus`), never a false "customer deleted".
  return {
    kind: 'SKIPPED_BY_POLICY',
    reason: `revenueCat=${action} — frozen policy performs no customer mutation`,
  };
}
