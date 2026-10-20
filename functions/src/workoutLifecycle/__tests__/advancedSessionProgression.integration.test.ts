import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { finalizeWorkoutSessionHandler } from '../finalizeWorkoutSession';
import { resolveWorkoutSchedule } from '../scheduleEngine/resolver';
import type { ResolveWorkoutScheduleInput } from '../scheduleEngine/types';
import { seedRealPrescriptionCatalog } from './realCatalogFixture';

/**
 * End-to-end progression of an ADVANCED session, against the real finalizer
 * and real Firestore — not simulated state.
 *
 * The rule under test: the calendar decides WHEN the user may train, the
 * rotation decides WHICH session is next. Completing a session ahead of its
 * own day consumes the sequence position, never the calendar opportunity it
 * was scheduled for — so advancing must not cost a later training day.
 *
 * Real scenario this came from (2026-10-18): trainingDays MON/WED/THU/FRI/SAT,
 * session A scheduled for Monday the 19th was advanced and performed on Sunday
 * the 18th, after which Monday refused to start B.
 *
 * Every schedule fact asserted here is RE-READ from Firestore and fed to the
 * real resolver, which is exactly what the app does on a cold open — so these
 * assertions double as the "reopen the app" check.
 */

const enabled = process.env.ADVANCED_SESSION_PROGRESSION_INTEGRATION === '1';

const UID = 'advance-alice';
const PROGRAM_ID = 'wpg_advance';
const INSTANCE_ID = 'wpi_advance';

const SUNDAY = '2026-10-18';
const MONDAY = '2026-10-19';
const TUESDAY = '2026-10-20';
const WEDNESDAY = '2026-10-21';
const TRAINING_DAYS = ['MON', 'WED', 'THU', 'FRI', 'SAT'];
const SESSION_COUNT = 3;
const ACTIVATED_AT = '2026-10-12';

function sets() {
  return [0, 1, 2].map((setIndex) => ({ setIndex, status: 'COMPLETED', actualReps: 10, weightKg: 20 }));
}

function request(uid: string, data: unknown): CallableRequest {
  return { auth: { uid }, data } as never;
}

