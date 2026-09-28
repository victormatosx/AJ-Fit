/**
 * `RETAINED_DATA_PROCESSING` step executor — Fase 8.
 *
 * Applies the FROZEN `retention` policy from the deletion record — never
 * `currentPolicy()` (Fase 8 rule §2/§20/§21; `AccountDeletionRecord.policy`
 * is immutable after creation, `../record.ts`). Delegates to
 * `processSupportRetention`/`processCouponRedemptionsRetention`, never a
 * monolithic switch (rule §19).
 *
 * Outcome: `SKIPPED_BY_POLICY` when every category's frozen action is
 * `RETAIN`/`SKIP` (no destructive action was ever authorized — matches
 * `../types.ts`'s doc comment on `AccountDeletionStepStatus`). `SUCCEEDED`
 * when at least one category's action actually executed
 * (`DELETE`/`ANONYMIZE`) without error. `FAILED` (terminal,
 * `MISSING_REQUIRED_CONFIGURATION`) when a category resolves to `ANONIZE`
 * with no implemented contract yet — never silently downgraded to RETAIN.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';

import { db as defaultDb, storage as defaultStorage } from '../../lib/firebaseAdmin';
import type { AccountDeletionStepOutcome, KnownErrorCode } from '../errors';
import type { AccountDeletionRetentionPolicy } from '../types';
import { processSupportRetention } from './support';
import { processCouponRedemptionsRetention } from './couponRedemptions';
import { UnsupportedRetentionActionError } from './types';
import type { RetainedDataCategoryResult } from './types';

/**
 * Maps whatever this step's dependencies threw to the shared taxonomy.
 * Covers BOTH Firestore's gRPC numeric codes (Support V2 cases, coupon
 * redemptions) and Cloud Storage's HTTP-like codes (support attachments) —
 * this step is the only one that legitimately crosses both, so it needs
 * both vocabularies (same reasoning as Fase 6/7's own per-provider
 * classifiers, `../firestoreCleanup/engine.ts` / `../storageCleanup/engine.ts`).
 */
function classifyRetainedDataError(error: unknown): KnownErrorCode {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code: unknown }).code
      : undefined;

  switch (code) {
    // Firestore gRPC
    case 4:
      return 'DEADLINE_EXCEEDED';
    case 14:
      return 'UNAVAILABLE';
    case 8:
      return 'RESOURCE_EXHAUSTED';
    case 7:
      return 'MISSING_REQUIRED_CONFIGURATION';
    // Cloud Storage HTTP-like
    case 429:
      return 'RESOURCE_EXHAUSTED';
    case 500:
    case 503:
      return 'UNAVAILABLE';
    case 403:
      return 'MISSING_REQUIRED_CONFIGURATION';
    case 400:
      return 'INVALID_CONTRACT';
    default:
      return 'INTERNAL_TRANSIENT';
  }
}

/** This step only concerns the two categories it owns — `revenueCat` belongs to Fase 9's own step. */
export type RetainedDataRetentionPolicy = Pick<
  AccountDeletionRetentionPolicy,
  'support' | 'couponRedemptions'
>;

export async function runRetainedDataProcessing(
  uid: string,
  retentionPolicy: RetainedDataRetentionPolicy,
  options: {
    db?: Firestore;
    storage?: Storage;
    onCategoryCompleted?: (result: RetainedDataCategoryResult) => void;
  } = {},
): Promise<AccountDeletionStepOutcome> {
  const db = options.db ?? defaultDb;
  const storage = options.storage ?? defaultStorage;

  let anyDestructiveActionRan = false;

  try {
    const supportResult = await processSupportRetention(uid, retentionPolicy.support, { db, storage });
    options.onCategoryCompleted?.(supportResult);
    if (supportResult.action === 'DELETE' || supportResult.action === 'ANONYMIZE') {
      anyDestructiveActionRan = true;
    }

    const couponResult = await processCouponRedemptionsRetention(uid, retentionPolicy.couponRedemptions, {
      db,
    });
    options.onCategoryCompleted?.(couponResult);
    if (couponResult.action === 'DELETE' || couponResult.action === 'ANONYMIZE') {
      anyDestructiveActionRan = true;
    }
  } catch (error) {
    if (error instanceof UnsupportedRetentionActionError) {
      return { kind: 'FAILED', code: 'MISSING_REQUIRED_CONFIGURATION' };
    }
    return { kind: 'FAILED', code: classifyRetainedDataError(error) };
  }

  if (!anyDestructiveActionRan) {
    return {
      kind: 'SKIPPED_BY_POLICY',
      reason: `support=${retentionPolicy.support}, couponRedemptions=${retentionPolicy.couponRedemptions} — frozen policy retains both categories`,
    };
  }

  return { kind: 'SUCCEEDED' };
}
