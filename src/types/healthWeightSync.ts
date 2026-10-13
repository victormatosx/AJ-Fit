import * as Crypto from 'expo-crypto';

/** Shared contracts for the Fase 3 weight-import pipeline. */

export type HealthWeightPlatform = 'ios' | 'android';

export interface HealthWeightSample {
  platform: HealthWeightPlatform;
  /** Stable native identifier: HealthKit sample `uuid`, or Health Connect record `metadata.id`. */
  sourceId: string;
  /** Originating app, when the platform reports one (bundle id / package name). */
  sourceApp: string | null;
  /** Real measurement time, as reported by the OS. */
  measuredAt: Date;
  weightKg: number;
}

/** `users/{uid}/healthWeightSamples/{sampleId}` document shape. */
export interface HealthWeightSampleDoc {
  id: string;
  platform: HealthWeightPlatform;
  sourceId: string;
  sourceApp: string | null;
  measuredAt: Date;
  weightKg: number;
  createdAt: Date | null;
}

export type HealthWeightSyncStatus =
  | 'idle'
  | 'syncing'
  | 'success'
  | 'no_data'
  | 'permission_required'
  | 'unavailable'
  | 'error';

export type HealthWeightSyncCheckpoint = {
  version: 1;
  platform: HealthWeightPlatform;
  /** Fixed lower bound for the first import (180 days), reused after token expiry. */
  historyStartIso: string;
  /** HealthKit anchor or Health Connect changes token. Never shared across platforms/users. */
  cursor: string | null;
  lastSuccessfulAtIso: string | null;
  /** Prevents a deliberate bulk deletion from immediately re-importing the deleted history. */
  ignoreMeasuredBeforeIso: string | null;
};

export const HEALTH_WEIGHT_INITIAL_HISTORY_DAYS = 180;
export const HEALTH_WEIGHT_PAGE_SIZE = 200;
const MAX_PLAUSIBLE_WEIGHT_KG = 500;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function isPlausibleWeightKg(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < MAX_PLAUSIBLE_WEIGHT_KG;
}

export function isPlausibleMeasuredAt(value: unknown): value is Date {
  return value instanceof Date
    && !Number.isNaN(value.getTime())
    && value.getTime() <= Date.now() + MAX_FUTURE_CLOCK_SKEW_MS;
}

/**
 * Deterministic, path-safe identity for one native record.
 *
 * Hashing the complete tuple is intentional. Replacing unsupported characters
 * with `_` (the interrupted implementation) made `a/b` collide with `a_b`, and
 * using only the native id ignored the source app namespace. SHA-256 keeps even
 * hostile/very long external ids out of Firestore paths while retaining a
 * stable identity across reinstalls and repeated syncs.
 */
export async function healthWeightSampleDocId(sample: Pick<HealthWeightSample, 'platform' | 'sourceApp' | 'sourceId'>): Promise<string> {
  const identity = JSON.stringify([
    1,
    sample.platform,
    sample.sourceApp?.trim() || '',
    sample.sourceId,
  ]);
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, identity);
  return `${sample.platform}_${digest.toLowerCase()}`;
}

export function isValidHealthWeightSample(sample: HealthWeightSample): boolean {
  return (
    (sample.platform === 'ios' || sample.platform === 'android')
    && typeof sample.sourceId === 'string' && sample.sourceId.trim().length > 0
    && sample.sourceId.length <= 512
    && (sample.sourceApp == null || (typeof sample.sourceApp === 'string' && sample.sourceApp.length <= 256))
    && isPlausibleWeightKg(sample.weightKg)
    && isPlausibleMeasuredAt(sample.measuredAt)
  );
}
