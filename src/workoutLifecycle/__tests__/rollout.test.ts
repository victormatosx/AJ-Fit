import { describe, expect, it } from 'vitest';
import {
  isEligibleForNewMigration,
  isValidRolloutConfig,
  stickyRolloutBucket,
  WORKOUT_LIFECYCLE_ROLLOUT_FAIL_SAFE_CONFIG,
} from '../rollout';

describe('stickyRolloutBucket', () => {
  it('is deterministic for the same uid', () => {
    expect(stickyRolloutBucket('user-1')).toBe(stickyRolloutBucket('user-1'));
  });

  it('is a 0-99 integer', () => {
    for (const uid of ['a', 'b', 'user-with-a-much-longer-uid-string-1234567890']) {
      const bucket = stickyRolloutBucket(uid);
      expect(Number.isInteger(bucket)).toBe(true);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
  });

  it('distributes across many uids rather than collapsing to one bucket', () => {
    const buckets = new Set(Array.from({ length: 500 }, (_, i) => stickyRolloutBucket(`synthetic-uid-${i}`)));
    expect(buckets.size).toBeGreaterThan(50);
  });
});

describe('isEligibleForNewMigration', () => {
  it('is false when disabled, regardless of percentage', () => {
    expect(isEligibleForNewMigration('any-uid', { schemaVersion: 1, enabled: false, percentage: 100 })).toBe(false);
  });

  it('is false at 0% and true at 100% for every uid', () => {
    for (const uid of ['a', 'zzz', 'user-42']) {
      expect(isEligibleForNewMigration(uid, { schemaVersion: 1, enabled: true, percentage: 0 })).toBe(false);
      expect(isEligibleForNewMigration(uid, { schemaVersion: 1, enabled: true, percentage: 100 })).toBe(true);
    }
  });

  it('same uid never flips cohort when percentage is re-evaluated at the same value twice', () => {
    const config = { schemaVersion: 1 as const, enabled: true, percentage: 37 };
    const uid = 'stable-uid';
    expect(isEligibleForNewMigration(uid, config)).toBe(isEligibleForNewMigration(uid, config));
  });

  it('increasing the percentage only ever adds uids, never removes previously-eligible ones', () => {
    const uids = Array.from({ length: 200 }, (_, i) => `uid-${i}`);
    const at10 = new Set(uids.filter((uid) => isEligibleForNewMigration(uid, { schemaVersion: 1, enabled: true, percentage: 10 })));
    const at50 = new Set(uids.filter((uid) => isEligibleForNewMigration(uid, { schemaVersion: 1, enabled: true, percentage: 50 })));
    for (const uid of at10) expect(at50.has(uid)).toBe(true);
  });

  it('rejects a non-finite/out-of-range percentage safely rather than throwing', () => {
    expect(isEligibleForNewMigration('u', { schemaVersion: 1, enabled: true, percentage: Number.NaN })).toBe(false);
    expect(isEligibleForNewMigration('u', { schemaVersion: 1, enabled: true, percentage: -5 })).toBe(false);
    expect(isEligibleForNewMigration('u', { schemaVersion: 1, enabled: true, percentage: 500 })).toBe(true);
  });

  it.each([0, 1, 10, 25, 50, 99, 100])('uses an exact exclusive bucket boundary at %i%%', (percentage) => {
    const config = { schemaVersion: 1 as const, enabled: true, percentage };
    const uids = Array.from({ length: 20_000 }, (_, index) => `boundary-uid-${index}`);
    const below = uids.find((uid) => stickyRolloutBucket(uid) === Math.max(0, percentage - 1));
    const at = uids.find((uid) => stickyRolloutBucket(uid) === Math.min(99, percentage));
    if (percentage > 0) expect(below && isEligibleForNewMigration(below, config)).toBe(true);
    if (percentage < 100) expect(at && isEligibleForNewMigration(at, config)).toBe(false);
  });
});

describe('isValidRolloutConfig', () => {
  it('accepts a well-formed config', () => {
    expect(isValidRolloutConfig({ schemaVersion: 1, enabled: true, percentage: 25 })).toBe(true);
  });

  it('rejects malformed shapes', () => {
    expect(isValidRolloutConfig(null)).toBe(false);
    expect(isValidRolloutConfig({})).toBe(false);
    expect(isValidRolloutConfig({ schemaVersion: 1, enabled: 'true', percentage: 25 })).toBe(false);
    expect(isValidRolloutConfig({ schemaVersion: 1, enabled: true, percentage: '25' })).toBe(false);
    expect(isValidRolloutConfig({ schemaVersion: 1, enabled: true, percentage: Number.NaN })).toBe(false);
    expect(isValidRolloutConfig({ schemaVersion: 1, enabled: true, percentage: 25, unknown: true })).toBe(false);
    expect(isValidRolloutConfig({ schemaVersion: 1, enabled: true, percentage: 25.5 })).toBe(false);
  });
});

describe('WORKOUT_LIFECYCLE_ROLLOUT_FAIL_SAFE_CONFIG', () => {
  it('is fail-closed for new migrations', () => {
    expect(isEligibleForNewMigration('any-uid', WORKOUT_LIFECYCLE_ROLLOUT_FAIL_SAFE_CONFIG)).toBe(false);
  });
});
