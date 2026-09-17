import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { finalizeWorkoutSessionHandler } from '../finalizeWorkoutSession';
import { seedRealPrescriptionCatalog } from './realCatalogFixture';

const enabled = process.env.FINALIZE_WORKOUT_SESSION_INTEGRATION === '1';
const UID = 'finalize-alice';
const OTHER_UID = 'finalize-mallory';
const PROGRAM_ID = 'wpg_finalize';
const INSTANCE_ID = 'wpi_finalize';
const EXECUTION_ID = 'exec_finalize_0';
const today = new Date().toISOString().slice(0, 10);
const weekday = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(`${today}T12:00:00Z`).getUTCDay()];

function sets(status: 'PENDING' | 'COMPLETED' = 'COMPLETED') {
  return [0, 1, 2].map((setIndex) => ({ setIndex, status, actualReps: 10, weightKg: 20 }));
}

function execution(overrides: Record<string, unknown> = {}) {
  return {
    programId: PROGRAM_ID,
    programInstanceId: INSTANCE_ID,
    sessionIndex: 0,
    scheduledLocalDate: today,
    status: 'IN_PROGRESS',
    exercises: [{ exerciseIndex: 0, prescribedExerciseId: 'squat', exerciseId: 'squat', sets: sets() }],
    cardio: null,
    startedAt: Timestamp.now(),
    ...overrides,
  };
}

function program(cardio = false) {
  return {
    programId: PROGRAM_ID,
    prescribedTrainingFrequency: 1,
    weeklySchedule: [{ weekday, state: 'TRAINING', sessionIndex: 0 }],
    sessions: [{
      name: 'A',
      exercises: [{ exerciseId: 'squat', sets: 3 }],
      ...(cardio ? { cardioFinisher: { duration: '10 min', mode: 'steady_state' } } : {}),
    }],
  };
}

function request(uid: string | null, data: unknown): CallableRequest {
  return (uid ? { auth: { uid }, data } : { data }) as never;
}

