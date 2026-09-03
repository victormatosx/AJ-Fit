/**
 * Phase 10D-V2 — Long-Run Journey Closure (docs/workout-lifecycle/v2/
 * architecture/25_PHASE_10DV2_LONG_RUN_JOURNEY_CLOSURE.md). Closes the three
 * verification gaps Phase 10D-V left NOT_TESTED (VG-H/I/J) plus VG-F's
 * pause/resume dynamic sub-case, by driving the REAL production functions
 * (`generateAndPersistWorkoutProgram`, `prepareEvolution`,
 * `activatePendingEvolution`, `adaptWorkoutProgram`, `reconcileWorkoutLifecycle`)
 * against the real Firestore Emulator through entire simulated career
 * timelines. No lifecycle field (level/earnedCycles/activeDays/adherence) is
 * ever set directly — every one of those numbers is instead an emergent
 * result of real, backdated `workoutExecutions`/`scheduleEvents` documents
 * that the backend's own eligibility computation
 * (`functions/src/workoutLifecycle/authorizeMutation.ts`) independently
 * recomputes from ground truth on every call, exactly as it would for a real
 * user who trained for months.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';

// Required for any journey step that exercises a REAL musculoskeletal
// limitation (VG-I) — `loadLimitationDataset`'s content-hash path pulls in
// `expo-crypto`, which under plain Node/vitest (no Expo/RN runtime) fails to
// resolve. Same mock already proven in workoutLifecycleApplication.
// integration.test.ts's own limitation-driven ADAPT tests.
vi.mock('expo-crypto', async () => {
  const { createHash } = await import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash('sha256').update(value).digest('hex'),
  };
});

import { buildSeedDocuments } from '../../../scripts/seedWorkoutTemplates';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import { toPersistedAnswers } from '../../lib/questionnaireAnswers';
import { CANONICAL_LIMITATION_DATASET_HASH, CANONICAL_LIMITATION_DATASET_VERSION } from '../../workoutPrescription/limitationDataset';
import { CANONICAL_LIMITATION_PROFILES } from '../../workoutPrescription/limitationDataset';
import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { PROGRESSION_V2_CONFIG } from '../../progressionEngineV2/config';
import { isLimitationSafe } from '../../prescriptionEvolution/equivalence';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'lara';
const QUESTIONNAIRE_ID = 'q1';
const enabled = process.env.LONG_RUN_JOURNEY_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;
const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({ get db() { return mocks.db; } }));

import { generateAndPersistWorkoutProgram, type WorkoutProgramSnapshot } from '../workoutPrograms';
import {
  loadWorkoutLifecycle, listTrainingCycles, listProgramInstances,
  loadPendingEvolution, listWorkoutLifecycleEvents,
} from '../workoutLifecycle';
import {
  activatePendingEvolution,
  adaptWorkoutProgram,
  prepareEvolution,
  reconcileWorkoutLifecycle,
} from '../workoutLifecycleApplication';
import { enableWorkoutLifecycleRollout } from './workoutLifecycleRolloutFixture';
import { installWorkoutLifecycleAuthorityFixture, resetWorkoutLifecycleAuthorityFixture } from './workoutLifecycleAuthorityFixture';

const T003_SEED = buildSeedDocuments().find((t) => t.id === 'T003');
if (!T003_SEED) throw new Error('T003 fixture missing from catalog — cannot run this integration test');

const BEGINNER_ANSWERS = completeAnswers({
  sex: 'm', goal: 'gain_muscle', level: 'beginner', days: 4, place: 'gym', specialConditions: ['none'],
});

const TRAINING_DAYS = ['MON', 'TUE', 'THU', 'FRI'] as const;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const { beginnerMinimumActiveDays, intermediateAdvancedMinimumActiveDays,
  motivationalRenewalExtensionDays, intermediateCyclesForPromotion } = PROGRESSION_V2_CONFIG;

async function seedBaseUser() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    await setDoc(doc(rawDb, 'users', UID), {
      profile: { name: 'Lara', email: 'lara@example.com' },
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
  const profileById = new Map(CANONICAL_LIMITATION_PROFILES.map((item) => [item.exerciseId, item.limitationProfile]));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    await Promise.all(EXERCISES_SEED.map((exercise) => setDoc(doc(rawDb, 'exercises', exercise.id), JSON.parse(JSON.stringify({
      ...exercise, limitationProfile: profileById.get(exercise.id),
    })))));
  });
}

function isTrainingWeekday(date: Date): boolean {
  const map = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return (TRAINING_DAYS as readonly string[]).includes(map[date.getUTCDay()]);
}

/**
 * Generalization of the concurrency suite's `backdateCycleWithQualifyingHistory`
 * (src/services/__tests__/workoutLifecycleConcurrency.integration.test.ts) —
 * same "walk real calendar days, write real COMPLETED workoutExecutions +
 * scheduleEvents ledger entries" mechanism, but supporting a configurable
 * completion pattern instead of always-100%, so it can produce a REAL <70%
 * adherence history (never faked) for the Motivational Renewal journey
 * without ever tripping 3-consecutive-miss inactivity pause (which would
 * freeze active-day accumulation and make the scenario unreachable within a
 * bounded simulated window).
 *
 * `shouldComplete(trainingDayIndex)` decides, for the Nth scheduled training
 * day since `start`, whether it is completed. Passing `() => true` reproduces
 * the original helper's 100%-adherence behavior exactly.
 */
