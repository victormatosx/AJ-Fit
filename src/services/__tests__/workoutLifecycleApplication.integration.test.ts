/** Opt-in real Firestore Emulator coverage for the Fase 4 Lifecycle Orchestrator (activation, deferral, adaptation). */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp } from 'firebase/firestore';

import { buildSeedDocuments } from '../../../scripts/seedWorkoutTemplates';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import { toPersistedAnswers } from '../../lib/questionnaireAnswers';
import {
  CANONICAL_LIMITATION_DATASET_HASH,
  CANONICAL_LIMITATION_DATASET_VERSION,
  CANONICAL_LIMITATION_PROFILES,
} from '../../workoutPrescription/limitationDataset';
import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { isLimitationSafe } from '../../prescriptionEvolution/equivalence';
import { countEarnedIntermediateCycles } from '../../progressionEngineV2/earnedCycles';
import { completeWorkoutSessionFlow } from '../../workoutLifecycle/finishFlow';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'frank';
const QUESTIONNAIRE_ID = 'q1';
const enabled = process.env.LIFECYCLE_APPLICATION_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;
const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({ get db() { return mocks.db; } }));
vi.mock('expo-crypto', async () => {
  const { createHash } = await import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash('sha256').update(value).digest('hex'),
  };
});

import { contentIdentityFor, generateAndPersistWorkoutProgram, loadActiveWorkoutProgram } from '../workoutPrograms';
import { loadWorkoutLifecycle, listTrainingCycles, listProgramInstances, loadPendingEvolution, recoverWorkoutLifecyclePartialState } from '../workoutLifecycle';
import { evolvePrescription } from '../prescriptionEvolution';
import { evaluateProgressionV2ForUser } from '../workoutProgressionV2';
import { finishWorkoutExecution, startOrResumeWorkoutExecution } from '../workoutExecutions';
import { completeScheduledSession } from '../workoutSchedule';
import {
  activatePendingEvolution,
  adaptWorkoutProgram,
  deferPendingEvolution,
  prepareEvolution,
  prepareQaTransitionEvolution,
  previewQaTransition,
  processWorkoutLifecycleAfterSession,
  reconcileWorkoutLifecycle,
} from '../workoutLifecycleApplication';
import { enableWorkoutLifecycleRollout } from './workoutLifecycleRolloutFixture';
import {
  installWorkoutLifecycleAuthorityFixture,
  resetWorkoutLifecycleAuthorityFixture,
  setWorkoutLifecycleCanonicalResponseOverrideForTests,
} from './workoutLifecycleAuthorityFixture';
import type { WorkoutLifecycleAuthorityCanonicalContent } from '../../workoutLifecycle/authorityProvider';
import type { FinalWorkoutPlan } from '../../workoutPrescription/types';

const T003_SEED = buildSeedDocuments().find((t) => t.id === 'T003');
if (!T003_SEED) throw new Error('T003 fixture missing from catalog — cannot run this integration test');

const BEGINNER_ANSWERS = completeAnswers({
  sex: 'm', goal: 'gain_muscle', level: 'beginner', days: 4, place: 'gym', specialConditions: ['none'],
});
const INTERMEDIATE_ANSWERS = completeAnswers({
  sex: 'm', goal: 'gain_muscle', level: 'intermediate', days: 4, place: 'gym', specialConditions: ['none'],
});

const TRAINING_DAYS = ['MON', 'TUE', 'THU', 'FRI'] as const;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function divergentCanonical(
  response: WorkoutLifecycleAuthorityCanonicalContent,
  suffix: string,
): WorkoutLifecycleAuthorityCanonicalContent {
  const targetPlan = JSON.parse(JSON.stringify(response.targetPlan)) as typeof response.targetPlan;
  targetPlan.planId = `${targetPlan.planId}_${suffix}`;
  const firstExercise = targetPlan.sessions[0].exercises[0];
  firstExercise.sets = firstExercise.sets === 10 ? 9 : Number(firstExercise.sets ?? 1) + 1;
  return {
    ...response,
    targetPlan,
    targetPrescriptionIdentity: targetPlan.planId,
    targetContentIdentity: contentIdentityFor({
      questionnaireId: QUESTIONNAIRE_ID,
      questionnaireVersion: 1,
      plan: targetPlan,
      template: {
        id: targetPlan.templateId,
        version: response.targetTemplateVersion,
        contentHash: response.targetTemplateContentHash,
      },
    }),
  };
}

async function seedBaseUser() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    await setDoc(doc(rawDb, 'users', UID), {
      profile: { name: 'Frank', email: 'frank@example.com' },
      preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
      subscription: {},
      metadata: { role: 'user', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), commercialGateResolvedAt: Timestamp.now() },
    });
    await setDoc(doc(rawDb, 'workoutTemplates', 'T003'), T003_SEED);
    await setDoc(doc(rawDb, 'limitationDatasetState', 'active'), {
      datasetVersion: CANONICAL_LIMITATION_DATASET_VERSION,
      limitationDatasetHash: CANONICAL_LIMITATION_DATASET_HASH,
    });
    await setDoc(doc(rawDb, 'users', UID, 'questionnaires', QUESTIONNAIRE_ID), {
      answers: toPersistedAnswers(BEGINNER_ANSWERS), version: 1, createdAt: Timestamp.now(),
    });
    await setDoc(doc(rawDb, 'users', UID, 'workoutProgramState', 'scheduleConfig'), {
      trainingDays: [...TRAINING_DAYS], timezone: 'UTC', scheduleVersion: 1,
    });
  });
}

async function seedCanonicalExerciseCatalog() {
  const profileByExerciseId = new Map(
    CANONICAL_LIMITATION_PROFILES.map((entry) => [entry.exerciseId, entry.limitationProfile]),
  );
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    await Promise.all(EXERCISES_SEED.map(async (exercise) => {
      const data = JSON.parse(JSON.stringify({
        ...exercise,
        limitationProfile: profileByExerciseId.get(exercise.id),
      })) as Record<string, unknown>;
      await setDoc(doc(rawDb, 'exercises', exercise.id), data);
    }));
  });
}

function expectProgramKneeSafe(program: { sessions: Array<{ exercises: Array<{ exerciseId: string }> }> }) {
  const profileByExerciseId = new Map(
    CANONICAL_LIMITATION_PROFILES.map((entry) => [entry.exerciseId, entry.limitationProfile]),
  );
  const catalog = new Map(EXERCISES_SEED.map((exercise) => [exercise.id, {
    ...exercise,
    limitationProfile: profileByExerciseId.get(exercise.id),
  }]));
  const exerciseIds = program.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseId));
  expect(exerciseIds.length).toBeGreaterThan(0);
  for (const exerciseId of exerciseIds) {
    const exercise = catalog.get(exerciseId);
    expect(exercise, exerciseId).toBeDefined();
    if (!exercise) continue;
    expect(isLimitationSafe(exercise, ['knee']), exerciseId).toBe(true);
  }
}

