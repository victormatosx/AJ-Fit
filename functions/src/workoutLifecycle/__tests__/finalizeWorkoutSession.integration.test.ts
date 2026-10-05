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
const otherWeekday = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][
  (new Date(`${today}T12:00:00Z`).getUTCDay() + 1) % 7
];

function sets(status: 'PENDING' | 'COMPLETED' = 'COMPLETED') {
  return [0, 1, 2].map((setIndex) => ({ setIndex, status, actualReps: 10, weightKg: 20 }));
}

function completionSets(completed: number, planned: number) {
  return Array.from({ length: planned }, (_, setIndex) => ({
    setIndex,
    status: setIndex < completed ? 'COMPLETED' : 'PENDING',
    actualReps: setIndex < completed ? 8 + setIndex : null,
    weightKg: setIndex < completed ? 20 + setIndex : null,
  }));
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
    createdAt: Timestamp.fromDate(new Date(`${today}T12:00:00Z`)),
    ...overrides,
  };
}

function program(cardio = false) {
  return {
    programId: PROGRAM_ID,
    status: 'active',
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
        supersededAt: null,
        prescriptionInputSnapshot: { inputs: { trainingDays: [weekday] } },
      }),
      root.collection('workoutProgramState').doc('scheduleConfig').set({ trainingDays: [weekday], timezone: 'UTC' }),
      root.collection('workoutExecutions').doc(EXECUTION_ID).set(execution()),
      root.collection('workoutExecutionState').doc('current').set({ executionId: EXECUTION_ID }),
      root.collection('workoutProgramState').doc('active').set({ programId: PROGRAM_ID }),
      root.collection('workoutLifecycleState').doc('current').set({ activeProgramInstanceId: INSTANCE_ID }),
    ]);
  });

  async function finalize(data: Record<string, unknown> = {}) {
    return finalizeWorkoutSessionHandler(request(UID, { executionId: EXECUTION_ID, ...data }), db);
  }

  it('atomically terminalizes strength Execution, clears mutex and completes Schedule', async () => {
    await expect(finalize()).resolves.toEqual({
      status: 'COMPLETED', executionStatus: 'COMPLETED', cardioStatus: 'NOT_APPLICABLE', scheduleStatus: 'COMPLETED',
      completion: { plannedSets: 3, completedSets: 3, percentageBasisPoints: 10_000 },
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

  it('publishes all real sidecar checkpoints without changing the authoritative result', async () => {
    const attemptId = 'attempt_progress_1';
    await expect(finalize({ attemptId })).resolves.toMatchObject({
      status: 'COMPLETED',
      scheduleStatus: 'COMPLETED',
    });
    const ref = root.collection('workoutFinalizationAttempts').doc(attemptId);
    let data: FirebaseFirestore.DocumentData | undefined;
    for (let index = 0; index < 40; index += 1) {
      data = (await ref.get()).data();
      if (data?.checkpoints?.SERVER_ACCEPTED
        && data.checkpoints.PREFLIGHT_VALIDATED
        && data.checkpoints.COMMITTED) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(data).toMatchObject({
      executionId: EXECUTION_ID,
      attemptId,
      checkpoints: {
        SERVER_ACCEPTED: expect.anything(),
        PREFLIGHT_VALIDATED: expect.anything(),
        COMMITTED: expect.anything(),
      },
    });
    expect(data?.expiresAt).toBeInstanceOf(Timestamp);
  });

  it.each([
    [4, 10, 4000],
    [7, 10, 7000],
    [9, 10, 9000],
    [10, 10, 10000],
  ])('EARLY persists authoritative completion for %i/%i sets', async (completed, planned, basisPoints) => {
    await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).set({
        ...program(),
        sessions: [{ name: 'A', exercises: [{ exerciseId: 'squat', sets: planned }] }],
      }),
      root.collection('workoutExecutions').doc(EXECUTION_ID).update({
        exercises: [{
          exerciseIndex: 0,
          prescribedExerciseId: 'squat',
          exerciseId: 'squat',
          sets: completionSets(completed, planned),
        }],
      }),
    ]);

    const result = await finalize({ mode: 'EARLY' });
    expect(result.completion).toEqual({
      plannedSets: planned,
      completedSets: completed,
      percentageBasisPoints: basisPoints,
    });
    const terminal = (await root.collection('workoutExecutions').doc(EXECUTION_ID).get()).data()!;
    expect(terminal.completion).toEqual(result.completion);
    expect(terminal.exercises[0].sets.filter((set: { status: string }) => set.status === 'PENDING')).toHaveLength(0);
    expect(terminal.exercises[0].sets.slice(0, completed)).toEqual(completionSets(completed, planned).slice(0, completed));
    expect(terminal.exercises[0].sets.slice(completed).every((set: { status: string }) => set.status === 'SKIPPED')).toBe(true);
  });

  it('rejects EARLY with no completed set and leaves execution/schedule untouched', async () => {
    await root.collection('workoutExecutions').doc(EXECUTION_ID).update({
      exercises: [{ exerciseIndex: 0, prescribedExerciseId: 'squat', exerciseId: 'squat', sets: sets('PENDING') }],
    });
    await expect(finalize({ mode: 'EARLY' })).rejects.toMatchObject({
      message: 'early_finish_requires_completed_set',
    });
    expect((await root.collection('workoutExecutions').doc(EXECUTION_ID).get()).data()?.status).toBe('IN_PROGRESS');
    expect((await root.collection('workoutExecutionState').doc('current').get()).exists).toBe(true);
  });

  it('finalizes Friday early on Thursday against the prescribed Friday opportunity', async () => {
    const thursday = '2026-09-17';
    const friday = '2026-09-18';
    const fixedDays = ['MON', 'TUE', 'WED', 'FRI'];
    await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).set({
        ...program(),
        scheduleMode: 'fixed',
        prescribedTrainingFrequency: 4,
        weeklySchedule: fixedDays.map((day, sessionIndex) => ({ weekday: day, state: 'TRAINING', sessionIndex })),
        sessions: [0, 1, 2, 3].map((index) => ({
          name: String.fromCharCode(65 + index), exercises: [{ exerciseId: 'squat', sets: 3 }],
        })),
      }),
      root.collection('programInstances').doc(INSTANCE_ID).update({
        activatedAt: Timestamp.fromDate(new Date('2026-09-14T00:00:00Z')),
        prescriptionInputSnapshot: { inputs: { scheduleMode: 'fixed', trainingDays: fixedDays } },
      }),
      root.collection('workoutProgramState').doc('scheduleConfig').set({ trainingDays: fixedDays, timezone: 'UTC' }),
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleState').doc(INSTANCE_ID).set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID, nextSessionIndex: 3,
        cursorDate: '2026-09-16', lastCompletedAt: '2026-09-16', pendingMissDecision: null,
      }),
      root.collection('workoutExecutions').doc(EXECUTION_ID).set(execution({
        sessionIndex: 3,
        scheduledLocalDate: friday,
        performedLocalDate: thursday,
        createdAt: Timestamp.fromDate(new Date('2026-09-17T12:00:00Z')),
        startedAt: Timestamp.fromDate(new Date('2026-09-17T12:00:00Z')),
      })),
    ]);

    await expect(finalize()).resolves.toMatchObject({ status: 'COMPLETED', scheduleStatus: 'COMPLETED' });
    const [state, event, completed] = await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleState').doc(INSTANCE_ID).get(),
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleEvents')
        .doc(`${INSTANCE_ID}_completed_3_${friday}`).get(),
      root.collection('workoutExecutions').doc(EXECUTION_ID).get(),
    ]);
    expect(state.data()).toMatchObject({ nextSessionIndex: 0, cursorDate: friday, lastCompletedAt: friday });
    expect(event.data()).toMatchObject({
      type: 'COMPLETED', sessionIndex: 3, scheduledDate: friday, performedLocalDate: thursday,
    });
    expect(completed.data()).toMatchObject({ scheduledLocalDate: friday, performedLocalDate: thursday });
  });

  it.each([
    ['wrong session', { sessionIndex: 2 }],
    ['more than one day early', { performedLocalDate: '2026-09-16', createdAt: Timestamp.fromDate(new Date('2026-09-16T12:00:00Z')) }],
    ['performed after scheduled', { performedLocalDate: '2026-09-19', createdAt: Timestamp.fromDate(new Date('2026-09-19T12:00:00Z')) }],
  ])('rejects an invalid advanced execution: %s', async (_label, override) => {
    const fixedDays = ['MON', 'TUE', 'WED', 'FRI'];
    await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).set({
        ...program(), status: 'active', scheduleMode: 'fixed', prescribedTrainingFrequency: 4,
        weeklySchedule: fixedDays.map((day, sessionIndex) => ({ weekday: day, state: 'TRAINING', sessionIndex })),
        sessions: [0, 1, 2, 3].map((index) => ({ name: String(index), exercises: [{ exerciseId: 'squat', sets: 3 }] })),
      }),
      root.collection('programInstances').doc(INSTANCE_ID).update({
        activatedAt: Timestamp.fromDate(new Date('2026-09-14T00:00:00Z')),
        prescriptionInputSnapshot: { inputs: { scheduleMode: 'fixed', trainingDays: fixedDays } },
      }),
      root.collection('workoutProgramState').doc('scheduleConfig').set({ trainingDays: fixedDays, timezone: 'UTC' }),
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleState').doc(INSTANCE_ID).set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID, nextSessionIndex: 3,
        cursorDate: '2026-09-16', lastCompletedAt: '2026-09-16', pendingMissDecision: null,
      }),
      root.collection('workoutExecutions').doc(EXECUTION_ID).set(execution({
        sessionIndex: 3,
        scheduledLocalDate: '2026-09-18',
        performedLocalDate: '2026-09-17',
        createdAt: Timestamp.fromDate(new Date('2026-09-17T12:00:00Z')),
        startedAt: Timestamp.fromDate(new Date('2026-09-17T12:00:00Z')),
        ...override,
      })),
    ]);
    await expect(finalize()).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await root.collection('workoutExecutions').doc(EXECUTION_ID).get()).data()?.status).toBe('IN_PROGRESS');
  });

  it('rejects the advanced path for flexible plans', async () => {
    await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).set({
        ...program(), status: 'active', scheduleMode: 'flexible', prescribedTrainingFrequency: 1, weeklySchedule: [],
      }),
      root.collection('programInstances').doc(INSTANCE_ID).update({
        activatedAt: Timestamp.fromDate(new Date('2026-09-17T00:00:00Z')),
        prescriptionInputSnapshot: { inputs: { scheduleMode: 'flexible', trainingDays: null } },
      }),
      root.collection('workoutProgramState').doc('scheduleConfig').set({ scheduleMode: 'flexible', trainingDays: [], timezone: 'UTC' }),
      root.collection('workoutExecutions').doc(EXECUTION_ID).set(execution({
        scheduledLocalDate: '2026-09-18', performedLocalDate: '2026-09-17',
        createdAt: Timestamp.fromDate(new Date('2026-09-17T12:00:00Z')),
      })),
    ]);
    await expect(finalize()).rejects.toMatchObject({ message: 'advanced_workout_not_next_opportunity' });
  });

  it('authorizes flexible on any weekday, starts at 0, and advances the authoritative cursor', async () => {
    await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).set({
        ...program(),
        scheduleMode: 'flexible',
        prescribedTrainingFrequency: 2,
        weeklySchedule: [],
        sessions: [
          { name: 'A', exercises: [{ exerciseId: 'squat', sets: 3 }] },
          { name: 'B', exercises: [{ exerciseId: 'squat', sets: 3 }] },
        ],
      }),
      root.collection('programInstances').doc(INSTANCE_ID).update({
        prescriptionInputSnapshot: { inputs: { scheduleMode: 'flexible', trainingDays: null } },
      }),
      root.collection('workoutProgramState').doc('scheduleConfig').set({
        scheduleMode: 'flexible', trainingDays: [], timezone: 'UTC',
      }),
    ]);
    await expect(finalize()).resolves.toMatchObject({ status: 'COMPLETED', scheduleStatus: 'COMPLETED' });
    const state = await root.collection('workoutPrograms').doc(PROGRAM_ID)
      .collection('scheduleState').doc(INSTANCE_ID).get();
    expect(state.data()).toMatchObject({ nextSessionIndex: 1, lastCompletedAt: today });
  });

  // 2026-10 fix (agenda livre): `programInstanceId + sessionIndex +
  // scheduledLocalDate` is not a unique schedule-event identity under
  // `flexible` — the SAME sessionIndex can legitimately recur same-day.
  it('flexible same-day repeat of the same sessionIndex: distinct schedule events, each finalize advances the cursor once, retry never double-advances', async () => {
    const EXECUTION_ID_2 = 'exec_finalize_0_o2';
    await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).set({
        ...program(),
        scheduleMode: 'flexible',
        prescribedTrainingFrequency: 1,
        weeklySchedule: [],
        sessions: [{ name: 'A', exercises: [{ exerciseId: 'squat', sets: 3 }] }],
      }),
      root.collection('programInstances').doc(INSTANCE_ID).update({
        prescriptionInputSnapshot: { inputs: { scheduleMode: 'flexible', trainingDays: null } },
      }),
      root.collection('workoutProgramState').doc('scheduleConfig').set({
        scheduleMode: 'flexible', trainingDays: [], timezone: 'UTC',
      }),
      root.collection('workoutExecutions').doc(EXECUTION_ID_2).set(execution({ occurrence: 2 })),
    ]);

    // Occurrence 1 finalizes first — sessionCount is 1, so the cursor wraps
    // right back to 0, exactly the condition that used to collide.
    await expect(finalize()).resolves.toMatchObject({ status: 'COMPLETED' });
    const [occurrence1Event, stateAfterFirst] = await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleEvents')
        .doc(`${INSTANCE_ID}_completed_0_${today}`).get(),
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleState').doc(INSTANCE_ID).get(),
    ]);
    expect(occurrence1Event.exists).toBe(true);
    expect(stateAfterFirst.data()).toMatchObject({ nextSessionIndex: 0, lastCompletedAt: today });

    // Occurrence 2 — same sessionIndex, same scheduledLocalDate, a DIFFERENT
    // execution — finalizes normally (agenda livre), never rejected as
    // "already completed today", and gets its OWN, distinct event.
    await expect(finalizeWorkoutSessionHandler(request(UID, { executionId: EXECUTION_ID_2 }), db))
      .resolves.toMatchObject({ status: 'COMPLETED' });
    const [occurrence2Event, stateAfterSecond] = await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleEvents')
        .doc(`${INSTANCE_ID}_completed_0_${today}_o2`).get(),
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleState').doc(INSTANCE_ID).get(),
    ]);
    expect(occurrence2Event.exists).toBe(true);
    expect(occurrence1Event.id).not.toBe(occurrence2Event.id);
    expect(stateAfterSecond.data()).toMatchObject({ nextSessionIndex: 0, lastCompletedAt: today });

    // Retry of occurrence 2 — idempotent: its event already exists, so no
    // second COMPLETED event is written and the cursor never advances twice.
    await expect(finalizeWorkoutSessionHandler(request(UID, { executionId: EXECUTION_ID_2 }), db))
      .resolves.toMatchObject({ status: 'COMPLETED' });
    const events = await root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleEvents').get();
    expect(events.docs.filter((doc) => doc.data().type === 'COMPLETED')).toHaveLength(2);
  });

  it('rejects a flexible execution whose session differs from nextSessionIndex', async () => {
    await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).set({
        ...program(), scheduleMode: 'flexible', weeklySchedule: [],
      }),
      root.collection('programInstances').doc(INSTANCE_ID).update({
        prescriptionInputSnapshot: { inputs: { scheduleMode: 'flexible', trainingDays: null } },
      }),
      root.collection('workoutProgramState').doc('scheduleConfig').set({
        scheduleMode: 'flexible', trainingDays: [], timezone: 'UTC',
      }),
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleState').doc(INSTANCE_ID).set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID, nextSessionIndex: 1,
        cursorDate: today, lastCompletedAt: null, pendingMissDecision: null,
      }),
    ]);
    await expect(finalize()).rejects.toMatchObject({ message: 'schedule_completion_session_not_expected' });
    expect((await root.collection('workoutExecutions').doc(EXECUTION_ID).get()).data()?.status).toBe('IN_PROGRESS');
  });

  it('keeps explicit fixed calendar authority even when client-writable config claims flexible', async () => {
    await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).set({
        ...program(), scheduleMode: 'fixed',
        weeklySchedule: [{ weekday: otherWeekday, state: 'TRAINING', sessionIndex: 0 }],
      }),
      root.collection('programInstances').doc(INSTANCE_ID).update({
        prescriptionInputSnapshot: { inputs: { scheduleMode: 'flexible', trainingDays: null } },
      }),
      root.collection('workoutProgramState').doc('scheduleConfig').set({
        scheduleMode: 'flexible', trainingDays: [], timezone: 'UTC',
      }),
    ]);
    await expect(finalize()).rejects.toMatchObject({ message: 'schedule_completion_session_not_expected' });
    expect((await root.collection('workoutExecutions').doc(EXECUTION_ID).get()).data()?.status).toBe('IN_PROGRESS');
  });

  it('treats a legacy program/instance without scheduleMode as fixed', async () => {
    await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).set({
        ...program(), weeklySchedule: [{ weekday: otherWeekday, state: 'TRAINING', sessionIndex: 0 }],
      }),
      root.collection('programInstances').doc(INSTANCE_ID).update({
        prescriptionInputSnapshot: { inputs: { trainingDays: [otherWeekday] } },
      }),
      root.collection('workoutProgramState').doc('scheduleConfig').set({
        scheduleMode: 'flexible', trainingDays: [], timezone: 'UTC',
      }),
    ]);
    await expect(finalize()).rejects.toMatchObject({ message: 'schedule_completion_session_not_expected' });
  });

  it('persists prescribed cardio in the same durable transition', async () => {
    await root.collection('workoutPrograms').doc(PROGRAM_ID).set(program(true));
    await expect(finalize({ cardio: { actualDurationSeconds: 600 } })).resolves.toMatchObject({ cardioStatus: 'COMPLETED' });
    expect((await root.collection('workoutExecutions').doc(EXECUTION_ID).get()).data()?.cardio)
      .toMatchObject({ status: 'COMPLETED', actualDurationSeconds: 600 });
  });

  it('EARLY explicitly skips prescribed cardio without fabricating a zero-duration completion', async () => {
    await root.collection('workoutPrograms').doc(PROGRAM_ID).set(program(true));
    await expect(finalize({ mode: 'EARLY' })).resolves.toMatchObject({
      cardioStatus: 'SKIPPED',
      completion: { plannedSets: 3, completedSets: 3, percentageBasisPoints: 10_000 },
    });
    const cardio = (await root.collection('workoutExecutions').doc(EXECUTION_ID).get()).data()?.cardio;
    expect(cardio).toMatchObject({ status: 'SKIPPED', reason: 'EARLY_FINISH' });
    expect(cardio).not.toHaveProperty('actualDurationSeconds');
    expect(cardio).not.toHaveProperty('completedAt');
  });

  // 2026-10 fix: `PARTIALLY_COMPLETED` is not exclusive to EARLY — a plain
  // NORMAL finish lands there too whenever sets were skipped. Persist the
  // actual intent explicitly so the summary screen never has to guess.
  it('persists the real finalizationMode (NORMAL vs EARLY) on the terminal execution, independent of executionStatus', async () => {
    await root.collection('workoutExecutions').doc(EXECUTION_ID).update({
      exercises: [{
        exerciseIndex: 0, prescribedExerciseId: 'squat', exerciseId: 'squat',
        sets: completionSets(2, 3),
      }],
    });
    await expect(finalize()).resolves.toMatchObject({ executionStatus: 'PARTIALLY_COMPLETED' });
    expect((await root.collection('workoutExecutions').doc(EXECUTION_ID).get()).data())
      .toMatchObject({ status: 'PARTIALLY_COMPLETED', finalizationMode: 'NORMAL' });
  });

  it('persists finalizationMode EARLY distinctly from a NORMAL partial finish', async () => {
    await root.collection('workoutExecutions').doc(EXECUTION_ID).update({
      exercises: [{
        exerciseIndex: 0, prescribedExerciseId: 'squat', exerciseId: 'squat',
        sets: completionSets(2, 3),
      }],
    });
    await expect(finalize({ mode: 'EARLY' })).resolves.toMatchObject({ executionStatus: 'PARTIALLY_COMPLETED' });
    expect((await root.collection('workoutExecutions').doc(EXECUTION_ID).get()).data())
      .toMatchObject({ status: 'PARTIALLY_COMPLETED', finalizationMode: 'EARLY' });
  });

  it('retry of an already-terminal finalize never overwrites the original finalizationMode', async () => {
    await root.collection('workoutExecutions').doc(EXECUTION_ID).update({
      exercises: [{
        exerciseIndex: 0, prescribedExerciseId: 'squat', exerciseId: 'squat',
        sets: completionSets(2, 3),
      }],
    });
    await finalize({ mode: 'EARLY' });
    // Retry without `mode` (a client resending the base request after a lost
    // response) must stay idempotent — it never re-sweeps the execution nor
    // flips the already-persisted finalizationMode to NORMAL.
    await expect(finalize()).resolves.toMatchObject({ executionStatus: 'PARTIALLY_COMPLETED' });
    expect((await root.collection('workoutExecutions').doc(EXECUTION_ID).get()).data())
      .toMatchObject({ finalizationMode: 'EARLY' });
  });

  it('finalizes flexible with prescribed cardio and advances the same sequence cursor', async () => {
    await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).set({
        ...program(true), scheduleMode: 'flexible', prescribedTrainingFrequency: 2, weeklySchedule: [],
        sessions: [
          { name: 'A', exercises: [{ exerciseId: 'squat', sets: 3 }], cardioFinisher: { duration: '10 min', mode: 'steady_state' } },
          { name: 'B', exercises: [{ exerciseId: 'squat', sets: 3 }] },
        ],
      }),
      root.collection('programInstances').doc(INSTANCE_ID).update({
        prescriptionInputSnapshot: { inputs: { scheduleMode: 'flexible', trainingDays: null } },
      }),
      root.collection('workoutProgramState').doc('scheduleConfig').set({
        scheduleMode: 'flexible', trainingDays: [], timezone: 'UTC',
      }),
    ]);
    await expect(finalize({ cardio: { actualDurationSeconds: 600 } })).resolves.toMatchObject({
      status: 'COMPLETED', cardioStatus: 'COMPLETED', scheduleStatus: 'COMPLETED',
    });
    const [state, completedExecution] = await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleState').doc(INSTANCE_ID).get(),
      root.collection('workoutExecutions').doc(EXECUTION_ID).get(),
    ]);
    expect(state.data()).toMatchObject({ nextSessionIndex: 1, lastCompletedAt: today });
    expect(completedExecution.data()?.cardio).toMatchObject({ status: 'COMPLETED', actualDurationSeconds: 600 });
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
  }, 10_000);

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
