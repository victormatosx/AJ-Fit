/**
 * `RETAINED_DATA_PROCESSING` step — Fase 8.
 *
 * This module applies exactly the `retention` policy FROZEN on the deletion
 * record (`AccountDeletionRecord.policy.retention` — see `../policy.ts` and
 * `../types.ts`'s doc comment on `AccountDeletionPolicy`), never
 * `currentPolicy()`. A later backend deploy that changes
 * `CURRENT_WORKFLOW_VERSION`/`WORKFLOW_POLICIES` must never retroactively
 * change what an in-flight or already-processed deletion did — see
 * `__tests__/engine.test.ts`'s "policy versioning" cases for the proof.
 */

import type { RetentionAction } from '../types';

/** One data category this step is responsible for. */
export type RetainedDataCategory = 'support' | 'couponRedemptions';

/**
 * What actually happened to one category, given the frozen `RetentionAction`
 * for it. `RETAINED` is the expected, non-error outcome for policy v1
 * (`support`/`couponRedemptions` both `RETAIN`) — never represented as a
 * failure or a no-op the caller has to guess at.
 */
export type RetainedDataCategoryOutcome = 'RETAINED' | 'DELETED' | 'ANONYMIZED' | 'ALREADY_ABSENT';

export interface RetainedDataCategoryResult {
  category: RetainedDataCategory;
  action: RetentionAction;
  outcome: RetainedDataCategoryOutcome;
  /** Number of top-level resources found for this category (tickets, or 1/0 for the single coupon redemption doc) — observability only, never a correctness signal. */
  resourceCount: number;
}

/**
 * Thrown when a frozen policy resolves to `ANONYMIZE` for a category this
 * module has no concrete, reviewed anonymization contract for yet (Fase 8
 * §11/rule "não fingir anonimização"). Always a `TERMINAL`/
 * `MISSING_REQUIRED_CONFIGURATION`-classified condition — no retry fixes a
 * missing contract; it needs a real product/legal decision plus a new
 * policy version that ships the actual field-by-field transformation. Never
 * caught and silently downgraded to `RETAIN`/`SUCCEEDED`.
 */
export class UnsupportedRetentionActionError extends Error {
  constructor(
    public readonly category: RetainedDataCategory,
    public readonly action: RetentionAction,
  ) {
    super(
      `No implemented contract for ${category} retention action "${action}" — ` +
        'ANONYMIZE requires an explicit, reviewed field-by-field contract before ' +
        'this executor may run it (Fase 8 rule: never invent anonymization).',
    );
    this.name = 'UnsupportedRetentionActionError';
  }
}