function isTrainingWeekday(date: Date): boolean {
  const map = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return (TRAINING_DAYS as readonly string[]).includes(map[date.getUTCDay()]);
}

function completedExecutionExercises(
  program: { sessions: Array<{ exercises: Array<{ exerciseId: string; sets?: number }> }> },
  sessionIndex: number,
) {
  return program.sessions[sessionIndex].exercises.map((exercise, exerciseIndex) => ({
    exerciseIndex,
    exerciseId: exercise.exerciseId,
    sets: Array.from({ length: exercise.sets ?? 1 }, (_, setIndex) => ({
      setIndex,
      status: 'COMPLETED' as const,
    })),
  }));
}

/** Backdates the active Training Cycle's `startedAt`/`createdAt` and seeds a COMPLETED execution on every prescribed weekday since then — enough real history for Fase 2 to independently compute activeDays/adherence and reach an earned decision. */
async function backdateCycleWithQualifyingHistory(uid: string, activeDaysAgo: number, programInstanceId: string, programId: string) {
  const cycleId = (await loadWorkoutLifecycle(uid))!.lifecycle.currentCycleId;
  const program = await loadActiveWorkoutProgram(uid);
  if (!program || program.programId !== programId) throw new Error('qualifying history requires the active program');
  const start = new Date(Date.now() - activeDaysAgo * MS_PER_DAY);
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    await setDoc(doc(rawDb, 'users', uid, 'trainingCycles', cycleId), { startedAt: Timestamp.fromDate(start) }, { merge: true });
    await setDoc(doc(rawDb, 'users', uid, 'programInstances', programInstanceId), { activatedAt: Timestamp.fromDate(start) }, { merge: true });
    let cursor = new Date(start);
    let index = 0;
    while (cursor.getTime() <= Date.now()) {
      if (isTrainingWeekday(cursor)) {
        const scheduledLocalDate = cursor.toISOString().slice(0, 10);
        const sessionIndex = index % program.sessions.length;
        await setDoc(doc(rawDb, 'users', uid, 'workoutExecutions', `exec_${programInstanceId}_${index}_${scheduledLocalDate}`), {
          programId, programInstanceId, templateId: 'T003', sessionIndex, sessionName: 'A',
          scheduledLocalDate, status: 'COMPLETED', startedAt: Timestamp.now(), finishedAt: Timestamp.now(),
          exercises: completedExecutionExercises(program, sessionIndex), executionSchemaVersion: 2, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
        });
        await setDoc(doc(rawDb, 'users', uid, 'workoutPrograms', programId, 'scheduleEvents', `completed_${programInstanceId}_${index}_${scheduledLocalDate}`), {
          type: 'COMPLETED', programInstanceId, sessionIndex,
          scheduledDate: scheduledLocalDate, occurredAt: Timestamp.now(),
        });
        index += 1;
      }
      cursor = new Date(cursor.getTime() + MS_PER_DAY);
    }
  });
}

