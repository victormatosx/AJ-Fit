import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fase 2.2 — `reconcileWorkoutLifecycle` reuses the `ProgressionDecision` it
 * already computed while deciding whether to prepare an evolution, so
 * `useWorkoutEvolution.load()` doesn't call `evaluateProgressionV2ForUser`
 * (~1.4-2.1s: lifecycle bundle + 6 more Firestore reads, then the pure V2
 * resolver) a second time for the exact same uid/instant.
 *
 * This is safe ONLY when the outcome was `NO_ACTION` (nothing written) —
 * these tests exercise `reconcileWorkoutLifecycle` directly (mocked
 * Firestore + collaborator modules, no emulator) to prove:
 *   1. Both call sites that CAN produce a safe `NO_ACTION` populate
 *      `progressionDecision` with the exact decision object/value used.
 *   2. Every other branch — pending already exists, already-activated
 *      cleanup, and prepareEvolutionAttempt itself returning something other
 *      than NO_ACTION (ALREADY_PENDING) — leaves `progressionDecision`
 *      completely absent from the result, and does not call
 *      `evaluateProgressionV2ForUser` more than necessary.
 */

const mocks = vi.hoisted(() => ({
  runTransaction: vi.fn(),
  recoverWorkoutLifecyclePartialState: vi.fn(),
  loadWorkoutLifecycle: vi.fn(),
  loadPendingEvolution: vi.fn(),
  listWorkoutLifecycleEventsForProgramInstance: vi.fn(),
  listTrainingCycles: vi.fn(),
  evaluateProgressionV2ForUser: vi.fn(),
  evaluateProgressionV2ForUserFull: vi.fn(),
  authorizeWorkoutLifecycleMutation: vi.fn(),
  requireWorkoutLifecycleCanonical: vi.fn(),
  logWorkoutLifecycleEvent: vi.fn(),
  isAutoActivationDue: vi.fn(),
  toDeferralView: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...segments: string[]) => ({ path: segments.join('/') })),
  runTransaction: mocks.runTransaction,
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  Timestamp: {
    fromMillis: vi.fn((ms: number) => ({ toMillis: () => ms })),
    fromDate: vi.fn((d: Date) => ({ toMillis: () => d.getTime() })),
  },
}));
vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../lib/logger', () => ({ logWarn: vi.fn() }));
vi.mock('../../workoutLifecycle/domain', () => ({
  evolutionIdempotencyKey: vi.fn(() => 'idem-key'),
  lifecycleEventId: vi.fn((type: string, key: string) => `${type}:${key}`),
  pendingEvolutionIdForOperation: vi.fn(() => 'pending-id'),
  programInstanceIdForOperation: vi.fn(() => 'wpi-target'),
}));
vi.mock('../../workoutLifecycle/deferral', () => ({
  applyDefer: vi.fn(),
  canDefer: vi.fn(),
  isAutoActivationDue: mocks.isAutoActivationDue,
  resolveDeferralConfig: vi.fn(() => ({})),
  toDeferralView: mocks.toDeferralView,
}));
vi.mock('../../workoutLifecycle/qaPolicy', () => ({
  resolveWorkoutLifecycleProgressionPolicy: vi.fn(),
}));
vi.mock('../prescriptionEvolution', () => ({ evolvePrescription: vi.fn() }));
vi.mock('../prescriptionInputs', () => ({ loadAuthoritativePrescriptionInputs: vi.fn() }));
vi.mock('../workoutProgressionV2', () => ({
  evaluateProgressionV2ForUser: mocks.evaluateProgressionV2ForUser,
  evaluateProgressionV2ForUserFull: mocks.evaluateProgressionV2ForUserFull,
}));
vi.mock('../workoutLifecycle', () => ({
  lifecycleRef: vi.fn(() => ({ path: 'lifecycleRef' })),
  loadPendingEvolution: mocks.loadPendingEvolution,
  loadWorkoutLifecycle: mocks.loadWorkoutLifecycle,
  listTrainingCycles: mocks.listTrainingCycles,
  listWorkoutLifecycleEventsForProgramInstance: mocks.listWorkoutLifecycleEventsForProgramInstance,
  pendingEvolutionRef: vi.fn(() => ({ path: 'pendingEvolutionRef' })),
  recoverWorkoutLifecyclePartialState: mocks.recoverWorkoutLifecyclePartialState,
}));
vi.mock('../../progressionEngineV2/earnedCycles', () => ({ countEarnedIntermediateCycles: vi.fn(() => 0) }));
vi.mock('../workoutPrograms', () => ({
  contentIdentityFor: vi.fn(() => 'content-identity'),
  loadActiveWorkoutProgram: vi.fn(),
  loadExerciseCatalogForLimitations: vi.fn(),
  loadWorkoutTemplate: vi.fn(),
  prepareWorkoutProgram: vi.fn(),
  saveAndActivateWorkoutProgram: vi.fn(),
  withoutUndefined: vi.fn((value: unknown) => value),
}));
vi.mock('../../workoutPrescription/templateDocument', () => ({ fromWorkoutTemplateDocument: vi.fn() }));
vi.mock('../../workoutLifecycle/telemetry', () => ({
  logWorkoutLifecycleEvent: mocks.logWorkoutLifecycleEvent,
  workoutLifecycleErrorCategory: vi.fn(() => 'UNKNOWN'),
}));
vi.mock('../../workoutLifecycle/authorityProvider', () => ({
  authorizeWorkoutLifecycleMutation: mocks.authorizeWorkoutLifecycleMutation,
  requireWorkoutLifecycleCanonical: mocks.requireWorkoutLifecycleCanonical,
  WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID: 'grant',
}));

