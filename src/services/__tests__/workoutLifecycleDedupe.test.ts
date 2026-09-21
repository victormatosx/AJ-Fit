import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn((...segments: string[]) => ({ path: segments.join('/') })),
  getDoc: mocks.getDoc,
  getDocs: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  where: vi.fn(),
}));
vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../workoutLifecycle/domain', () => ({
  isWorkoutLifecycle: () => true,
  isTrainingCycle: () => true,
  isProgramInstance: () => true,
  isPendingEvolution: () => true,
  isWorkoutLifecycleEvent: () => true,
  cycleIdForOperation: vi.fn(),
  lifecycleEventId: vi.fn(),
  programInstanceIdForOperation: vi.fn(),
  startingLevelFromQuestionnaire: vi.fn(),
}));
vi.mock('../userProfile', () => ({ getQuestionnaireById: vi.fn() }));
vi.mock('../../workoutLifecycle/prescriptionInputs', () => ({ buildPrescriptionInputSnapshot: vi.fn() }));
vi.mock('../../workoutLifecycle/rollout', () => ({
  isEligibleForNewMigration: vi.fn(),
  isValidRolloutConfig: vi.fn(),
  WORKOUT_LIFECYCLE_ROLLOUT_FAIL_SAFE_CONFIG: {},
}));
vi.mock('../../workoutLifecycle/telemetry', () => ({ logWorkoutLifecycleEvent: vi.fn() }));
vi.mock('../../workoutLifecycle/authorityProvider', () => ({
  authorizeWorkoutLifecycleMutation: vi.fn(),
  requireWorkoutLifecycleCanonical: vi.fn(),
  WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID: 'grant',
}));

import { loadWorkoutLifecycle, loadWorkoutLifecycleDeduped } from '../workoutLifecycle';

function fakeSnapshot(data: Record<string, unknown>) {
  return { exists: () => true, data: () => data };
}

describe('loadWorkoutLifecycleDeduped', () => {
  beforeEach(() => {
    mocks.getDoc.mockReset();
    mocks.getDoc.mockImplementation(async () => fakeSnapshot({ currentCycleId: 'c1', activeProgramInstanceId: 'p1' }));
  });

  it('dedupes concurrent calls for the same uid into one loadWorkoutLifecycle attempt', async () => {
    let resolveFirst!: () => void;
    let callCount = 0;
    mocks.getDoc.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise((resolve) => {
          resolveFirst = () => resolve(fakeSnapshot({ currentCycleId: 'c1', activeProgramInstanceId: 'p1' }));
        });
      }
      return Promise.resolve(fakeSnapshot({ currentCycleId: 'c1', activeProgramInstanceId: 'p1' }));
    });

    const [a, b] = [loadWorkoutLifecycleDeduped('uid-A'), loadWorkoutLifecycleDeduped('uid-A')];
    resolveFirst();
    await Promise.all([a, b]);
    // 1 lifecycle-doc getDoc + 2 (cycle, instance) getDocs for the single shared attempt = 3 total, not 6.
    expect(callCount).toBe(3);
  });

  it('never shares the in-flight promise across different uids', async () => {
    await Promise.all([
      loadWorkoutLifecycleDeduped('uid-A'),
      loadWorkoutLifecycleDeduped('uid-B'),
    ]);
    // 3 getDoc calls per uid (lifecycle + cycle + instance) x 2 uids = 6.
    expect(mocks.getDoc).toHaveBeenCalledTimes(6);
  });

  it('is a thin wrapper — a plain loadWorkoutLifecycle call still works unchanged', async () => {
    const result = await loadWorkoutLifecycle('uid-A');
    expect(result).not.toBeNull();
  });
});
