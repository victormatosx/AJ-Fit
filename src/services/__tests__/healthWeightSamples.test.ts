import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    createHash('sha256').update(value, 'utf8').digest('hex'),
}));

const store = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const transactionControl = vi.hoisted(() => ({ calls: 0, rejectCall: 0 }));
const queryDocs = vi.hoisted(() => [] as { id: string; ref: { path: string } }[]);
vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => {
  class FakeTimestamp {
    constructor(readonly value: Date) {}
    static fromDate(value: Date) { return new FakeTimestamp(value); }
    toDate() { return this.value; }
  }
  return {
    collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    doc: (parent: { path: string }, id: string) => ({ path: `${parent.path}/${id}`, id }),
    serverTimestamp: () => ({ server: true }),
    Timestamp: FakeTimestamp,
    runTransaction: async (_db: unknown, callback: (transaction: unknown) => Promise<unknown>) => {
      transactionControl.calls += 1;
      if (transactionControl.rejectCall === transactionControl.calls) throw new Error('injected failure');
      const pending: Array<{ ref: { path: string }; data: Record<string, unknown> }> = [];
      const result = await callback({
        get: async (ref: { path: string }) => ({ exists: () => store.has(ref.path) }),
        set: (ref: { path: string }, data: Record<string, unknown>) => pending.push({ ref, data }),
      });
      pending.forEach(({ ref, data }) => store.set(ref.path, data));
      return result;
    },
    getDocs: vi.fn(async () => ({ docs: [...queryDocs] })),
    query: (...args: unknown[]) => args,
    orderBy: (...args: unknown[]) => args,
    limit: (value: number) => value,
    writeBatch: () => {
      const pending: { path: string }[] = [];
      return {
        delete: (ref: { path: string }) => pending.push(ref),
        commit: async () => {
          pending.forEach((ref) => {
            store.delete(ref.path);
            const index = queryDocs.findIndex((candidate) => candidate.ref.path === ref.path);
            if (index >= 0) queryDocs.splice(index, 1);
          });
        },
      };
    },
    deleteDoc: vi.fn(async () => undefined),
  };
});

import { deleteAllHealthWeightSamples, importHealthWeightSamples } from '../healthWeightSamples';
import type { HealthWeightSample } from '../../types/healthWeightSync';

function sample(index: number, overrides: Partial<HealthWeightSample> = {}): HealthWeightSample {
  return {
    platform: 'ios',
    sourceId: `id-${index}`,
    sourceApp: 'com.apple.Health',
    measuredAt: new Date(`2026-01-01T12:${String(index % 60).padStart(2, '0')}:00Z`),
    weightKg: 70 + index / 100,
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
  transactionControl.calls = 0;
  transactionControl.rejectCall = 0;
  queryDocs.splice(0);
});

describe('healthWeightSamples persistence', () => {
  it('deduplicates repeated input persistently while preserving same-day distinct ids', async () => {
    const atSameTime = new Date('2026-01-01T12:00:00Z');
    const first = sample(1, { measuredAt: atSameTime });
    const second = sample(2, { measuredAt: atSameTime });
    const initial = await importHealthWeightSamples('uid-a', [first, first, second]);
    expect(initial).toMatchObject({ imported: 2, skippedDuplicates: 1, partialFailure: false });
    expect(store.size).toBe(2);

    const repeated = await importHealthWeightSamples('uid-a', [first, second]);
    expect(repeated).toMatchObject({ imported: 0, skippedDuplicates: 2, partialFailure: false });
    expect(store.size).toBe(2);
  });

  it('keeps identical source ids from different apps as distinct records', async () => {
    const result = await importHealthWeightSamples('uid-a', [
      sample(1, { sourceId: 'shared', sourceApp: 'com.scale.a' }),
      sample(2, { sourceId: 'shared', sourceApp: 'com.scale.b' }),
    ]);
    expect(result.imported).toBe(2);
  });

  it('stops after an atomic chunk failure and safely resumes without duplicating the committed chunk', async () => {
    const records = Array.from({ length: 205 }, (_, index) => sample(index));
    transactionControl.rejectCall = 2;
    const partial = await importHealthWeightSamples('uid-a', records);
    expect(partial).toMatchObject({ imported: 200, partialFailure: true });
    expect(store.size).toBe(200);

    transactionControl.calls = 0;
    transactionControl.rejectCall = 0;
    const recovered = await importHealthWeightSamples('uid-a', records);
    expect(recovered).toMatchObject({ imported: 5, skippedDuplicates: 200, partialFailure: false });
    expect(store.size).toBe(205);
  });

  it('skips invalid records individually without blocking valid neighbors', async () => {
    const result = await importHealthWeightSamples('uid-a', [sample(1), sample(2, { weightKg: 0 })]);
    expect(result).toMatchObject({ imported: 1, skippedInvalid: 1 });
  });

  it('bulk deletion targets only imported-weight document refs', async () => {
    const weightPaths = [
      'users/uid-a/healthWeightSamples/w1',
      'users/uid-a/healthWeightSamples/w2',
    ];
    weightPaths.forEach((path, index) => {
      store.set(path, { weightKg: 70 + index });
      queryDocs.push({ id: `w${index + 1}`, ref: { path } });
    });
    store.set('users/uid-a/assessments/a1', { weight: 80 });
    store.set('users/uid-a/nutritionProfile/current', { target: 2000 });

    await expect(deleteAllHealthWeightSamples('uid-a')).resolves.toEqual({ deleted: 2 });
    expect(store.has('users/uid-a/assessments/a1')).toBe(true);
    expect(store.has('users/uid-a/nutritionProfile/current')).toBe(true);
    expect(weightPaths.every((path) => !store.has(path))).toBe(true);
  });
});
