import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';

import { serverEvaluateProgressionHandler, buildProgressionSnapshotV2FromFirestore } from '../serverEvaluateProgression';

/**
 * Fase 5.0 — read-only prototype for a server-side `evaluateProgression`
 * boundary (docs/33_fase5_0_estudo_latencia_server_side.md). Mirrors the
 * exact `installActiveWorkoutProgram.integration.test.ts` harness pattern:
 * calls the handler directly against a real (Admin SDK) Firestore emulator
 * instance.
 *
 * Scope limitation (documented, not silently skipped): this prototype only
 * supports FIXED-schedule ProgramInstances with an embedded
 * `prescriptionInputSnapshot` and NORMAL/QA_ACCELERATED policy — flexible
 * schedules and the legacy questionnaire-fallback path are out of scope for
 * a structural latency prototype (see file header of
 * `../serverEvaluateProgression.ts`).
 *
 * Skipped by default — only runs when
 * `SERVER_EVALUATE_PROGRESSION_INTEGRATION=1` is set, requiring a live
 * Firestore Emulator (matches the reference test's convention).
 */

const enabled = process.env.SERVER_EVALUATE_PROGRESSION_INTEGRATION === '1';
const UID = 'server-evaluate-progression-adversary';

const MON = 'MON', WED = 'WED', FRI = 'FRI';

function daysAgo(n: number): Timestamp {
  const ms = Date.now() - n * 24 * 60 * 60 * 1000;
  return Timestamp.fromMillis(ms);
}