describe.skipIf(!enabled)('advanced session progression — real finalizer + Firestore Emulator', () => {
  let app: App;
  let db: Firestore;
  let root: FirebaseFirestore.DocumentReference;

  beforeAll(async () => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'advanced-session-progression');
    db = getFirestore(app);
    root = db.collection('users').doc(UID);
    await seedRealPrescriptionCatalog(db);
  });

  afterAll(async () => { await deleteApp(app); });

  beforeEach(async () => {
    await db.recursiveDelete(root).catch(() => {});
    await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).set({
        programId: PROGRAM_ID,
        status: 'active',
        scheduleMode: 'fixed',
        prescribedTrainingFrequency: TRAINING_DAYS.length,
        weeklySchedule: TRAINING_DAYS.map((weekday, sessionIndex) => ({
          weekday, state: 'TRAINING', sessionIndex: sessionIndex % SESSION_COUNT,
        })),
        sessions: [0, 1, 2].map((index) => ({
          name: String.fromCharCode(65 + index),
          exercises: [{ exerciseId: 'squat', sets: 3 }],
        })),
      }),
      root.collection('programInstances').doc(INSTANCE_ID).set({
        programInstanceId: INSTANCE_ID,
        contentIdentity: PROGRAM_ID,
        activatedAt: Timestamp.fromDate(new Date(`${ACTIVATED_AT}T00:00:00Z`)),
        supersededAt: null,
        prescriptionInputSnapshot: { inputs: { scheduleMode: 'fixed', trainingDays: TRAINING_DAYS } },
      }),
      root.collection('workoutProgramState').doc('scheduleConfig')
        .set({ trainingDays: TRAINING_DAYS, timezone: 'UTC', scheduleVersion: 1 }),
      root.collection('workoutProgramState').doc('active').set({ programId: PROGRAM_ID }),
      root.collection('workoutLifecycleState').doc('current').set({ activeProgramInstanceId: INSTANCE_ID }),
      // Session A (index 0) is the one the rotation owes; nothing completed yet.
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleState').doc(INSTANCE_ID).set({
        programId: PROGRAM_ID,
        programInstanceId: INSTANCE_ID,
        nextSessionIndex: 0,
        cursorDate: '2026-10-17',
        lastCompletedAt: '2026-10-17',
        lastPerformedLocalDate: '2026-10-17',
        pendingMissDecision: null,
      }),
    ]);
  });

  /** Starts an execution the way the client does, then finalizes it for real. */
  async function performSession(input: {
    executionId: string;
    sessionIndex: number;
    scheduledLocalDate: string;
    performedLocalDate: string;
  }) {
    await Promise.all([
      root.collection('workoutExecutions').doc(input.executionId).set({
        programId: PROGRAM_ID,
        programInstanceId: INSTANCE_ID,
        sessionIndex: input.sessionIndex,
        scheduledLocalDate: input.scheduledLocalDate,
        performedLocalDate: input.performedLocalDate,
        status: 'IN_PROGRESS',
        exercises: [{ exerciseIndex: 0, prescribedExerciseId: 'squat', exerciseId: 'squat', sets: sets() }],
        cardio: null,
        startedAt: Timestamp.fromDate(new Date(`${input.performedLocalDate}T12:00:00Z`)),
        createdAt: Timestamp.fromDate(new Date(`${input.performedLocalDate}T12:00:00Z`)),
      }),
      root.collection('workoutExecutionState').doc('current').set({ executionId: input.executionId }),
    ]);
    return finalizeWorkoutSessionHandler(request(UID, { executionId: input.executionId }), db);
  }

  /** Re-reads the persisted state and runs the real resolver against it. */
  async function resolveOn(todayLocalDate: string) {
    const snapshot = await root.collection('workoutPrograms').doc(PROGRAM_ID)
      .collection('scheduleState').doc(INSTANCE_ID).get();
    const data = snapshot.data()!;
    const state: ResolveWorkoutScheduleInput['state'] = {
      nextSessionIndex: data.nextSessionIndex,
      cursorDate: data.cursorDate,
      lastCompletedAt: data.lastCompletedAt ?? null,
      ...(data.lastPerformedLocalDate != null ? { lastPerformedLocalDate: data.lastPerformedLocalDate } : {}),
      pendingMissDecision: data.pendingMissDecision ?? null,
    };
    return resolveWorkoutSchedule({
      hasActiveProgram: true,
      sessionCount: SESSION_COUNT,
      scheduleMode: 'fixed',
      config: { trainingDays: TRAINING_DAYS as never, timezone: 'UTC', scheduleVersion: 1 },
      state,
      activatedAtLocalDate: ACTIVATED_AT,
      todayLocalDate,
    });
  }

  const advanceAOntoSunday = () => performSession({
    executionId: 'exec_a_advanced',
    sessionIndex: 0,
    scheduledLocalDate: MONDAY,
    performedLocalDate: SUNDAY,
  });

  it('Sunday: finalizing A (scheduled Monday) consumes the sequence, not Monday', async () => {
    await expect(advanceAOntoSunday()).resolves.toMatchObject({
      status: 'COMPLETED', scheduleStatus: 'COMPLETED',
    });

    const state = (await root.collection('workoutPrograms').doc(PROGRAM_ID)
      .collection('scheduleState').doc(INSTANCE_ID).get()).data()!;
    expect(state).toMatchObject({
      nextSessionIndex: 1,            // the rotation now owes B
      cursorDate: SUNDAY,             // ...but the calendar only consumed Sunday
      lastCompletedAt: SUNDAY,
      lastPerformedLocalDate: SUNDAY,
    });

    // The occurrence keeps its own identity: history still says A belonged to
    // Monday's opportunity and was performed on Sunday.
    const event = (await root.collection('workoutPrograms').doc(PROGRAM_ID)
      .collection('scheduleEvents').doc(`${INSTANCE_ID}_completed_0_${MONDAY}`).get()).data();
    expect(event).toMatchObject({
      type: 'COMPLETED', sessionIndex: 0, scheduledDate: MONDAY, performedLocalDate: SUNDAY,
    });
  });

  it('Sunday reads as already trained; Monday offers B; Tuesday stays a rest day', async () => {
    await advanceAOntoSunday();
    expect(await resolveOn(SUNDAY)).toMatchObject({ status: 'TODAY_COMPLETED' });
    expect(await resolveOn(MONDAY)).toEqual({ status: 'SESSION_READY', sessionIndex: 1 });
    expect(await resolveOn(TUESDAY)).toMatchObject({ status: 'REST_DAY' });
  });

  it('Monday: B can actually be started and finalized, and Wednesday then offers C', async () => {
    await advanceAOntoSunday();
    expect(await resolveOn(MONDAY)).toEqual({ status: 'SESSION_READY', sessionIndex: 1 });

    await expect(performSession({
      executionId: 'exec_b_monday',
      sessionIndex: 1,
      scheduledLocalDate: MONDAY,
      performedLocalDate: MONDAY,
    })).resolves.toMatchObject({ status: 'COMPLETED', scheduleStatus: 'COMPLETED' });

    const state = (await root.collection('workoutPrograms').doc(PROGRAM_ID)
      .collection('scheduleState').doc(INSTANCE_ID).get()).data()!;
    expect(state).toMatchObject({
      nextSessionIndex: 2, cursorDate: MONDAY, lastCompletedAt: MONDAY, lastPerformedLocalDate: MONDAY,
    });

    expect(await resolveOn(MONDAY)).toMatchObject({ status: 'TODAY_COMPLETED' });
    expect(await resolveOn(WEDNESDAY)).toEqual({ status: 'SESSION_READY', sessionIndex: 2 });
  });

  it('without B on Monday, Wednesday still owes B — never skips it', async () => {
    await advanceAOntoSunday();
    const wednesday = await resolveOn(WEDNESDAY);
    // Two unconsumed opportunities (Mon, Wed) is the pre-existing missed-session
    // gap. Whatever the user decides, the rotation still owes B (index 1) — the
    // session is never dropped just because its date went by.
    expect(wednesday).toMatchObject({
      status: 'MISSED_SESSION_DECISION_REQUIRED',
      missedSessionIndex: 1,
      missedScheduledDate: MONDAY,
    });
  });

  it('reopening the app re-derives the same answers from Firestore alone', async () => {
    await advanceAOntoSunday();
    const first = await Promise.all([SUNDAY, MONDAY, TUESDAY].map(resolveOn));
    const second = await Promise.all([SUNDAY, MONDAY, TUESDAY].map(resolveOn));
    expect(second).toEqual(first);
    expect(second[1]).toEqual({ status: 'SESSION_READY', sessionIndex: 1 });
  });

  it('a retry of the same finalize advances the sequence exactly once', async () => {
    await advanceAOntoSunday();
    // Same executionId again: the deterministic completion event is the
    // idempotency key, so the schedule write is skipped entirely.
    await expect(finalizeWorkoutSessionHandler(
      request(UID, { executionId: 'exec_a_advanced' }), db,
    )).resolves.toMatchObject({ status: 'COMPLETED' });

    const state = (await root.collection('workoutPrograms').doc(PROGRAM_ID)
      .collection('scheduleState').doc(INSTANCE_ID).get()).data()!;
    expect(state).toMatchObject({ nextSessionIndex: 1, cursorDate: SUNDAY });
    expect(await resolveOn(MONDAY)).toEqual({ status: 'SESSION_READY', sessionIndex: 1 });
  });

  it('completing the last session of the rotation wraps to the next cycle', async () => {
    await root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleState').doc(INSTANCE_ID)
      .update({ nextSessionIndex: 2 });
    await expect(performSession({
      executionId: 'exec_c_advanced',
      sessionIndex: 2,
      scheduledLocalDate: MONDAY,
      performedLocalDate: SUNDAY,
    })).resolves.toMatchObject({ status: 'COMPLETED' });

    const state = (await root.collection('workoutPrograms').doc(PROGRAM_ID)
      .collection('scheduleState').doc(INSTANCE_ID).get()).data()!;
    expect(state).toMatchObject({ nextSessionIndex: 0, cursorDate: SUNDAY });
    expect(await resolveOn(MONDAY)).toEqual({ status: 'SESSION_READY', sessionIndex: 0 });
  });

  it('a session performed on its own day keeps the ordinary flow untouched', async () => {
    await expect(performSession({
      executionId: 'exec_a_on_monday',
      sessionIndex: 0,
      scheduledLocalDate: MONDAY,
      performedLocalDate: MONDAY,
    })).resolves.toMatchObject({ status: 'COMPLETED' });

    const state = (await root.collection('workoutPrograms').doc(PROGRAM_ID)
      .collection('scheduleState').doc(INSTANCE_ID).get()).data()!;
    expect(state).toMatchObject({ nextSessionIndex: 1, cursorDate: MONDAY, lastCompletedAt: MONDAY });
    expect(await resolveOn(MONDAY)).toMatchObject({ status: 'TODAY_COMPLETED' });
    expect(await resolveOn(WEDNESDAY)).toEqual({ status: 'SESSION_READY', sessionIndex: 1 });
  });

  /**
   * An OLD app build reads only `lastCompletedAt` and `cursorDate` — it has no
   * knowledge of `lastPerformedLocalDate`. The fix lives in the persisted
   * cursor, so such a build inherits the corrected behavior unchanged.
   */
  it('an old build, reading only cursorDate/lastCompletedAt, also gets B on Monday', async () => {
    await advanceAOntoSunday();
    const data = (await root.collection('workoutPrograms').doc(PROGRAM_ID)
      .collection('scheduleState').doc(INSTANCE_ID).get()).data()!;
    const oldBuildState = {
      nextSessionIndex: data.nextSessionIndex,
      cursorDate: data.cursorDate,
      lastCompletedAt: data.lastCompletedAt ?? null,
      pendingMissDecision: data.pendingMissDecision ?? null,
    };
    const resolveAsOldBuild = (todayLocalDate: string) => resolveWorkoutSchedule({
      hasActiveProgram: true,
      sessionCount: SESSION_COUNT,
      scheduleMode: 'fixed',
      config: { trainingDays: TRAINING_DAYS as never, timezone: 'UTC', scheduleVersion: 1 },
      state: oldBuildState,
      activatedAtLocalDate: ACTIVATED_AT,
      todayLocalDate,
    });
    expect(resolveAsOldBuild(SUNDAY)).toMatchObject({ status: 'TODAY_COMPLETED' });
    expect(resolveAsOldBuild(MONDAY)).toEqual({ status: 'SESSION_READY', sessionIndex: 1 });
  });
});