describe.skipIf(!enabled)('finalizeWorkoutSession — real Firestore Emulator integration', () => {
  let app: App;
  let db: Firestore;
  let root: FirebaseFirestore.DocumentReference;

  beforeAll(async () => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'finalize-workout-session-integration');
    db = getFirestore(app);
    root = db.collection('users').doc(UID);
    await seedRealPrescriptionCatalog(db);
  });

  afterAll(async () => { await deleteApp(app); });

  beforeEach(async () => {
    await db.recursiveDelete(root).catch(() => {});
    await db.recursiveDelete(db.collection('users').doc(OTHER_UID)).catch(() => {});
    await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).set(program()),
      root.collection('programInstances').doc(INSTANCE_ID).set({
        programInstanceId: INSTANCE_ID,
        contentIdentity: PROGRAM_ID,
        activatedAt: Timestamp.fromDate(new Date(`${today}T00:00:00Z`)),
        prescriptionInputSnapshot: { inputs: { trainingDays: [weekday] } },
      }),
      root.collection('workoutProgramState').doc('scheduleConfig').set({ trainingDays: [weekday], timezone: 'UTC' }),
      root.collection('workoutExecutions').doc(EXECUTION_ID).set(execution()),
      root.collection('workoutExecutionState').doc('current').set({ executionId: EXECUTION_ID }),
    ]);
  });

  async function finalize(data: Record<string, unknown> = {}) {
    return finalizeWorkoutSessionHandler(request(UID, { executionId: EXECUTION_ID, ...data }), db);
  }

  it('atomically terminalizes strength Execution, clears mutex and completes Schedule', async () => {
    await expect(finalize()).resolves.toEqual({
      status: 'COMPLETED', executionStatus: 'COMPLETED', cardioStatus: 'NOT_APPLICABLE', scheduleStatus: 'COMPLETED',
    });
    const [executionDoc, pointer, event, state] = await Promise.all([
      root.collection('workoutExecutions').doc(EXECUTION_ID).get(),
      root.collection('workoutExecutionState').doc('current').get(),
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleEvents')
        .doc(`${INSTANCE_ID}_completed_0_${today}`).get(),
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleState').doc(INSTANCE_ID).get(),
    ]);
    expect(executionDoc.data()?.status).toBe('COMPLETED');
    expect(pointer.exists).toBe(false);
    expect(event.data()).toMatchObject({ type: 'COMPLETED', sessionIndex: 0, scheduledDate: today });
    expect(state.data()).toMatchObject({ nextSessionIndex: 0, lastCompletedAt: today });
  });

  it('persists prescribed cardio in the same durable transition', async () => {
    await root.collection('workoutPrograms').doc(PROGRAM_ID).set(program(true));
    await expect(finalize({ cardio: { actualDurationSeconds: 600 } })).resolves.toMatchObject({ cardioStatus: 'COMPLETED' });
    expect((await root.collection('workoutExecutions').doc(EXECUTION_ID).get()).data()?.cardio)
      .toMatchObject({ status: 'COMPLETED', actualDurationSeconds: 600 });
  });

  it('rejects missing/invalid/unprescribed cardio', async () => {
    await expect(finalize({ cardio: { actualDurationSeconds: 1 } })).rejects.toMatchObject({ message: 'session_has_no_cardio_finisher' });
    await expect(finalize({ cardio: { actualDurationSeconds: -1 } })).rejects.toMatchObject({ code: 'invalid-argument' });
    await root.collection('workoutPrograms').doc(PROGRAM_ID).set(program(true));
    await expect(finalize()).rejects.toMatchObject({ message: 'cardio_completion_required' });
  });

  it('converges from cardio completed + Execution pending and preserves the original duration', async () => {
    await root.collection('workoutPrograms').doc(PROGRAM_ID).set(program(true));
    await root.collection('workoutExecutions').doc(EXECUTION_ID).update({
      cardio: { status: 'COMPLETED', actualDurationSeconds: 700, completedAt: Timestamp.now() },
    });
    await expect(finalize({ cardio: { actualDurationSeconds: 999 } })).resolves.toMatchObject({ status: 'COMPLETED' });
    expect((await root.collection('workoutExecutions').doc(EXECUTION_ID).get()).data()?.cardio.actualDurationSeconds).toBe(700);
  });

  it('lost response retry and two concurrent requests produce one immutable event/advance', async () => {
    const [first, second] = await Promise.all([finalize(), finalize()]);
    expect(first.status).toBe('COMPLETED');
    expect(second.status).toBe('COMPLETED');
    await expect(finalize()).resolves.toMatchObject({ status: 'COMPLETED' });
    const events = await root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleEvents').get();
    expect(events.docs.filter((doc) => doc.data().type === 'COMPLETED')).toHaveLength(1);
  });

  it('converges from a terminal Execution with Schedule pending', async () => {
    await root.collection('workoutExecutions').doc(EXECUTION_ID).update({ status: 'PARTIALLY_COMPLETED' });
    await expect(finalize()).resolves.toMatchObject({ executionStatus: 'PARTIALLY_COMPLETED' });
  });

  it('fails closed for another uid, content identity mismatch and malformed substitution', async () => {
    await expect(finalizeWorkoutSessionHandler(request(OTHER_UID, { executionId: EXECUTION_ID }), db))
      .rejects.toMatchObject({ code: 'not-found' });
    await root.collection('programInstances').doc(INSTANCE_ID).update({ contentIdentity: 'wpg_other' });
    await expect(finalize()).rejects.toMatchObject({ message: 'execution_prescription_referent_missing' });
    await root.collection('programInstances').doc(INSTANCE_ID).update({ contentIdentity: PROGRAM_ID });
    await root.collection('workoutExecutions').doc(EXECUTION_ID).update({
      exercises: [{ exerciseIndex: 0, prescribedExerciseId: 'squat', exerciseId: 'squat', substitution: { scope: 'SESSION' }, sets: sets() }],
    });
    await expect(finalize()).rejects.toMatchObject({ message: 'execution_substitution_not_authoritative' });
  });

  it.each(['SESSION', 'PERMANENT'] as const)('accepts an authoritative %s substitution while validating structure by prescribed identity', async (scope) => {
    await Promise.all([
      root.collection('programInstances').doc(INSTANCE_ID).update({
        prescriptionInputSnapshot: { inputs: {
          sex: 'm', goal: 'gain_muscle', level: 'beginner', days: 1, duration: '60',
          place: 'home', trainingDays: [weekday], equipment: [], style: [], limits: [], muscleFocus: [],
          specialConditions: ['none'], pregnancyScreening: null, postpartumScreening: null,
          functionalScreening: null, lipedemaScreening: null, dizzinessScreening: null,
          postSurgicalScreening: null, medicalRestrictionScreening: null,
        } },
      }),
      root.collection('workoutPrograms').doc(PROGRAM_ID).set({
        ...program(), environment: 'home',
        sessions: [{ name: 'A', exercises: [{ exerciseId: 'barbell-back-squat', sets: 3 }] }],
      }),
      root.collection('workoutExecutions').doc(EXECUTION_ID).update({
        exercises: [{
          exerciseIndex: 0,
          prescribedExerciseId: 'barbell-back-squat',
          exerciseId: 'bodyweight-squat',
          substitution: { scope, appliedAt: Timestamp.now() },
          sets: sets(),
        }],
      }),
    ]);
    await expect(finalize()).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('does not commit any critical write when Schedule validation rejects', async () => {
    await root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleState').doc(INSTANCE_ID).set({
      programId: PROGRAM_ID, programInstanceId: INSTANCE_ID, nextSessionIndex: 1,
      cursorDate: today, lastCompletedAt: null, pendingMissDecision: null,
    });
    await expect(finalize()).rejects.toMatchObject({ message: 'schedule_completion_session_not_expected' });
    expect((await root.collection('workoutExecutions').doc(EXECUTION_ID).get()).data()?.status).toBe('IN_PROGRESS');
    expect((await root.collection('workoutExecutionState').doc('current').get()).exists).toBe(true);
  });

  // Regression (2026-09-16 production incident): once a missed-session gap
  // has already been decided (a `MISS_RESOLVED` ledger event), completing
  // the pending session it left behind must succeed — not be permanently
  // rejected as an unexpected schedule gap on every retry.
  it('completes the pending session left behind by an already-resolved missed-session gap', async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const missedDate = new Date(new Date(`${today}T12:00:00Z`).getTime() - 7 * dayMs).toISOString().slice(0, 10);
    const cursorDate = new Date(new Date(`${today}T12:00:00Z`).getTime() - 14 * dayMs).toISOString().slice(0, 10);
    await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleState').doc(INSTANCE_ID).set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID, nextSessionIndex: 0,
        cursorDate, lastCompletedAt: null, pendingMissDecision: null,
      }),
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleEvents')
        .doc(`${INSTANCE_ID}_miss_resolved_0_${missedDate}`).set({
          type: 'MISS_RESOLVED', programInstanceId: INSTANCE_ID, sessionIndex: 0,
          scheduledDate: missedDate, decision: 'CONTINUE_SEQUENCE',
        }),
    ]);
    await expect(finalize()).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  // Security regression: `firestore.rules` gates what CONTENT a MISS_RESOLVED
  // event may hold (must match a real grant) but never binds the document id
  // itself to that content — an owner can legally write grant-matched
  // content under an id of their own choosing. A document that merely
  // EXISTS at the expected deterministic id, with content for a different
  // gap, must never be trusted as resolving THIS gap.
  it('ignores a MISS_RESOLVED document at the expected id whose content does not match this gap', async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const missedDate = new Date(new Date(`${today}T12:00:00Z`).getTime() - 7 * dayMs).toISOString().slice(0, 10);
    const cursorDate = new Date(new Date(`${today}T12:00:00Z`).getTime() - 14 * dayMs).toISOString().slice(0, 10);
    await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleState').doc(INSTANCE_ID).set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID, nextSessionIndex: 0,
        cursorDate, lastCompletedAt: null, pendingMissDecision: null,
      }),
      // Right id, wrong content: a different sessionIndex/date/instance —
      // simulating a doc planted ahead of time at this id for another gap.
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleEvents')
        .doc(`${INSTANCE_ID}_miss_resolved_0_${missedDate}`).set({
          type: 'MISS_RESOLVED', programInstanceId: INSTANCE_ID, sessionIndex: 3,
          scheduledDate: '2099-01-01', decision: 'CONTINUE_SEQUENCE',
        }),
    ]);
    await expect(finalize()).rejects.toMatchObject({ message: 'schedule_completion_session_not_expected' });
    expect((await root.collection('workoutExecutions').doc(EXECUTION_ID).get()).data()?.status).toBe('IN_PROGRESS');
  });
});
