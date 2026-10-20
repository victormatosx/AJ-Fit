import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { finalizeWorkoutSessionHandler } from '../finalizeWorkoutSession';
import { seedRealPrescriptionCatalog } from './realCatalogFixture';
import { WORKOUT_DAILY_COMPLETIONS_COLLECTION } from '../scheduleEngine/dailyWorkoutLimit';

/**
 * New training model — B-1, server side.
 *
 * Two claims are pinned here:
 *
 *  1. The CALENDAR no longer authorizes a completion. Any session of the
 *     active program finalizes on any day, including a day the fixed
 *     recommendation never offered, with no missed-session decision and no
 *     "advance" exception.
 *  2. Security did NOT move with it. A session outside the program, a
 *     superseded instance, a foreign account, a forged performed date and a
 *     duplicated finalize are all still refused.
 *
 * Plus the invariant the whole rotation rests on: completion recomputes the
 * same pointer a selection already set, so it can never advance twice.
 */

const enabled = process.env.FREE_SESSION_SELECTION_INTEGRATION === '1';
const UID = 'freesel-alice';
const OTHER_UID = 'freesel-mallory';
const PROGRAM_ID = 'wpg_freesel';
const INSTANCE_ID = 'wpi_freesel';
const today = new Date().toISOString().slice(0, 10);
const jsDay = new Date(`${today}T12:00:00Z`).getUTCDay();
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
/** Deliberately NOT today: the fixed calendar never recommends training now. */
const otherWeekday = WEEKDAYS[(jsDay + 1) % 7];

const sets = () => [0, 1, 2].map(setIndex => ({ setIndex, status: 'COMPLETED', actualReps: 10, weightKg: 20 }));

function execution(sessionIndex: number, overrides: Record<string, unknown> = {}) {
  return {
    programId: PROGRAM_ID,
    programInstanceId: INSTANCE_ID,
    sessionIndex,
    scheduledLocalDate: today,
    performedLocalDate: today,
    status: 'IN_PROGRESS',
    exercises: [{ exerciseIndex: 0, prescribedExerciseId: 'squat', exerciseId: 'squat', sets: sets() }],
    cardio: null,
    startedAt: Timestamp.now(),
    createdAt: Timestamp.fromDate(new Date(`${today}T12:00:00Z`)),
    ...overrides,
  };
}

/** A/B/C rotation whose only recommended weekday is NOT today. */
const program = () => ({
  programId: PROGRAM_ID,
  status: 'active',
  prescribedTrainingFrequency: 3,
  weeklySchedule: [{ weekday: otherWeekday, state: 'TRAINING', sessionIndex: 0 }],
  sessions: ['A', 'B', 'C'].map(name => ({ name, exercises: [{ exerciseId: 'squat', sets: 3 }] })),
});

const request = (uid: string | null, data: unknown): CallableRequest =>
  (uid ? { auth: { uid }, data } : { data }) as never;

