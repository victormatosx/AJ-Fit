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
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';

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

import {
  abandonWorkoutExecution,
  activeExecutionId,
  finishWorkoutExecution,
  listRecentWorkoutExecutions,
  loadWorkoutExecution,
  recordSetExecution,
  skipExerciseExecution,
  skipSetExecution,
  startOrResumeWorkoutExecution,
} from '../workoutExecutions';
import { completeScheduledSession } from '../workoutSchedule';
import type { WorkoutProgramSnapshot } from '../workoutPrograms';

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
    await completeScheduledSession({ uid: UID, programId: 'wpg_test1', sessionIndex: 0, sessionCount: 2, scheduledLocalDate: '2026-08-25' });
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
    await completeScheduledSession({ uid: UID, programId: 'wpg_test1', sessionIndex: 0, sessionCount: 2, scheduledLocalDate: '2026-08-25' });
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

    await completeScheduledSession({ uid: UID, programId: 'wpg_test1', sessionIndex: 0, sessionCount: 2, scheduledLocalDate: '2026-08-25' });
    await completeScheduledSession({ uid: UID, programId: 'wpg_test1', sessionIndex: 0, sessionCount: 2, scheduledLocalDate: '2026-08-25' }); // double tap
    const state = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', 'wpg_test1', 'scheduleState', 'current'));
    expect(state.data()?.nextSessionIndex).toBe(1); // advanced exactly once, not twice
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
});