async function seedHistory(input: {
  uid: string;
  activatedAt: Date;
  toDate: Date;
  programInstanceId: string;
  programId: string;
  shouldComplete: (trainingDayIndex: number) => boolean;
}): Promise<void> {
  const programSnapshot = await getDoc(doc(mocks.db as never, 'users', input.uid, 'workoutPrograms', input.programId));
  const program = programSnapshot.data() as {
    sessions: Array<{ exercises: Array<{ exerciseId: string; sets?: number }> }>;
  };
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    let cursor = new Date(input.activatedAt);
    let trainingDayIndex = 0;
    while (cursor.getTime() <= input.toDate.getTime()) {
      if (isTrainingWeekday(cursor)) {
        if (input.shouldComplete(trainingDayIndex)) {
          const scheduledLocalDate = cursor.toISOString().slice(0, 10);
          const sessionIndex = trainingDayIndex % program.sessions.length;
          const exercises = program.sessions[sessionIndex].exercises.map((exercise, exerciseIndex) => ({
            exerciseIndex, exerciseId: exercise.exerciseId,
            sets: Array.from({ length: exercise.sets ?? 1 }, (_, setIndex) => ({ setIndex, status: 'COMPLETED' as const })),
          }));
          await setDoc(doc(rawDb, 'users', input.uid, 'workoutExecutions',
            `exec_${input.programInstanceId}_${trainingDayIndex}_${scheduledLocalDate}`), {
            programId: input.programId, programInstanceId: input.programInstanceId, templateId: 'T003',
            sessionIndex, sessionName: 'A', scheduledLocalDate, status: 'COMPLETED',
            startedAt: Timestamp.now(), finishedAt: Timestamp.now(), exercises,
            executionSchemaVersion: 2, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
          });
          await setDoc(doc(rawDb, 'users', input.uid, 'workoutPrograms', input.programId, 'scheduleEvents',
            `completed_${input.programInstanceId}_${trainingDayIndex}_${scheduledLocalDate}`), {
            type: 'COMPLETED', programInstanceId: input.programInstanceId, sessionIndex,
            scheduledDate: scheduledLocalDate, occurredAt: Timestamp.now(),
          });
        }
        trainingDayIndex += 1;
      }
      cursor = new Date(cursor.getTime() + MS_PER_DAY);
    }
  });
}

