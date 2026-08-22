/**
 * `REVENUECAT_PROCESSING` step — Fase 9.
 *
 * `RevenueCatProcessingAction` (`../types.ts`) reuses the same closed
 * vocabulary as retention (`DELETE | ANONYMIZE | RETAIN | SKIP`), but for
 * RevenueCat it NEVER means canceling the underlying Apple/Google native
 * subscription — see `../types.ts`'s doc comment on
 * `RevenueCatProcessingAction`. This module only ever concerns the
 * RevenueCat customer IDENTITY (the `appUserID` record and its data inside
 * RevenueCat), never the store subscription itself.
 */

import type { RevenueCatProcessingAction } from '../types';

export type RevenueCatProcessingOutcome = 'SKIPPED' | 'DELETED' | 'ANONYMIZED';

export interface RevenueCatProcessingResult {
  action: RevenueCatProcessingAction;
  outcome: RevenueCatProcessingOutcome;
}

/**
 * Thrown when a frozen policy resolves to `DELETE`/`ANONYMIZE` for
 * RevenueCat and no confirmed, reviewed administrative operation exists to
 * perform it. Fase 9 rule §31: "não invente endpoint" — audited during this
 * phase, `functions/src/billing/revenueCatApi.ts`'s `RevenueCatV2Client`
 * only implements READ operations (`getCustomerIdentityGraph`,
 * `getCustomerSubscriptions`); no customer-delete/anonymize administrative
 * call is implemented or confirmed against RevenueCat's official V2 API
 * docs anywhere in this codebase. Always `TERMINAL`/
 * `MISSING_REQUIRED_CONFIGURATION` — no retry fixes a missing contract.
 */
export class UnsupportedRevenueCatActionError extends Error {
  constructor(public readonly action: RevenueCatProcessingAction) {
    super(
      `No implemented/confirmed RevenueCat administrative operation for action "${action}" — ` +
        'DELETE/ANONYMIZE require a reviewed contract against RevenueCat\'s official API before ' +
        'this executor may run them (Fase 9 rule: never invent an endpoint).',
    );
    this.name = 'UnsupportedRevenueCatActionError';
  }
}
