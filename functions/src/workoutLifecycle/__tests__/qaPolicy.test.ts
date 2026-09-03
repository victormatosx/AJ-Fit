import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { progressionPolicyModeFor, resolveWorkoutLifecycleQaMode } from '../qaPolicy';

function fakeFirestore(userData: Record<string, unknown> | undefined): Firestore {
  return {
    collection: () => ({
      doc: () => ({
        get: async () => ({ data: () => userData }),
      }),
    }),
  } as unknown as Firestore;
}

describe('resolveWorkoutLifecycleQaMode', () => {
  it('defaults to NORMAL when the user document does not exist', async () => {
    expect(await resolveWorkoutLifecycleQaMode('u1', fakeFirestore(undefined))).toBe('NORMAL');
  });

  it('defaults to NORMAL when no QA field is present', async () => {
    const firestore = fakeFirestore({ metadata: { role: 'user' } });
    expect(await resolveWorkoutLifecycleQaMode('u1', firestore)).toBe('NORMAL');
  });

  it('defaults to NORMAL for a malformed/unknown workoutLifecycleQaMode value (never guesses)', async () => {
    for (const value of ['accelerated', 'transition', 'BOTH', 1, true, null, {}, ['ACCELERATED']]) {
      const firestore = fakeFirestore({ metadata: { workoutLifecycleQaMode: value } });
      expect(await resolveWorkoutLifecycleQaMode('u1', firestore)).toBe('NORMAL');
    }
  });

  it('resolves QA_ACCELERATED from the new field', async () => {
    const firestore = fakeFirestore({ metadata: { workoutLifecycleQaMode: 'ACCELERATED' } });
    expect(await resolveWorkoutLifecycleQaMode('u1', firestore)).toBe('QA_ACCELERATED');
  });

  it('resolves QA_TRANSITION from the new field', async () => {
    const firestore = fakeFirestore({ metadata: { workoutLifecycleQaMode: 'TRANSITION' } });
    expect(await resolveWorkoutLifecycleQaMode('u1', firestore)).toBe('QA_TRANSITION');
  });

  describe('legacy boolean fallback (deprecated)', () => {
    it('interprets the old boolean as QA_ACCELERATED only when the new field is absent', async () => {
      const firestore = fakeFirestore({ metadata: { workoutLifecycleQaAccelerated: true } });
      expect(await resolveWorkoutLifecycleQaMode('u1', firestore)).toBe('QA_ACCELERATED');
    });

    it('the new field always wins over the legacy boolean, in both directions', async () => {
      const toTransition = fakeFirestore({
        metadata: { workoutLifecycleQaMode: 'TRANSITION', workoutLifecycleQaAccelerated: true },
      });
      expect(await resolveWorkoutLifecycleQaMode('u1', toTransition)).toBe('QA_TRANSITION');

      const toNormal = fakeFirestore({
        metadata: { workoutLifecycleQaMode: 'ACCELERATED', workoutLifecycleQaAccelerated: false },
      });
      expect(await resolveWorkoutLifecycleQaMode('u1', toNormal)).toBe('QA_ACCELERATED');
    });

    it('never infers QA_TRANSITION from the legacy boolean — it never meant that', async () => {
      const firestore = fakeFirestore({ metadata: { workoutLifecycleQaAccelerated: true } });
      expect(await resolveWorkoutLifecycleQaMode('u1', firestore)).not.toBe('QA_TRANSITION');
    });

    it('ignores a falsy/malformed legacy boolean exactly like before', async () => {
      for (const value of [false, 1, 'true', null, {}]) {
        const firestore = fakeFirestore({ metadata: { workoutLifecycleQaAccelerated: value } });
        expect(await resolveWorkoutLifecycleQaMode('u1', firestore)).toBe('NORMAL');
      }
    });
  });

  it('mutual exclusivity: the resolved mode is always exactly one of NORMAL/QA_ACCELERATED/QA_TRANSITION, never a combination', async () => {
    const cases = [
      { metadata: {} },
      { metadata: { workoutLifecycleQaMode: 'ACCELERATED' } },
      { metadata: { workoutLifecycleQaMode: 'TRANSITION' } },
      { metadata: { workoutLifecycleQaAccelerated: true } },
      { metadata: { workoutLifecycleQaMode: 'TRANSITION', workoutLifecycleQaAccelerated: true } },
    ];
    for (const data of cases) {
      const mode = await resolveWorkoutLifecycleQaMode('u1', fakeFirestore(data));
      expect(['NORMAL', 'QA_ACCELERATED', 'QA_TRANSITION']).toContain(mode);
    }
  });
});

describe('progressionPolicyModeFor', () => {
  it('only QA_ACCELERATED maps to compressed thresholds', () => {
    expect(progressionPolicyModeFor('NORMAL')).toBe('NORMAL');
    expect(progressionPolicyModeFor('QA_ACCELERATED')).toBe('QA_ACCELERATED');
    // QA_TRANSITION bypasses eligibility outright — it never needs (or gets) compressed time.
    expect(progressionPolicyModeFor('QA_TRANSITION')).toBe('NORMAL');
  });
});