/**
 * The document that is ALREADY in Firestore for anyone who advanced a session
 * before the finalizer fix: the cursor sits on the opportunity's own
 * (scheduled) date, with the performed date recorded beside it. Nothing here
 * is migrated or rewritten up front — the point is that the live system must
 * carry this shape as-is, through real writes.
 */
describe.skipIf(!enabled)('legacy persisted state — cursor on the scheduled date', () => {
  let app: App;
  let db: Firestore;
  let root: FirebaseFirestore.DocumentReference;

  const A_EXECUTION_ID = 'exec_a_legacy';
  const stateRef = () => root.collection('workoutPrograms').doc(PROGRAM_ID)
    .collection('scheduleState').doc(INSTANCE_ID);

  beforeAll(async () => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'advanced-session-legacy-state');
    db = getFirestore(app);
    root = db.collection('users').doc(UID);
    await seedRealPrescriptionCatalog(db);
  });

  afterAll(async () => { await deleteApp(app); });

  beforeEach(async () => {
    await db.recursiveDelete(root).catch(() => {});
    await Promise.all([
      root.collection('workoutPrograms').doc(PROGRAM_ID).set({
        programId: PROGRAM_ID,
        status: 'active',
        scheduleMode: 'fixed',
        prescribedTrainingFrequency: TRAINING_DAYS.length,
        weeklySchedule: TRAINING_DAYS.map((weekday, sessionIndex) => ({
          weekday, state: 'TRAINING', sessionIndex: sessionIndex % SESSION_COUNT,
        })),
        sessions: [0, 1, 2].map((index) => ({
          name: String.fromCharCode(65 + index),
          exercises: [{ exerciseId: 'squat', sets: 3 }],
        })),
      }),
      root.collection('programInstances').doc(INSTANCE_ID).set({
        programInstanceId: INSTANCE_ID,
        contentIdentity: PROGRAM_ID,
        activatedAt: Timestamp.fromDate(new Date(`${ACTIVATED_AT}T00:00:00Z`)),
        supersededAt: null,
        prescriptionInputSnapshot: { inputs: { scheduleMode: 'fixed', trainingDays: TRAINING_DAYS } },
      }),
      root.collection('workoutProgramState').doc('scheduleConfig')
        .set({ trainingDays: TRAINING_DAYS, timezone: 'UTC', scheduleVersion: 1 }),
      root.collection('workoutProgramState').doc('active').set({ programId: PROGRAM_ID }),
      root.collection('workoutLifecycleState').doc('current').set({ activeProgramInstanceId: INSTANCE_ID }),
      // THE LEGACY STATE, verbatim.
      stateRef().set({
        programId: PROGRAM_ID,
        programInstanceId: INSTANCE_ID,
        nextSessionIndex: 1,
        cursorDate: MONDAY,
        lastCompletedAt: MONDAY,
        lastPerformedLocalDate: SUNDAY,
        pendingMissDecision: null,
      }),
      // A's real occurrence identity and terminal execution, as a genuine
      // legacy account would already carry them.
      root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleEvents')
        .doc(`${INSTANCE_ID}_completed_0_${MONDAY}`).set({
          type: 'COMPLETED',
          programInstanceId: INSTANCE_ID,
          sessionIndex: 0,
          scheduledDate: MONDAY,
          performedLocalDate: SUNDAY,
          occurredAt: Timestamp.fromDate(new Date(`${SUNDAY}T13:00:00Z`)),
        }),
      root.collection('workoutExecutions').doc(A_EXECUTION_ID).set({
        programId: PROGRAM_ID,
        programInstanceId: INSTANCE_ID,
        sessionIndex: 0,
        scheduledLocalDate: MONDAY,
        performedLocalDate: SUNDAY,
        status: 'COMPLETED',
        exercises: [{ exerciseIndex: 0, prescribedExerciseId: 'squat', exerciseId: 'squat', sets: sets() }],
        cardio: null,
        startedAt: Timestamp.fromDate(new Date(`${SUNDAY}T12:00:00Z`)),
        createdAt: Timestamp.fromDate(new Date(`${SUNDAY}T12:00:00Z`)),
        finishedAt: Timestamp.fromDate(new Date(`${SUNDAY}T13:00:00Z`)),
      }),
    ]);
  });

  async function resolveOn(todayLocalDate: string) {
    const data = (await stateRef().get()).data()!;
    return resolveWorkoutSchedule({
      hasActiveProgram: true,
      sessionCount: SESSION_COUNT,
      scheduleMode: 'fixed',
      config: { trainingDays: TRAINING_DAYS as never, timezone: 'UTC', scheduleVersion: 1 },
      state: {
        nextSessionIndex: data.nextSessionIndex,
        cursorDate: data.cursorDate,
        lastCompletedAt: data.lastCompletedAt ?? null,
        ...(data.lastPerformedLocalDate != null
          ? { lastPerformedLocalDate: data.lastPerformedLocalDate } : {}),
        pendingMissDecision: data.pendingMissDecision ?? null,
      },
      activatedAtLocalDate: ACTIVATED_AT,
      todayLocalDate,
    });
  }

  async function startAndFinalizeB(executionId = 'exec_b_legacy') {
    await Promise.all([
      root.collection('workoutExecutions').doc(executionId).set({
        programId: PROGRAM_ID,
        programInstanceId: INSTANCE_ID,
        sessionIndex: 1,
        scheduledLocalDate: MONDAY,
        performedLocalDate: MONDAY,
        status: 'IN_PROGRESS',
        exercises: [{ exerciseIndex: 0, prescribedExerciseId: 'squat', exerciseId: 'squat', sets: sets() }],
        cardio: null,
        startedAt: Timestamp.fromDate(new Date(`${MONDAY}T12:00:00Z`)),
        createdAt: Timestamp.fromDate(new Date(`${MONDAY}T12:00:00Z`)),
      }),
      root.collection('workoutExecutionState').doc('current').set({ executionId }),
    ]);
    return finalizeWorkoutSessionHandler(
      request(UID, { executionId }), db,
    );
  }

  it('(1) the resolver offers B on Monday, straight off the unmigrated document', async () => {
    expect(await resolveOn(MONDAY)).toEqual({ status: 'SESSION_READY', sessionIndex: 1 });
  });

  it('(2,3,4) B starts and the real finalizer accepts it — the legacy cursor is no grounds to reject', async () => {
    await expect(startAndFinalizeB()).resolves.toMatchObject({
      status: 'COMPLETED', scheduleStatus: 'COMPLETED',
    });
  });

  it('(5) Firestore ends on nextSessionIndex 2 with the cursor on Monday', async () => {
    await startAndFinalizeB();
    expect((await stateRef().get()).data()).toMatchObject({
      nextSessionIndex: 2,
      cursorDate: MONDAY,
      lastCompletedAt: MONDAY,
      lastPerformedLocalDate: MONDAY,
    });
  });

  it("(6) Wednesday then offers C, and A's own history is untouched", async () => {
    await startAndFinalizeB();
    expect(await resolveOn(WEDNESDAY)).toEqual({ status: 'SESSION_READY', sessionIndex: 2 });
    const aEvent = await root.collection('workoutPrograms').doc(PROGRAM_ID)
      .collection('scheduleEvents').doc(`${INSTANCE_ID}_completed_0_${MONDAY}`).get();
    expect(aEvent.data()).toMatchObject({ sessionIndex: 0, scheduledDate: MONDAY, performedLocalDate: SUNDAY });
  });

  it('(7) closing and reopening re-derives the same answers from Firestore alone', async () => {
    const before = await Promise.all([SUNDAY, MONDAY, TUESDAY, WEDNESDAY].map(resolveOn));
    expect(before[1]).toEqual({ status: 'SESSION_READY', sessionIndex: 1 });
    await startAndFinalizeB();
    const after = await Promise.all([MONDAY, WEDNESDAY].map(resolveOn));
    expect(after[0]).toMatchObject({ status: 'TODAY_COMPLETED' });
    expect(after[1]).toEqual({ status: 'SESSION_READY', sessionIndex: 2 });
    expect(await Promise.all([MONDAY, WEDNESDAY].map(resolveOn))).toEqual(after);
  });

  it('(8) a retry of the same finalize never advances twice', async () => {
    await startAndFinalizeB();
    await expect(finalizeWorkoutSessionHandler(
      request(UID, { executionId: 'exec_b_legacy' }), db,
    )).resolves.toMatchObject({ status: 'COMPLETED' });
    expect((await stateRef().get()).data()).toMatchObject({ nextSessionIndex: 2, cursorDate: MONDAY });
    const completed = await root.collection('workoutPrograms').doc(PROGRAM_ID)
      .collection('scheduleEvents').where('type', '==', 'COMPLETED').get();
    // A's legacy event plus B's — never a third from the retry.
    expect(completed.size).toBe(2);
  });

  it('(8) two simultaneous confirmations advance the sequence exactly once', async () => {
    await Promise.all([
      root.collection('workoutExecutions').doc('exec_b_race').set({
        programId: PROGRAM_ID,
        programInstanceId: INSTANCE_ID,
        sessionIndex: 1,
        scheduledLocalDate: MONDAY,
        performedLocalDate: MONDAY,
        status: 'IN_PROGRESS',
        exercises: [{ exerciseIndex: 0, prescribedExerciseId: 'squat', exerciseId: 'squat', sets: sets() }],
        cardio: null,
        startedAt: Timestamp.fromDate(new Date(`${MONDAY}T12:00:00Z`)),
        createdAt: Timestamp.fromDate(new Date(`${MONDAY}T12:00:00Z`)),
      }),
      root.collection('workoutExecutionState').doc('current').set({ executionId: 'exec_b_race' }),
    ]);
    const [first, second] = await Promise.all([
      finalizeWorkoutSessionHandler(request(UID, { executionId: 'exec_b_race' }), db),
      finalizeWorkoutSessionHandler(request(UID, { executionId: 'exec_b_race' }), db),
    ]);
    expect(first.status).toBe('COMPLETED');
    expect(second.status).toBe('COMPLETED');
    expect((await stateRef().get()).data()).toMatchObject({ nextSessionIndex: 2 });
    const completed = await root.collection('workoutPrograms').doc(PROGRAM_ID)
      .collection('scheduleEvents').where('type', '==', 'COMPLETED').get();
    expect(completed.size).toBe(2);
  }, 15_000);
});