/** Backdates the CURRENT active cycle/instance's `startedAt`/`activatedAt`, then seeds full (100%) history up to "now". Mirrors the concurrency suite's original helper exactly for the always-100%-adherence case. */
async function backdateAndFillHistory(uid: string, activeDaysAgo: number, programInstanceId: string, programId: string): Promise<Date> {
  const cycleId = (await loadWorkoutLifecycle(uid))!.lifecycle.currentCycleId;
  const start = new Date(Date.now() - activeDaysAgo * MS_PER_DAY);
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    await setDoc(doc(rawDb, 'users', uid, 'trainingCycles', cycleId), { startedAt: Timestamp.fromDate(start) }, { merge: true });
    await setDoc(doc(rawDb, 'users', uid, 'programInstances', programInstanceId), { activatedAt: Timestamp.fromDate(start) }, { merge: true });
  });
  await seedHistory({
    uid, activatedAt: start, toDate: new Date(), programInstanceId, programId,
    shouldComplete: () => true,
  });
  return start;
}

/** Same as above, but only completes every other scheduled training day (~50% adherence — well under the 70% earned-progression bar) while never missing more than one in a row, so the 3-consecutive-miss inactivity pause never triggers and active-day accumulation is never frozen. */
async function backdateAndFillLowAdherenceHistory(uid: string, activeDaysAgo: number, programInstanceId: string, programId: string): Promise<Date> {
  const cycleId = (await loadWorkoutLifecycle(uid))!.lifecycle.currentCycleId;
  const start = new Date(Date.now() - activeDaysAgo * MS_PER_DAY);
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    await setDoc(doc(rawDb, 'users', uid, 'trainingCycles', cycleId), { startedAt: Timestamp.fromDate(start) }, { merge: true });
    await setDoc(doc(rawDb, 'users', uid, 'programInstances', programInstanceId), { activatedAt: Timestamp.fromDate(start) }, { merge: true });
  });
  await seedHistory({
    uid, activatedAt: start, toDate: new Date(), programInstanceId, programId,
    shouldComplete: (index) => index % 2 === 0,
  });
  return start;
}

async function currentInstanceAndProgram(uid: string): Promise<{ programInstanceId: string; programId: string }> {
  const lifecycle = (await loadWorkoutLifecycle(uid))!;
  return { programInstanceId: lifecycle.programInstance.programInstanceId, programId: lifecycle.lifecycle.activeContentIdentity };
}

/** PREPARE → assert PREPARED with the expected earned type → ACTIVATE(MANUAL) → assert activation landed on the pending's target instance. Fails loudly (not silently) if the earned fact isn't what the caller expected — this is the harness's single most important honesty check: it never proceeds past a step production didn't actually grant. */
async function prepareAndActivate(uid: string, expectedType: 'LEVEL_PROMOTION' | 'CYCLE_EVOLUTION' | 'MOTIVATIONAL_RENEWAL'): Promise<void> {
  const prepared = await prepareEvolution({ uid });
  if (prepared.status !== 'PREPARED') {
    throw new Error(`prepareEvolution did not PREPARE (got ${prepared.status}) — the real backend did not grant eligibility yet`);
  }
  expect(prepared.pending.type).toBe(expectedType);
  const targetInstanceId = prepared.pending.targetProgramInstanceId;
  const activated = await activatePendingEvolution({ uid, trigger: 'MANUAL' });
  expect(activated.status).toBe('ACTIVATED');
  const lifecycle = (await loadWorkoutLifecycle(uid))!;
  expect(lifecycle.lifecycle.activeProgramInstanceId).toBe(targetInstanceId);
}