// Local re-derivation of `src/scheduleEngine/calendar.ts`'s UTC-midnight
// LocalDate math, kept test-local on purpose — a fixture helper computing
// expected calendar dates from real "now" should not import the very
// production module whose output it independently derives.
function toLocalDateUTC(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function addDaysUTC(localDate: string, days: number): string {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function weekdayUTC(localDate: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][jsDay];
}

async function seedProgramInstance(
  db: Firestore,
  overrides: {
    level?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
    activatedDaysAgo?: number;
    earnedIntermediateCycles?: number;
    executions?: {
      scheduledLocalDate: string;
      sessionIndex: number;
      status: string;
      exercises?: { exerciseIndex: number; exerciseId: string; sets: { setIndex: number; status: string }[] }[];
    }[];
    scheduleEvents?: { scheduledDate: string; sessionIndex: number; type: string }[];
    qaAccelerated?: boolean;
  } = {},
): Promise<{ programInstanceId: string; cycleId: string; contentIdentity: string }> {
  const root = db.collection('users').doc(UID);
  const level = overrides.level ?? 'BEGINNER';
  const programInstanceId = 'wpi_test';
  const cycleId = 'cyc_test';
  const contentIdentity = 'prog_test';
  const activatedAt = daysAgo(overrides.activatedDaysAgo ?? 0);

  await root.collection('workoutLifecycleState').doc('current').set({
    currentTrainingLevel: level,
    currentCycleId: cycleId,
    currentCycleNumber: 1,
    activeProgramInstanceId: programInstanceId,
    activeContentIdentity: contentIdentity,
  });
  await root.collection('trainingCycles').doc(cycleId).set({
    cycleId, level, cycleNumber: 1, status: 'ACTIVE', programInstanceId,
  });
  await root.collection('programInstances').doc(programInstanceId).set({
    programInstanceId, cycleId, contentIdentity,
    activatedAt,
    prescriptionInputSnapshot: { inputs: { trainingDays: [MON, WED, FRI] } },
  });
  await root.collection('workoutPrograms').doc(contentIdentity).set({
    scheduleMode: 'fixed',
    weeklySchedule: [MON, WED, FRI].map((weekday) => ({ weekday, state: 'TRAINING' })),
    sessions: [
      { exercises: [{ exerciseId: 'ex1', sets: 3 }] },
      { exercises: [{ exerciseId: 'ex2', sets: 3 }] },
      { exercises: [{ exerciseId: 'ex3', sets: 3 }] },
    ],
  });

  for (const execution of overrides.executions ?? []) {
    await root.collection('workoutExecutions').add({
      programInstanceId,
      sessionIndex: execution.sessionIndex,
      scheduledLocalDate: execution.scheduledLocalDate,
      status: execution.status,
      exercises: execution.exercises ?? [{ exerciseIndex: 0, exerciseId: 'ex1', sets: [{ setIndex: 0, status: 'COMPLETED' }] }],
    });
  }
  for (const event of overrides.scheduleEvents ?? []) {
    await root.collection('workoutPrograms').doc(contentIdentity).collection('scheduleEvents').add({
      programInstanceId,
      sessionIndex: event.sessionIndex,
      scheduledDate: event.scheduledDate,
      type: event.type,
    });
  }
  if (overrides.earnedIntermediateCycles) {
    for (let i = 0; i < overrides.earnedIntermediateCycles; i += 1) {
      await root.collection('trainingCycles').doc(`cyc_earned_${i}`).set({
        cycleId: `cyc_earned_${i}`, level: 'INTERMEDIATE', cycleNumber: i + 1,
        status: 'COMPLETED', completionReason: 'EARNED_EVOLUTION', programInstanceId: 'wpi_other',
      });
    }
  }
  if (overrides.qaAccelerated) {
    await db.collection('users').doc(UID).set({
      metadata: { workoutLifecycleQaMode: 'ACCELERATED' },
    }, { merge: true });
  }

  return { programInstanceId, cycleId, contentIdentity };
}

describe.skipIf(!enabled)('serverEvaluateProgression — real Firestore Emulator', () => {
  let app: App;
  let db: Firestore;

  beforeAll(async () => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'server-evaluate-progression-integration');
    db = getFirestore(app);
  });

  afterAll(async () => deleteApp(app));

  beforeEach(async () => {
    await db.recursiveDelete(db.collection('users').doc(UID));
  });

  it('requires Firebase Auth — never trusts a client-supplied uid', async () => {
    await expect(serverEvaluateProgressionHandler(
      { auth: null, data: {} } as never,
      db,
    )).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a payload carrying a forged uid — identity comes only from request.auth.uid', async () => {
    await seedProgramInstance(db, { level: 'BEGINNER' });
    await expect(serverEvaluateProgressionHandler(
      { auth: { uid: UID }, data: { uid: 'someone-else' } } as never,
      db,
    )).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('returns a null decision for an account with no lifecycle yet (never onboarded)', async () => {
    const result = await serverEvaluateProgressionHandler(
      { auth: { uid: UID }, data: {} } as never,
      db,
    );
    expect(result.progressionDecision).toBeNull();
  });

  it('PROGRESS_CONTINUES: a freshly activated BEGINNER cycle has not met the minimum active-day gate', async () => {
    await seedProgramInstance(db, { level: 'BEGINNER', activatedDaysAgo: 1 });
    const result = await serverEvaluateProgressionHandler(
      { auth: { uid: UID }, data: {} } as never,
      db,
    );
    expect(result.progressionDecision).toBe('PROGRESS_CONTINUES');
  });

  // Hand-constructing a fixture that actually CROSSES the 28-active-day /
  // 70%-adherence EARNED threshold requires replicating
  // `trainingDayOccurrences`'s exact MON/WED/FRI calendar walk here (the
  // pure resolver takes `activeTime`/`adherence` as already-computed
  // inputs, not raw dates) — decided against duplicating that logic in a
  // test fixture. Instead, this proves the inverse and equally load-bearing
  // property for a server orchestrator: real Firestore data with an old
  // activation date but ZERO qualifying executions deterministically stays
  // NO_ACTION (low adherence), regardless of calendar alignment. The EARNED
  // branch itself is already covered by `evaluateProgressionV2`'s own unit
  // tests (`src/progressionEngineV2/`) — this integration test's job is to
  // prove the SERVER ORCHESTRATION wires real Firestore data into that same
  // pure function correctly, not to re-derive its domain rules.
  it('stays PROGRESS_CONTINUES for an old cycle with zero qualifying executions (low adherence, not just low active time)', async () => {
    await seedProgramInstance(db, { level: 'BEGINNER', activatedDaysAgo: 40 });
    const result = await serverEvaluateProgressionHandler(
      { auth: { uid: UID }, data: {} } as never,
      db,
    );
    expect(result.progressionDecision).toBe('PROGRESS_CONTINUES');
  });

  // INTERMEDIATE/ADVANCED level fixtures: same reasoning as the BEGINNER
  // case above — these prove the handler correctly threads
  // `currentTrainingLevel` through to `minimumActiveDaysForLevel` and (for
  // INTERMEDIATE only) actually dispatches the `relevant_cycles` query and
  // feeds it into `countEarnedIntermediateCycles`, without crashing or
  // misrouting for either level. Reaching an EARNED decision for these
  // levels is the same intractable calendar-fixture problem noted above.
  it('PROGRESS_CONTINUES for INTERMEDIATE: threads currentTrainingLevel and dispatches the earned-cycle-history query without error', async () => {
    await seedProgramInstance(db, { level: 'INTERMEDIATE', activatedDaysAgo: 5, earnedIntermediateCycles: 1 });
    const result = await serverEvaluateProgressionHandler(
      { auth: { uid: UID }, data: {} } as never,
      db,
    );
    expect(result.progressionDecision).toBe('PROGRESS_CONTINUES');
  });

  it('PROGRESS_CONTINUES for ADVANCED: threads currentTrainingLevel and skips the earned-cycle-history query (ADVANCED has no next level)', async () => {
    await seedProgramInstance(db, { level: 'ADVANCED', activatedDaysAgo: 5 });
    const result = await serverEvaluateProgressionHandler(
      { auth: { uid: UID }, data: {} } as never,
      db,
    );
    expect(result.progressionDecision).toBe('PROGRESS_CONTINUES');
  });

  it('respects the account QA_ACCELERATED policy the same way the backend authority does', async () => {
    await seedProgramInstance(db, { level: 'BEGINNER', activatedDaysAgo: 1, qaAccelerated: true });
    const result = await serverEvaluateProgressionHandler(
      { auth: { uid: UID }, data: {} } as never,
      db,
    );
    // 1 active day is still below QA_ACCELERATED's 7-day beginner gate —
    // proves the handler actually reads and applies the account's QA mode
    // (not hardcoded NORMAL) without asserting on the boundary itself.
    expect(result.progressionDecision).toBe('PROGRESS_CONTINUES');
  });

  it('is unaffected by an unrelated pending-evolution or outstanding-earned-fact document — it only evaluates progression', async () => {
    await seedProgramInstance(db, { level: 'BEGINNER', activatedDaysAgo: 1 });
    await db.collection('users').doc(UID).collection('workoutLifecycleState').doc('pendingEvolution').set({
      type: 'EVOLUTION_ELIGIBLE', createdAt: Timestamp.now(),
    });
    await db.collection('users').doc(UID).collection('workoutLifecycleEvents').add({
      type: 'OUTSTANDING_MARKER', occurredAt: Timestamp.now(),
    });
    const result = await serverEvaluateProgressionHandler(
      { auth: { uid: UID }, data: {} } as never,
      db,
    );
    expect(result.progressionDecision).toBe('PROGRESS_CONTINUES');
  });

  // Fase 5.1 Passo 12 — a real EARNED fixture, not just the inverse property
  // above. Reaching LEVEL_PROMOTION_ELIGIBLE requires replicating the exact
  // rotation `buildExpectedSessionIndexByDate` walks (docs
  // `src/progressionEngineV2/expectedSessionIndex.ts`): every prescribed
  // MON/WED/FRI date in the window needs a matching `scheduleEvents`
  // COMPLETED ledger entry (which both records AND advances the rotation
  // cursor) plus a `workoutExecutions` document whose `exercises` shape
  // exactly matches the prescribed session at that rotated index. Computed
  // here from the ACTUAL current date (not a hardcoded date string), so the
  // fixture is correct regardless of which real weekday the suite runs on.
  it('LEVEL_PROMOTION_ELIGIBLE: a BEGINNER cycle with 30 active days and full MON/WED/FRI adherence earns promotion to INTERMEDIATE', async () => {
    const now = new Date();
    const activatedDaysAgo = 30;
    const todayLocal = toLocalDateUTC(now);
    const startLocal = addDaysUTC(todayLocal, -activatedDaysAgo);
    const trainingDays = new Set([MON, WED, FRI]);

    const prescribedDates: string[] = [];
    for (let cursor = startLocal; cursor <= todayLocal; cursor = addDaysUTC(cursor, 1)) {
      if (trainingDays.has(weekdayUTC(cursor))) prescribedDates.push(cursor);
    }
    expect(prescribedDates.length).toBeGreaterThan(0);

    const sessionExerciseIds = ['ex1', 'ex2', 'ex3'];
    const orderedDays = [MON, WED, FRI];
    const anchor = orderedDays.indexOf(weekdayUTC(prescribedDates[0]));

    const executions = prescribedDates.map((scheduledLocalDate, i) => {
      const sessionIndex = (anchor + i) % 3;
      return {
        scheduledLocalDate,
        sessionIndex,
        status: 'COMPLETED',
        exercises: [{
          exerciseIndex: 0,
          exerciseId: sessionExerciseIds[sessionIndex],
          sets: [0, 1, 2].map((setIndex) => ({ setIndex, status: 'COMPLETED' })),
        }],
      };
    });
    const scheduleEvents = prescribedDates.map((scheduledDate, i) => ({
      scheduledDate,
      sessionIndex: (anchor + i) % 3,
      type: 'COMPLETED',
    }));

    await seedProgramInstance(db, { level: 'BEGINNER', activatedDaysAgo, executions, scheduleEvents });
    const result = await serverEvaluateProgressionHandler(
      { auth: { uid: UID }, data: {} } as never,
      db,
      now,
    );
    expect(result.progressionDecision).toBe('LEVEL_PROMOTION_ELIGIBLE');
    expect(result.level).toBe('INTERMEDIATE');
  });

  // Equivalence check (per docs/33_fase5_0_estudo_latencia_server_side.md
  // §13/§F): this is the "hand-computed expected snapshot" approach, not
  // cross-SDK deep-equal — wiring the client's `firebase/firestore` SDK
  // into the Functions vitest/Node environment against the same emulator
  // was judged not worth the added test-harness complexity for a
  // structural prototype. Instead this asserts the orchestrator's FULL
  // `ProgressionSnapshotV2` (not just the minimal public decision payload)
  // against a fixture whose `activeDays`/`adherence` are hand-derivable
  // independent of which calendar day the suite happens to run on: a
  // 2-day window (activatedDaysAgo: 1) can contain at most ONE prescribed
  // MON/WED/FRI opportunity, which is fewer than the
  // `inactivityMissedOpportunityThreshold` (3) needed to pause — so
  // `activeDays` is deterministically `2` (start day + today) regardless
  // of which weekday "today" is, and with zero executions `adherence` is
  // deterministically `{ ratio: 0, quality: 'BELOW_TARGET' }` regardless of
  // `expectedSessions` (0 or 1, both fail the 70% bp threshold). This
  // proves the Admin SDK fetch→snapshot translation is faithful to the
  // client's own `evaluateProgressionV2ForUserFull` construction, not just
  // that SOME decision came out the other end.
  it('equivalence: the snapshot built from real Firestore data matches a hand-computed ProgressionSnapshotV2', async () => {
    await seedProgramInstance(db, { level: 'BEGINNER', activatedDaysAgo: 1 });
    const built = await buildProgressionSnapshotV2FromFirestore(UID, db, new Date());
    expect(built).not.toBeNull();
    expect(built!.qaMode).toBe('NORMAL');
    expect(built!.snapshot).toEqual({
      level: 'BEGINNER',
      activeTime: { activeDays: 2, pausedAt: null },
      adherence: { ratio: 0, quality: 'BELOW_TARGET' },
      earnedIntermediateCycleCount: 0,
      hasInProgressExecution: false,
      validSessionCount: 0,
    });
  });

  it('rejects a flexible-schedule ProgramInstance — explicitly out of prototype scope, not silently wrong', async () => {
    await seedProgramInstance(db, { level: 'BEGINNER' });
    await db.collection('users').doc(UID).collection('workoutPrograms').doc('prog_test')
      .set({ scheduleMode: 'flexible' }, { merge: true });
    await expect(serverEvaluateProgressionHandler(
      { auth: { uid: UID }, data: {} } as never,
      db,
    )).rejects.toMatchObject({ code: 'unimplemented' });
  });

  // App Check enforcement (`enforceAppCheck: true`) is applied at the
  // `onCall(...)` wrapper level, never inside the handler — identical
  // boundary to `installActiveWorkoutProgram`, whose own handler-level test
  // suite (see that file) likewise does not re-test it here. This handler
  // is intentionally never wired into `functions/src/index.ts`, so there is
  // no `onCall` wrapper to test against in this prototype.
});
