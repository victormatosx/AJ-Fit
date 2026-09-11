/**
 * OPT-IN integration proof against the REAL Firestore Emulator — same
 * pattern as `authorizeMutation.integration.test.ts` and
 * `accountDeletion/__tests__/accountDeletionReconciliation.integration.test.ts`:
 * a separate named Admin app auto-connects via `FIRESTORE_EMULATOR_HOST`,
 * exercising the actual, unmodified `completeWorkoutCardioHandler` — never
 * a reimplementation of it.
 *
 * Cardio Finisher Completion Recovery hardening, Architecture B (2026-09
 * security audit). Skipped by default — only runs when
 * `COMPLETE_WORKOUT_CARDIO_INTEGRATION=1` is set.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import {
  completeWorkoutCardioHandler,
  MAX_CARDIO_ACTUAL_DURATION_SECONDS,
} from '../completeWorkoutCardio';

const enabled = process.env.COMPLETE_WORKOUT_CARDIO_INTEGRATION === '1';
const UID = 'cardio-alice';
const OTHER_UID = 'cardio-mallory';
const PROGRAM_ID = 'wpg_cardio_test';
const EXECUTION_ID = 'exec_cardio_test_0_2026-08-25';

function oneSet() {
  return [{ setIndex: 0, status: 'PENDING', actualReps: null, weightKg: null, actualDurationSeconds: null }];
}

function executionDoc(overrides: Record<string, unknown> = {}) {
  return {
    programId: PROGRAM_ID,
    templateId: 'T003',
    sessionIndex: 0,
    sessionName: 'A',
    scheduledLocalDate: '2026-08-25',
    status: 'IN_PROGRESS',
    startedAt: Timestamp.now(),
    finishedAt: null,
    cardio: null,
    exercises: [{
      exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12',
      prescribedDuration: null, prescribedCycles: null, sets: oneSet(),
    }],
    executionSchemaVersion: 1,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

function programDoc(overrides: Record<string, unknown> = {}) {
  return {
    programId: PROGRAM_ID,
    status: 'active',
    sessions: [
      {
        name: 'A',
        type: 'strength',
        exercises: [{ exerciseId: 'bench_press', sourceExerciseId: 'bench_press', sets: 3, reps: '8-12' }],
        cardioFinisher: {
          mode: 'steady_state', exerciseOptions: ['treadmill'], duration: '10-20 min',
          intensity: 'moderate', required: false,
        },
      },
      { name: 'B', type: 'strength', exercises: [{ exerciseId: 'squat', sourceExerciseId: 'squat', sets: 3, reps: '8-12' }] },
    ],
    ...overrides,
  };
}

function programDocNoCardio() {
  return programDoc({
    sessions: [
      { name: 'A', type: 'strength', exercises: [{ exerciseId: 'bench_press', sourceExerciseId: 'bench_press', sets: 3, reps: '8-12' }] },
    ],
  });
}

function callableRequest(uid: string | null, data: unknown): CallableRequest {
  return (uid ? { auth: { uid }, data } : { data }) as never;
}

describe.skipIf(!enabled)('completeWorkoutCardio — real Firestore Emulator integration', () => {
  let app: App;
  let db: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'complete-workout-cardio-integration');
    db = getFirestore(app);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  beforeEach(async () => {
    await db.recursiveDelete(db.collection('users').doc(UID)).catch(() => {});
    await db.recursiveDelete(db.collection('users').doc(OTHER_UID)).catch(() => {});
    await db.collection('users').doc(UID).collection('workoutPrograms').doc(PROGRAM_ID).set(programDoc());
    await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID).set(executionDoc());
  });

  it('1) valid callable request: SUCCESS, persists a COMPLETED cardio record with a real server timestamp', async () => {
    const result = await completeWorkoutCardioHandler(callableRequest(UID, { executionId: EXECUTION_ID, actualDurationSeconds: 900 }), db);
    expect(result).toEqual({ status: 'COMPLETED', actualDurationSeconds: 900 });

    const snapshot = await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID).get();
    const cardio = snapshot.data()?.cardio;
    expect(cardio.status).toBe('COMPLETED');
    expect(cardio.actualDurationSeconds).toBe(900);
    expect(cardio.completedAt).toBeInstanceOf(Timestamp);
    // Never fabricated by the client — bounded to "recently", proving it's
    // a genuine serverTimestamp() and not whatever the caller might send.
    expect(Math.abs(cardio.completedAt.toMillis() - Date.now())).toBeLessThan(10_000);
  });

  it('2) unauthenticated request: DENIED (unauthenticated)', async () => {
    await expect(completeWorkoutCardioHandler(callableRequest(null, { executionId: EXECUTION_ID, actualDurationSeconds: 900 }), db))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('3) execution belongs to a DIFFERENT uid: DENIED as not-found — never discloses that it exists for someone else', async () => {
    await expect(completeWorkoutCardioHandler(callableRequest(OTHER_UID, { executionId: EXECUTION_ID, actualDurationSeconds: 900 }), db))
      .rejects.toMatchObject({ code: 'not-found' });
  });

  it('4) execution does not exist: DENIED as not-found', async () => {
    await expect(completeWorkoutCardioHandler(callableRequest(UID, { executionId: 'exec_does_not_exist', actualDurationSeconds: 900 }), db))
      .rejects.toMatchObject({ code: 'not-found' });
  });

  it('5) the session this execution runs does NOT have a cardio finisher: DENIED — a client cannot pick an arbitrary IN_PROGRESS execution and fabricate a cardio completion for it', async () => {
    await db.collection('users').doc(UID).collection('workoutPrograms').doc(PROGRAM_ID).set(programDocNoCardio());
    await expect(completeWorkoutCardioHandler(callableRequest(UID, { executionId: EXECUTION_ID, actualDurationSeconds: 900 }), db))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'session_has_no_cardio_finisher' });
  });

  it('6) execution is terminal (ABANDONED) and cardio was never completed: DENIED', async () => {
    await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID).update({
      status: 'ABANDONED', finishedAt: Timestamp.now(),
    });
    await expect(completeWorkoutCardioHandler(callableRequest(UID, { executionId: EXECUTION_ID, actualDurationSeconds: 900 }), db))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'execution_not_in_progress' });
  });

  it('6b) execution is terminal (COMPLETED) but cardio WAS already completed before finishing: idempotent SUCCESS, returns the original record — semantically correct, not a hard failure', async () => {
    await completeWorkoutCardioHandler(callableRequest(UID, { executionId: EXECUTION_ID, actualDurationSeconds: 900 }), db);
    await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID).update({
      status: 'COMPLETED', finishedAt: Timestamp.now(),
    });
    const retry = await completeWorkoutCardioHandler(callableRequest(UID, { executionId: EXECUTION_ID, actualDurationSeconds: 1 }), db);
    expect(retry).toEqual({ status: 'COMPLETED', actualDurationSeconds: 900 });
  });

  it('7) invalid durations are all rejected: NaN, Infinity, negative, non-integer, wrong type, and past the app ceiling', async () => {
    const invalid = [
      Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 900.5,
      '900', null, undefined, MAX_CARDIO_ACTUAL_DURATION_SECONDS + 1,
    ];
    for (const actualDurationSeconds of invalid) {
      await expect(completeWorkoutCardioHandler(callableRequest(UID, { executionId: EXECUTION_ID, actualDurationSeconds }), db))
        .rejects.toMatchObject({ code: 'invalid-argument' });
    }
  });

  it('7b) the boundary values are accepted: 0 (skip-before-start) and the exact ceiling', async () => {
    const zero = await completeWorkoutCardioHandler(callableRequest(UID, { executionId: EXECUTION_ID, actualDurationSeconds: 0 }), db);
    expect(zero).toEqual({ status: 'COMPLETED', actualDurationSeconds: 0 });

    await db.collection('users').doc(UID).collection('workoutExecutions').doc('exec_ceiling').set(executionDoc());
    const ceiling = await completeWorkoutCardioHandler(
      callableRequest(UID, { executionId: 'exec_ceiling', actualDurationSeconds: MAX_CARDIO_ACTUAL_DURATION_SECONDS }), db,
    );
    expect(ceiling).toEqual({ status: 'COMPLETED', actualDurationSeconds: MAX_CARDIO_ACTUAL_DURATION_SECONDS });
  });

  it('8) retry after COMPLETED is idempotent SUCCESS — never overwrites the first confirmed duration/timestamp (never turns 1200s into 5000s)', async () => {
    const first = await completeWorkoutCardioHandler(callableRequest(UID, { executionId: EXECUTION_ID, actualDurationSeconds: 1200 }), db);
    expect(first).toEqual({ status: 'COMPLETED', actualDurationSeconds: 1200 });
    const firstSnapshot = await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID).get();
    const firstCompletedAtMs = (firstSnapshot.data()!.cardio.completedAt as Timestamp).toMillis();

    const retry = await completeWorkoutCardioHandler(callableRequest(UID, { executionId: EXECUTION_ID, actualDurationSeconds: 5000 }), db);
    expect(retry).toEqual({ status: 'COMPLETED', actualDurationSeconds: 1200 });
    const retrySnapshot = await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID).get();
    expect(retrySnapshot.data()!.cardio.actualDurationSeconds).toBe(1200);
    expect((retrySnapshot.data()!.cardio.completedAt as Timestamp).toMillis()).toBe(firstCompletedAtMs);
  });

  it('9) a V2 execution (programInstanceId present) resolves cardio authority the same way via programId — no V1/V2 branch needed', async () => {
    const executionId = 'exec_v2_cardio_test';
    await db.collection('users').doc(UID).collection('workoutExecutions').doc(executionId).set(executionDoc({
      programInstanceId: 'wpi_cardio_test', executionSchemaVersion: 2,
    }));
    const result = await completeWorkoutCardioHandler(callableRequest(UID, { executionId, actualDurationSeconds: 600 }), db);
    expect(result).toEqual({ status: 'COMPLETED', actualDurationSeconds: 600 });
  });

  it('10) an execution referencing a program that no longer exists: DENIED (program_context_missing)', async () => {
    const executionId = 'exec_orphan_program';
    await db.collection('users').doc(UID).collection('workoutExecutions').doc(executionId).set(executionDoc({
      programId: 'wpg_does_not_exist',
    }));
    await expect(completeWorkoutCardioHandler(callableRequest(UID, { executionId, actualDurationSeconds: 900 }), db))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'program_context_missing' });
  });

  it('11) malformed executionId is rejected before any Firestore read (invalid-argument)', async () => {
    await expect(completeWorkoutCardioHandler(callableRequest(UID, { executionId: 'not a valid id !!', actualDurationSeconds: 900 }), db))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(completeWorkoutCardioHandler(callableRequest(UID, { actualDurationSeconds: 900 }), db))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('errors are real HttpsError instances (so the client SDK surfaces the correct .code)', async () => {
    try {
      await completeWorkoutCardioHandler(callableRequest(UID, { executionId: 'exec_does_not_exist', actualDurationSeconds: 1 }), db);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HttpsError);
    }
  });
});
