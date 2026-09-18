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

  it('credits only fulfilled prescribed opportunities: 6 prescribed + 4 extra valid workouts remains 60%', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutProgramState', 'scheduleConfig'), {
        trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'], timezone: 'UTC', scheduleVersion: 1,
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
      expect(decision.adherence.ratio).toBeCloseTo(5 / 6, 8);
      expect(decision.adherence.quality).toBe('GOOD');
    }
  });
});