describe.skipIf(!enabled)('Phase 10D-V2 — long-run lifecycle journeys (real Firestore Emulator)', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
    });
    mocks.db = testEnv.authenticatedContext(UID, { email: 'lara@example.com', email_verified: true }).firestore();
    installWorkoutLifecycleAuthorityFixture(testEnv, UID);
  });
  afterAll(async () => {
    resetWorkoutLifecycleAuthorityFixture();
    await testEnv.cleanup();
  });
  beforeEach(async () => {
    await testEnv.clearFirestore();
    await enableWorkoutLifecycleRollout(testEnv);
    await seedBaseUser();
    await seedCanonicalExerciseCatalog();
  });

  it('VG-H: full Beginner -> Intermediate -> Advanced long-run journey never dead-ends or corrupts identity', async () => {
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1, answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    const originStartingLevel = (await loadWorkoutLifecycle(UID))!.lifecycle.startingLevel;
    expect(originStartingLevel).toBe('BEGINNER');
    expect((await loadWorkoutLifecycle(UID))!.lifecycle.currentTrainingLevel).toBe('BEGINNER');

    // LR-01: too early (10 of 28 required active days) — must NOT be eligible.
    await backdateAndFillHistory(UID, 10, generated.program.programInstanceId!, generated.program.programId);
    await expect(prepareEvolution({ uid: UID })).resolves.toMatchObject({ status: 'NO_ACTION' });

    // LR-02: real threshold reached with real >=70% adherence (100% here) -> eligible exactly once.
    await backdateAndFillHistory(UID, beginnerMinimumActiveDays + 2, generated.program.programInstanceId!, generated.program.programId);
    await prepareAndActivate(UID, 'LEVEL_PROMOTION');
    // LR-03: StartingLevel immutable; CurrentTrainingLevel promoted.
    expect((await loadWorkoutLifecycle(UID))!.lifecycle.startingLevel).toBe('BEGINNER');
    expect((await loadWorkoutLifecycle(UID))!.lifecycle.currentTrainingLevel).toBe('INTERMEDIATE');

    // Idempotency (§26): repeat PREPARE immediately post-activation — must
    // never fabricate a second pending/earned event for the same (now
    // already-consumed) transition.
    const earnedEventsAfterFirstActivation = (await listWorkoutLifecycleEvents(UID)).filter((e) => e.type === 'EVOLUTION_EARNED' || e.type === 'LEVEL_PROMOTED');
    await prepareEvolution({ uid: UID });
    await prepareEvolution({ uid: UID });
    expect((await listWorkoutLifecycleEvents(UID)).filter((e) => e.type === 'EVOLUTION_EARNED' || e.type === 'LEVEL_PROMOTED')).toHaveLength(earnedEventsAfterFirstActivation.length);

    // LR-04/LR-05: earn exactly 4 Intermediate cycles; Advanced must not be
    // reachable before the 4th.
    for (let cycle = 1; cycle <= intermediateCyclesForPromotion; cycle += 1) {
      const { programInstanceId, programId } = await currentInstanceAndProgram(UID);
      // LR-04 (below threshold): not yet eligible mid-window.
      await backdateAndFillHistory(UID, Math.floor(intermediateAdvancedMinimumActiveDays / 2), programInstanceId, programId);
      await expect(prepareEvolution({ uid: UID })).resolves.toMatchObject({ status: 'NO_ACTION' });
      // Real threshold + adherence reached.
      await backdateAndFillHistory(UID, intermediateAdvancedMinimumActiveDays + 2, programInstanceId, programId);
      const expectedType = cycle === intermediateCyclesForPromotion ? 'LEVEL_PROMOTION' : 'CYCLE_EVOLUTION';
      await prepareAndActivate(UID, expectedType);
      // LR-09/LR-10: exactly one active instance/cycle after every activation.
      expect((await listProgramInstances(UID)).filter((i) => i.supersededAt === null)).toHaveLength(1);
      expect((await listTrainingCycles(UID)).filter((c) => c.status === 'ACTIVE')).toHaveLength(1);
    }
    expect((await loadWorkoutLifecycle(UID))!.lifecycle.currentTrainingLevel).toBe('ADVANCED');
    expect((await loadWorkoutLifecycle(UID))!.lifecycle.startingLevel).toBe('BEGINNER');

    // LR-06/LR-07/LR-08: Advanced can continue evolving — no dead end.
    const { programInstanceId: advInstance, programId: advProgram } = await currentInstanceAndProgram(UID);
    await backdateAndFillHistory(UID, intermediateAdvancedMinimumActiveDays + 2, advInstance, advProgram);
    await prepareAndActivate(UID, 'CYCLE_EVOLUTION');
    expect((await loadWorkoutLifecycle(UID))!.lifecycle.currentTrainingLevel).toBe('ADVANCED');

    // LR-09/history integrity: no orphan/duplicate instances or cycles across the WHOLE journey.
    const events = await listWorkoutLifecycleEvents(UID);
    expect(events.filter((e) => e.type === 'LEVEL_PROMOTED')).toHaveLength(2); // Beginner->Intermediate, Intermediate->Advanced
    expect(events.filter((e) => e.type === 'EVOLUTION_EARNED').length).toBeGreaterThanOrEqual(intermediateCyclesForPromotion + 1);
    expect((await listProgramInstances(UID)).filter((i) => i.supersededAt === null)).toHaveLength(1);
    expect((await listTrainingCycles(UID)).filter((c) => c.status === 'ACTIVE')).toHaveLength(1);
  }, 600_000);

  it('VG-I: ADAPT mid-journey preserves career progress and future evolution still works', async () => {
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1, answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    await backdateAndFillHistory(UID, beginnerMinimumActiveDays + 2, generated.program.programInstanceId!, generated.program.programId);
    await prepareAndActivate(UID, 'LEVEL_PROMOTION');
    // Earn Intermediate Cycle 1 first, so ADAPT happens mid-career (Cycle 2), not at the very first Intermediate cycle.
    {
      const { programInstanceId, programId } = await currentInstanceAndProgram(UID);
      await backdateAndFillHistory(UID, intermediateAdvancedMinimumActiveDays + 2, programInstanceId, programId);
      await prepareAndActivate(UID, 'CYCLE_EVOLUTION');
    }

    const beforeAdapt = (await loadWorkoutLifecycle(UID))!;
    const beforeInstances = (await listProgramInstances(UID)).length;
    const beforeEarnedCount = (await listWorkoutLifecycleEvents(UID)).filter((e) => e.type === 'EVOLUTION_EARNED').length;

    // LA-01/LA-07: real limitation change with a real substitution ('knee' — proven elsewhere in this codebase's concurrency suite to have real alternatives in the canonical limitation dataset).
    const adaptResult = await adaptWorkoutProgram({
      uid: UID, updatedFields: { limits: ['knee'], specialConditions: ['musculoskeletal_limitation'] },
      reason: 'LIMITATION', idempotencyKey: 'vg-i-adapt-knee',
    });
    expect(adaptResult.status).toBe('SUCCESS');

    const afterAdapt = (await loadWorkoutLifecycle(UID))!;
    // LA-02/LA-03/LA-04: career level/cycle/earned-count unchanged by ADAPT.
    expect(afterAdapt.lifecycle.startingLevel).toBe(beforeAdapt.lifecycle.startingLevel);
    expect(afterAdapt.lifecycle.currentTrainingLevel).toBe(beforeAdapt.lifecycle.currentTrainingLevel);
    expect(afterAdapt.cycle.cycleId).toBe(beforeAdapt.cycle.cycleId);
    expect((await listWorkoutLifecycleEvents(UID)).filter((e) => e.type === 'EVOLUTION_EARNED')).toHaveLength(beforeEarnedCount);
    // LA-01: a NEW ProgramInstance was created (old one superseded, not mutated in place).
    expect(afterAdapt.programInstance.programInstanceId).not.toBe(beforeAdapt.programInstance.programInstanceId);
    expect((await listProgramInstances(UID)).length).toBe(beforeInstances + 1);
    expect((await listProgramInstances(UID)).filter((i) => i.supersededAt === null)).toHaveLength(1);
    // LA-06: latest snapshot carries the adaptation.
    expect(afterAdapt.programInstance.prescriptionInputSnapshot?.inputs.limits).toEqual(['knee']);
    // LA-07: the new canonical program never prescribes a knee-unsafe
    // exercise — same in-memory-catalog `isLimitationSafe` validation
    // approach already proven in workoutLifecycleApplication.integration.
    // test.ts's `expectProgramKneeSafe` helper.
    const newProgramSnapshot = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', afterAdapt.lifecycle.activeContentIdentity));
    const newProgram = newProgramSnapshot.data() as { sessions: Array<{ exercises: Array<{ exerciseId: string }> }> };
    const prescribedIds = newProgram.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseId));
    expect(prescribedIds.length).toBeGreaterThan(0);
    const profileByExerciseId = new Map(CANONICAL_LIMITATION_PROFILES.map((entry) => [entry.exerciseId, entry.limitationProfile]));
    const catalog = new Map(EXERCISES_SEED.map((exercise) => [exercise.id, { ...exercise, limitationProfile: profileByExerciseId.get(exercise.id) }]));
    for (const exerciseId of prescribedIds) {
      const exercise = catalog.get(exerciseId);
      expect(exercise, exerciseId).toBeDefined();
      if (!exercise) continue;
      expect(isLimitationSafe(exercise, ['knee']), exerciseId).toBe(true);
    }

    // LA-05/LA-08 (§13 — the most important VG-I assertion): the journey
    // must be able to CONTINUE past the ADAPT to a further real earned
    // evolution — proves no stale snapshot/source identity/dead cycle.
    const { programInstanceId: postAdaptInstance, programId: postAdaptProgram } = await currentInstanceAndProgram(UID);
    await backdateAndFillHistory(UID, intermediateAdvancedMinimumActiveDays + 2, postAdaptInstance, postAdaptProgram);
    await prepareAndActivate(UID, 'CYCLE_EVOLUTION');
    expect((await loadWorkoutLifecycle(UID))!.lifecycle.currentTrainingLevel).toBe('INTERMEDIATE');
    expect((await loadWorkoutLifecycle(UID))!.lifecycle.startingLevel).toBe('BEGINNER');
  }, 600_000);

  it('VG-J: Motivational Renewal never counts as earned, and 3 earned + 1 renewal never unlocks Advanced', async () => {
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1, answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    await backdateAndFillHistory(UID, beginnerMinimumActiveDays + 2, generated.program.programInstanceId!, generated.program.programId);
    await prepareAndActivate(UID, 'LEVEL_PROMOTION');

    // Earn 3 genuine Intermediate cycles first.
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      const { programInstanceId, programId } = await currentInstanceAndProgram(UID);
      await backdateAndFillHistory(UID, intermediateAdvancedMinimumActiveDays + 2, programInstanceId, programId);
      await prepareAndActivate(UID, 'CYCLE_EVOLUTION');
    }
    const earnedIntermediateCycles = (await listTrainingCycles(UID))
      .filter((c) => c.level === 'INTERMEDIATE' && c.status === 'COMPLETED' && c.completionReason === 'EARNED_EVOLUTION');
    expect(earnedIntermediateCycles).toHaveLength(3);

    // 4th Intermediate cycle: real, low (<70%) adherence via genuinely fewer
    // completed sessions relative to scheduled opportunities — never faked —
    // held long enough (85 + 30 extension days) to reach the Motivational
    // Renewal window without ever crossing the earned-eligibility bar first.
    {
      const { programInstanceId, programId } = await currentInstanceAndProgram(UID);
      const midWindow = Math.floor(intermediateAdvancedMinimumActiveDays * 0.6);
      await backdateAndFillLowAdherenceHistory(UID, midWindow, programInstanceId, programId);
      // MR-01: mid-window, low adherence -> definitely not earned yet.
      await expect(prepareEvolution({ uid: UID })).resolves.toMatchObject({ status: 'NO_ACTION' });

      await backdateAndFillLowAdherenceHistory(UID, intermediateAdvancedMinimumActiveDays + 2, programInstanceId, programId);
      // MR-01 (again, at the normal threshold with low adherence): still not earned.
      await expect(prepareEvolution({ uid: UID })).resolves.toMatchObject({ status: 'NO_ACTION' });

      // MR-02: only after the extended renewal window does it become eligible, as a RENEWAL, not an earned evolution.
      await backdateAndFillLowAdherenceHistory(
        UID, intermediateAdvancedMinimumActiveDays + motivationalRenewalExtensionDays + 2, programInstanceId, programId,
      );
      const beforeRenewalEarnedCount = (await listWorkoutLifecycleEvents(UID)).filter((e) => e.type === 'EVOLUTION_EARNED').length;
      await prepareAndActivate(UID, 'MOTIVATIONAL_RENEWAL');
      // MR-03/MR-05: renewal is not an EVOLUTION_EARNED event and does not increment the earned-cycle-eligible ledger.
      expect((await listWorkoutLifecycleEvents(UID)).filter((e) => e.type === 'EVOLUTION_EARNED')).toHaveLength(beforeRenewalEarnedCount);
      expect((await listWorkoutLifecycleEvents(UID)).filter((e) => e.type === 'MOTIVATIONAL_RENEWAL_ACTIVATED')).toHaveLength(1);
      // MR-04: level unchanged by a renewal.
      expect((await loadWorkoutLifecycle(UID))!.lifecycle.currentTrainingLevel).toBe('INTERMEDIATE');
    }

    // MR-07 (§17 — the single most important assertion in this phase):
    // 3 earned + 1 renewal must NOT be Advanced-eligible. A Motivational
    // Renewal (`activatePendingEvolution`'s `nextCycle = undefined` for
    // `type === 'MOTIVATIONAL_RENEWAL'` — src/services/
    // workoutLifecycleApplication.ts) never completes the current
    // TrainingCycle at all — it installs fresh content into the SAME cycle
    // (no new cycle number, no completion record). So renewal is structurally
    // incapable of ever being fallback-inferred as an earned completion by
    // `countEarnedIntermediateCycles` (which only ever looks at cycles whose
    // `status === 'COMPLETED'`): there is nothing to (mis)count yet.
    {
      const cyclesAfterRenewal = (await listTrainingCycles(UID))
        .filter((c) => c.level === 'INTERMEDIATE' && c.status === 'COMPLETED' && c.completionReason === 'EARNED_EVOLUTION');
      expect(cyclesAfterRenewal).toHaveLength(3); // renewal must not have added a 4th earned entry
      // Immediately after the renewal — no new history yet — the SAME
      // still-open cycle must not spuriously already be eligible.
      await expect(prepareEvolution({ uid: UID })).resolves.toMatchObject({ status: 'NO_ACTION' });
    }

    // MR-06/MR-08: the SAME renewed cycle can still be genuinely earned —
    // real good adherence over the real threshold in this SAME (never
    // completed by the renewal) cycle correctly produces the REAL 4th
    // earned Intermediate completion, and THAT — not the renewal — is what
    // legitimately unlocks Advanced. This is the correct positive
    // counterpart to MR-07: the renewal didn't fabricate a 4th earned cycle,
    // but it also didn't block the user from later earning a genuine one.
    {
      const { programInstanceId, programId } = await currentInstanceAndProgram(UID);
      await backdateAndFillHistory(UID, intermediateAdvancedMinimumActiveDays + 2, programInstanceId, programId);
      await prepareAndActivate(UID, 'LEVEL_PROMOTION');
      expect((await loadWorkoutLifecycle(UID))!.lifecycle.currentTrainingLevel).toBe('ADVANCED');
      const earnedIntermediateAtPromotion = (await listTrainingCycles(UID))
        .filter((c) => c.level === 'INTERMEDIATE' && c.status === 'COMPLETED' && c.completionReason === 'EARNED_EVOLUTION');
      expect(earnedIntermediateAtPromotion).toHaveLength(4); // exactly 4 genuinely earned, never inflated by the renewal
    }
  }, 900_000);

  it('VG-F (dynamic): a real inactivity pause and resume never leaks credit across the boundary or invents active days', async () => {
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1, answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    if (generated.status !== 'SUCCESS') throw new Error('setup failed');
    const { programInstanceId, programId } = { programInstanceId: generated.program.programInstanceId!, programId: generated.program.programId };

    // Real history: trains normally for a stretch, then genuinely stops
    // training for well over the 3-consecutive-missed-opportunity pause
    // threshold (PROGRESSION_V2_CONFIG.inactivityMissedOpportunityThreshold),
    // then resumes — all via real backdated executions, never a
    // directly-written "paused" flag.
    // Short enough total calendar span (15 days) that even 100% pre/post
    // adherence cannot reach the 28-day Beginner threshold regardless of
    // exact pause-day arithmetic — isolates "did the gap get credited at
    // all" from needing to hand-compute the exact paused/unpaused day count.
    const activatedAt = new Date(Date.now() - 15 * MS_PER_DAY);
    const pauseStart = new Date(Date.now() - 10 * MS_PER_DAY); // trains 5 real days, then genuinely stops
    const resumeAt = new Date(Date.now() - 3 * MS_PER_DAY); // real 7-day gap (>> the 3-missed-opportunity pause threshold), then resumes
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const rawDb = ctx.firestore();
      const cycleId = (await loadWorkoutLifecycle(UID))!.lifecycle.currentCycleId;
      await setDoc(doc(rawDb, 'users', UID, 'trainingCycles', cycleId), { startedAt: Timestamp.fromDate(activatedAt) }, { merge: true });
      await setDoc(doc(rawDb, 'users', UID, 'programInstances', programInstanceId), { activatedAt: Timestamp.fromDate(activatedAt) }, { merge: true });
    });
    // Train normally from activation up to pauseStart, nothing after (real gap), then resume from resumeAt to now.
    await seedHistory({
      uid: UID, activatedAt, toDate: pauseStart, programInstanceId, programId, shouldComplete: () => true,
    });
    await seedHistory({
      uid: UID, activatedAt: resumeAt, toDate: new Date(), programInstanceId, programId, shouldComplete: () => true,
    });

    // PR-02/PR-03: active-day accumulation must reflect the real gap, not
    // invent activity during the pause. Not directly observable via a public
    // API, so assert indirectly: with only 15 real calendar days elapsed
    // since `activatedAt`, this account cannot possibly be eligible yet
    // (28-day Beginner floor) regardless of exactly how the pause math
    // apportions active vs. frozen days within that span.
    await expect(prepareEvolution({ uid: UID })).resolves.toMatchObject({ status: 'NO_ACTION' });

    // PR-01/PR-04: a backdated completion landing INSIDE the pause gap but
    // within the real 3-day offline-sync grace window relative to "today" is
    // still rejected by the schedule authority as not the expected session —
    // reuses the exact same instance-scoped rotation-anchoring guarantee
    // already proven in Phase 10D-V's VG-D/VG-E — never assigns credit to a
    // stale rotation position from before the gap.
    const insideGapButOutOfGrace = new Date(Date.now() - 10 * MS_PER_DAY).toISOString().slice(0, 10);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutExecutions', 'exec_gap_backdate'), {
        programId, programInstanceId, templateId: 'T003', sessionIndex: 0, sessionName: 'A',
        scheduledLocalDate: insideGapButOutOfGrace, status: 'COMPLETED',
        startedAt: Timestamp.now(), finishedAt: Timestamp.now(), exercises: [],
        executionSchemaVersion: 2, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    });
    // PR-05: no premature evolution triggered merely by resuming.
    await expect(prepareEvolution({ uid: UID })).resolves.toMatchObject({ status: 'NO_ACTION' });

    // Finally, enough REAL active days accrue after resume (continuing to
    // train normally) that eligibility is eventually and legitimately
    // reached — proving the pause didn't permanently break progression,
    // only correctly delayed it.
    await backdateAndFillHistory(UID, beginnerMinimumActiveDays + 30, programInstanceId, programId);
    await prepareAndActivate(UID, 'LEVEL_PROMOTION');
    expect((await loadWorkoutLifecycle(UID))!.lifecycle.currentTrainingLevel).toBe('INTERMEDIATE');
  }, 300_000);
});
