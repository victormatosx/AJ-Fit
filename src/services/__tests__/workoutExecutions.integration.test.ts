/**
 * OPT-IN integration proof against the REAL Firestore Emulator — same
 * pattern as `questionnaireLoad.integration.test.ts`. Imports the actual,
 * unmodified service functions from `../workoutExecutions.ts` and
 * `../workoutSchedule.ts` and runs them against the Emulator with the real
 * `firestore.rules` enforced, proving idempotency/resume/schedule-integration
 * behavior on the real transactional code path — not a reimplementation of it.
 *
 * Skipped by default — only runs when `WORKOUT_EXECUTION_INTEGRATION=1` is
 * set (see the `test:integration:workoutExecution` npm script).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

import {
  abandonWorkoutExecution,
  activeExecutionId,
  finishWorkoutExecution,
  listExecutionsForProgram,
  listRecentWorkoutExecutions,
  loadActiveExecutionPointer,
  loadWorkoutExecution,
  recordSetExecution,
  skipExerciseExecution,
  skipSetExecution,
  startOrResumeWorkoutExecution,
  WorkoutExecutionConflictError,
  WorkoutExecutionLegacyPendingError,
} from '../workoutExecutions';
import { resolveWorkoutSessionRecoveryState } from '../../workoutExecution/useWorkoutSessionRecovery';
import {
  computeWorkoutElapsedSeconds,
  formatWorkoutSessionDuration,
  isLongWorkoutSession,
  safeStartedAtMs,
} from '../../lib/workoutSessionTimer';
import { completeScheduledSession } from '../workoutSchedule';
import { resolveWorkoutSchedule } from '../../scheduleEngine/resolver';
import type { WorkoutProgramSnapshot } from '../workoutPrograms';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';

const enabled = process.env.WORKOUT_EXECUTION_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({
  get db() {
    return mocks.db;
  },
}));

function program(overrides: Partial<WorkoutProgramSnapshot> = {}): WorkoutProgramSnapshot {
  return {
    programId: 'wpg_test1',
    prescriptionId: 'plan_1',
    templateId: 'T003',
    templateVersion: 1,
    templateSourceVersion: '1.3.0',
    templateContentHash: 'a'.repeat(64),
    questionnaireId: 'q1',
    questionnaireVersion: 1,
    status: 'active',
    source: 'onboarding',
    requestedDays: 4,
    prescribedStructuredDays: 4,
    population: 'male',
    environment: 'gym',
    goalFamily: 'hypertrophy',
    split: 'ABCD',
    planId: 'plan_1',
    sessions: [
      {
        name: 'A',
        type: 'strength',
        exercises: [
          { exerciseId: 'bench_press', sourceExerciseId: 'bench_press', sets: 3, reps: '8-12' },
          { exerciseId: 'plank', sourceExerciseId: 'plank', duration: '30s', cycles: 2 },
        ],
      },
      { name: 'B', type: 'strength', exercises: [{ exerciseId: 'squat', sourceExerciseId: 'squat', sets: 3, reps: '8-12' }] },
    ],
    versions: {
      templateLibrary: '1.3.0',
      selectionEngine: '1.0.0',
      safetyRules: '1.0.0',
      modifierRules: '2.0.0',
      compositionEngine: '2.0.0',
    },
    trace: { safety: { status: 'CLEAR' }, unresolvedModifiers: [] } as unknown as WorkoutProgramSnapshot['trace'],
    createdAt: null,
    activatedAt: null,
    updatedAt: null,
    ...overrides,
  } as WorkoutProgramSnapshot;
}

function scheduleStateDoc(overrides: Record<string, unknown> = {}) {
  return {
    programId: 'wpg_test1',
    nextSessionIndex: 0,
    cursorDate: '2026-08-24',
    lastCompletedAt: null,
    pendingMissDecision: null,
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

describe.skipIf(!enabled)('Workout Execution & History — real Firestore Emulator integration', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
    });
    mocks.db = testEnv.authenticatedContext(UID, { email: 'alice@example.com', email_verified: true }).firestore();
  });

  afterAll(async () => testEnv.cleanup());

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users', UID), {
        profile: { name: 'Alice', email: 'alice@example.com' },
        preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
        subscription: {},
        metadata: { role: 'user', createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
      });
      await setDoc(doc(db, 'users', UID, 'workoutPrograms', 'wpg_test1'), { programId: 'wpg_test1', status: 'active' });
    });
  });

  it('§78 SESSION_READY(A) → start → IN_PROGRESS, with the session snapshot materialized', async () => {
    const result = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.sessionName).toBe('A');
    expect(result.exercises).toHaveLength(2);
    expect(result.exercises[0].sets).toHaveLength(3); // sets: 3
    expect(result.exercises[1].sets).toHaveLength(1); // duration/cycles exercise, no `sets` -> 1
  });

  it('§79 double start (double tap / retry) lands on the same execution, never a duplicate', async () => {
    const a = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    const b = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    expect(a.executionId).toBe(b.executionId);
    const recent = await listRecentWorkoutExecutions(UID, 20); // both are still IN_PROGRESS -> not in "recent" (terminal-only), just confirm no crash/duplication path
    expect(recent).toHaveLength(0);
  });

  it('§80/§89 resume / cold start: data persisted before a "reload" survives a second start() call', async () => {
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    await recordSetExecution({ uid: UID, executionId: started.executionId, exerciseIndex: 0, setIndex: 0, actualReps: 10, weightKg: 30 });

    // Simulate the app being killed and reopened: a fresh `start()` call is
    // the only thing the cold-started app has to go on.
    const resumed = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    expect(resumed.executionId).toBe(started.executionId);
    expect(resumed.status).toBe('IN_PROGRESS');
    expect(resumed.exercises[0].sets[0]).toMatchObject({ status: 'COMPLETED', actualReps: 10, weightKg: 30 });
    // Duration audit: `startedAt` is the session-timer's canonical source
    // (`useWorkoutExecution().workoutStartedAtMs`, WorkoutScreen elapsed
    // calculation) — a resumed execution must never get a fresh timestamp,
    // or a cold-start reopen would silently reset the visible duration to
    // zero.
    expect(resumed.startedAt.toMillis()).toBe(started.startedAt.toMillis());
  });

  it('§81/§82 each set reproduces exactly what was actually done, independent per-set loads — prescription (3x10) untouched', async () => {
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    await recordSetExecution({ uid: UID, executionId: started.executionId, exerciseIndex: 0, setIndex: 0, actualReps: 10, weightKg: 30 });
    await recordSetExecution({ uid: UID, executionId: started.executionId, exerciseIndex: 0, setIndex: 1, actualReps: 10, weightKg: 35 });
    await recordSetExecution({ uid: UID, executionId: started.executionId, exerciseIndex: 0, setIndex: 2, actualReps: 8, weightKg: 35 });

    const loaded = await loadWorkoutExecution(UID, started.executionId);
    expect(loaded?.exercises[0].sets.map((s) => [s.actualReps, s.weightKg])).toEqual([[10, 30], [10, 35], [8, 35]]);
    expect(loaded?.exercises[0].prescribedSets).toBe(3);
    expect(loaded?.exercises[0].prescribedReps).toBe('8-12');
  });

  it('§83 a skipped set is SKIPPED, never a falsely-completed 0-rep set', async () => {
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    await skipSetExecution({ uid: UID, executionId: started.executionId, exerciseIndex: 0, setIndex: 1 });
    const loaded = await loadWorkoutExecution(UID, started.executionId);
    expect(loaded?.exercises[0].sets[1]).toMatchObject({ status: 'SKIPPED', actualReps: null, weightKg: null });
  });

  it('§84 skipping an exercise skips its remaining pending sets, leaving already-logged sets untouched', async () => {
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    await recordSetExecution({ uid: UID, executionId: started.executionId, exerciseIndex: 0, setIndex: 0, actualReps: 10, weightKg: 30 });
    await skipExerciseExecution({ uid: UID, executionId: started.executionId, exerciseIndex: 0 });
    const loaded = await loadWorkoutExecution(UID, started.executionId);
    expect(loaded?.exercises[0].sets[0]).toMatchObject({ status: 'COMPLETED', actualReps: 10, weightKg: 30 });
    expect(loaded?.exercises[0].sets[1].status).toBe('SKIPPED');
    expect(loaded?.exercises[0].sets[2].status).toBe('SKIPPED');
  });

  it('§85 fully completed session finishes COMPLETED, and the Schedule Engine advances by exactly one session', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutPrograms', 'wpg_test1', 'scheduleState', 'current'), scheduleStateDoc());
    });
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    for (let exerciseIndex = 0; exerciseIndex < 2; exerciseIndex++) {
      const setCount = exerciseIndex === 0 ? 3 : 1;
      for (let setIndex = 0; setIndex < setCount; setIndex++) {
        await recordSetExecution({ uid: UID, executionId: started.executionId, exerciseIndex, setIndex, actualReps: 10, weightKg: 30 });
      }
    }
    const finish = await finishWorkoutExecution(UID, started.executionId);
    expect(finish.status).toBe('COMPLETED');
    await completeScheduledSession({ uid: UID, programId: 'wpg_test1', sessionIndex: 0, sessionCount: 2, scheduledLocalDate: '2026-08-25', trainingDays: ['MON', 'TUE'], activatedAtLocalDate: '2026-08-24' });
    const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', 'wpg_test1', 'scheduleState', 'current'));
    expect(state.data()?.nextSessionIndex).toBe(1);
  });

  it('§86 an early-finished, incomplete session is PARTIALLY_COMPLETED, and still advances the Schedule by one session', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutPrograms', 'wpg_test1', 'scheduleState', 'current'), scheduleStateDoc());
    });
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    await recordSetExecution({ uid: UID, executionId: started.executionId, exerciseIndex: 0, setIndex: 0, actualReps: 10, weightKg: 30 });
    const finish = await finishWorkoutExecution(UID, started.executionId);
    expect(finish.status).toBe('PARTIALLY_COMPLETED');
    const loaded = await loadWorkoutExecution(UID, started.executionId);
    expect(loaded?.exercises[0].sets[1].status).toBe('SKIPPED'); // swept
    await completeScheduledSession({ uid: UID, programId: 'wpg_test1', sessionIndex: 0, sessionCount: 2, scheduledLocalDate: '2026-08-25', trainingDays: ['MON', 'TUE'], activatedAtLocalDate: '2026-08-24' });
    const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', 'wpg_test1', 'scheduleState', 'current'));
    expect(state.data()?.nextSessionIndex).toBe(1);
  });

  it('§87 abandoning never advances the Schedule — nextSessionIndex stays put', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutPrograms', 'wpg_test1', 'scheduleState', 'current'), scheduleStateDoc());
    });
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    await abandonWorkoutExecution(UID, started.executionId);
    const loaded = await loadWorkoutExecution(UID, started.executionId);
    expect(loaded?.status).toBe('ABANDONED');
    const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', 'wpg_test1', 'scheduleState', 'current'));
    expect(state.data()?.nextSessionIndex).toBe(0); // untouched
  });

  it('§88 double finish is idempotent — the second call is a no-op, and a doubled completion call never double-advances the Schedule', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutPrograms', 'wpg_test1', 'scheduleState', 'current'), scheduleStateDoc());
    });
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    const first = await finishWorkoutExecution(UID, started.executionId);
    const second = await finishWorkoutExecution(UID, started.executionId); // double tap
    expect(first.status).toBe(second.status);

    await completeScheduledSession({ uid: UID, programId: 'wpg_test1', sessionIndex: 0, sessionCount: 2, scheduledLocalDate: '2026-08-25', trainingDays: ['MON', 'TUE'], activatedAtLocalDate: '2026-08-24' });
    await completeScheduledSession({ uid: UID, programId: 'wpg_test1', sessionIndex: 0, sessionCount: 2, scheduledLocalDate: '2026-08-25', trainingDays: ['MON', 'TUE'], activatedAtLocalDate: '2026-08-24' }); // double tap
    const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', 'wpg_test1', 'scheduleState', 'current'));
    expect(state.data()?.nextSessionIndex).toBe(1); // advanced exactly once, not twice
  });

  describe('SESSION_INDEX_OUT_OF_SEQUENCE regression — first completion, no ScheduleState yet', () => {
    // Real production data (docs — QA account KVBSbHQ8RPMqVBrsyTicjkXgP6l2):
    // trainingDays=[MON,TUE,WED,THU], ProgramInstance activated on a
    // Thursday, first prescribed session anchored to index 3 ("Lower B").
    // The old `current?.nextSessionIndex ?? 0` fallback rejected the
    // legitimate first completion of session 3 as out-of-sequence — the
    // Schedule Engine's own anchor (`anchorSessionIndex`/
    // `initialSessionIndexFor`) must be consulted instead of a hardcoded 0.
    const FOUR_DAY_TRAINING_DAYS = ['MON', 'TUE', 'WED', 'THU'] as const;

    it('accepts the real first session (Thursday activation, sessionIndex 3) that the old fallback rejected', async () => {
      await completeScheduledSession({
        uid: UID, programId: 'wpg_test1', sessionIndex: 3, sessionCount: 4,
        scheduledLocalDate: '2026-09-03', // Thursday
        trainingDays: FOUR_DAY_TRAINING_DAYS, activatedAtLocalDate: '2026-09-03',
      });
      const event = await getDoc(doc(
        mocks.db as never, 'users', UID, 'workoutPrograms', 'wpg_test1', 'scheduleEvents', 'completed_3_2026-09-03',
      ));
      expect(event.exists()).toBe(true);
      const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', 'wpg_test1', 'scheduleState', 'current'));
      expect(state.data()).toMatchObject({ nextSessionIndex: 0, cursorDate: '2026-09-03', lastCompletedAt: '2026-09-03' }); // wraps 3 -> 0

      // The resolver must never re-offer session 3 for that same date again.
      const resolution = resolveWorkoutSchedule({
        hasActiveProgram: true,
        sessionCount: 4,
        config: { trainingDays: [...FOUR_DAY_TRAINING_DAYS], timezone: 'America/Sao_Paulo', scheduleVersion: 1 },
        state: {
          nextSessionIndex: state.data()!.nextSessionIndex,
          cursorDate: state.data()!.cursorDate,
          lastCompletedAt: state.data()!.lastCompletedAt,
          pendingMissDecision: null,
        },
        activatedAtLocalDate: '2026-09-03',
        todayLocalDate: '2026-09-03',
      });
      expect(resolution.status).toBe('TODAY_COMPLETED');
    });

    it.each([
      ['MON', 0], ['TUE', 1], ['WED', 2], ['THU', 3],
    ] as const)('activation on %s anchors the first completion to session %i', async (weekdayLabel, expectedIndex) => {
      const dateByWeekday: Record<string, string> = {
        MON: '2026-08-31', TUE: '2026-09-01', WED: '2026-09-02', THU: '2026-09-03',
      };
      const scheduledLocalDate = dateByWeekday[weekdayLabel];
      await completeScheduledSession({
        uid: UID, programId: 'wpg_test1', sessionIndex: expectedIndex, sessionCount: 4,
        scheduledLocalDate, trainingDays: FOUR_DAY_TRAINING_DAYS, activatedAtLocalDate: scheduledLocalDate,
      });
      const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', 'wpg_test1', 'scheduleState', 'current'));
      expect(state.data()?.nextSessionIndex).toBe((expectedIndex + 1) % 4);
    });

    it('still rejects a genuinely wrong first sessionIndex (0 sent when the anchor requires 3)', async () => {
      await expect(completeScheduledSession({
        uid: UID, programId: 'wpg_test1', sessionIndex: 0, sessionCount: 4,
        scheduledLocalDate: '2026-09-03', // Thursday — anchors to 3, not 0
        trainingDays: FOUR_DAY_TRAINING_DAYS, activatedAtLocalDate: '2026-09-03',
      })).rejects.toThrow('SESSION_INDEX_OUT_OF_SEQUENCE');
      const event = await getDoc(doc(
        mocks.db as never, 'users', UID, 'workoutPrograms', 'wpg_test1', 'scheduleEvents', 'completed_0_2026-09-03',
      ));
      expect(event.exists()).toBe(false);
    });

    it('once ScheduleState exists, current.nextSessionIndex is authoritative again — the anchor is never recomputed', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutPrograms', 'wpg_test1', 'scheduleState', 'current'), {
          programId: 'wpg_test1', nextSessionIndex: 1, cursorDate: '2026-09-03', lastCompletedAt: '2026-09-03', pendingMissDecision: null, updatedAt: Timestamp.now(),
        });
      });
      // Anchor for Thursday would be 3 — but state says 1 is next, and that must win.
      await expect(completeScheduledSession({
        uid: UID, programId: 'wpg_test1', sessionIndex: 3, sessionCount: 4,
        scheduledLocalDate: '2026-09-10', trainingDays: FOUR_DAY_TRAINING_DAYS, activatedAtLocalDate: '2026-09-03',
      })).rejects.toThrow('SESSION_INDEX_OUT_OF_SEQUENCE');
      await completeScheduledSession({
        uid: UID, programId: 'wpg_test1', sessionIndex: 1, sessionCount: 4,
        scheduledLocalDate: '2026-09-10', trainingDays: FOUR_DAY_TRAINING_DAYS, activatedAtLocalDate: '2026-09-03',
      });
      const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', 'wpg_test1', 'scheduleState', 'current'));
      expect(state.data()?.nextSessionIndex).toBe(2);
    });
  });

  it('§90/§91 execution operations never touch the Program Snapshot or its template', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutPrograms', 'wpg_test1'), program());
    });
    const before = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', 'wpg_test1'));
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    await recordSetExecution({ uid: UID, executionId: started.executionId, exerciseIndex: 0, setIndex: 0, actualReps: 10, weightKg: 30 });
    await finishWorkoutExecution(UID, started.executionId);
    const after = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', 'wpg_test1'));
    expect(after.data()).toEqual(before.data());
  });

  it('§92/§93 history spans superseded programs and lists newest-scheduled-date first', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutPrograms', 'wpg_old'), { programId: 'wpg_old', status: 'superseded' });
    });
    const oldExec = await startOrResumeWorkoutExecution({ uid: UID, program: program({ programId: 'wpg_old' }), sessionIndex: 0, scheduledLocalDate: '2026-08-01' });
    await finishWorkoutExecution(UID, oldExec.executionId);
    const newExec = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    await finishWorkoutExecution(UID, newExec.executionId);

    const recent = await listRecentWorkoutExecutions(UID, 20);
    expect(recent.map((e) => e.programId)).toEqual(['wpg_test1', 'wpg_old']); // newest scheduledLocalDate first
  });

  it('§95 refuses to start an execution against a program that does not belong to this user (no such doc under this uid)', async () => {
    await expect(
      startOrResumeWorkoutExecution({ uid: UID, program: program({ programId: 'wpg_nonexistent' }), sessionIndex: 0, scheduledLocalDate: '2026-08-25' }),
    ).rejects.toThrow();
  });

  it('§98 non-rep (duration/cycles) exercises materialize exactly one set and can record a duration instead of reps', async () => {
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    expect(started.exercises[1]).toMatchObject({ exerciseId: 'plank', prescribedDuration: '30s', prescribedCycles: 2 });
    await recordSetExecution({ uid: UID, executionId: started.executionId, exerciseIndex: 1, setIndex: 0, actualDurationSeconds: 28 });
    const loaded = await loadWorkoutExecution(UID, started.executionId);
    expect(loaded?.exercises[1].sets[0]).toMatchObject({ status: 'COMPLETED', actualDurationSeconds: 28, actualReps: null });
  });

  it('an execution ID is deterministic for the same (programId, sessionIndex, scheduledLocalDate)', () => {
    expect(activeExecutionId('wpg_test1', 0, '2026-08-25')).toBe(activeExecutionId('wpg_test1', 0, '2026-08-25'));
  });

  it('a finished session cannot be silently reopened by start() — throws instead of resuming', async () => {
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    await finishWorkoutExecution(UID, started.executionId);
    await expect(
      startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' }),
    ).rejects.toThrow('SESSION_ALREADY_FINISHED');
  });

  it('an abandoned session CAN be restarted fresh, discarding the abandoned attempt’s data', async () => {
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    await recordSetExecution({ uid: UID, executionId: started.executionId, exerciseIndex: 0, setIndex: 0, actualReps: 10, weightKg: 30 });
    await abandonWorkoutExecution(UID, started.executionId);

    const restarted = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    expect(restarted.status).toBe('IN_PROGRESS');
    expect(restarted.exercises[0].sets[0]).toMatchObject({ status: 'PENDING', actualReps: null, weightKg: null });
  });

  // ── P0 integrity fix (2026-09) — workoutExecutionState/current mutex ────

  it('P0: start creates the workoutExecutionState/current pointer alongside the execution', async () => {
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutExecutionState', 'current'));
    expect(state.exists()).toBe(true);
    expect(state.data()).toMatchObject({
      executionId: started.executionId,
      programId: 'wpg_test1',
      sessionIndex: 0,
      scheduledLocalDate: '2026-08-25',
      status: 'IN_PROGRESS',
    });
  });

  it('P0: finish clears the current pointer atomically with terminalizing the execution', async () => {
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    await finishWorkoutExecution(UID, started.executionId);
    const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutExecutionState', 'current'));
    expect(state.exists()).toBe(false);
  });

  it('P0: abandon clears the current pointer atomically with terminalizing the execution', async () => {
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    await abandonWorkoutExecution(UID, started.executionId);
    const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutExecutionState', 'current'));
    expect(state.exists()).toBe(false);
  });

  // ── Workout Recovery / Resume após process death ─────────────────────

  it('recovery: loadActiveExecutionPointer returns null with no pointer, and the exact pointer fields once one exists', async () => {
    expect(await loadActiveExecutionPointer(UID)).toBeNull();
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    const pointer = await loadActiveExecutionPointer(UID);
    expect(pointer).toMatchObject({
      executionId: started.executionId,
      programId: 'wpg_test1',
      sessionIndex: 0,
      scheduledLocalDate: '2026-08-25',
      status: 'IN_PROGRESS',
    });
  });

  it('recovery: resolveWorkoutSessionRecoveryState is `none` with no pointer, `pending` with the matching execution once one exists', async () => {
    expect(await resolveWorkoutSessionRecoveryState(UID)).toEqual({ status: 'none' });
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    const state = await resolveWorkoutSessionRecoveryState(UID);
    expect(state.status).toBe('pending');
    if (state.status === 'pending') {
      expect(state.execution.executionId).toBe(started.executionId);
      expect(state.execution.status).toBe('IN_PROGRESS');
      // The exact instant the mutex was created — never a fresh one; resume
      // must never look like a restart (docs §9 timer, §13).
      expect(state.execution.startedAt.toMillis()).toBe(started.startedAt.toMillis());
    }
  });

  it('recovery: current → an execution that already finished (e.g. another device) is `inconsistent`/EXECUTION_TERMINAL, and safely self-heals via abandon without touching the terminal record', async () => {
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    // Every prescribed set actually recorded (3x bench_press + 1x plank,
    // mirroring §85's fixture) — a normal, fully-completed session, so
    // finish() legitimately produces COMPLETED here (deriveFinishStatus:
    // COMPLETED only if every set in every exercise was actually COMPLETED;
    // any PENDING set swept to SKIPPED at finish would instead make this
    // PARTIALLY_COMPLETED — a real, correct outcome this same self-heal must
    // equally never disturb, which is why every assertion below compares
    // against `finish.status` rather than a hardcoded literal).
    for (let exerciseIndex = 0; exerciseIndex < 2; exerciseIndex += 1) {
      const setCount = exerciseIndex === 0 ? 3 : 1;
      for (let setIndex = 0; setIndex < setCount; setIndex += 1) {
        await recordSetExecution({ uid: UID, executionId: started.executionId, exerciseIndex, setIndex, actualReps: 10, weightKg: 30 });
      }
    }
    const finish = await finishWorkoutExecution(UID, started.executionId);
    expect(finish.status).toBe('COMPLETED');
    const beforeSelfHeal = await loadWorkoutExecution(UID, started.executionId);
    expect(beforeSelfHeal?.status).toBe(finish.status);

    // Simulate a dangling pointer left behind after the execution finished
    // (e.g. a partial/racing write) — write it back directly, bypassing the
    // normal atomic finish transaction, purely to exercise the fail-safe path.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutExecutionState', 'current'), {
        executionId: started.executionId, programId: 'wpg_test1', programInstanceId: null,
        sessionIndex: 0, scheduledLocalDate: '2026-08-25', status: 'IN_PROGRESS', schemaVersion: 1,
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    });
    const state = await resolveWorkoutSessionRecoveryState(UID);
    expect(state.status).toBe('inconsistent');
    if (state.status === 'inconsistent') expect(state.reason).toBe('EXECUTION_TERMINAL');

    // Self-heal: Rules allow clearing `current` once the execution it names
    // is non-IN_PROGRESS — abandon() only clears the pointer here, it never
    // rewrites the already-terminal record (docs §11/§12).
    await abandonWorkoutExecution(UID, started.executionId);
    expect(await loadActiveExecutionPointer(UID)).toBeNull();
    const reloaded = await loadWorkoutExecution(UID, started.executionId);
    expect(reloaded?.status).toBe(finish.status);
    expect(reloaded?.finishedAt?.toMillis()).toBe(beforeSelfHeal?.finishedAt?.toMillis());
    expect(reloaded?.exercises).toEqual(beforeSelfHeal?.exercises);
  });

  it('recovery: current → a nonexistent execution is `inconsistent`/EXECUTION_MISSING, and abandon() is a safe no-op (Rules cannot authorize deleting a pointer with no execution to check) rather than throwing or corrupting anything', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutExecutionState', 'current'), {
        executionId: 'exec_does_not_exist', programId: 'wpg_test1', programInstanceId: null,
        sessionIndex: 0, scheduledLocalDate: '2026-08-25', status: 'IN_PROGRESS', schemaVersion: 1,
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    });
    const state = await resolveWorkoutSessionRecoveryState(UID);
    expect(state.status).toBe('inconsistent');
    if (state.status === 'inconsistent') {
      expect(state.reason).toBe('EXECUTION_MISSING');
      expect(state.execution).toBeNull();
    }
    // Documented limitation (docs §12): this specific case cannot self-heal
    // client-side under the current Rules (deleting `current` requires
    // reading the execution it names, which doesn't exist here) — the call
    // must not throw or otherwise crash the recovery flow, it just leaves
    // the dangling pointer in place.
    await expect(abandonWorkoutExecution(UID, 'exec_does_not_exist')).resolves.toBeUndefined();
    const pointer = await loadActiveExecutionPointer(UID);
    expect(pointer?.executionId).toBe('exec_does_not_exist');
  });

  it('recovery: logout/login — one account\'s pending execution never surfaces for a different uid', async () => {
    await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    const bobDb = testEnv.authenticatedContext('bob', { email: 'bob@example.com', email_verified: true }).firestore();
    const originalDb = mocks.db;
    mocks.db = bobDb;
    try {
      expect(await resolveWorkoutSessionRecoveryState('bob')).toEqual({ status: 'none' });
      expect(await loadActiveExecutionPointer('bob')).toBeNull();
    } finally {
      mocks.db = originalDb;
    }
    // Alice's own pointer is completely unaffected by Bob's session.
    const aliceState = await resolveWorkoutSessionRecoveryState(UID);
    expect(aliceState.status).toBe('pending');
  });

  it('recovery: long-session alert — a real, Firestore-loaded execution backdated 5h12 is still `pending`/recoverable, and its OWN startedAt (no second source of truth) drives the long-session math', async () => {
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    await recordSetExecution({ uid: UID, executionId: started.executionId, exerciseIndex: 0, setIndex: 0, actualReps: 10, weightKg: 32.5 });
    await skipSetExecution({ uid: UID, executionId: started.executionId, exerciseIndex: 0, setIndex: 1 });

    const FIVE_H_12_MIN_MS = (5 * 60 + 12) * 60_000;
    const backdatedStartedAt = Timestamp.fromMillis(Date.now() - FIVE_H_12_MIN_MS);
    // Only `startedAt` is backdated directly (bypassing Rules purely for this
    // fixture) — everything else about the execution is untouched, so this
    // proves the long-session math reads the SAME field the mutex/hydration
    // already treat as authoritative, not a second, separately-tracked value.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'users', UID, 'workoutExecutions', started.executionId), {
        startedAt: backdatedStartedAt,
      });
    });

    const state = await resolveWorkoutSessionRecoveryState(UID);
    expect(state.status).toBe('pending');
    if (state.status !== 'pending') return;

    // Still a perfectly valid, recoverable IN_PROGRESS execution — being old
    // never abandons it automatically (docs: long-session alert never
    // auto-discards).
    expect(state.execution.status).toBe('IN_PROGRESS');
    expect(state.execution.executionId).toBe(started.executionId);
    expect(state.execution.startedAt.toMillis()).toBe(backdatedStartedAt.toMillis());

    const elapsedSeconds = computeWorkoutElapsedSeconds(safeStartedAtMs(state.execution.startedAt)!, Date.now());
    expect(isLongWorkoutSession(elapsedSeconds)).toBe(true);
    expect(formatWorkoutSessionDuration(elapsedSeconds)).toBe('5h12');

    // "Continuar" on a long session must be exactly the same resume as any
    // other: same executionId, same startedAt (never renewed), sets/loads/
    // skips hydrated exactly as persisted — mirroring `handleResumeRecovery`'s
    // own freshness re-check before adopting.
    const resumed = await loadWorkoutExecution(UID, state.pointer.executionId);
    expect(resumed?.executionId).toBe(started.executionId);
    expect(resumed?.startedAt.toMillis()).toBe(backdatedStartedAt.toMillis());
    expect(resumed?.exercises[0].sets[0]).toMatchObject({ status: 'COMPLETED', actualReps: 10, weightKg: 32.5 });
    expect(resumed?.exercises[0].sets[1]).toMatchObject({ status: 'SKIPPED' });
    expect(resumed?.exercises[0].sets[2]).toMatchObject({ status: 'PENDING' });

    // No second execution was created by any of the above.
    const allExecutions = await listExecutionsForProgram(UID, 'wpg_test1');
    expect(allExecutions).toHaveLength(1);
  });

  it('P0: starting a DIFFERENT session while one is active is rejected — no second execution is created', async () => {
    const first = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    await expect(
      startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 1, scheduledLocalDate: '2026-08-25' }),
    ).rejects.toThrow(WorkoutExecutionConflictError);
    const secondId = activeExecutionId('wpg_test1', 1, '2026-08-25');
    const second = await loadWorkoutExecution(UID, secondId);
    expect(second).toBeNull();
    const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutExecutionState', 'current'));
    expect(state.data()?.executionId).toBe(first.executionId);
  });

  it('P0: exact regression fixture — session 1 started 08/09 stays open; 09/09 cannot silently create a second session-1 execution', async () => {
    const day1 = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 1, scheduledLocalDate: '2026-09-08' });
    expect(day1.status).toBe('IN_PROGRESS');
    await expect(
      startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 1, scheduledLocalDate: '2026-09-09' }),
    ).rejects.toThrow(WorkoutExecutionConflictError);
    const day2Id = activeExecutionId('wpg_test1', 1, '2026-09-09');
    expect(await loadWorkoutExecution(UID, day2Id)).toBeNull();
    // The 08/09 execution is still exactly as it was — untouched by the rejected attempt.
    const day1Reloaded = await loadWorkoutExecution(UID, day1.executionId);
    expect(day1Reloaded?.status).toBe('IN_PROGRESS');
  });

  it('P0: two concurrent start() calls for DIFFERENT sessions — exactly one wins, never both', async () => {
    const [a, b] = await Promise.allSettled([
      startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' }),
      startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 1, scheduledLocalDate: '2026-08-25' }),
    ]);
    const outcomes = [a, b];
    const fulfilled = outcomes.filter((item) => item.status === 'fulfilled');
    const rejected = outcomes.filter((item) => item.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutExecutionState', 'current'));
    expect(state.exists()).toBe(true);
    const winner = fulfilled[0].status === 'fulfilled' ? fulfilled[0].value : null;
    expect(state.data()?.executionId).toBe(winner?.executionId);
  });

  it('P0: double start() for the SAME session while it is active converges idempotently on the one execution', async () => {
    const [a, b] = await Promise.all([
      startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' }),
      startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' }),
    ]);
    expect(a.executionId).toBe(b.executionId);
    const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutExecutionState', 'current'));
    expect(state.data()?.executionId).toBe(a.executionId);
  });

  it('P0: restart-after-abandon renews startedAt — a resumed attempt never shows a stale duration (docs §13)', async () => {
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    const originalStartedAtMs = started.startedAt.toMillis();
    await abandonWorkoutExecution(UID, started.executionId);
    // Simulate real elapsed wall-clock time between the abandon and the restart.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    const restarted = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    expect(restarted.startedAt.toMillis()).toBeGreaterThan(originalStartedAtMs);
  });

  it('P0: legacy IN_PROGRESS execution predating the mutex (no current pointer) blocks a DIFFERENT new start', async () => {
    // Simulate pre-P0 data: an IN_PROGRESS execution with no workoutExecutionState/current pointer.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db2 = ctx.firestore();
      await setDoc(doc(db2, 'users', UID, 'workoutExecutions', 'exec_wpg_test1_0_2026-08-25'), {
        programId: 'wpg_test1', templateId: 'T003', sessionIndex: 0, sessionName: 'A',
        scheduledLocalDate: '2026-08-25', status: 'IN_PROGRESS',
        startedAt: Timestamp.now(), finishedAt: null,
        exercises: [{ exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null, sets: [] }],
        executionSchemaVersion: 1, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    });
    await expect(
      startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 1, scheduledLocalDate: '2026-08-25' }),
    ).rejects.toThrow(WorkoutExecutionLegacyPendingError);
  });

  it('P0: legacy IN_PROGRESS execution matching exactly the id being started is safely adopted (single, deterministic case)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db2 = ctx.firestore();
      await setDoc(doc(db2, 'users', UID, 'workoutExecutions', 'exec_wpg_test1_0_2026-08-25'), {
        programId: 'wpg_test1', templateId: 'T003', sessionIndex: 0, sessionName: 'A',
        scheduledLocalDate: '2026-08-25', status: 'IN_PROGRESS',
        startedAt: Timestamp.now(), finishedAt: null,
        exercises: [{ exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null, sets: [] }],
        executionSchemaVersion: 1, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    });
    const adopted = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    expect(adopted.status).toBe('IN_PROGRESS');
    const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutExecutionState', 'current'));
    expect(state.data()?.executionId).toBe(adopted.executionId);
  });

  it('P0: multiple ambiguous legacy IN_PROGRESS executions block start and never auto-pick a winner', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db2 = ctx.firestore();
      for (const [execId, sessionIndex, scheduledLocalDate] of [
        ['exec_wpg_test1_0_2026-08-20', 0, '2026-08-20'],
        ['exec_wpg_test1_1_2026-08-21', 1, '2026-08-21'],
      ] as const) {
        await setDoc(doc(db2, 'users', UID, 'workoutExecutions', execId), {
          programId: 'wpg_test1', templateId: 'T003', sessionIndex, sessionName: 'A',
          scheduledLocalDate, status: 'IN_PROGRESS',
          startedAt: Timestamp.now(), finishedAt: null,
          exercises: [{ exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null, sets: [] }],
          executionSchemaVersion: 1, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
        });
      }
    });
    let caught: unknown;
    try {
      await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorkoutExecutionLegacyPendingError);
    expect((caught as InstanceType<typeof WorkoutExecutionLegacyPendingError>).executionIds).toHaveLength(2);
    // Neither legacy execution was silently resolved/abandoned.
    const first = await loadWorkoutExecution(UID, 'exec_wpg_test1_0_2026-08-20');
    const second = await loadWorkoutExecution(UID, 'exec_wpg_test1_1_2026-08-21');
    expect(first?.status).toBe('IN_PROGRESS');
    expect(second?.status).toBe('IN_PROGRESS');
  });

  it('P0: a legacy orphan can be abandoned directly by id, unblocking future starts', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db2 = ctx.firestore();
      await setDoc(doc(db2, 'users', UID, 'workoutExecutions', 'exec_wpg_test1_0_2026-08-20'), {
        programId: 'wpg_test1', templateId: 'T003', sessionIndex: 0, sessionName: 'A',
        scheduledLocalDate: '2026-08-20', status: 'IN_PROGRESS',
        startedAt: Timestamp.now(), finishedAt: null,
        exercises: [{ exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null, sets: [] }],
        executionSchemaVersion: 1, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    });
    await abandonWorkoutExecution(UID, 'exec_wpg_test1_0_2026-08-20');
    const legacy = await loadWorkoutExecution(UID, 'exec_wpg_test1_0_2026-08-20');
    expect(legacy?.status).toBe('ABANDONED');
    // Now a fresh start proceeds normally.
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    expect(started.status).toBe('IN_PROGRESS');
  });

  it('P0: production regression fixture — 08/09 IN_PROGRESS orphan + 09/09 COMPLETED — system detects the inconsistency and blocks further starts until reconciled', async () => {
    // Mirrors the real incident: session 1 started 08/09 never terminalized;
    // session 1 for 09/09 was started (adopted as current, matching the
    // deterministic id — this is the ONLY way a second start for the same
    // session/date pair could ever succeed pre-P0) and completed normally.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db2 = ctx.firestore();
      await setDoc(doc(db2, 'users', UID, 'workoutExecutions', 'exec_wpg_test1_1_2026-09-08'), {
        programId: 'wpg_test1', templateId: 'T003', sessionIndex: 1, sessionName: 'A',
        scheduledLocalDate: '2026-09-08', status: 'IN_PROGRESS',
        startedAt: Timestamp.now(), finishedAt: null,
        exercises: [{ exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null, sets: [] }],
        executionSchemaVersion: 1, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    });
    // A brand-new session (different index/date) cannot start while the
    // orphan remains unresolved.
    await expect(
      startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-09-09' }),
    ).rejects.toThrow(WorkoutExecutionLegacyPendingError);
  });

  // P0-C hardening plan (2026-09) §13 — mixed old-protocol/new-protocol
// device scenarios, against COMPATIBLE mode (the current, deployed
// default — hardening is never enabled in this test file). "Old client" is
// simulated with a raw rules-enforced `setDoc`/`updateDoc` (the exact shape
// a pre-P0 client produces: no `current`, no `mutexProtocolVersion`) against
// the SAME authenticated context the real service functions use — never a
// reimplementation, never a Rules bypass. "New client" always goes through
// the real, unmodified `startOrResumeWorkoutExecution`/`finishWorkoutExecution`/
// `abandonWorkoutExecution`. Each scenario fixes a deterministic ORDER
// (documented per test) rather than true concurrency — see this module's
// validation history for the disposable-script proof that a genuine TOCTOU
// race between an old client's write and a new client's legacy pre-check
// can still reach the corrupted end-state proven here under a fixed order.
describe('P0-C §13 — mixed old-protocol/new-protocol device scenarios (compatible mode)', () => {
  function legacyExecutionDoc(sessionIndex: number, scheduledLocalDate: string, overrides: Record<string, unknown> = {}) {
    return {
      programId: 'wpg_test1', templateId: 'T003', sessionIndex, sessionName: 'A',
      scheduledLocalDate, status: 'IN_PROGRESS', startedAt: serverTimestamp(), finishedAt: null,
      exercises: [{ exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null, sets: [] }],
      executionSchemaVersion: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      ...overrides,
      // No `current`, no `mutexProtocolVersion` — exactly what a pre-P0-C
      // client's own write produces; this is a REAL rules-enforced write
      // (not withSecurityRulesDisabled), proving Rules currently permit it.
    };
  }

  async function oldClientCreate(executionId: string, sessionIndex: number, scheduledLocalDate: string) {
    await setDoc(doc(mocks.db as never, 'users', UID, 'workoutExecutions', executionId), legacyExecutionDoc(sessionIndex, scheduledLocalDate));
  }

  // Scenario A: new client starts first (creates its execution + current),
  // then an old-protocol device tries to start a DIFFERENT session directly.
  it('A — new client starts first; old-protocol device then creates another execution directly — both end up IN_PROGRESS, only the new one tracked', async () => {
    const newStart = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    expect(newStart.status).toBe('IN_PROGRESS');

    // Old client's write is UNRELATED to `current` — Rules currently allow
    // it regardless of what `current` already tracks (compatible mode).
    await oldClientCreate('exec_wpg_test1_1_2026-08-25', 1, '2026-08-25');
    const legacy = await loadWorkoutExecution(UID, 'exec_wpg_test1_1_2026-08-25');
    expect(legacy?.status).toBe('IN_PROGRESS');

    // Deterministic, documented outcome: `current` still tracks ONLY the
    // new client's execution — the old client's write produced an untracked
    // orphan, detected on the NEXT start attempt (any session).
    const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutExecutionState', 'current'));
    expect(state.data()?.executionId).toBe(newStart.executionId);
    await expect(
      startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-26' }),
    ).rejects.toThrow(WorkoutExecutionLegacyPendingError);
  });

  // Scenario B: old-protocol device starts first (direct write, no
  // current), then a new client tries to start. Order matters: if the new
  // client's legacy pre-check runs AFTER the old write committed (the
  // deterministic case constructed here), it correctly blocks.
  it('B — old-protocol device starts first; new client\'s pre-check sees it and blocks (deterministic order: old write committed before new client\'s call)', async () => {
    await oldClientCreate('exec_wpg_test1_0_2026-08-25', 0, '2026-08-25');
    await expect(
      startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 1, scheduledLocalDate: '2026-08-25' }),
    ).rejects.toThrow(WorkoutExecutionLegacyPendingError);
    // No `current` was created — the new client's transaction never ran.
    const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutExecutionState', 'current'));
    expect(state.exists()).toBe(false);
  });

  // Scenario C (both simultaneously) is not a fixed-order scenario by
  // definition — its outcome depends on which of the new client's two
  // network calls (the legacy pre-check query vs. its mutex transaction)
  // straddles the old client's commit. This was proven empirically during
  // this plan's validation (disposable emulator script, not part of this
  // suite — see the P0-C validation report): when the pre-check loses the
  // race, the mutex transaction alone does NOT protect against the old
  // client's orphan, and the corrupted 2-IN_PROGRESS end-state from
  // Scenario A is reproducible. There is no deterministic Rules-level test
  // for a true network race; Scenarios A and B above are its two possible
  // resolved orderings.

  // Scenario D: old-protocol device finishes (direct updateDoc) WHILE a new
  // client tries to start. Two sub-orderings, both deterministic:
  it('D1 — old client finishes an unrelated legacy execution BEFORE the new client\'s pre-check runs: new start proceeds normally', async () => {
    await oldClientCreate('exec_wpg_test1_0_2026-08-25', 0, '2026-08-25');
    // Old client's own finish — a partial updateDoc (never touches
    // startedAt/createdAt, matching the update rule's "must stay fixed"
    // constraint the same way the real pre-P0 code always did).
    await updateDoc(doc(mocks.db as never, 'users', UID, 'workoutExecutions', 'exec_wpg_test1_0_2026-08-25'), {
      status: 'COMPLETED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 1, scheduledLocalDate: '2026-08-25' });
    expect(started.status).toBe('IN_PROGRESS');
  });

  it('D2 — old client\'s finish has NOT yet landed when the new client\'s pre-check runs: new start is blocked (still sees it as IN_PROGRESS)', async () => {
    await oldClientCreate('exec_wpg_test1_0_2026-08-25', 0, '2026-08-25');
    // Pre-check runs (and blocks) BEFORE the old client's finish — modeled
    // by simply not finishing it first, the deterministic "not yet landed" case.
    await expect(
      startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 1, scheduledLocalDate: '2026-08-25' }),
    ).rejects.toThrow(WorkoutExecutionLegacyPendingError);
  });

  // Scenario E: new client abandons its own session WHILE an old-protocol
  // device creates another execution directly. The two operations touch
  // completely disjoint documents (different executionId, current only
  // referenced by the new client's own abandon) — no contention, so the
  // outcome is deterministic regardless of ordering.
  it('E — new client abandons; old-protocol device creates a different execution directly — old write is unaffected by the abandon, current ends up absent', async () => {
    const started = await startOrResumeWorkoutExecution({ uid: UID, program: program(), sessionIndex: 0, scheduledLocalDate: '2026-08-25' });
    await abandonWorkoutExecution(UID, started.executionId);
    await oldClientCreate('exec_wpg_test1_1_2026-08-25', 1, '2026-08-25');

    const abandoned = await loadWorkoutExecution(UID, started.executionId);
    expect(abandoned?.status).toBe('ABANDONED');
    const legacy = await loadWorkoutExecution(UID, 'exec_wpg_test1_1_2026-08-25');
    expect(legacy?.status).toBe('IN_PROGRESS');
    // current is absent (abandon cleared it) — the old client's write never
    // touched it, so this is a "no current pointer, one legacy orphan"
    // state, exactly like the known production incident fixture above.
    const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutExecutionState', 'current'));
    expect(state.exists()).toBe(false);
  });
  });
});