import { reconcileWorkoutLifecycle } from '../workoutLifecycleApplication';

const LIFECYCLE_BUNDLE = {
  lifecycle: {
    activeProgramInstanceId: 'wpi-1',
    currentTrainingLevel: 'BEGINNER',
    currentCycleNumber: 1,
    activeContentIdentity: 'content-1',
    initializationOrigin: 'V2_NATIVE',
    currentCycleId: 'cyc-1',
  },
  cycle: {
    cycleId: 'cyc-1',
    level: 'BEGINNER',
    cycleNumber: 1,
  },
  programInstance: {
    programInstanceId: 'wpi-1',
    prescriptionInputSnapshot: undefined,
    previousProgramInstanceId: null,
  },
};

function fakeTransactionSnapshot(exists: boolean, data?: Record<string, unknown>) {
  return { exists: () => exists, data: () => data };
}

describe('reconcileWorkoutLifecycle — progressionDecision propagation (Fase 2.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recoverWorkoutLifecyclePartialState.mockResolvedValue({
      classification: 'COMPLETE',
      recovered: false,
      lifecycle: LIFECYCLE_BUNDLE,
    });
    mocks.listWorkoutLifecycleEventsForProgramInstance.mockResolvedValue([]);
    mocks.runTransaction.mockImplementation(async (_db: unknown, cb: (tx: unknown) => unknown) => cb({
      get: vi.fn(async () => fakeTransactionSnapshot(false)),
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }));
  });

  it('call site 1 (no pending at all): NO_ACTION decision is threaded through as progressionDecision, and evaluateProgressionV2ForUser is called exactly once', async () => {
    const decision = { type: 'NO_ACTION', reason: 'IN_PROGRESS_EXECUTION' } as const;
    mocks.loadPendingEvolution.mockResolvedValue(null);
    mocks.evaluateProgressionV2ForUser.mockResolvedValue(decision);

    const result = await reconcileWorkoutLifecycle({ uid: 'uid-1', trigger: 'COLD_START' });

    expect(result.prepared).toBe(false);
    expect(result.progressionDecision).toBe(decision);
    expect(mocks.evaluateProgressionV2ForUser).toHaveBeenCalledTimes(1);
  });

  it('call site 1: PROGRESS_CONTINUES also counts as a safe NO_ACTION outcome and is threaded through', async () => {
    const decision = {
      type: 'PROGRESS_CONTINUES',
      reason: 'MINIMUM_ACTIVE_TIME_NOT_REACHED',
      activeDays: 2,
      adherence: { ratio: 0.5, quality: 'BELOW_TARGET' },
      validSessionCount: 1,
    } as const;
    mocks.loadPendingEvolution.mockResolvedValue(null);
    mocks.evaluateProgressionV2ForUser.mockResolvedValue(decision);

    const result = await reconcileWorkoutLifecycle({ uid: 'uid-1', trigger: 'COLD_START' });

    expect(result.progressionDecision).toBe(decision);
  });

  it('call site 1: a concurrent prepare that lands ALREADY_PENDING never carries a progressionDecision, and never even reaches evaluateProgressionV2ForUser', async () => {
    // Reconcile's own pending check sees nothing (why we entered this branch),
    // but prepareEvolutionAttempt's OWN re-check a moment later observes a
    // pending another caller just installed — a benign race, not the common
    // case, but it must never fabricate a decision for it.
    const racedPending = { pendingEvolutionId: 'pe-1', idempotencyKey: 'idem-key' };
    mocks.loadPendingEvolution
      .mockResolvedValueOnce(null) // reconcile's own `pending` check
      .mockResolvedValueOnce(racedPending); // prepareEvolutionAttempt's existingPending check

    const result = await reconcileWorkoutLifecycle({ uid: 'uid-1', trigger: 'COLD_START' });

    expect(result.prepared).toBe(false);
    expect(result).not.toHaveProperty('progressionDecision');
    expect(mocks.evaluateProgressionV2ForUser).not.toHaveBeenCalled();
  });

  it('pending already exists and is neither stale nor due: no decision is ever computed or propagated', async () => {
    const pending = {
      pendingEvolutionId: 'pe-1',
      idempotencyKey: 'idem-key',
      sourceProgramInstanceId: 'wpi-1',
      sourceCycleId: 'cyc-1',
      sourcePrescriptionInputSnapshotId: undefined,
      targetProgramInstanceId: 'wpi-target-not-active',
      status: 'READY',
      deferralCount: 0,
      nextPromptAt: null,
      autoActivateAt: null,
    };
    mocks.loadPendingEvolution.mockResolvedValue(pending);
    mocks.toDeferralView.mockReturnValue({});
    mocks.isAutoActivationDue.mockReturnValue(false);

    const result = await reconcileWorkoutLifecycle({ uid: 'uid-1', trigger: 'COLD_START' });

    expect(result.prepared).toBe(false);
    expect(result.autoActivated).toBe(false);
    expect(result).not.toHaveProperty('progressionDecision');
    expect(mocks.evaluateProgressionV2ForUser).not.toHaveBeenCalled();
  });

  it('already-activated cleanup branch: no decision is ever computed or propagated', async () => {
    const pending = {
      pendingEvolutionId: 'pe-1',
      idempotencyKey: 'idem-key',
      sourceProgramInstanceId: 'wpi-1',
      sourceCycleId: 'cyc-1',
      // Matches lifecycle.lifecycle.activeProgramInstanceId — activation already succeeded.
      targetProgramInstanceId: 'wpi-1',
    };
    mocks.loadPendingEvolution.mockResolvedValue(pending);

    const result = await reconcileWorkoutLifecycle({ uid: 'uid-1', trigger: 'COLD_START' });

    expect(result.staleClearedPendingEvolution).toBe(true);
    expect(result).not.toHaveProperty('progressionDecision');
    expect(mocks.evaluateProgressionV2ForUser).not.toHaveBeenCalled();
  });

  it('call site 2 (pendingIsStale, re-prepared): a fresh post-clear NO_ACTION decision is threaded through', async () => {
    const stalePending = {
      pendingEvolutionId: 'pe-1',
      idempotencyKey: 'idem-key',
      // Different from lifecycle.programInstance.programInstanceId ('wpi-1') -> stale.
      sourceProgramInstanceId: 'wpi-old',
      sourceCycleId: 'cyc-old',
      targetProgramInstanceId: 'wpi-target-not-active',
    };
    const decision = { type: 'NO_ACTION', reason: 'IN_PROGRESS_EXECUTION' } as const;
    mocks.loadPendingEvolution
      .mockResolvedValueOnce(stalePending) // reconcile's own `pending` check
      .mockResolvedValueOnce(null); // prepareEvolutionAttempt's existingPending check, after the clear
    mocks.evaluateProgressionV2ForUser.mockResolvedValue(decision);

    const result = await reconcileWorkoutLifecycle({ uid: 'uid-1', trigger: 'COLD_START' });

    expect(result.staleClearedPendingEvolution).toBe(true);
    expect(result.progressionDecision).toBe(decision);
    expect(mocks.evaluateProgressionV2ForUser).toHaveBeenCalledTimes(1);
  });

  it('call site 2: a re-prepare that lands ALREADY_PENDING never carries a progressionDecision', async () => {
    const stalePending = {
      pendingEvolutionId: 'pe-1',
      idempotencyKey: 'idem-key',
      sourceProgramInstanceId: 'wpi-old',
      sourceCycleId: 'cyc-old',
      targetProgramInstanceId: 'wpi-target-not-active',
    };
    const racedPending = { pendingEvolutionId: 'pe-2', idempotencyKey: 'idem-key-2' };
    mocks.loadPendingEvolution
      .mockResolvedValueOnce(stalePending) // reconcile's own `pending` check
      .mockResolvedValueOnce(racedPending); // prepareEvolutionAttempt's existingPending check, post-clear

    const result = await reconcileWorkoutLifecycle({ uid: 'uid-1', trigger: 'COLD_START' });

    expect(result.staleClearedPendingEvolution).toBe(true);
    expect(result).not.toHaveProperty('progressionDecision');
    expect(mocks.evaluateProgressionV2ForUser).not.toHaveBeenCalled();
  });
});