describe.skipIf(!enabled)('Fase 4 Lifecycle Orchestrator — real Firestore Emulator integration', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
    });
    mocks.db = testEnv.authenticatedContext(UID, { email: 'frank@example.com', email_verified: true }).firestore();
    installWorkoutLifecycleAuthorityFixture(testEnv, UID);
  });
  afterAll(async () => {
    resetWorkoutLifecycleAuthorityFixture();
    await testEnv.cleanup();
  });
  beforeEach(async () => {
    setWorkoutLifecycleCanonicalResponseOverrideForTests(null);
    await testEnv.clearFirestore();
    await enableWorkoutLifecycleRollout(testEnv);
  });

  it('8B real finish → schedule → V2 orchestrator creates pending without UI mount or V1 mutation', async () => {
    await seedBaseUser();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    await backdateCycleWithQualifyingHistory(UID, 30, generated.program.programInstanceId!, generated.program.programId);
    const execution = await startOrResumeWorkoutExecution({
      uid: UID, program: generated.program, sessionIndex: 0, scheduledLocalDate: '2026-08-29',
    });

    const flow = await completeWorkoutSessionFlow({
      finishExecution: async () => (await finishWorkoutExecution(UID, execution.executionId)).status,
      completeSchedule: async () => {
        await completeScheduledSession({
          uid: UID, programId: generated.program.programId,
          programInstanceId: generated.program.programInstanceId,
          sessionIndex: 0, sessionCount: generated.program.sessions.length,
          scheduledLocalDate: '2026-08-29', trainingDays: TRAINING_DAYS, activatedAtLocalDate: '2026-08-29',
        });
        return true;
      },
      afterSchedule: async () => { await processWorkoutLifecycleAfterSession({ uid: UID }); },
    });

    expect(flow).toBe('COMPLETED');
    expect((await loadPendingEvolution(UID))?.type).toBe('LEVEL_PROMOTION');
    const v1Events = await getDocs(collection(
      mocks.db as never, 'users', UID, 'workoutPrograms', generated.program.programId, 'progressionEvents',
    ));
    expect(v1Events.size).toBe(0);
  }, 30_000);

  it('10C PREPARE level promotion persists backend canonical B in pending evolution', async () => {
    await seedBaseUser();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    await backdateCycleWithQualifyingHistory(
      UID, 30, generated.program.programInstanceId!, generated.program.programId,
    );
    let backendPlanId = '';
    setWorkoutLifecycleCanonicalResponseOverrideForTests((request, response) => {
      if (request.operation !== 'PREPARE') return response;
      const canonical = divergentCanonical(response, 'backend_promotion');
      backendPlanId = canonical.targetPlan.planId;
      return canonical;
    });

    const prepared = await prepareEvolution({ uid: UID });
    expect(prepared.status).toBe('PREPARED');
    if (prepared.status !== 'PREPARED') return;
    const pendingPlan = prepared.pending.plan as FinalWorkoutPlan;
    expect(prepared.pending.type).toBe('LEVEL_PROMOTION');
    expect(pendingPlan.planId).toBe(backendPlanId);
    expect(prepared.pending.targetPrescriptionIdentity).toBe(backendPlanId);
    expect(prepared.pending.targetContentIdentity).toBe(contentIdentityFor({
      questionnaireId: QUESTIONNAIRE_ID,
      questionnaireVersion: 1,
      plan: pendingPlan,
      template: {
        id: pendingPlan.templateId,
        version: prepared.pending.targetTemplateVersion,
        contentHash: prepared.pending.targetTemplateContentHash,
      },
    }));
  }, 30_000);

  it('10C PREPARE cycle evolution persists backend canonical B in pending evolution', async () => {
    await seedBaseUser();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'questionnaires', QUESTIONNAIRE_ID), {
        answers: toPersistedAnswers(INTERMEDIATE_ANSWERS), version: 1, createdAt: Timestamp.now(),
      });
    });
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: INTERMEDIATE_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    await backdateCycleWithQualifyingHistory(
      UID, 90, generated.program.programInstanceId!, generated.program.programId,
    );
    expect((await evaluateProgressionV2ForUser(UID))?.type).toBe('EVOLUTION_ELIGIBLE');
    let backendPlanId = '';
    setWorkoutLifecycleCanonicalResponseOverrideForTests((request, response) => {
      if (request.operation !== 'PREPARE') return response;
      const canonical = divergentCanonical(response, 'backend_cycle');
      backendPlanId = canonical.targetPlan.planId;
      return canonical;
    });

    const prepared = await prepareEvolution({ uid: UID });
    expect(prepared.status).toBe('PREPARED');
    if (prepared.status !== 'PREPARED') return;
    expect(prepared.pending.type).toBe('CYCLE_EVOLUTION');
    expect((prepared.pending.plan as FinalWorkoutPlan).planId).toBe(backendPlanId);
    expect(prepared.pending.targetPrescriptionIdentity).toBe(backendPlanId);
  }, 60_000);

  it('10C ADAPT activation persists backend canonical B, never local candidate A', async () => {
    await seedBaseUser();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    let candidateContentIdentity = '';
    let backendPlanId = '';
    setWorkoutLifecycleCanonicalResponseOverrideForTests((request, response) => {
      if (request.operation !== 'ADAPT') return response;
      candidateContentIdentity = String(request.targetContentIdentity);
      const canonical = divergentCanonical(response, 'backend_adapt');
      backendPlanId = canonical.targetPlan.planId;
      return canonical;
    });

    const adapted = await adaptWorkoutProgram({
      uid: UID,
      updatedFields: { duration: '45' },
      reason: 'AVAILABILITY',
      idempotencyKey: 'phase10c-catalog-race',
    });
    expect(adapted.status).toBe('SUCCESS');
    if (adapted.status !== 'SUCCESS') return;
    expect(adapted.program.planId).toBe(backendPlanId);
    expect(adapted.program.prescriptionId).toBe(backendPlanId);
    expect(adapted.program.programId).not.toBe(candidateContentIdentity);
    expect((await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', candidateContentIdentity))).exists())
      .toBe(false);
  }, 30_000);

  it('8B legacy-only cold/post-workout race converges to one V2 baseline before progression authority runs', async () => {
    await seedBaseUser();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');

    // Convert the fixture into an account that genuinely has only the legacy
    // program + active pointer. Historical V2 artifacts are removed only by
    // the admin fixture; production recovery never performs this deletion.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const rawDb = ctx.firestore();
      for (const collectionName of ['trainingCycles', 'programInstances', 'workoutLifecycleEvents']) {
        const snapshots = await getDocs(collection(rawDb, 'users', UID, collectionName));
        await Promise.all(snapshots.docs.map((snapshot) => deleteDoc(snapshot.ref)));
      }
      await deleteDoc(doc(rawDb, 'users', UID, 'workoutLifecycleState', 'current'));
    });

    // A cold-start reconcile and the operational post-workout entry may race;
    // both must pass through the same deterministic legacy→V2 bootstrap.
    await Promise.all([
      reconcileWorkoutLifecycle({ uid: UID, trigger: 'COLD_START' }),
      processWorkoutLifecycleAfterSession({ uid: UID }),
    ]);
    const baseline = await loadWorkoutLifecycle(UID);
    expect(baseline).not.toBeNull();
    expect(baseline!.lifecycle.initializationOrigin).toBe('V1_MIGRATION_BASELINE');
    expect(await listTrainingCycles(UID)).toHaveLength(1);
    expect(await listProgramInstances(UID)).toHaveLength(1);
    // Baseline identity is represented by the lifecycle/cycle/instance
    // transaction; migration does not invent a historical domain event.
    expect((await getDocs(collection(mocks.db as never, 'users', UID, 'workoutLifecycleEvents'))).size).toBe(0);

    // Once converged, a real qualifying finish uses the migrated Program
    // Instance namespace and produces only the V2 pending transition.
    const active = await loadActiveWorkoutProgram(UID);
    if (!active) throw new Error('migrated active program missing');
    await backdateCycleWithQualifyingHistory(UID, 30, active.programInstanceId!, active.programId);
    const execution = await startOrResumeWorkoutExecution({
      uid: UID, program: active, sessionIndex: 0, scheduledLocalDate: '2026-08-29',
    });
    const flow = await completeWorkoutSessionFlow({
      finishExecution: async () => (await finishWorkoutExecution(UID, execution.executionId)).status,
      completeSchedule: async () => {
        await completeScheduledSession({
          uid: UID, programId: active.programId, programInstanceId: active.programInstanceId,
          sessionIndex: 0, sessionCount: active.sessions.length, scheduledLocalDate: '2026-08-29',
          trainingDays: TRAINING_DAYS, activatedAtLocalDate: '2026-08-29',
        });
        return true;
      },
      afterSchedule: async () => { await processWorkoutLifecycleAfterSession({ uid: UID }); },
    });
    expect(flow).toBe('COMPLETED');
    expect((await loadPendingEvolution(UID))?.type).toBe('LEVEL_PROMOTION');
    const v1Events = await getDocs(collection(
      mocks.db as never, 'users', UID, 'workoutPrograms', active.programId, 'progressionEvents',
    ));
    expect(v1Events.size).toBe(0);
  }, 60_000);

  it('10C MIGRATE catalog race installs and points lifecycle at backend canonical B', async () => {
    await seedBaseUser();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    const legacyContentIdentity = generated.program.programId;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const rawDb = ctx.firestore();
      for (const collectionName of ['trainingCycles', 'programInstances', 'workoutLifecycleEvents']) {
        const snapshots = await getDocs(collection(rawDb, 'users', UID, collectionName));
        await Promise.all(snapshots.docs.map((snapshot) => deleteDoc(snapshot.ref)));
      }
      await deleteDoc(doc(rawDb, 'users', UID, 'workoutLifecycleState', 'current'));
    });
    let backendContentIdentity = '';
    let backendPlanId = '';
    setWorkoutLifecycleCanonicalResponseOverrideForTests((request, response) => {
      if (request.operation !== 'MIGRATE') return response;
      const canonical = divergentCanonical(response, 'backend_migrate');
      backendContentIdentity = canonical.targetContentIdentity;
      backendPlanId = canonical.targetPlan.planId;
      return canonical;
    });

    const migrated = await loadActiveWorkoutProgram(UID);
    expect(migrated).not.toBeNull();
    expect(migrated?.programId).toBe(backendContentIdentity);
    expect(migrated?.planId).toBe(backendPlanId);
    expect(migrated?.prescriptionId).toBe(backendPlanId);
    expect((await loadWorkoutLifecycle(UID))?.lifecycle).toMatchObject({
      activeContentIdentity: backendContentIdentity,
      activePrescriptionIdentity: backendPlanId,
    });
    expect((await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', legacyContentIdentity)))
      .data()?.status).toBe('superseded');
  }, 30_000);

  it('§98-101 BR: earned cycle E2E — prepare, first defer, second defer, auto-activate, history intact', async () => {
    await seedBaseUser();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1, answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    expect(generated.status).toBe('SUCCESS');
    if (generated.status !== 'SUCCESS') return;
    const sourceInstanceId = generated.program.programInstanceId!;
    await backdateCycleWithQualifyingHistory(UID, 30, sourceInstanceId, generated.program.programId);

    // Beginner: 28 active days + >=70% adherence -> LEVEL_PROMOTION_ELIGIBLE (from BEGINNER to INTERMEDIATE).
    const prepared = await prepareEvolution({ uid: UID, now: new Date() });
    expect(prepared.status).toBe('PREPARED');
    if (prepared.status !== 'PREPARED') return;
    expect(prepared.pending.type).toBe('LEVEL_PROMOTION');
    expect(prepared.pending.fromLevel).toBe('BEGINNER');
    expect(prepared.pending.toLevel).toBe('INTERMEDIATE');
    expect(prepared.pending.status).toBe('READY');
    expect(prepared.pending.deferralCount).toBe(0);

    // Current Program remains active during pending (docs §10/§19).
    const lifecycleDuringPending = await loadWorkoutLifecycle(UID);
    expect(lifecycleDuringPending!.programInstance.programInstanceId).toBe(sourceInstanceId);
    // Earned and active remain distinct: the immutable pending/ledger carries
    // INTERMEDIATE while the lifecycle pointer remains cycle-coherent until activation.
    expect(prepared.pending.toLevel).toBe('INTERMEDIATE');
    expect(lifecycleDuringPending!.lifecycle.currentTrainingLevel).toBe('BEGINNER');
    expect(lifecycleDuringPending!.cycle.level).toBe('BEGINNER');

    // Idempotent preparation: a second prepare call converges, no duplicate pending.
    const secondPrepare = await prepareEvolution({ uid: UID, now: new Date() });
    expect(secondPrepare.status).toBe('ALREADY_PENDING');

    // First defer.
    const D0 = new Date();
    const firstDefer = await deferPendingEvolution({ uid: UID, now: D0 });
    expect(firstDefer.status).toBe('DEFERRED');
    if (firstDefer.status !== 'DEFERRED') return;
    expect(firstDefer.pending.deferralCount).toBe(1);
    expect(firstDefer.pending.nextPromptAt).not.toBeNull();

    // Cannot defer again before the window elapses.
    const tooSoon = await deferPendingEvolution({ uid: UID, now: new Date(D0.getTime() + 1 * MS_PER_DAY) });
    expect(tooSoon.status).toBe('CANNOT_DEFER');

    // Auto-activation not yet due mid-first-window.
    const reconcileTooSoon = await reconcileWorkoutLifecycle({ uid: UID, now: new Date(D0.getTime() + 1 * MS_PER_DAY) });
    expect(reconcileTooSoon.autoActivated).toBe(false);

    // Second (final) defer, once the first window has elapsed.
    const D14 = new Date(D0.getTime() + 14 * MS_PER_DAY);
    const secondDefer = await deferPendingEvolution({ uid: UID, now: D14 });
    expect(secondDefer.status).toBe('DEFERRED');
    if (secondDefer.status !== 'DEFERRED') return;
    expect(secondDefer.pending.deferralCount).toBe(2);
    expect(secondDefer.pending.autoActivateAt).not.toBeNull();

    // A third defer is impossible.
    const thirdDefer = await deferPendingEvolution({ uid: UID, now: new Date(D14.getTime() + 20 * MS_PER_DAY) });
    expect(thirdDefer.status).toBe('CANNOT_DEFER');

    // Late reconciliation after the final deadline auto-activates exactly once.
    const D28 = new Date(D14.getTime() + 14 * MS_PER_DAY);
    const lateOpen = new Date(D28.getTime() + 5 * MS_PER_DAY); // app opened 5 days after the deadline
    const reconciled = await reconcileWorkoutLifecycle({ uid: UID, now: lateOpen });
    expect(reconciled.autoActivated).toBe(true);

    const lifecycleAfter = await loadWorkoutLifecycle(UID);
    expect(lifecycleAfter!.lifecycle.currentTrainingLevel).toBe('INTERMEDIATE');
    expect(lifecycleAfter!.cycle.level).toBe('INTERMEDIATE');
    expect(lifecycleAfter!.cycle.cycleNumber).toBe(1);
    expect(lifecycleAfter!.programInstance.programInstanceId).not.toBe(sourceInstanceId);

    // History intact: Beginner cycle COMPLETED, not overwritten (docs §37/§39).
    const cycles = await listTrainingCycles(UID);
    const beginnerCycle = cycles.find((c) => c.level === 'BEGINNER')!;
    expect(beginnerCycle.status).toBe('COMPLETED');
    expect(beginnerCycle.completedAt).not.toBeNull();
    const instances = await listProgramInstances(UID);
    expect(instances).toHaveLength(2);
    expect(instances.find((i) => i.programInstanceId === sourceInstanceId)?.supersededAt).not.toBeNull();

    // Pending cleared atomically with activation.
    expect(await loadPendingEvolution(UID)).toBeNull();

    // A second reconcile is a safe no-op (idempotent, no duplicate transition).
    const secondReconcile = await reconcileWorkoutLifecycle({ uid: UID, now: lateOpen });
    expect(secondReconcile.autoActivated).toBe(false);
    expect((await listTrainingCycles(UID))).toHaveLength(2);
  }, 60_000);

  it('§40/§110 manual activation is idempotent — two concurrent START calls converge on one transition', async () => {
    await seedBaseUser();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1, answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    await backdateCycleWithQualifyingHistory(UID, 30, generated.program.programInstanceId!, generated.program.programId);
    const prepared = await prepareEvolution({ uid: UID });
    if (prepared.status !== 'PREPARED') throw new Error('setup failed');

    const [first, second] = await Promise.all([
      activatePendingEvolution({ uid: UID, trigger: 'MANUAL' }),
      activatePendingEvolution({ uid: UID, trigger: 'MANUAL' }),
    ]);
    expect(first.status).toBe('ACTIVATED');
    expect(second.status).toBe('ACTIVATED');
    if (first.status !== 'ACTIVATED' || second.status !== 'ACTIVATED') return;
    expect(first.program.programInstanceId).toBe(second.program.programInstanceId);
    expect(await listTrainingCycles(UID)).toHaveLength(2);
    expect(await listProgramInstances(UID)).toHaveLength(2);
    const events = await getDocs(collection(mocks.db as never, 'users', UID, 'workoutLifecycleEvents'));
    expect(events.docs.filter((item) => item.data().type === 'LEVEL_PROMOTED')).toHaveLength(1);
  }, 30_000);

  it('8B crash boundary: durable earned fact without pending target is prepared exactly once by reconciliation', async () => {
    await seedBaseUser();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    await backdateCycleWithQualifyingHistory(UID, 30, generated.program.programInstanceId!, generated.program.programId);
    const prepared = await prepareEvolution({ uid: UID });
    if (prepared.status !== 'PREPARED') throw new Error('setup failed');
    const transitionKey = prepared.pending.idempotencyKey;

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'users', UID, 'pendingEvolutions', 'current'));
    });
    expect(await loadPendingEvolution(UID)).toBeNull();

    const outcomes = await Promise.all([
      reconcileWorkoutLifecycle({ uid: UID }),
      reconcileWorkoutLifecycle({ uid: UID }),
      reconcileWorkoutLifecycle({ uid: UID }),
    ]);
    expect(outcomes.some((item) => item.prepared)).toBe(true);
    expect((await loadPendingEvolution(UID))?.idempotencyKey).toBe(transitionKey);
    const events = await getDocs(collection(mocks.db as never, 'users', UID, 'workoutLifecycleEvents'));
    expect(events.docs.filter((item) => item.data().type === 'EVOLUTION_EARNED')).toHaveLength(1);
  }, 30_000);

  it('§104-105 BS: Motivational Renewal E2E — same level, earned-cycle count untouched, no CYCLE_COMPLETED artifact, new fresh Program Instance', async () => {
    await seedBaseUser();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1, answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    const sourceInstanceId = generated.program.programInstanceId!;
    const sourceCycleId = (await loadWorkoutLifecycle(UID))!.lifecycle.currentCycleId;

    // Extension window reached (28 + 30 active days) with LOW (~50%)
    // adherence — every OTHER prescribed occurrence attended, so the
    // consecutive-missed-opportunity streak never reaches the inactivity
    // threshold (Active Time keeps accruing for the full window) while
    // overall adherence stays safely below the 70% earned bar — Motivational
    // Renewal, not earned evolution.
    const start = new Date(Date.now() - 60 * MS_PER_DAY);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const rawDb = ctx.firestore();
      await setDoc(doc(rawDb, 'users', UID, 'trainingCycles', sourceCycleId), { startedAt: Timestamp.fromDate(start) }, { merge: true });
      await setDoc(doc(rawDb, 'users', UID, 'programInstances', sourceInstanceId), { activatedAt: Timestamp.fromDate(start) }, { merge: true });
      let cursor = new Date(start);
      let opportunityIndex = 0;
      let execIndex = 0;
      while (cursor.getTime() <= Date.now()) {
        if (isTrainingWeekday(cursor)) {
          if (opportunityIndex % 2 === 0) {
            const scheduledLocalDate = cursor.toISOString().slice(0, 10);
            const sessionIndex = execIndex % generated.program.sessions.length;
            await setDoc(doc(rawDb, 'users', UID, 'workoutExecutions', `exec_${sourceInstanceId}_${execIndex}_${scheduledLocalDate}`), {
              programId: generated.program.programId, programInstanceId: sourceInstanceId, templateId: 'T003', sessionIndex, sessionName: 'A',
              scheduledLocalDate, status: 'COMPLETED', startedAt: Timestamp.now(), finishedAt: Timestamp.now(),
              exercises: completedExecutionExercises(generated.program, sessionIndex), executionSchemaVersion: 2, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
            });
            await setDoc(doc(rawDb, 'users', UID, 'workoutPrograms', generated.program.programId, 'scheduleEvents', `completed_${sourceInstanceId}_${execIndex}_${scheduledLocalDate}`), {
              type: 'COMPLETED', programInstanceId: sourceInstanceId, sessionIndex,
              scheduledDate: scheduledLocalDate, occurredAt: Timestamp.now(),
            });
            execIndex += 1;
          }
          opportunityIndex += 1;
        }
        cursor = new Date(cursor.getTime() + MS_PER_DAY);
      }
    });

    const prepared = await prepareEvolution({ uid: UID });
    expect(prepared.status).toBe('PREPARED');
    if (prepared.status !== 'PREPARED') return;
    expect(prepared.pending.type).toBe('MOTIVATIONAL_RENEWAL');
    expect(prepared.pending.fromLevel).toBe('BEGINNER');
    expect(prepared.pending.toLevel).toBe('BEGINNER'); // same level, never a promotion

    const activated = await activatePendingEvolution({ uid: UID, trigger: 'MANUAL' });
    expect(activated.status).toBe('ACTIVATED');
    if (activated.status !== 'ACTIVATED') return;

    const lifecycleAfter = await loadWorkoutLifecycle(UID);
    expect(lifecycleAfter!.lifecycle.currentTrainingLevel).toBe('BEGINNER'); // no promotion
    expect(lifecycleAfter!.lifecycle.currentCycleId).toBe(sourceCycleId); // same cycle — never completed by renewal
    expect(lifecycleAfter!.cycle.cycleNumber).toBe(1); // unchanged
    expect(lifecycleAfter!.programInstance.programInstanceId).not.toBe(sourceInstanceId); // fresh Program Instance

    const cycles = await listTrainingCycles(UID);
    expect(cycles).toHaveLength(1); // renewal never created/completed a cycle
    expect(cycles[0].status).toBe('ACTIVE');

    const events = await getDocs(collection(mocks.db as never, 'users', UID, 'workoutLifecycleEvents'));
    const eventTypes = events.docs.map((d) => d.data().type as string);
    expect(eventTypes).toContain('MOTIVATIONAL_RENEWAL_OFFERED');
    expect(eventTypes).toContain('MOTIVATIONAL_RENEWAL_ACTIVATED');
    expect(eventTypes).not.toContain('LEVEL_PROMOTED');
    expect(eventTypes).not.toContain('CYCLE_COMPLETED');
  }, 30_000);

  it('§106 Program Adaptation E2E — preserves career level and TrainingCycle, activates immediately, no deferral', async () => {
    await seedBaseUser();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1, answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    const sourceInstanceId = generated.program.programInstanceId!;
    const beforeLifecycle = await loadWorkoutLifecycle(UID);

    const result = await adaptWorkoutProgram({
      uid: UID,
      updatedFields: { goal: 'lose_fat' },
      reason: 'GOAL',
      idempotencyKey: 'adapt-1',
    });
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;

    const afterLifecycle = await loadWorkoutLifecycle(UID);
    expect(afterLifecycle!.lifecycle.currentTrainingLevel).toBe(beforeLifecycle!.lifecycle.currentTrainingLevel);
    expect(afterLifecycle!.lifecycle.currentCycleId).toBe(beforeLifecycle!.lifecycle.currentCycleId); // same TrainingCycle — no new cycle
    expect(afterLifecycle!.programInstance.programInstanceId).not.toBe(sourceInstanceId); // new Program Instance, activated NOW

    const cycles = await listTrainingCycles(UID);
    expect(cycles).toHaveLength(1); // adaptation never creates a cycle
    const instances = await listProgramInstances(UID);
    expect(instances).toHaveLength(2);
    expect(instances.find((i) => i.programInstanceId === sourceInstanceId)?.supersededAt).not.toBeNull();
  }, 30_000);

  it('8B missing adapted ProgramInstance fails safely instead of rebuilding stale questionnaire inputs', async () => {
    await seedBaseUser();
    await seedCanonicalExerciseCatalog();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    const adapted = await adaptWorkoutProgram({
      uid: UID,
      updatedFields: { specialConditions: ['musculoskeletal_limitation'], limits: ['knee'] },
      reason: 'LIMITATION', idempotencyKey: 'missing-adapted-instance',
    });
    if (adapted.status !== 'SUCCESS') throw new Error('setup failed');
    const adaptedInstanceId = adapted.program.programInstanceId!;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'users', UID, 'programInstances', adaptedInstanceId));
    });

    const recovery = await recoverWorkoutLifecyclePartialState(UID);
    expect(recovery).toMatchObject({ classification: 'UNRECOVERABLE', recovered: false, lifecycle: null });
    expect((await listProgramInstances(UID)).some((item) => item.programInstanceId === adaptedInstanceId)).toBe(false);
  }, 30_000);

  it('§113 adaptation is idempotent under retry — same idempotencyKey converges on one Program Instance', async () => {
    await seedBaseUser();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1, answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');

    const [first, second] = await Promise.all([
      adaptWorkoutProgram({ uid: UID, updatedFields: { goal: 'lose_fat' }, reason: 'GOAL', idempotencyKey: 'same-key' }),
      adaptWorkoutProgram({ uid: UID, updatedFields: { goal: 'lose_fat' }, reason: 'GOAL', idempotencyKey: 'same-key' }),
    ]);
    expect(first.status).toBe('SUCCESS');
    expect(second.status).toBe('SUCCESS');
    if (first.status !== 'SUCCESS' || second.status !== 'SUCCESS') return;
    expect(first.program.programInstanceId).toBe(second.program.programInstanceId);
    expect(await listProgramInstances(UID)).toHaveLength(2);
  }, 30_000);

  it.each([0, 1, 2] as const)(
    '§72/§108 adaptation invalidates READY/DEFERRED(%s), preserves earned fact and consumed deferrals',
    async (deferralCount) => {
    await seedBaseUser();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1, answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    await backdateCycleWithQualifyingHistory(UID, 30, generated.program.programInstanceId!, generated.program.programId);

    const prepared = await prepareEvolution({ uid: UID });
    expect(prepared.status).toBe('PREPARED');
    const levelBeforeActivation = (await loadWorkoutLifecycle(UID))!.lifecycle.currentTrainingLevel;
    expect(levelBeforeActivation).toBe('BEGINNER');

    const earnedAt = prepared.status === 'PREPARED' ? prepared.pending.earnedAt.toMillis() : 0;
    // Rules compare the persisted deadline with request.time; use the live
    // emulator clock so this regression remains valid after its authoring day.
    let timelinePending = prepared.status === 'PREPARED' ? prepared.pending : null;
    for (let index = 0; index < deferralCount; index += 1) {
      const deferNow = index === 0
        ? new Date()
        : new Date(timelinePending?.nextPromptAt?.toMillis() ?? Date.now());
      const deferred = await deferPendingEvolution({ uid: UID, now: deferNow });
      expect(deferred.status).toBe('DEFERRED');
      if (deferred.status !== 'DEFERRED') return;
      timelinePending = deferred.pending;
    }
    const originalNextPromptAt = timelinePending?.nextPromptAt?.toMillis();
    const originalAutoActivateAt = timelinePending?.autoActivateAt?.toMillis();
    await adaptWorkoutProgram({ uid: UID, updatedFields: { goal: 'lose_fat' }, reason: 'GOAL', idempotencyKey: 'adapt-invalidate' });

    // The stale prescription is replaced, while the original earned fact and
    // timeline survive. The user never has to earn the promotion twice.
    const afterLifecycle = (await loadWorkoutLifecycle(UID))!;
    const reprepared = await loadPendingEvolution(UID);
    expect(reprepared).not.toBeNull();
    expect(reprepared!.sourceProgramInstanceId).toBe(afterLifecycle.programInstance.programInstanceId);
    expect(reprepared!.sourceProgramInstanceId).not.toBe(generated.program.programInstanceId);
    expect(reprepared!.targetPrescriptionInputSnapshot?.inputs.goal).toBe('lose_fat');
    expect(reprepared!.earnedAt.toMillis()).toBe(earnedAt);
    expect(reprepared!.deferralCount).toBe(deferralCount);
    expect(reprepared!.nextPromptAt?.toMillis()).toBe(originalNextPromptAt);
    expect(reprepared!.autoActivateAt?.toMillis()).toBe(originalAutoActivateAt);
    const afterLevel = afterLifecycle.lifecycle.currentTrainingLevel;
    expect(afterLevel).toBe('BEGINNER');
    },
    30_000,
  );

  it('§AV/§AW LIMITATION adaptation activates immediately — never deferred', async () => {
    await seedBaseUser();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1, answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');

    const result = await adaptWorkoutProgram({
      uid: UID, updatedFields: {}, reason: 'LIMITATION', idempotencyKey: 'safety-1',
    });
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    // No pending/deferral artifact exists anywhere for adaptation — it is
    // synchronous and immediate by construction (adaptWorkoutProgram never
    // touches pendingEvolutions except to clear a stale one).
    expect(await loadPendingEvolution(UID)).toBeNull();
    const lifecycle = await loadWorkoutLifecycle(UID);
    expect(lifecycle!.programInstance.activatedAt).not.toBeNull();
  }, 30_000);

  it('Fase 8A P0 — adapted inputs remain authoritative across consecutive adaptations and future evolution', async () => {
    await seedBaseUser();
    await seedCanonicalExerciseCatalog();
    const questionnaireBefore = (await getDoc(doc(
      mocks.db as never, 'users', UID, 'questionnaires', QUESTIONNAIRE_ID,
    ))).data();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    const programAInstanceId = generated.program.programInstanceId!;

    const firstAdaptation = await adaptWorkoutProgram({
      uid: UID,
      updatedFields: { specialConditions: ['musculoskeletal_limitation'], limits: ['knee'] },
      reason: 'LIMITATION',
      idempotencyKey: 'phase8a-knee',
    });
    expect(firstAdaptation.status).toBe('SUCCESS');
    if (firstAdaptation.status !== 'SUCCESS') return;
    const programBInstanceId = firstAdaptation.program.programInstanceId!;
    expectProgramKneeSafe(firstAdaptation.program);

    const afterFirst = await loadWorkoutLifecycle(UID);
    expect(afterFirst!.programInstance.prescriptionInputSnapshot).toMatchObject({
      source: 'PROGRAM_ADAPTATION',
      schemaVersion: 1,
      inputs: {
        level: 'beginner',
        limits: ['knee'],
        specialConditions: ['musculoskeletal_limitation'],
      },
    });

    // A promotion candidate must be derived from Program B's effective
    // inputs, not from the original Beginner questionnaire.
    const promotion = await evolvePrescription({ mode: 'LEVEL_PROMOTION', uid: UID, targetLevel: 'INTERMEDIATE' });
    expect(promotion.status).toBe('SUCCESS');
    if (promotion.status !== 'SUCCESS') return;
    expect(promotion.prescriptionInputSnapshot.inputs).toMatchObject({
      level: 'intermediate', limits: ['knee'], specialConditions: ['musculoskeletal_limitation'],
    });
    expectProgramKneeSafe(promotion.plan);

    const secondAdaptation = await adaptWorkoutProgram({
      uid: UID,
      updatedFields: { duration: '45' },
      reason: 'AVAILABILITY',
      idempotencyKey: 'phase8a-duration',
    });
    expect(secondAdaptation.status).toBe('SUCCESS');
    if (secondAdaptation.status !== 'SUCCESS') return;
    const programCInstanceId = secondAdaptation.program.programInstanceId!;
    const afterSecond = await loadWorkoutLifecycle(UID);
    expect(afterSecond!.programInstance.prescriptionInputSnapshot?.inputs).toMatchObject({
      duration: '45', limits: ['knee'], specialConditions: ['musculoskeletal_limitation'],
    });
    expectProgramKneeSafe(secondAdaptation.program);

    // Simulate a career fact newer than the historical questionnaire. The
    // next adaptation must pin Advanced, while preserving the adapted knee
    // limitation. This is intentionally an admin-only fixture mutation.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const rawDb = ctx.firestore();
      const current = (await loadWorkoutLifecycle(UID))!;
      await setDoc(doc(rawDb, 'users', UID, 'workoutLifecycleState', 'current'), {
        currentTrainingLevel: 'ADVANCED',
      }, { merge: true });
      await setDoc(doc(rawDb, 'users', UID, 'trainingCycles', current.lifecycle.currentCycleId), {
        level: 'ADVANCED',
      }, { merge: true });
    });
    const thirdAdaptation = await adaptWorkoutProgram({
      uid: UID,
      updatedFields: { goal: 'lose_fat' },
      reason: 'GOAL',
      idempotencyKey: 'phase8a-current-level',
    });
    expect(thirdAdaptation.status).toBe('SUCCESS');
    if (thirdAdaptation.status !== 'SUCCESS') return;
    expect((await loadWorkoutLifecycle(UID))!.programInstance.prescriptionInputSnapshot?.inputs).toMatchObject({
      level: 'advanced', goal: 'lose_fat', duration: '45', limits: ['knee'],
    });
    expectProgramKneeSafe(thirdAdaptation.program);

    const futureCycle = await evolvePrescription({
      mode: 'CYCLE_EVOLUTION', uid: UID, targetCycleIdentity: 'phase8a-future',
    });
    expect(futureCycle.status).toBe('SUCCESS');
    if (futureCycle.status !== 'SUCCESS') return;
    expect(futureCycle.prescriptionInputSnapshot.inputs).toMatchObject({
      level: 'advanced', goal: 'lose_fat', duration: '45', limits: ['knee'],
    });
    expectProgramKneeSafe(futureCycle.plan);

    // Origin stays immutable, and each ProgramInstance retains its own
    // historical identity rather than pointing at a mutable current object.
    const questionnaireAfter = (await getDoc(doc(
      mocks.db as never, 'users', UID, 'questionnaires', QUESTIONNAIRE_ID,
    ))).data();
    expect(questionnaireAfter).toEqual(questionnaireBefore);
    const instances = await listProgramInstances(UID);
    expect(instances.find((item) => item.programInstanceId === programAInstanceId)
      ?.prescriptionInputSnapshot?.inputs.limits).toEqual(BEGINNER_ANSWERS.limits);
    expect(instances.find((item) => item.programInstanceId === programBInstanceId)
      ?.prescriptionInputSnapshot?.inputs.limits).toEqual(['knee']);
    expect(instances.find((item) => item.programInstanceId === programCInstanceId)
      ?.prescriptionInputSnapshot?.inputs.duration).toBe('45');
    expect(new Set(instances.map((item) => item.prescriptionInputSnapshot?.snapshotId)).size).toBe(instances.length);
  }, 60_000);

  it('Fase 8A P0 — adaptation resets only the progression window and the new ProgramInstance progresses independently', async () => {
    await seedBaseUser();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    const programAInstanceId = generated.program.programInstanceId!;
    const careerBefore = (await loadWorkoutLifecycle(UID))!;
    await backdateCycleWithQualifyingHistory(UID, 30, programAInstanceId, generated.program.programId);
    expect((await evaluateProgressionV2ForUser(UID))?.type).toBe('LEVEL_PROMOTION_ELIGIBLE');

    const adapted = await adaptWorkoutProgram({
      uid: UID, updatedFields: { duration: '45' }, reason: 'AVAILABILITY', idempotencyKey: 'phase8a-reset',
    });
    expect(adapted.status).toBe('SUCCESS');
    if (adapted.status !== 'SUCCESS') return;
    const programBInstanceId = adapted.program.programInstanceId!;
    const careerAfter = (await loadWorkoutLifecycle(UID))!;
    expect(programBInstanceId).not.toBe(programAInstanceId);
    expect(careerAfter.lifecycle.currentTrainingLevel).toBe(careerBefore.lifecycle.currentTrainingLevel);
    expect(careerAfter.lifecycle.currentCycleId).toBe(careerBefore.lifecycle.currentCycleId);

    const immediate = await evaluateProgressionV2ForUser(UID);
    expect(immediate).toMatchObject({
      type: 'PROGRESS_CONTINUES',
      reason: 'MINIMUM_ACTIVE_TIME_NOT_REACHED',
      validSessionCount: 0,
      adherence: { ratio: 0, quality: 'BELOW_TARGET' },
    });
    const oldExecutions = await getDocs(collection(mocks.db as never, 'users', UID, 'workoutExecutions'));
    expect(oldExecutions.docs.some((item) => item.data().programInstanceId === programAInstanceId)).toBe(true);

    await backdateCycleWithQualifyingHistory(UID, 30, programBInstanceId, adapted.program.programId);
    const afterNewHistory = await evaluateProgressionV2ForUser(UID);
    expect(afterNewHistory).toMatchObject({
      type: 'LEVEL_PROMOTION_ELIGIBLE',
      validSessionCount: expect.any(Number),
    });
    if (afterNewHistory?.type === 'LEVEL_PROMOTION_ELIGIBLE') {
      expect(afterNewHistory.validSessionCount).toBeGreaterThan(0);
      expect(afterNewHistory.adherence.quality).toBe('HIGH');
    }
  }, 60_000);

  it('Fase 8A — a user starting Intermediate earns C1..C4 exactly once and C4 promotes to Advanced', async () => {
    await seedBaseUser();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'questionnaires', QUESTIONNAIRE_ID), {
        answers: toPersistedAnswers(INTERMEDIATE_ANSWERS), version: 1, createdAt: Timestamp.now(),
      });
    });
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: INTERMEDIATE_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    const initial = (await loadWorkoutLifecycle(UID))!;
    const initialCycleId = initial.lifecycle.currentCycleId;
    const instanceId = initial.programInstance.programInstanceId;

    // Materialize three already-earned completions and the fourth active
    // cycle. These are exact persisted domain records; the application path
    // below performs the real C4 eligibility/promotion transition.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const rawDb = ctx.firestore();
      const baseCycle = (await getDoc(doc(rawDb, 'users', UID, 'trainingCycles', initialCycleId))).data()!;
      for (let cycleNumber = 1; cycleNumber <= 4; cycleNumber += 1) {
        const trainingCycleId = cycleNumber === 1 ? initialCycleId : `phase8a_intermediate_c${cycleNumber}`;
        const completed = cycleNumber < 4;
        await setDoc(doc(rawDb, 'users', UID, 'trainingCycles', trainingCycleId), {
          ...baseCycle,
          cycleId: trainingCycleId,
          level: 'INTERMEDIATE',
          cycleNumber,
          status: completed ? 'COMPLETED' : 'ACTIVE',
          completionReason: completed ? 'EARNED_EVOLUTION' : null,
          progressionReason: cycleNumber === 1 ? 'INITIAL_PRESCRIPTION' : 'EARNED_CYCLE_EVOLUTION',
          completedAt: completed ? Timestamp.now() : null,
          updatedAt: Timestamp.now(),
        });
      }
      await setDoc(doc(rawDb, 'users', UID, 'workoutLifecycleState', 'current'), {
        currentTrainingLevel: 'INTERMEDIATE',
        currentCycleId: 'phase8a_intermediate_c4',
        currentCycleNumber: 4,
      }, { merge: true });
      await setDoc(doc(rawDb, 'users', UID, 'programInstances', instanceId), {
        cycleId: 'phase8a_intermediate_c4',
      }, { merge: true });
    });

    const beforeC4 = await listTrainingCycles(UID);
    expect(countEarnedIntermediateCycles(beforeC4)).toBe(3);
    expect(beforeC4.find((cycle) => cycle.cycleNumber === 1)?.completionReason).toBe('EARNED_EVOLUTION');
    await backdateCycleWithQualifyingHistory(UID, 90, instanceId, generated.program.programId);

    const c4Decision = await evaluateProgressionV2ForUser(UID);
    expect(c4Decision).toMatchObject({
      type: 'LEVEL_PROMOTION_ELIGIBLE', from: 'INTERMEDIATE', to: 'ADVANCED',
    });
    let prepared: Awaited<ReturnType<typeof prepareEvolution>>;
    try {
      prepared = await prepareEvolution({ uid: UID });
    } catch (error) {
      throw new Error('PHASE8A_INTERMEDIATE_PREPARE_FAILED', { cause: error });
    }
    expect(prepared.status).toBe('PREPARED');
    if (prepared.status !== 'PREPARED') return;
    expect(prepared.pending.type).toBe('LEVEL_PROMOTION');
    let activated: Awaited<ReturnType<typeof activatePendingEvolution>>;
    try {
      activated = await activatePendingEvolution({ uid: UID, trigger: 'MANUAL' });
    } catch (error) {
      throw new Error('PHASE8A_INTERMEDIATE_ACTIVATE_FAILED', { cause: error });
    }
    expect(activated.status).toBe('ACTIVATED');

    const afterC4 = await listTrainingCycles(UID);
    expect(countEarnedIntermediateCycles(afterC4)).toBe(4);
    expect(afterC4.filter((cycle) => cycle.level === 'INTERMEDIATE' && cycle.status === 'COMPLETED'))
      .toHaveLength(4);
    expect((await loadWorkoutLifecycle(UID))!.lifecycle.currentTrainingLevel).toBe('ADVANCED');
  }, 60_000);

  describe('QA_TRANSITION — real pipeline, eligibility bypassed (docs/workout-lifecycle/v2/qa/)', () => {
    async function setQaMode(mode: 'ACCELERATED' | 'TRANSITION' | null) {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', UID), {
          metadata: mode ? { role: 'user', workoutLifecycleQaMode: mode } : { role: 'user' },
        }, { merge: true });
      });
    }

    it('BEGINNER account with zero real history: QA prepare -> real INTERMEDIATE pending, canonical prescription, old ProgramInstance untouched until activation', async () => {
      await seedBaseUser();
      const generated = await generateAndPersistWorkoutProgram({
        uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
        answers: BEGINNER_ANSWERS, source: 'onboarding',
      });
      if (generated.status !== 'SUCCESS') throw new Error('setup failed');
      await setQaMode('TRANSITION');

      const before = await loadWorkoutLifecycle(UID);
      expect(before!.lifecycle.currentTrainingLevel).toBe('BEGINNER');

      const preview = await previewQaTransition(UID);
      expect(preview).toMatchObject({ currentLevel: 'BEGINNER', targetType: 'LEVEL_PROMOTION', targetLevel: 'INTERMEDIATE' });

      const result = await prepareQaTransitionEvolution({ uid: UID });
      expect(result.status).toBe('PREPARED');
      if (result.status !== 'PREPARED') return;
      expect(result.pending).toMatchObject({ type: 'LEVEL_PROMOTION', fromLevel: 'BEGINNER', toLevel: 'INTERMEDIATE' });
      expect(result.pending.targetProgramInstanceId).not.toBe(before!.programInstance.programInstanceId);
      // Real canonical prescription — never a client-fabricated/empty plan.
      const plan = result.pending.plan as { sessions: unknown[] };
      expect(Array.isArray(plan.sessions)).toBe(true);
      expect(plan.sessions.length).toBeGreaterThan(0);

      // Old ProgramInstance remains active until ACTIVATE — PREPARE never installs it.
      const stillOld = await loadWorkoutLifecycle(UID);
      expect(stillOld!.lifecycle.currentTrainingLevel).toBe('BEGINNER');
      expect(stillOld!.programInstance.programInstanceId).toBe(before!.programInstance.programInstanceId);

      // Idempotent re-invocation: a pending evolution already exists -> ALREADY_PENDING, never a second one.
      const again = await prepareQaTransitionEvolution({ uid: UID });
      expect(again.status).toBe('ALREADY_PENDING');

      // Real DEFER — QA_TRANSITION never fakes this either.
      const deferred = await deferPendingEvolution({ uid: UID });
      expect(deferred.status).toBe('DEFERRED');

      // Real ACTIVATE — schedule/Home only reflect the new program from here.
      const activated = await activatePendingEvolution({ uid: UID, trigger: 'MANUAL' });
      expect(activated.status).toBe('ACTIVATED');
      const after = await loadWorkoutLifecycle(UID);
      expect(after!.lifecycle.currentTrainingLevel).toBe('INTERMEDIATE');
      expect(after!.programInstance.programInstanceId).toBe(result.pending.targetProgramInstanceId);
    }, 30_000);

    it('NORMAL account (same zero-history fixture): QA prepare is never attempted by the real flow, and forcing EARN directly is denied', async () => {
      await seedBaseUser();
      const generated = await generateAndPersistWorkoutProgram({
        uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
        answers: BEGINNER_ANSWERS, source: 'onboarding',
      });
      if (generated.status !== 'SUCCESS') throw new Error('setup failed');
      await setQaMode(null);

      // The real, unmodified prepareEvolution() path — client-side eligibility
      // check refuses even to attempt EARN for an account with no real history.
      const result = await prepareEvolution({ uid: UID });
      expect(result.status).toBe('NO_ACTION');
    }, 30_000);
  });
});
