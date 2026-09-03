/**
 * OPT-IN integration proof against the REAL Firestore Emulator — same
 * pattern as `workoutExecutions.integration.test.ts`. Drives the actual,
 * unmodified `applyProgression`/`evaluateActiveProgression` through the
 * REAL Prescription Engine (`generateAndPersistWorkoutProgram`, real
 * T003 template, real questionnaire), proving eligibility/idempotency/
 * program-generation behavior on the real transactional code path.
 *
 * Skipped by default — only runs when `WORKOUT_PROGRESSION_INTEGRATION=1`
 * is set (see the `test:integration:workoutProgression` npm script).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, Timestamp } from 'firebase/firestore';

import { buildSeedDocuments } from '../../../scripts/seedWorkoutTemplates';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import { toPersistedAnswers } from '../../lib/questionnaireAnswers';
import {
  CANONICAL_LIMITATION_DATASET_HASH,
  CANONICAL_LIMITATION_DATASET_VERSION,
} from '../../workoutPrescription/limitationDataset';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const QUESTIONNAIRE_ID = 'q1';

const enabled = process.env.WORKOUT_PROGRESSION_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({
  get db() {
    return mocks.db;
  },
}));

import { generateAndPersistWorkoutProgram, type WorkoutProgramSnapshot } from '../workoutPrograms';
import { saveScheduleConfig } from '../workoutSchedule';
import { recordSetExecution, startOrResumeWorkoutExecution } from '../workoutExecutions';
import { applyProgression, evaluateActiveProgression } from '../workoutProgression';
import { enableWorkoutLifecycleRollout } from './workoutLifecycleRolloutFixture';
import { installWorkoutLifecycleAuthorityFixture, resetWorkoutLifecycleAuthorityFixture } from './workoutLifecycleAuthorityFixture';

const T003_SEED = buildSeedDocuments().find((t) => t.id === 'T003');
if (!T003_SEED) throw new Error('T003 fixture missing from catalog — cannot run Progression integration tests');

const ANSWERS = completeAnswers({ level: 'never_or_starting', days: 4, place: 'gym', sex: 'm', goal: 'gain_muscle' });

function daysAgo(days: number): Timestamp {
  return Timestamp.fromMillis(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe.skipIf(!enabled)('Progression Engine — real Firestore Emulator integration', () => {
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
    await enableWorkoutLifecycleRollout(testEnv);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const rawDb = ctx.firestore();
      await setDoc(doc(rawDb, 'users', UID), {
        profile: { name: 'Alice', email: 'alice@example.com' },
        preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
        subscription: {},
        metadata: { role: 'user', createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
      });
      await setDoc(doc(rawDb, 'workoutTemplates', 'T003'), T003_SEED);
      await setDoc(doc(rawDb, 'limitationDatasetState', 'active'), {
        datasetVersion: CANONICAL_LIMITATION_DATASET_VERSION,
        limitationDatasetHash: CANONICAL_LIMITATION_DATASET_HASH,
      });
      await setDoc(doc(rawDb, 'users', UID, 'questionnaires', QUESTIONNAIRE_ID), {
        answers: toPersistedAnswers(ANSWERS),
        version: 1,
        createdAt: Timestamp.now(),
      });
    });
    await saveScheduleConfig(UID, { trainingDays: ['MON', 'TUE', 'THU', 'FRI'], timezone: 'UTC' });
  });

  async function createStage1Program(): Promise<WorkoutProgramSnapshot> {
    const result = await generateAndPersistWorkoutProgram({
      uid: UID,
      questionnaireId: QUESTIONNAIRE_ID,
      questionnaireVersion: 1,
      answers: ANSWERS,
      source: 'onboarding',
      adaptationWeek: 1,
    });
    if (result.status !== 'SUCCESS') throw new Error(`Fixture setup failed: ${JSON.stringify(result)}`);
    return result.program;
  }

  /** Backdates `activatedAt` directly (bypassing Rules) — simulates elapsed real-world time without waiting for it. */
  async function backdateActivation(program: WorkoutProgramSnapshot, days: number): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutPrograms', program.programId), { activatedAt: daysAgo(days) }, { merge: true });
      if (program.programInstanceId) {
        await setDoc(doc(ctx.firestore(), 'users', UID, 'programInstances', program.programInstanceId), { activatedAt: daysAgo(days) }, { merge: true });
      }
    });
  }

  async function seedCompletedExecutions(program: WorkoutProgramSnapshot, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      const scheduledLocalDate = `2026-01-${String(i + 1).padStart(2, '0')}`;
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const rawDb = ctx.firestore();
        const scopeId = program.programInstanceId ?? program.programId;
        await setDoc(doc(rawDb, 'users', UID, 'workoutExecutions', `exec_${scopeId}_${i}_${scheduledLocalDate}`), {
          programId: program.programId,
          ...(program.programInstanceId ? { programInstanceId: program.programInstanceId } : {}),
          templateId: 'T003', sessionIndex: i % 4, sessionName: 'A',
          scheduledLocalDate, status: 'COMPLETED', startedAt: Timestamp.now(), finishedAt: Timestamp.now(),
          exercises: [], executionSchemaVersion: program.programInstanceId ? 2 : 1, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
        });
      });
    }
  }

  it('8B V1 Beginner stage evaluation remains readable but cannot mutate a V2 user', async () => {
    const stage1 = await createStage1Program();
    expect(stage1.adaptationStage).toBe(1);
    await backdateActivation(stage1, 8);
    await seedCompletedExecutions(stage1, 4);

    const { resolution } = await evaluateActiveProgression(UID);
    expect(resolution.status).toBe('BEGINNER_STAGE_PROGRESSION_AVAILABLE');

    const result = await applyProgression({ uid: UID, expectedProgramId: stage1.programId });
    expect(result).toEqual({ applied: false, reason: 'V2_LIFECYCLE_OWNS_ELIGIBILITY' });
    const oldDoc = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', stage1.programId));
    expect(oldDoc.data()?.status).toBe('active');
    expect(oldDoc.data()?.adaptationStage).toBe(1);
    expect(oldDoc.data()?.sessions).toEqual(stage1.sessions);
  });

  it('§62 Stage 1, 10 days old, 0 sessions → NOT_ELIGIBLE, and apply is a no-op', async () => {
    const stage1 = await createStage1Program();
    await backdateActivation(stage1, 10);

    const { resolution } = await evaluateActiveProgression(UID);
    expect(resolution).toEqual({ status: 'NOT_ELIGIBLE', reasonCodes: ['MINIMUM_SESSIONS_NOT_REACHED'] });

    const result = await applyProgression({ uid: UID, expectedProgramId: stage1.programId });
    expect(result.applied).toBe(false);
    const stillActive = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', stage1.programId));
    expect(stillActive.data()?.status).toBe('active'); // untouched
  });

  it('§72/§93 an IN_PROGRESS execution blocks apply even when otherwise eligible', async () => {
    const stage1 = await createStage1Program();
    await backdateActivation(stage1, 8);
    await seedCompletedExecutions(stage1, 4);
    await startOrResumeWorkoutExecution({ uid: UID, program: stage1, sessionIndex: 0, scheduledLocalDate: '2026-02-01' });

    const { resolution } = await evaluateActiveProgression(UID);
    expect(resolution).toEqual({ status: 'BLOCKED_ACTIVE_EXECUTION' });

    const result = await applyProgression({ uid: UID, expectedProgramId: stage1.programId });
    expect(result.applied).toBe(false);
  });

  it('8B repeated V1 apply remains an inert compatibility call', async () => {
    const stage1 = await createStage1Program();
    await backdateActivation(stage1, 8);
    await seedCompletedExecutions(stage1, 4);

    const first = await applyProgression({ uid: UID, expectedProgramId: stage1.programId });
    expect(first).toEqual({ applied: false, reason: 'V2_LIFECYCLE_OWNS_ELIGIBILITY' });
    const second = await applyProgression({ uid: UID, expectedProgramId: stage1.programId });
    expect(second).toEqual({ applied: false, reason: 'V2_LIFECYCLE_OWNS_ELIGIBILITY' });
    expect((await getDocs(collection(mocks.db as never, 'users', UID, 'workoutPrograms'))).size).toBe(1);
  });

  it('8B concurrent V1 applies cannot generate a competing prescription', async () => {
    const stage1 = await createStage1Program();
    await backdateActivation(stage1, 8);
    await seedCompletedExecutions(stage1, 4);

    const [a, b] = await Promise.all([
      applyProgression({ uid: UID, expectedProgramId: stage1.programId }),
      applyProgression({ uid: UID, expectedProgramId: stage1.programId }),
    ]);
    expect(a).toEqual({ applied: false, reason: 'V2_LIFECYCLE_OWNS_ELIGIBILITY' });
    expect(b).toEqual({ applied: false, reason: 'V2_LIFECYCLE_OWNS_ELIGIBILITY' });
    expect((await getDocs(collection(mocks.db as never, 'users', UID, 'workoutPrograms'))).size).toBe(1);
  });

  it('8B the old Beginner ramp cannot be used to reach Stage 3 under V2 authority', async () => {
    const stage1 = await createStage1Program();
    await backdateActivation(stage1, 8);
    await seedCompletedExecutions(stage1, 4);
    const result = await applyProgression({ uid: UID, expectedProgramId: stage1.programId });
    expect(result).toEqual({ applied: false, reason: 'V2_LIFECYCLE_OWNS_ELIGIBILITY' });
    expect((await evaluateActiveProgression(UID)).program?.adaptationStage).toBe(1);
  });

  it('§74/§90 normal rotation still evaluates for audit, but cannot apply once V2 exists', async () => {
    // Phase 10D (docs/workout-lifecycle/v2/architecture/
    // 23_PHASE_10D_FINAL_AUTHORITY_BYPASS_REMEDIATION.md): this fixture used
    // to bootstrap via `createStage1Program()` (source `onboarding`, which
    // already enrolls V2 under this suite's fully-enabled rollout) and THEN
    // reach stage 3 via a second `automatic_progression` call — exactly the
    // now-closed RECOVER content-installation path (P0-1). Generate stage 3
    // directly as this account's first-ever program instead (still source
    // `onboarding`, still V2-enrolled) — the test only ever asserts against
    // `stage3`, never `stage1`.
    const stage3Result = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: ANSWERS, source: 'onboarding', adaptationWeek: 3,
    });
    if (stage3Result.status !== 'SUCCESS') throw new Error('setup failed');
    const stage3 = stage3Result.program;

    await backdateActivation(stage3, 90);
    await seedCompletedExecutions(stage3, 31); // 4/wk * 90/7 ≈ 51.4 expected, ceil(*0.6) = 31

    const { resolution } = await evaluateActiveProgression(UID);
    expect(resolution).toEqual({ status: 'NORMAL_ROTATION_AVAILABLE' });

    // V1 still SEES the transition (evaluateActiveProgression is unmodified),
    // but Fase 2 (Progression Engine V2) is now this account's sole authority
    // for cycle/level eligibility, and V2's own bar (≥85 active days, ≥70% of
    // sessions meeting the 70%-of-sets rule) is stricter than V1's — so V1
    // must never be allowed to apply a rotation V2 hasn't independently
    // earned. `applyProgression` blocks it outright rather than rotating.
    const result = await applyProgression({ uid: UID, expectedProgramId: stage3.programId });
    expect(result).toEqual({ applied: false, reason: 'V2_LIFECYCLE_OWNS_ELIGIBILITY' });

    // Nothing changed: the account is still on the Stage 3 program, still
    // eligible by V1's (now-inert) math, not silently mutated.
    const { resolution: after } = await evaluateActiveProgression(UID);
    expect(after).toEqual({ status: 'NORMAL_ROTATION_AVAILABLE' });
  });

  it('§73/§90 90 days without adherence never rotates', async () => {
    const stage1 = await createStage1Program();
    await backdateActivation(stage1, 90);
    await seedCompletedExecutions(stage1, 2); // trivial adherence, and still Stage 1 anyway

    const { resolution } = await evaluateActiveProgression(UID);
    // Still Stage 1 (never progressed) — MINIMUM gates apply, not the normal cycle; either way, NOT_ELIGIBLE.
    expect(resolution.status).toBe('NOT_ELIGIBLE');
    const result = await applyProgression({ uid: UID, expectedProgramId: stage1.programId });
    expect(result.applied).toBe(false);
  });
});
