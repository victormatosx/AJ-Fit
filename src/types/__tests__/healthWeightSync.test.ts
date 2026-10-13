import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    createHash('sha256').update(value, 'utf8').digest('hex'),
}));

import {
  healthWeightSampleDocId,
  isValidHealthWeightSample,
  type HealthWeightSample,
} from '../healthWeightSync';

function sample(overrides: Partial<HealthWeightSample> = {}): HealthWeightSample {
  return {
    platform: 'ios',
    sourceId: 'uuid-1',
    sourceApp: 'com.scale.one',
    measuredAt: new Date('2026-01-02T03:04:05.000Z'),
    weightKg: 72.4,
    ...overrides,
  };
}

describe('health weight identity and validation', () => {
  it('is deterministic, fixed-length, and Firestore path-safe for hostile external ids', async () => {
    const value = sample({ sourceId: '../../a/b?# unicode ç' });
    const first = await healthWeightSampleDocId(value);
    const second = await healthWeightSampleDocId(value);
    expect(first).toBe(second);
    expect(first).toMatch(/^ios_[0-9a-f]{64}$/);
    expect(first).not.toContain('/');
  });

  it('does not reproduce the old character-substitution collision', async () => {
    await expect(healthWeightSampleDocId(sample({ sourceId: 'a/b' })))
      .resolves.not.toBe(await healthWeightSampleDocId(sample({ sourceId: 'a_b' })));
  });

  it('namespaces identical native ids by source app and platform', async () => {
    const iosA = await healthWeightSampleDocId(sample());
    const iosB = await healthWeightSampleDocId(sample({ sourceApp: 'com.scale.two' }));
    const android = await healthWeightSampleDocId(sample({ platform: 'android' }));
    expect(new Set([iosA, iosB, android]).size).toBe(3);
  });

  it('accepts multiple valid measurements at the same timestamp and rejects malformed values', () => {
    expect(isValidHealthWeightSample(sample({ sourceId: 'one' }))).toBe(true);
    expect(isValidHealthWeightSample(sample({ sourceId: 'two' }))).toBe(true);
    expect(isValidHealthWeightSample(sample({ weightKg: 0 }))).toBe(false);
    expect(isValidHealthWeightSample(sample({ sourceId: '' }))).toBe(false);
    expect(isValidHealthWeightSample(sample({ measuredAt: new Date('invalid') }))).toBe(false);
  });
});
