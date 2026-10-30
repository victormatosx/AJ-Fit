/** Opt-in real Firestore Emulator coverage for Progression Engine V2's gather layer. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const enabled = process.env.PROGRESSION_V2_INTEGRATION === '1';
const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
let testEnv: RulesTestEnvironment;

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({ get db() { return mocks.db; } }));

import { ensureWorkoutLifecycleForLegacyActiveProgram, loadWorkoutLifecycle } from '../workoutLifecycle';
import { evaluateProgressionV2ForUser } from '../workoutProgressionV2';
import { listScheduleEventsForProgramInstance } from '../workoutSchedule';
import { installWorkoutLifecycleAuthorityFixture, resetWorkoutLifecycleAuthorityFixture } from './workoutLifecycleAuthorityFixture';

const ACTIVATED_AT_MS = Date.UTC(2020, 0, 6); // a Monday, UTC
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function localDate(dayOffset: number): string {
  const ms = ACTIVATED_AT_MS + dayOffset * MS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

async function seedExecution(input: {
  db: unknown;
  executionId: string;
  programInstanceId: string;
  scheduledLocalDate: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'ABANDONED';
  prescribed?: boolean;
}) {
  await setDoc(doc(input.db as never, 'users', UID, 'workoutExecutions', input.executionId), {
    executionId: input.executionId,
    programId: 'program-a',
    programInstanceId: input.programInstanceId,
    templateId: 'T001',
    sessionIndex: 0,
    sessionName: 'A',
    scheduledLocalDate: input.scheduledLocalDate,
    status: input.status,
    startedAt: Timestamp.now(),
    finishedAt: input.status === 'IN_PROGRESS' ? null : Timestamp.now(),
    exercises: [{ exerciseIndex: 0, exerciseId: 'ex1', prescribedSets: 1, prescribedReps: '10', prescribedDuration: null, prescribedCycles: null, sets: [{ setIndex: 0, status: 'COMPLETED', actualReps: 10, weightKg: 0, actualDurationSeconds: null }] }],
    executionSchemaVersion: 2,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  if (input.prescribed !== false && (input.status === 'COMPLETED' || input.status === 'PARTIALLY_COMPLETED')) {
    await setDoc(doc(
      input.db as never,
      'users', UID, 'workoutPrograms', 'program-a', 'scheduleEvents',
      `completed_${input.programInstanceId}_0_${input.scheduledLocalDate}`,
    ), {
      type: 'COMPLETED', programInstanceId: input.programInstanceId, sessionIndex: 0,
      scheduledDate: input.scheduledLocalDate, occurredAt: Timestamp.now(),
    });
  }
}

describe.skipIf(!enabled)('Progression Engine V2 — real Firestore Emulator integration', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
    });
    mocks.db = testEnv.authenticatedContext(UID, { email: 'alice@example.com', email_verified: true }).firestore();
    installWorkoutLifecycleAuthorityFixture(testEnv, UID);
  });
  afterAll(async () => {
    resetWorkoutLifecycleAuthorityFixture();
    await testEnv.cleanup();
  });

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
      await setDoc(doc(db, 'users', UID, 'questionnaires', 'q1'), {
        answers: { level: 'beginner' }, version: 1, createdAt: Timestamp.now(),
      });
      await setDoc(doc(db, 'users', UID, 'workoutPrograms', 'program-a'), {
        programId: 'program-a', prescriptionId: 'rx-a', questionnaireId: 'q1', status: 'active',
        // The sealed weekly goal is the adherence denominator now, so every
        // fixture needs the real field rather than relying on a fallback.
        prescribedTrainingFrequency: 3,
        sessions: [{ name: 'A', exercises: [{ exerciseId: 'ex1', sets: 1 }] }],
      });
      await setDoc(doc(db, 'users', UID, 'workoutProgramState', 'scheduleConfig'), {
        trainingDays: ['MON', 'WED', 'FRI'], timezone: 'UTC', scheduleVersion: 1,
      });
    });
  });

  it('returns null when the account has no V2 lifecycle yet', async () => {
    expect(await evaluateProgressionV2ForUser(UID)).toBeNull();
  });

  it('a Beginner meeting the 28-active-day + adherence bar is LEVEL_PROMOTION_ELIGIBLE', async () => {
    const bundle = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(ACTIVATED_AT_MS),
    });
    const instanceId = bundle.programInstance.programInstanceId;
    // MON/WED/FRI occurrences across the 28-day window starting on day 0 (Mon).
    const prescribedOffsets = [0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25];
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await Promise.all(prescribedOffsets.map((offset, i) =>
        seedExecution({ db, executionId: `exec-${i}`, programInstanceId: instanceId, scheduledLocalDate: localDate(offset), status: 'COMPLETED' }),
      ));
    });

    const now = new Date(ACTIVATED_AT_MS + 27 * MS_PER_DAY);
    const decision = await evaluateProgressionV2ForUser(UID, now);
    expect(decision).toMatchObject({ type: 'LEVEL_PROMOTION_ELIGIBLE', from: 'BEGINNER', to: 'INTERMEDIATE', quality: 'HIGH' });
  });

  it('before the minimum active period, decision is PROGRESS_CONTINUES even with perfect adherence so far', async () => {
    const bundle = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(ACTIVATED_AT_MS),
    });
    const instanceId = bundle.programInstance.programInstanceId;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await Promise.all([0, 2, 4, 7, 9].map((offset, i) =>
        seedExecution({ db, executionId: `exec-${i}`, programInstanceId: instanceId, scheduledLocalDate: localDate(offset), status: 'COMPLETED' }),
      ));
    });
    const now = new Date(ACTIVATED_AT_MS + 10 * MS_PER_DAY); // well under 28 active days
    const decision = await evaluateProgressionV2ForUser(UID, now);
    expect(decision).toMatchObject({ type: 'PROGRESS_CONTINUES', reason: 'MINIMUM_ACTIVE_TIME_NOT_REACHED' });
  });

  it('an IN_PROGRESS execution blocks the decision with NO_ACTION', async () => {
    const bundle = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(ACTIVATED_AT_MS),
    });
    const instanceId = bundle.programInstance.programInstanceId;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await seedExecution({ db, executionId: 'exec-in-progress', programInstanceId: instanceId, scheduledLocalDate: localDate(0), status: 'IN_PROGRESS' });
    });
    const now = new Date(ACTIVATED_AT_MS + 30 * MS_PER_DAY);
    const decision = await evaluateProgressionV2ForUser(UID, now);
    expect(decision).toEqual({ type: 'NO_ACTION', reason: 'IN_PROGRESS_EXECUTION' });

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'users', UID, 'workoutExecutions', 'exec-in-progress'), {
        status: 'ABANDONED',
        finishedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    });
    const refreshedDecision = await evaluateProgressionV2ForUser(UID, now);
    expect(refreshedDecision).not.toEqual({ type: 'NO_ACTION', reason: 'IN_PROGRESS_EXECUTION' });
  });

  it('executions from a Program Instance outside the current cycle never count toward eligibility', async () => {
    const bundle = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(ACTIVATED_AT_MS),
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      // 12 COMPLETED sessions, but attributed to an unrelated Program Instance id.
      const prescribedOffsets = [0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25];
      await Promise.all(prescribedOffsets.map((offset, i) =>
        seedExecution({ db, executionId: `foreign-${i}`, programInstanceId: 'wpi_unrelated_instance', scheduledLocalDate: localDate(offset), status: 'COMPLETED' }),
      ));
    });
    void bundle;
    const now = new Date(ACTIVATED_AT_MS + 27 * MS_PER_DAY);
    const decision = await evaluateProgressionV2ForUser(UID, now);
    // No executions recognized for this cycle at all -> no engagement signal,
    // Active Time itself freezes (and adherence has no valid sessions either).
    expect(decision).toMatchObject({ type: 'PROGRESS_CONTINUES', reason: 'MINIMUM_ACTIVE_TIME_NOT_REACHED' });
    if (decision?.type === 'PROGRESS_CONTINUES') {
      expect(decision.adherence.ratio).toBe(0);
    }
  });

  it('schedule-event reads stay scoped to the active ProgramInstance when content is reused', async () => {
    const bundle = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(ACTIVATED_AT_MS),
    });
    const instanceId = bundle.programInstance.programInstanceId;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const rawDb = ctx.firestore();
      await Promise.all([
        ...Array.from({ length: 100 }, (_, index) => setDoc(doc(
          rawDb,
          'users', UID, 'workoutPrograms', 'program-a', 'scheduleEvents', `foreign-${index}`,
        ), {
          type: index % 2 === 0 ? 'COMPLETED' : 'SKIPPED',
          programInstanceId: `superseded-${index}`,
          sessionIndex: index % 3,
          scheduledDate: localDate(index),
          occurredAt: Timestamp.now(),
        })),
        setDoc(doc(rawDb, 'users', UID, 'workoutPrograms', 'program-a', 'scheduleEvents', 'legacy'), {
          type: 'COMPLETED', sessionIndex: 0, scheduledDate: localDate(0), occurredAt: Timestamp.now(),
        }),
        setDoc(doc(rawDb, 'users', UID, 'workoutPrograms', 'program-a', 'scheduleEvents', 'own-completed'), {
          type: 'COMPLETED', programInstanceId: instanceId,
          sessionIndex: 0, scheduledDate: localDate(0), occurredAt: Timestamp.now(),
        }),
        setDoc(doc(rawDb, 'users', UID, 'workoutPrograms', 'program-a', 'scheduleEvents', 'own-skipped'), {
          type: 'SKIPPED', programInstanceId: instanceId,
          sessionIndex: 1, scheduledDate: localDate(2), occurredAt: Timestamp.now(),
        }),
        setDoc(doc(rawDb, 'users', UID, 'workoutPrograms', 'program-a', 'scheduleEvents', 'own-miss-resolved'), {
          type: 'MISS_RESOLVED', programInstanceId: instanceId,
          sessionIndex: 1, scheduledDate: localDate(2), occurredAt: Timestamp.now(),
        }),
      ]);
    });

    const events = await listScheduleEventsForProgramInstance(UID, 'program-a', instanceId);
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.programInstanceId === instanceId)).toBe(true);
    expect(events.map((event) => event.type).sort()).toEqual(['COMPLETED', 'MISS_RESOLVED', 'SKIPPED']);
  });

  it('evaluating the same state twice returns the exact same decision (idempotent, no hidden mutation)', async () => {
    const bundle = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(ACTIVATED_AT_MS),
    });
    const instanceId = bundle.programInstance.programInstanceId;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await seedExecution({ db, executionId: 'exec-0', programInstanceId: instanceId, scheduledLocalDate: localDate(0), status: 'COMPLETED' });
    });
    const now = new Date(ACTIVATED_AT_MS + 5 * MS_PER_DAY);
    const first = await evaluateProgressionV2ForUser(UID, now);
    const second = await evaluateProgressionV2ForUser(UID, now);
    expect(first).toEqual(second);
    expect(await loadWorkoutLifecycle(UID)).toMatchObject({ lifecycle: { activeProgramInstanceId: instanceId } });
  });

  it('credits only ledger-proven days: 6 proven + 4 unproven workouts remains 60%', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutProgramState', 'scheduleConfig'), {
        trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'], timezone: 'UTC', scheduleVersion: 1,
      });
      await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutPrograms', 'program-a'), {
        programId: 'program-a', prescriptionId: 'rx-a', questionnaireId: 'q1', status: 'active',
        prescribedTrainingFrequency: 5,
        sessions: [{ name: 'A', exercises: [{ exerciseId: 'ex1', sets: 1 }] }],
      });
    });
    const bundle = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(ACTIVATED_AT_MS),
    });
    const instanceId = bundle.programInstance.programInstanceId;
    const fulfilled = [0, 1, 3, 7, 8, 10];
    const extras = [5, 6, 12, 13];
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (const [index, offset] of fulfilled.entries()) {
        await seedExecution({ db, executionId: `prescribed-${index}`, programInstanceId: instanceId, scheduledLocalDate: localDate(offset), status: 'COMPLETED' });
      }
      for (const [index, offset] of extras.entries()) {
        await seedExecution({ db, executionId: `extra-${index}`, programInstanceId: instanceId, scheduledLocalDate: localDate(offset), status: 'COMPLETED', prescribed: false });
      }
    });

    const decision = await evaluateProgressionV2ForUser(UID, new Date(ACTIVATED_AT_MS + 13 * MS_PER_DAY));
    expect(decision).toMatchObject({ type: 'PROGRESS_CONTINUES' });
    if (decision?.type === 'PROGRESS_CONTINUES') {
      expect(decision.validSessionCount).toBe(6);
      expect(decision.adherence.ratio).toBeCloseTo(0.6, 8);
      expect(decision.adherence.quality).toBe('BELOW_TARGET');
    }
  });

  it('flexible uses prescribedTrainingFrequency as the weekly target without weekday debt', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const rawDb = ctx.firestore();
      await setDoc(doc(rawDb, 'users', UID, 'workoutPrograms', 'program-a'), {
        programId: 'program-a',
        prescriptionId: 'rx-a',
        questionnaireId: 'q1',
        status: 'active',
        scheduleMode: 'flexible',
        prescribedTrainingFrequency: 3,
        weeklySchedule: [],
        sessions: [{ name: 'A', exercises: [{ exerciseId: 'ex1', sets: 1 }] }],
      });
      await setDoc(doc(rawDb, 'users', UID, 'workoutProgramState', 'scheduleConfig'), {
        scheduleMode: 'flexible', trainingDays: [], timezone: 'UTC', scheduleVersion: 1,
      });
    });
    const bundle = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
      contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
      questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(ACTIVATED_AT_MS),
    });
    const instanceId = bundle.programInstance.programInstanceId;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      for (const [index, offset] of [0, 2, 4, 8, 10].entries()) {
        await seedExecution({
          db: ctx.firestore(),
          executionId: `flexible-${index}`,
          programInstanceId: instanceId,
          scheduledLocalDate: localDate(offset),
          status: 'COMPLETED',
        });
      }
    });
    const decision = await evaluateProgressionV2ForUser(UID, new Date(ACTIVATED_AT_MS + 13 * MS_PER_DAY));
    expect(decision).toMatchObject({ type: 'PROGRESS_CONTINUES' });
    if (decision?.type === 'PROGRESS_CONTINUES') {
      expect(decision.validSessionCount).toBe(5);
      // Quantized to basis points by design (one definition shared with the
      // authority): floor(5 * 10000 / 6) = 8333.
      expect(decision.adherence.ratio).toBe(0.8333);
      expect(decision.adherence.quality).toBe('GOOD');
    }
  });

  /**
   * The gather layer must read the whole TrainingCycle. These seed a real
   * second ProgramInstance in the SAME cycle — exactly the shape an ADAPT
   * leaves behind — and assert that the progression window spans both.
   */
  describe('cycle continuity across a Program Adaptation', () => {
    /** Supersedes the baseline instance and activates a 5x one in the same cycle. */
    async function adaptToFiveTimesAWeek(input: {
      previousInstanceId: string;
      cycleId: string;
      supersededAtOffset: number;
      activatedAtOffset: number;
    }) {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await updateDoc(doc(db, 'users', UID, 'programInstances', input.previousInstanceId), {
          supersededAt: Timestamp.fromMillis(ACTIVATED_AT_MS + input.supersededAtOffset * MS_PER_DAY),
          updatedAt: Timestamp.now(),
        });
        await setDoc(doc(db, 'users', UID, 'workoutPrograms', 'program-b'), {
          programId: 'program-b', prescriptionId: 'rx-b', questionnaireId: 'q1', status: 'active',
          prescribedTrainingFrequency: 5,
          sessions: [{ name: 'A', exercises: [{ exerciseId: 'ex1', sets: 1 }] }],
        });
        await setDoc(doc(db, 'users', UID, 'programInstances', 'wpi_adapted'), {
          programInstanceId: 'wpi_adapted',
          cycleId: input.cycleId,
          contentIdentity: 'program-b',
          prescriptionIdentity: 'rx-b',
          questionnaireId: 'q1',
          activatedAt: Timestamp.fromMillis(ACTIVATED_AT_MS + input.activatedAtOffset * MS_PER_DAY),
          supersededAt: null,
          previousProgramInstanceId: input.previousInstanceId,
          activationReason: 'PROGRAM_ADAPTATION',
          schemaVersion: 2,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        await updateDoc(doc(db, 'users', UID, 'workoutLifecycleState', 'current'), {
          activeProgramInstanceId: 'wpi_adapted',
          activeContentIdentity: 'program-b',
          activePrescriptionIdentity: 'rx-b',
          updatedAt: Timestamp.now(),
        });
      });
    }

    async function seedAdaptedExecution(offset: number, index: number) {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'users', UID, 'workoutExecutions', `adapted-${index}`), {
          executionId: `adapted-${index}`,
          programId: 'program-b',
          programInstanceId: 'wpi_adapted',
          templateId: 'T001',
          sessionIndex: 0,
          sessionName: 'A',
          scheduledLocalDate: localDate(offset),
          status: 'COMPLETED',
          startedAt: Timestamp.now(),
          finishedAt: Timestamp.now(),
          exercises: [{
            exerciseIndex: 0, exerciseId: 'ex1', prescribedSets: 1, prescribedReps: '10',
            prescribedDuration: null, prescribedCycles: null,
            sets: [{ setIndex: 0, status: 'COMPLETED', actualReps: 10, weightKg: 0, actualDurationSeconds: null }],
          }],
          executionSchemaVersion: 2,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        await setDoc(doc(
          db, 'users', UID, 'workoutPrograms', 'program-b', 'scheduleEvents',
          `completed_wpi_adapted_0_${localDate(offset)}`,
        ), {
          type: 'COMPLETED', programInstanceId: 'wpi_adapted', sessionIndex: 0,
          scheduledDate: localDate(offset), occurredAt: Timestamp.now(),
        });
      });
    }

    async function seedAdaptedInProgressExecution(offset: number) {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutExecutions', 'adapted-in-progress'), {
          executionId: 'adapted-in-progress',
          programId: 'program-b',
          programInstanceId: 'wpi_adapted',
          templateId: 'T001',
          sessionIndex: 0,
          sessionName: 'A',
          scheduledLocalDate: localDate(offset),
          status: 'IN_PROGRESS',
          startedAt: Timestamp.now(),
          finishedAt: null,
          exercises: [{
            exerciseIndex: 0, exerciseId: 'ex1', prescribedSets: 1, prescribedReps: '10',
            prescribedDuration: null, prescribedCycles: null,
            sets: [{ setIndex: 0, status: 'PENDING', actualReps: null, weightKg: null, actualDurationSeconds: null }],
          }],
          executionSchemaVersion: 2,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
      });
    }

    it('keeps the active days earned before the adaptation instead of restarting at the new instance', async () => {
      const bundle = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
        contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
        questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(ACTIVATED_AT_MS),
      });
      const previousInstanceId = bundle.programInstance.programInstanceId;
      // Three weeks on the original 3x program, fully met.
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await Promise.all([0, 2, 4, 7, 9, 11, 14, 16, 18].map((offset, index) =>
          seedExecution({
            db, executionId: `before-${index}`, programInstanceId: previousInstanceId,
            scheduledLocalDate: localDate(offset), status: 'COMPLETED',
          })));
      });
      // ADAPT on day 21 (a Monday), then a met 5x week.
      await adaptToFiveTimesAWeek({
        previousInstanceId, cycleId: bundle.cycle.cycleId,
        supersededAtOffset: 20, activatedAtOffset: 21,
      });
      for (const [index, offset] of [21, 22, 23, 24, 25].entries()) {
        await seedAdaptedExecution(offset, index);
      }

      // 28 cycle days at 100% is the Beginner bar. Before this change the
      // window restarted at the new instance's activation, so the same user
      // was back at 7 active days and could not earn at all.
      const decision = await evaluateProgressionV2ForUser(UID, new Date(ACTIVATED_AT_MS + 27 * MS_PER_DAY));
      expect(decision).toMatchObject({
        type: 'LEVEL_PROMOTION_ELIGIBLE', from: 'BEGINNER', to: 'INTERMEDIATE', quality: 'HIGH',
      });
      if (decision?.type === 'LEVEL_PROMOTION_ELIGIBLE') {
        // 28 calendar days of the CYCLE, not the 7 since the new instance.
        expect(decision.activeDays).toBe(28);
        // Weeks 1-3 keep their 3x goal (9 of 9); week 4 gets the new 5x goal
        // (5 of 5). Nothing was rewritten and nothing was lost.
        expect(decision.validSessionCount).toBe(14);
        expect(decision.adherence.ratio).toBe(1);
      }
      // The cycle number itself never moved.
      expect(await loadWorkoutLifecycle(UID)).toMatchObject({
        cycle: { cycleId: bundle.cycle.cycleId },
        lifecycle: { activeProgramInstanceId: 'wpi_adapted' },
      });
    });

    it('a mid-week frequency change gives that week one goal, never two', async () => {
      const bundle = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
        contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
        questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(ACTIVATED_AT_MS),
      });
      const previousInstanceId = bundle.programInstance.programInstanceId;
      // Day 0 is a Monday. ADAPT on day 3 (Thursday) — mid-week.
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await Promise.all([0, 2].map((offset, index) =>
          seedExecution({
            db, executionId: `before-${index}`, programInstanceId: previousInstanceId,
            scheduledLocalDate: localDate(offset), status: 'COMPLETED',
          })));
      });
      await adaptToFiveTimesAWeek({
        previousInstanceId, cycleId: bundle.cycle.cycleId,
        supersededAtOffset: 3, activatedAtOffset: 3,
      });
      await seedAdaptedExecution(4, 0);

      const decision = await evaluateProgressionV2ForUser(UID, new Date(ACTIVATED_AT_MS + 6 * MS_PER_DAY));
      expect(decision).toMatchObject({ type: 'PROGRESS_CONTINUES' });
      if (decision?.type === 'PROGRESS_CONTINUES') {
        expect(decision.activeDays).toBe(7);
        // ONE week, ONE goal: 3x covered Mon–Thu (4 days), 5x covered Thu–Sun
        // (4 days) — the tie goes to the most recent activation, so 5.
        // Three distinct days trained, none of them double-counted.
        expect(decision.validSessionCount).toBe(3);
        expect(decision.adherence.ratio).toBeCloseTo(3 / 5, 8);
      }
    });

    it('a stale IN_PROGRESS execution on the superseded instance does not block progression', async () => {
      const bundle = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
        contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
        questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(ACTIVATED_AT_MS),
      });
      const previousInstanceId = bundle.programInstance.programInstanceId;
      await adaptToFiveTimesAWeek({
        previousInstanceId, cycleId: bundle.cycle.cycleId,
        supersededAtOffset: 2, activatedAtOffset: 2,
      });
      // Superseding an instance never terminalizes its executions, so this
      // document is real production debris. It belongs to the cycle window
      // now, and must still not be mistaken for a session running right now.
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await seedExecution({
          db: ctx.firestore(), executionId: 'stale-in-progress',
          programInstanceId: previousInstanceId,
          scheduledLocalDate: localDate(1), status: 'IN_PROGRESS',
        });
      });
      await seedAdaptedExecution(3, 0);

      const decision = await evaluateProgressionV2ForUser(UID, new Date(ACTIVATED_AT_MS + 6 * MS_PER_DAY));
      expect(decision).not.toMatchObject({ type: 'NO_ACTION', reason: 'IN_PROGRESS_EXECUTION' });

      // ...while one on the ACTIVE instance still blocks, as it always did.
      await seedAdaptedInProgressExecution(4);
      expect(await evaluateProgressionV2ForUser(UID, new Date(ACTIVATED_AT_MS + 6 * MS_PER_DAY)))
        .toEqual({ type: 'NO_ACTION', reason: 'IN_PROGRESS_EXECUTION' });
    });

    it('does not credit a day twice when both instances hold a record for it', async () => {
      const bundle = await ensureWorkoutLifecycleForLegacyActiveProgram(UID, {
        contentIdentity: 'program-a', prescriptionIdentity: 'rx-a', questionnaireId: 'q1',
        questionnaireExperienceLevel: 'beginner', activatedAt: Timestamp.fromMillis(ACTIVATED_AT_MS),
      });
      const previousInstanceId = bundle.programInstance.programInstanceId;
      await adaptToFiveTimesAWeek({
        previousInstanceId, cycleId: bundle.cycle.cycleId,
        supersededAtOffset: 2, activatedAtOffset: 2,
      });
      // Both instances carry a credited record for day 2 — the ADAPT day.
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await seedExecution({
          db: ctx.firestore(), executionId: 'overlap-old', programInstanceId: previousInstanceId,
          scheduledLocalDate: localDate(2), status: 'COMPLETED',
        });
      });
      await seedAdaptedExecution(2, 0);

      const decision = await evaluateProgressionV2ForUser(UID, new Date(ACTIVATED_AT_MS + 6 * MS_PER_DAY));
      if (decision?.type === 'PROGRESS_CONTINUES') {
        expect(decision.validSessionCount).toBe(1);
      } else {
        throw new Error(`unexpected decision ${decision?.type}`);
      }
    });
  });
});