describe.skipIf(!enabled)('free session selection and completion — emulator', () => {
  let app: App; let db: Firestore; let root: FirebaseFirestore.DocumentReference;

  beforeAll(async () => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'free-session-selection-integration');
    db = getFirestore(app);
    root = db.collection('users').doc(UID);
    await seedRealPrescriptionCatalog(db);
  });
  afterAll(async () => { await deleteApp(app); });

  const stateRef = () => root.collection('workoutPrograms').doc(PROGRAM_ID)
    .collection('scheduleState').doc(INSTANCE_ID);
  const state = async () => (await stateRef().get()).data();
  const execId = (sessionIndex: number) => `exec_freesel_${sessionIndex}`;

  async function seedExecution(sessionIndex: number, overrides: Record<string, unknown> = {}) {
    await root.collection('workoutExecutions').doc(execId(sessionIndex))
      .set(execution(sessionIndex, overrides));
  }
  const finalize = (sessionIndex: number, uid = UID) =>
    finalizeWorkoutSessionHandler(request(uid, { executionId: execId(sessionIndex) }), db);
  const dailyMarker = async (localDate: string) =>
    (await root.collection(WORKOUT_DAILY_COMPLETIONS_COLLECTION).doc(localDate).get()).data();

  beforeEach(async () => {
    await db.recursiveDelete(root).catch(() => {});
    await db.recursiveDelete(db.collection('users').doc(OTHER_UID)).catch(() => {});
    await Promise.all([
      // Controlled pilot enrolment. Every behaviour in this file belongs to
      // the new training model, and the callable grants none of it without
      // this server-written document — which is exactly the claim the
      // `legacy accounts are untouched` block below verifies from the other
      // side, by deleting it.
      db.collection('workoutPilotEnrollment').doc(UID).set({ enabled: true }),
      root.collection('workoutPrograms').doc(PROGRAM_ID).set(program()),
      root.collection('programInstances').doc(INSTANCE_ID).set({
        programInstanceId: INSTANCE_ID,
        contentIdentity: PROGRAM_ID,
        activatedAt: Timestamp.fromDate(new Date(`${today}T00:00:00Z`)),
        supersededAt: null,
        prescriptionInputSnapshot: { inputs: { trainingDays: [otherWeekday] } },
      }),
      root.collection('workoutProgramState').doc('scheduleConfig')
        .set({ trainingDays: [otherWeekday], timezone: 'UTC' }),
      root.collection('workoutProgramState').doc('active').set({ programId: PROGRAM_ID }),
      root.collection('workoutLifecycleState').doc('current').set({ activeProgramInstanceId: INSTANCE_ID }),
    ]);
  });

  describe('the calendar no longer blocks a completion', () => {
    it('finalizes on a day the fixed recommendation never offered', async () => {
      await seedExecution(0);
      await expect(finalize(0)).resolves.toMatchObject({ status: 'COMPLETED', scheduleStatus: 'COMPLETED' });
      expect(await state()).toMatchObject({ suggestedSessionIndex: 1, nextSessionIndex: 1 });
    });

    it('finalizes session C even though the rotation was offering A', async () => {
      await stateRef().set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID,
        nextSessionIndex: 0, suggestedSessionIndex: 0, suggestionVersion: 0, lastSelectedSessionIndex: null,
        cursorDate: today, lastCompletedAt: null, lastPerformedLocalDate: null,
        pendingMissDecision: null, updatedAt: Timestamp.now(),
      });
      await seedExecution(2);
      await expect(finalize(2)).resolves.toMatchObject({ status: 'COMPLETED' });
      // C completed → A is next.
      expect(await state()).toMatchObject({ suggestedSessionIndex: 0, nextSessionIndex: 0 });
    });

    it('ignores a stale pendingMissDecision instead of refusing to train', async () => {
      await stateRef().set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID,
        nextSessionIndex: 0, cursorDate: '2026-01-01', lastCompletedAt: null, lastPerformedLocalDate: null,
        pendingMissDecision: {
          missedSessionIndex: 0, calendarSessionIndex: 1,
          missedScheduledDate: '2026-01-05', detectedOnDate: '2026-01-06',
        },
        updatedAt: Timestamp.now(),
      });
      await seedExecution(1);
      await expect(finalize(1)).resolves.toMatchObject({ status: 'COMPLETED' });
      expect((await state())?.pendingMissDecision).toBeNull();
    });

    it('refuses a SECOND credited session on the same day (A done → B blocked)', async () => {
      await seedExecution(0);
      await finalize(0);
      await seedExecution(1);
      await expect(finalize(1)).rejects.toThrow('workout_daily_limit_reached');
      // The rejected attempt committed nothing at all.
      expect((await root.collection('workoutExecutions').doc(execId(1)).get()).data()?.status).toBe('IN_PROGRESS');
      expect(await state()).toMatchObject({ suggestedSessionIndex: 1 });
    });
  });

  // ONE CREDITED WORKOUT PER DAY. Enforced by a user-scoped, per-day marker
  // read and written inside the finalize transaction.
  describe('one credited workout per day', () => {
    it('claims the day with a marker naming the execution that consumed it', async () => {
      await seedExecution(0);
      await finalize(0);
      expect(await dailyMarker(today)).toMatchObject({
        localDate: today, executionId: execId(0), programInstanceId: INSTANCE_ID, sessionIndex: 0,
      });
    });

    it('A done today → B allowed TOMORROW', async () => {
      await seedExecution(0);
      await finalize(0);
      // Tomorrow's execution: created tomorrow, performed tomorrow.
      const tomorrow = new Date(new Date(`${today}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
      await seedExecution(1, {
        scheduledLocalDate: tomorrow,
        performedLocalDate: tomorrow,
        createdAt: Timestamp.fromDate(new Date(`${tomorrow}T12:00:00Z`)),
      });
      await expect(finalize(1)).resolves.toMatchObject({ status: 'COMPLETED' });
      expect(await dailyMarker(tomorrow)).toMatchObject({ executionId: execId(1) });
      expect(await state()).toMatchObject({ suggestedSessionIndex: 2 });
    });

    it('a PARTIALLY_COMPLETED workout consumes the day just like a full one', async () => {
      // One of three sets done → terminal status is PARTIALLY_COMPLETED.
      await seedExecution(0, {
        exercises: [{
          exerciseIndex: 0, prescribedExerciseId: 'squat', exerciseId: 'squat',
          sets: [
            { setIndex: 0, status: 'COMPLETED', actualReps: 10, weightKg: 20 },
            { setIndex: 1, status: 'PENDING', actualReps: null, weightKg: null },
            { setIndex: 2, status: 'PENDING', actualReps: null, weightKg: null },
          ],
        }],
      });
      await expect(finalize(0)).resolves.toMatchObject({ executionStatus: 'PARTIALLY_COMPLETED' });
      expect(await dailyMarker(today)).toMatchObject({ executionId: execId(0) });
      await seedExecution(1);
      await expect(finalize(1)).rejects.toThrow('workout_daily_limit_reached');
    });

    it('an ABANDONED attempt never consumes the day', async () => {
      await seedExecution(0, { status: 'ABANDONED' });
      // An abandoned execution is not finishable at all, so nothing is claimed.
      await expect(finalize(0)).rejects.toThrow('execution_not_finishable');
      expect(await dailyMarker(today)).toBeUndefined();
      // …and a different session still goes through.
      await seedExecution(1);
      await expect(finalize(1)).resolves.toMatchObject({ status: 'COMPLETED' });
    });

    it('two devices finishing DIFFERENT sessions at once: exactly one is credited', async () => {
      await seedExecution(0);
      await seedExecution(1);
      const results = await Promise.allSettled([finalize(0), finalize(1)]);
      const fulfilled = results.filter(result => result.status === 'fulfilled');
      const rejected = results.filter(result => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String((rejected[0] as PromiseRejectedResult).reason)).toContain('workout_daily_limit_reached');
      // Exactly one COMPLETED event and one marker.
      const events = await root.collection('workoutPrograms').doc(PROGRAM_ID)
        .collection('scheduleEvents').where('type', '==', 'COMPLETED').get();
      expect(events.size).toBe(1);
      const markers = await root.collection(WORKOUT_DAILY_COMPLETIONS_COLLECTION).get();
      expect(markers.size).toBe(1);
    }, 15_000);

    it('a replayed finalize of the SAME execution stays idempotent, never a second workout', async () => {
      await seedExecution(0);
      await finalize(0);
      const marker = await dailyMarker(today);
      await expect(finalize(0)).resolves.toMatchObject({ status: 'COMPLETED' });
      // Same marker, same single event — the replay is not a second session.
      expect(await dailyMarker(today)).toMatchObject({ executionId: marker?.executionId as string });
      const events = await root.collection('workoutPrograms').doc(PROGRAM_ID)
        .collection('scheduleEvents').where('type', '==', 'COMPLETED').get();
      expect(events.size).toBe(1);
    });

    it('switching program instance does not buy a second workout', async () => {
      await seedExecution(0);
      await finalize(0);
      // A brand-new instance of another program, freshly activated and active.
      const OTHER_PROGRAM = 'wpg_freesel_other';
      const OTHER_INSTANCE = 'wpi_freesel_other';
      await Promise.all([
        root.collection('workoutPrograms').doc(OTHER_PROGRAM).set({ ...program(), programId: OTHER_PROGRAM }),
        root.collection('programInstances').doc(OTHER_INSTANCE).set({
          programInstanceId: OTHER_INSTANCE, contentIdentity: OTHER_PROGRAM,
          activatedAt: Timestamp.fromDate(new Date(`${today}T00:00:00Z`)), supersededAt: null,
          prescriptionInputSnapshot: { inputs: { trainingDays: [otherWeekday] } },
        }),
        root.collection('workoutProgramState').doc('active').set({ programId: OTHER_PROGRAM }),
        root.collection('workoutLifecycleState').doc('current').set({ activeProgramInstanceId: OTHER_INSTANCE }),
        root.collection('workoutExecutions').doc('exec_other').set({
          ...execution(0), programId: OTHER_PROGRAM, programInstanceId: OTHER_INSTANCE,
        }),
      ]);
      await expect(
        finalizeWorkoutSessionHandler(request(UID, { executionId: 'exec_other' }), db),
      ).rejects.toThrow('workout_daily_limit_reached');
    });

    it('the day is keyed by performedLocalDate in the schedule timezone', async () => {
      // 2026-09-18 23:50 America/Sao_Paulo == 2026-09-19 02:50 UTC. The marker
      // must land on the 18th (local), never the 19th (naive UTC).
      await root.collection('workoutProgramState').doc('scheduleConfig')
        .set({ trainingDays: [otherWeekday], timezone: 'America/Sao_Paulo' });
      await seedExecution(0, {
        scheduledLocalDate: '2026-09-18',
        performedLocalDate: '2026-09-18',
        createdAt: Timestamp.fromDate(new Date('2026-09-19T02:50:00Z')),
      });
      await finalize(0);
      expect(await dailyMarker('2026-09-18')).toMatchObject({ localDate: '2026-09-18' });
      expect(await dailyMarker('2026-09-19')).toBeUndefined();
    });

    it('legacy history with two completions on one day is preserved, not rewritten', async () => {
      // Two pre-existing COMPLETED events for the same day and no marker —
      // exactly what an account from before this rule looks like.
      const events = root.collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleEvents');
      await Promise.all([
        events.doc(`${INSTANCE_ID}_completed_0_2026-05-04`).set({
          type: 'COMPLETED', programInstanceId: INSTANCE_ID, sessionIndex: 0,
          scheduledDate: '2026-05-04', performedLocalDate: '2026-05-04',
        }),
        events.doc(`${INSTANCE_ID}_completed_1_2026-05-04`).set({
          type: 'COMPLETED', programInstanceId: INSTANCE_ID, sessionIndex: 1,
          scheduledDate: '2026-05-04', performedLocalDate: '2026-05-04',
        }),
      ]);
      await seedExecution(2);
      await expect(finalize(2)).resolves.toMatchObject({ status: 'COMPLETED' });
      // Both historical events survive untouched.
      const may4 = await events.where('scheduledDate', '==', '2026-05-04').get();
      expect(may4.size).toBe(2);
      // And no marker was invented for that past day.
      expect(await dailyMarker('2026-05-04')).toBeUndefined();
    });

    it('the transition guard closes a day an older completion left unmarked', async () => {
      // Pre-rule shape: scheduleState says the user trained today, but no
      // marker exists because the old code never wrote one.
      await stateRef().set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID,
        nextSessionIndex: 1, cursorDate: today, lastCompletedAt: today, lastPerformedLocalDate: today,
        pendingMissDecision: null, updatedAt: Timestamp.now(),
      });
      await seedExecution(1);
      await expect(finalize(1)).rejects.toThrow('workout_daily_limit_reached');
    });
  });

  // Adversarial review of the daily limit (post-approval hardening round).
  describe('adversarial — the rejected second attempt must not strand the user', () => {
    const executionStateRef = () => root.collection('workoutExecutionState').doc('current');

    it('leaves the refused execution IN_PROGRESS and the first completion untouched', async () => {
      await seedExecution(0);
      await finalize(0);
      await seedExecution(1);
      await executionStateRef().set({ executionId: execId(1) });
      await expect(finalize(1)).rejects.toThrow('workout_daily_limit_reached');

      // Nothing about the legitimate first workout moved.
      expect((await root.collection('workoutExecutions').doc(execId(0)).get()).data()?.status)
        .toBe('COMPLETED');
      expect(await dailyMarker(today)).toMatchObject({ executionId: execId(0) });
      const events = await root.collection('workoutPrograms').doc(PROGRAM_ID)
        .collection('scheduleEvents').where('type', '==', 'COMPLETED').get();
      expect(events.size).toBe(1);
      // The refused one is merely still open — not terminal, not credited.
      expect((await root.collection('workoutExecutions').doc(execId(1)).get()).data()?.status)
        .toBe('IN_PROGRESS');
    });

    it('the stranded execution can be abandoned, which frees the mutex and credits nothing', async () => {
      await seedExecution(0);
      await finalize(0);
      await seedExecution(1);
      await executionStateRef().set({ executionId: execId(1) });
      await expect(finalize(1)).rejects.toThrow('workout_daily_limit_reached');

      // Same transaction `abandonWorkoutExecution` performs on the client.
      await db.runTransaction(async tx => {
        const ref = root.collection('workoutExecutions').doc(execId(1));
        const [snapshot, pointer] = await Promise.all([tx.get(ref), tx.get(executionStateRef())]);
        if (snapshot.data()?.status === 'IN_PROGRESS') {
          tx.update(ref, { status: 'ABANDONED', finishedAt: Timestamp.now(), updatedAt: Timestamp.now() });
        }
        if (pointer.exists && pointer.get('executionId') === execId(1)) tx.delete(executionStateRef());
      });

      expect((await root.collection('workoutExecutions').doc(execId(1)).get()).data()?.status)
        .toBe('ABANDONED');
      expect((await executionStateRef().get()).exists).toBe(false);
      // The first workout and its claim are still exactly as they were.
      expect(await dailyMarker(today)).toMatchObject({ executionId: execId(0) });
      expect(await state()).toMatchObject({ suggestedSessionIndex: 1, lastPerformedLocalDate: today });
    });

    it('does NOT block the next day: tomorrow finalizes normally after the stranding', async () => {
      await seedExecution(0);
      await finalize(0);
      await seedExecution(1);
      await expect(finalize(1)).rejects.toThrow('workout_daily_limit_reached');

      const tomorrow = new Date(new Date(`${today}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
      await root.collection('workoutExecutions').doc('exec_tomorrow').set({
        ...execution(1),
        scheduledLocalDate: tomorrow,
        performedLocalDate: tomorrow,
        createdAt: Timestamp.fromDate(new Date(`${tomorrow}T12:00:00Z`)),
      });
      await expect(
        finalizeWorkoutSessionHandler(request(UID, { executionId: 'exec_tomorrow' }), db),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
      expect(await dailyMarker(tomorrow)).toMatchObject({ executionId: 'exec_tomorrow' });
    });

    it('resuming the stranded execution the next day stays refused — its own day is spent', async () => {
      await seedExecution(0);
      await finalize(0);
      // The stranded execution still carries YESTERDAY's performed date, so it
      // can never be credited: that day is claimed. It must stay refused
      // rather than silently claim a day it was not performed on.
      await seedExecution(1);
      await expect(finalize(1)).rejects.toThrow('workout_daily_limit_reached');
      await expect(finalize(1)).rejects.toThrow('workout_daily_limit_reached');
      expect((await root.collection(WORKOUT_DAILY_COMPLETIONS_COLLECTION).get()).size).toBe(1);
    });
  });

  describe('adversarial — timezone', () => {
    it('keys the day by the schedule timezone even when the canonical streak zone differs', async () => {
      // Schedule zone UTC-3, streak zone UTC+14 — deliberately divergent.
      await Promise.all([
        root.collection('workoutProgramState').doc('scheduleConfig')
          .set({ trainingDays: [otherWeekday], timezone: 'America/Sao_Paulo' }),
        root.collection('streakSettings').doc('current')
          .set({ timezone: 'Pacific/Kiritimati', schemaVersion: 1, createdAt: Timestamp.now() }),
      ]);
      await seedExecution(0, {
        scheduledLocalDate: '2026-09-18',
        performedLocalDate: '2026-09-18',
        createdAt: Timestamp.fromDate(new Date('2026-09-19T02:50:00Z')),
      });
      await finalize(0);
      // The marker follows the SCHEDULE zone (the 18th), which is the same day
      // the completion itself is keyed by. The streak's own zone is unrelated.
      expect(await dailyMarker('2026-09-18')).toMatchObject({ localDate: '2026-09-18' });
      expect(await dailyMarker('2026-09-19')).toBeUndefined();
    });

    it('a changed schedule timezone cannot unlock a second workout for the SAME claimed day', async () => {
      await seedExecution(0);
      await finalize(0);
      // The user moves their schedule zone after training.
      await root.collection('workoutProgramState').doc('scheduleConfig')
        .set({ trainingDays: [otherWeekday], timezone: 'Pacific/Kiritimati' });
      await seedExecution(1);
      // Either the provenance check or the marker refuses it — never credited.
      await expect(finalize(1)).rejects.toThrow(/workout_daily_limit_reached|invalid_execution_performed_date/);
      expect((await root.collection(WORKOUT_DAILY_COMPLETIONS_COLLECTION).get()).size).toBe(1);
    });
  });

  describe('adversarial — rollout transition without a marker', () => {
    /** A pre-rule completion: credited execution + event, but no marker. */
    async function seedLegacyCompletion(sessionIndex: number, instanceId = INSTANCE_ID) {
      await root.collection('workoutExecutions').doc(`legacy_${sessionIndex}`).set({
        ...execution(sessionIndex), programInstanceId: instanceId, status: 'COMPLETED',
        finishedAt: Timestamp.now(),
      });
    }

    it('refuses a second workout when an earlier one that day left no marker', async () => {
      await seedLegacyCompletion(0);
      await seedExecution(1);
      await expect(finalize(1)).rejects.toThrow('workout_daily_limit_reached');
      expect((await root.collection(WORKOUT_DAILY_COMPLETIONS_COLLECTION).get()).empty).toBe(true);
    });

    it('refuses it across a PROGRAM/INSTANCE switch — the query is program-independent', async () => {
      // Legacy completion on an old instance; the user then switched.
      await seedLegacyCompletion(0, 'wpi_old_instance');
      // The new instance's rotation state is fresh and carries no history.
      await stateRef().set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID,
        nextSessionIndex: 0, suggestedSessionIndex: 0, suggestionVersion: 0, lastSelectedSessionIndex: null,
        cursorDate: today, lastCompletedAt: null, lastPerformedLocalDate: null,
        pendingMissDecision: null, updatedAt: Timestamp.now(),
      });
      await seedExecution(1);
      await expect(finalize(1)).rejects.toThrow('workout_daily_limit_reached');
    });

    it('a PARTIALLY_COMPLETED legacy execution also closes the day', async () => {
      await root.collection('workoutExecutions').doc('legacy_partial').set({
        ...execution(0), status: 'PARTIALLY_COMPLETED', finishedAt: Timestamp.now(),
      });
      await seedExecution(1);
      await expect(finalize(1)).rejects.toThrow('workout_daily_limit_reached');
    });

    it('an ABANDONED legacy execution does NOT close the day', async () => {
      await root.collection('workoutExecutions').doc('legacy_abandoned').set({
        ...execution(0), status: 'ABANDONED', finishedAt: Timestamp.now(),
      });
      await seedExecution(1);
      await expect(finalize(1)).resolves.toMatchObject({ status: 'COMPLETED' });
    });

    it('a credited execution on ANOTHER day does not close today', async () => {
      await root.collection('workoutExecutions').doc('legacy_other_day').set({
        ...execution(0), status: 'COMPLETED', finishedAt: Timestamp.now(),
        scheduledLocalDate: '2026-05-04', performedLocalDate: '2026-05-04',
      });
      await seedExecution(1);
      await expect(finalize(1)).resolves.toMatchObject({ status: 'COMPLETED' });
      expect(await dailyMarker(today)).toMatchObject({ executionId: execId(1) });
    });

    it('the query never mistakes the execution being finalized for a prior one', async () => {
      // Only this execution exists for today; it must not block itself.
      await seedExecution(0);
      await expect(finalize(0)).resolves.toMatchObject({ status: 'COMPLETED' });
    });
  });

  describe('no double advance', () => {
    it('does not advance again when the user had already selected that session', async () => {
      // The user selected B, so the pointer is already on C (version 1).
      await stateRef().set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID,
        nextSessionIndex: 2, suggestedSessionIndex: 2, suggestionVersion: 1, lastSelectedSessionIndex: 1,
        cursorDate: today, lastCompletedAt: null, lastPerformedLocalDate: null,
        pendingMissDecision: null, updatedAt: Timestamp.now(),
      });
      await seedExecution(1, { startedFromSuggestionVersion: 1 });
      await finalize(1);
      const after = await state();
      expect(after).toMatchObject({ suggestedSessionIndex: 2, suggestionVersion: 1, lastSelectedSessionIndex: 1 });
    });

    it('is idempotent across a repeated finalize', async () => {
      await seedExecution(0);
      await finalize(0);
      const first = await state();
      await expect(finalize(0)).resolves.toMatchObject({ status: 'COMPLETED' });
      expect(await state()).toMatchObject({ suggestedSessionIndex: first?.suggestedSessionIndex });
    });

    it('leaves a NEWER selection standing when a late finalize arrives', async () => {
      // Started from version 1, but the user has since selected again (v2).
      await stateRef().set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID,
        nextSessionIndex: 0, suggestedSessionIndex: 0, suggestionVersion: 2, lastSelectedSessionIndex: 2,
        cursorDate: today, lastCompletedAt: null, lastPerformedLocalDate: null,
        pendingMissDecision: null, updatedAt: Timestamp.now(),
      });
      await seedExecution(1, { startedFromSuggestionVersion: 1 });
      // The completion is still fully recorded…
      await expect(finalize(1)).resolves.toMatchObject({ status: 'COMPLETED', scheduleStatus: 'COMPLETED' });
      const event = await root.collection('workoutPrograms').doc(PROGRAM_ID)
        .collection('scheduleEvents').doc(`${INSTANCE_ID}_completed_1_${today}`).get();
      expect(event.exists).toBe(true);
      expect(event.data()).toMatchObject({ type: 'COMPLETED', sessionIndex: 1 });
      // …but the user's newer intent is preserved.
      expect(await state()).toMatchObject({ suggestedSessionIndex: 0, suggestionVersion: 2, lastSelectedSessionIndex: 2 });
    });

    it('advances for a legacy execution that carries no version', async () => {
      await stateRef().set({
        programId: PROGRAM_ID, programInstanceId: INSTANCE_ID,
        nextSessionIndex: 0, cursorDate: today, lastCompletedAt: null,
        pendingMissDecision: null, updatedAt: Timestamp.now(),
      });
      await seedExecution(0);
      await finalize(0);
      expect(await state()).toMatchObject({ suggestedSessionIndex: 1, nextSessionIndex: 1 });
    });
  });

  // Adversarial: every date-shaped block the old model used must be gone,
  // and every provenance guarantee must still be there.
  describe('no residual scheduledLocalDate blocking', () => {
    it('completes a session whose recommended date is in the PAST (late completion)', async () => {
      // The old rule refused `performedLocalDate > scheduledLocalDate` as the
      // tail of the advance window. A recommendation cannot block training.
      await seedExecution(0, { scheduledLocalDate: '2026-01-05' });
      await expect(finalize(0)).resolves.toMatchObject({ status: 'COMPLETED', scheduleStatus: 'COMPLETED' });
      const event = await root.collection('workoutPrograms').doc(PROGRAM_ID)
        .collection('scheduleEvents').doc(`${INSTANCE_ID}_completed_0_2026-01-05`).get();
      // History keeps the recommended date it was started against…
      expect(event.data()).toMatchObject({ scheduledDate: '2026-01-05', performedLocalDate: today });
      // …while the cursor records the day of effort, never a day behind it.
      expect(await state()).toMatchObject({ cursorDate: today, lastCompletedAt: today, lastPerformedLocalDate: today });
    });

    it('completes a session whose recommended date is far in the FUTURE', async () => {
      await seedExecution(1, { scheduledLocalDate: '2099-12-31' });
      await expect(finalize(1)).resolves.toMatchObject({ status: 'COMPLETED' });
      expect(await state()).toMatchObject({ cursorDate: today, suggestedSessionIndex: 2 });
    });

    it('completes several days after the recommended date, many sessions apart', async () => {
      await seedExecution(2, { scheduledLocalDate: '2025-06-01' });
      await expect(finalize(2)).resolves.toMatchObject({ status: 'COMPLETED' });
      expect(await state()).toMatchObject({ suggestedSessionIndex: 0 });
    });

    it('refuses a forged performed date in the FUTURE of the execution’s creation day', async () => {
      await seedExecution(0, { performedLocalDate: '2099-01-01' });
      await expect(finalize(0)).rejects.toThrow('invalid_execution_performed_date');
    });

    it('refuses a forged performed date in the PAST of the execution’s creation day', async () => {
      await seedExecution(0, { performedLocalDate: '2020-01-01' });
      await expect(finalize(0)).rejects.toThrow('invalid_execution_performed_date');
    });

    it('refuses a malformed scheduled or performed date', async () => {
      await seedExecution(0, { scheduledLocalDate: 'not-a-date' });
      await expect(finalize(0)).rejects.toThrow('invalid_execution_performed_date');
    });

    it('refuses an execution with no server-set createdAt at all', async () => {
      await seedExecution(0, { createdAt: null });
      await expect(finalize(0)).rejects.toThrow('invalid_execution_performed_date');
    });

    it('derives the performed day from the schedule timezone, not a naive UTC slice', async () => {
      // 2026-09-18 23:50 America/Sao_Paulo == 2026-09-19 02:50 UTC.
      await root.collection('workoutProgramState').doc('scheduleConfig')
        .set({ trainingDays: [otherWeekday], timezone: 'America/Sao_Paulo' });
      await seedExecution(0, {
        scheduledLocalDate: '2026-09-18',
        performedLocalDate: '2026-09-18',
        createdAt: Timestamp.fromDate(new Date('2026-09-19T02:50:00Z')),
      });
      await expect(finalize(0)).resolves.toMatchObject({ status: 'COMPLETED' });
      expect(await state()).toMatchObject({ cursorDate: '2026-09-18' });
    });
  });

  describe('security did not move with the calendar', () => {
    it('refuses a session index that is not in the program', async () => {
      await seedExecution(7);
      await expect(finalize(7)).rejects.toThrow('execution_does_not_match_authoritative_prescription');
    });

    it('refuses another account’s execution', async () => {
      await seedExecution(0);
      await expect(finalize(0, OTHER_UID)).rejects.toThrow('execution_not_found');
    });

    it('refuses an unauthenticated call', async () => {
      await seedExecution(0);
      await expect(
        finalizeWorkoutSessionHandler(request(null, { executionId: execId(0) }), db),
      ).rejects.toThrow();
    });

    it('refuses a superseded instance', async () => {
      await root.collection('programInstances').doc(INSTANCE_ID)
        .update({ supersededAt: Timestamp.now() });
      await seedExecution(0);
      await expect(finalize(0)).rejects.toThrow('execution_program_not_active');
    });

    it('refuses when the lifecycle pointer names another instance', async () => {
      await root.collection('workoutLifecycleState').doc('current')
        .set({ activeProgramInstanceId: 'wpi_somethingelse' });
      await seedExecution(0);
      await expect(finalize(0)).rejects.toThrow('execution_program_not_active');
    });

    it('refuses a performed date that disagrees with the execution’s creation day', async () => {
      await seedExecution(0, { performedLocalDate: '2026-01-01' });
      await expect(finalize(0)).rejects.toThrow('invalid_execution_performed_date');
    });

    it('ACCEPTS a performed date later than its scheduled date — a recommendation never blocks', async () => {
      // This was a rejection under the advance-window rule. The provenance
      // check still applies (performed == the execution's creation day), and
      // it is satisfied here, so the completion must go through.
      await seedExecution(0, { scheduledLocalDate: '2026-01-01', performedLocalDate: today });
      await expect(finalize(0)).resolves.toMatchObject({ status: 'COMPLETED' });
    });

    it('still writes exactly one COMPLETED event per occurrence', async () => {
      await seedExecution(0);
      await finalize(0);
      await finalize(0);
      const events = await root.collection('workoutPrograms').doc(PROGRAM_ID)
        .collection('scheduleEvents').where('sessionIndex', '==', 0).get();
      expect(events.size).toBe(1);
    });
  });

  /**
   * CONTROLLED PILOT ISOLATION.
   *
   * Everything above runs with `workoutPilotEnrollment/{uid}.enabled == true`.
   * This block removes exactly that one document — nothing else about the
   * account changes — and asserts the callable falls all the way back to the
   * published behaviour. It is the difference between "the new model exists"
   * and "the new model reached only the account that opted into it".
   *
   * `LEGACY_UID` is a second, fully-provisioned account living in the same
   * database as the enrolled one, so the last test can show both outcomes
   * side by side in a single run.
   */
  describe('legacy accounts are untouched', () => {
    const LEGACY_UID = 'freesel-legacy';
    /** Last week's same weekday — the occurrence before today's. */
    const previousOccurrence = new Date(new Date(`${today}T12:00:00Z`).getTime() - 7 * 86400000)
      .toISOString().slice(0, 10);
    const legacyRoot = () => db.collection('users').doc(LEGACY_UID);
    const legacyState = async () => (await legacyRoot().collection('workoutPrograms').doc(PROGRAM_ID)
      .collection('scheduleState').doc(INSTANCE_ID).get()).data();

    /** Same provisioning as the enrolled account, minus the enrolment. */
    async function provisionLegacyAccount(uid: string) {
      const accountRoot = db.collection('users').doc(uid);
      await db.recursiveDelete(accountRoot).catch(() => {});
      await db.collection('workoutPilotEnrollment').doc(uid).delete();
      await Promise.all([
        accountRoot.collection('workoutPrograms').doc(PROGRAM_ID).set(program()),
        accountRoot.collection('programInstances').doc(INSTANCE_ID).set({
          programInstanceId: INSTANCE_ID,
          contentIdentity: PROGRAM_ID,
          activatedAt: Timestamp.fromDate(new Date(`${today}T00:00:00Z`)),
          supersededAt: null,
          prescriptionInputSnapshot: { inputs: { trainingDays: [otherWeekday] } },
        }),
        accountRoot.collection('workoutProgramState').doc('scheduleConfig')
          .set({ trainingDays: [otherWeekday], timezone: 'UTC' }),
        accountRoot.collection('workoutProgramState').doc('active').set({ programId: PROGRAM_ID }),
        accountRoot.collection('workoutLifecycleState').doc('current')
          .set({ activeProgramInstanceId: INSTANCE_ID }),
      ]);
      return accountRoot;
    }

    beforeEach(async () => { await provisionLegacyAccount(LEGACY_UID); });

    it('REFUSES a completion on a day the recommendation never offered', async () => {
      // The headline new-model behaviour ("finalizes on a day the fixed
      // recommendation never offered") must NOT be available here. Today is
      // deliberately not a training day, and the calendar gate is back.
      await legacyRoot().collection('workoutExecutions').doc(execId(0)).set(execution(0));
      await expect(finalize(0, LEGACY_UID)).rejects.toThrow();
    });

    /**
     * Provisions the legacy account so that TODAY is its recommended day and
     * today's occurrence is still PENDING — the only shape in which the
     * published resolver reports `SESSION_READY`. The cursor therefore sits
     * on the previous week's occurrence ("consumed through last week"), not
     * on today: `cursorDate: today` would mean today was already consumed and
     * the resolver would answer REST_DAY. Without this the calendar gate
     * refuses the completion before any write happens, and the write-shape
     * assertions below would pass for the wrong reason.
     */
    async function legacyReadyForToday() {
      await legacyRoot().collection('workoutProgramState').doc('scheduleConfig')
        .set({ trainingDays: [WEEKDAYS[jsDay]], timezone: 'UTC' });
      await legacyRoot().collection('programInstances').doc(INSTANCE_ID).set({
        programInstanceId: INSTANCE_ID,
        contentIdentity: PROGRAM_ID,
        activatedAt: Timestamp.fromDate(new Date(`${previousOccurrence}T00:00:00Z`)),
        supersededAt: null,
        prescriptionInputSnapshot: { inputs: { trainingDays: [WEEKDAYS[jsDay]] } },
      });
      await legacyRoot().collection('workoutPrograms').doc(PROGRAM_ID).set({
        ...program(),
        weeklySchedule: [{ weekday: WEEKDAYS[jsDay], state: 'TRAINING', sessionIndex: 0 }],
      });
      await legacyRoot().collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleState')
        .doc(INSTANCE_ID).set({
          programId: PROGRAM_ID, programInstanceId: INSTANCE_ID, nextSessionIndex: 0,
          cursorDate: previousOccurrence, lastCompletedAt: null, pendingMissDecision: null,
          updatedAt: Timestamp.now(),
        });
      await legacyRoot().collection('workoutExecutions').doc(execId(0)).set(execution(0));
    }

    it('completes normally, and writes no daily-completion marker', async () => {
      // The marker is the daily limit's substrate. A non-enrolled account
      // never opted into that limit, so its day must stay unclaimed — which
      // also means a later enrolment starts from a clean slate.
      await legacyReadyForToday();
      await expect(finalize(0, LEGACY_UID)).resolves.toMatchObject({ status: 'COMPLETED' });
      const marker = await legacyRoot().collection(WORKOUT_DAILY_COMPLETIONS_COLLECTION)
        .doc(today).get();
      expect(marker.exists).toBe(false);
    });

    it('writes the published scheduleState shape — no suggestion fields', async () => {
      await legacyReadyForToday();
      await finalize(0, LEGACY_UID);
      const after = (await legacyState())!;
      expect(after.nextSessionIndex).toBe(1);
      expect(after.cursorDate).toBe(today);
      expect(after.lastPerformedLocalDate).toBe(today);
      // The three fields the new model adds must be absent — both so the
      // account's data shape does not change, and because the PUBLISHED
      // Rules reject a client write carrying them.
      expect(after.suggestedSessionIndex).toBeUndefined();
      expect(after.suggestionVersion).toBeUndefined();
      expect(after.lastSelectedSessionIndex).toBeUndefined();
    });

    it('keeps the cursor on the occurrence consumed, not the day of effort', async () => {
      // `min(performed, scheduled)` vs the new model's bare `performed`. The
      // two agree whenever `performed <= scheduled`, so the discriminating
      // input is a session finished AFTER its recommended date — and for a
      // legacy account that input is not reachable through a completion at
      // all: the resolver diverts it to a missed-session decision first.
      // That refusal IS the legacy behaviour being preserved here.
      await legacyReadyForToday();
      await legacyRoot().collection('workoutPrograms').doc(PROGRAM_ID).collection('scheduleState')
        .doc(INSTANCE_ID).set({
          programId: PROGRAM_ID, programInstanceId: INSTANCE_ID, nextSessionIndex: 0,
          cursorDate: '2026-01-01', lastCompletedAt: null, pendingMissDecision: null,
          updatedAt: Timestamp.now(),
        });
      await legacyRoot().collection('workoutExecutions').doc(execId(0)).set(execution(0, {
        scheduledLocalDate: '2026-01-05',
        performedLocalDate: today,
      }));
      await expect(finalize(0, LEGACY_UID)).rejects.toThrow();
      // And the enrolled account, given the same execution, credits the day
      // of effort — the behaviour difference this whole block isolates.
      await seedExecution(0, { scheduledLocalDate: '2026-01-05', performedLocalDate: today });
      await expect(finalize(0, UID)).resolves.toMatchObject({ status: 'COMPLETED' });
      expect((await state())!.cursorDate).toBe(today);
    });

    it('`enabled: false` is not enrolment, and neither is a truthy non-boolean', async () => {
      for (const value of [false, 'true', 1] as const) {
        await provisionLegacyAccount(LEGACY_UID);
        await db.collection('workoutPilotEnrollment').doc(LEGACY_UID).set({ enabled: value });
        await legacyRoot().collection('workoutExecutions').doc(execId(0)).set(execution(0));
        // Still the calendar gate: the flag was never read as enrolment.
        await expect(finalize(0, LEGACY_UID)).rejects.toThrow();
      }
    });

    it('both accounts in one run: only the enrolled UID gets the new model', async () => {
      // The whole point of the pilot, in a single assertion pair. Identical
      // executions, identical programs, identical non-recommended day — the
      // only difference is the enrolment document.
      await seedExecution(0);
      await legacyRoot().collection('workoutExecutions').doc(execId(0)).set(execution(0));
      await expect(finalize(0, UID)).resolves.toMatchObject({ status: 'COMPLETED' });
      await expect(finalize(0, LEGACY_UID)).rejects.toThrow();
      expect(await dailyMarker(today)).toMatchObject({ executionId: execId(0) });
      expect((await legacyRoot().collection(WORKOUT_DAILY_COMPLETIONS_COLLECTION).doc(today).get()).exists)
        .toBe(false);
    });
  });
});
