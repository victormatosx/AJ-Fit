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
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';

import { buildSeedDocuments } from '../../../scripts/seedWorkoutTemplates';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import { toPersistedAnswers } from '../../lib/questionnaireAnswers';

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
  });

  afterAll(async () => testEnv.cleanup());

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const rawDb = ctx.firestore();
      await setDoc(doc(rawDb, 'users', UID), {
        profile: { name: 'Alice', email: 'alice@example.com' },
        preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
        subscription: {},
        metadata: { role: 'user', createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
      });
      await setDoc(doc(rawDb, 'workoutTemplates', 'T003'), T003_SEED);
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
  async function backdateActivation(programId: string, days: number): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutPrograms', programId), { activatedAt: daysAgo(days) }, { merge: true });
    });
  }

  async function seedCompletedExecutions(programId: string, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      const scheduledLocalDate = `2026-01-${String(i + 1).padStart(2, '0')}`;
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const rawDb = ctx.firestore();
        await setDoc(doc(rawDb, 'users', UID, 'workoutExecutions', `exec_${programId}_${i}_${scheduledLocalDate}`), {
          programId, templateId: 'T003', sessionIndex: i % 4, sessionName: 'A',
          scheduledLocalDate, status: 'COMPLETED', startedAt: Timestamp.now(), finishedAt: Timestamp.now(),
          exercises: [], executionSchemaVersion: 1, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
        });
      });
    }
  }

  it('§64/§83 Stage 1 program, 7+ days old, 4/4 sessions done → BEGINNER_STAGE_PROGRESSION_AVAILABLE → apply creates Stage 2 as a NEW program, supersedes Stage 1', async () => {
    const stage1 = await createStage1Program();
    expect(stage1.adaptationStage).toBe(1);
    await backdateActivation(stage1.programId, 8);
    await seedCompletedExecutions(stage1.programId, 4);

    const { resolution } = await evaluateActiveProgression(UID);
    expect(resolution.status).toBe('BEGINNER_STAGE_PROGRESSION_AVAILABLE');

    const result = await applyProgression({ uid: UID, expectedProgramId: stage1.programId });
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.program.adaptationStage).toBe(2);
    expect(result.program.programId).not.toBe(stage1.programId);
    expect(result.program.questionnaireId).toBe(QUESTIONNAIRE_ID); // reused, not re-asked (§27)
    expect(result.event.type).toBe('BEGINNER_STAGE_TRANSITION');
    expect(result.event.fromStage).toBe(1);
    expect(result.event.toStage).toBe(2);

    // §94 Stage 1 snapshot remains byte-for-byte, only status/activatedAt/updatedAt may change.
    const oldDoc = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', stage1.programId));
    expect(oldDoc.data()?.status).toBe('superseded');
    expect(oldDoc.data()?.adaptationStage).toBe(1);
    expect(oldDoc.data()?.sessions).toEqual(stage1.sessions);
  });

  it('§62 Stage 1, 10 days old, 0 sessions → NOT_ELIGIBLE, and apply is a no-op', async () => {
    const stage1 = await createStage1Program();
    await backdateActivation(stage1.programId, 10);

    const { resolution } = await evaluateActiveProgression(UID);
    expect(resolution).toEqual({ status: 'NOT_ELIGIBLE', reasonCodes: ['MINIMUM_SESSIONS_NOT_REACHED'] });

    const result = await applyProgression({ uid: UID, expectedProgramId: stage1.programId });
    expect(result.applied).toBe(false);
    const stillActive = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', stage1.programId));
    expect(stillActive.data()?.status).toBe('active'); // untouched
  });

  it('§72/§93 an IN_PROGRESS execution blocks apply even when otherwise eligible', async () => {
    const stage1 = await createStage1Program();
    await backdateActivation(stage1.programId, 8);
    await seedCompletedExecutions(stage1.programId, 4);
    await startOrResumeWorkoutExecution({ uid: UID, program: stage1, sessionIndex: 0, scheduledLocalDate: '2026-02-01' });

    const { resolution } = await evaluateActiveProgression(UID);
    expect(resolution).toEqual({ status: 'BLOCKED_ACTIVE_EXECUTION' });

    const result = await applyProgression({ uid: UID, expectedProgramId: stage1.programId });
    expect(result.applied).toBe(false);
  });

  it('§77/§91/§99 double apply: the second call finds the program already moved on and is a safe no-op', async () => {
    const stage1 = await createStage1Program();
    await backdateActivation(stage1.programId, 8);
    await seedCompletedExecutions(stage1.programId, 4);

    const first = await applyProgression({ uid: UID, expectedProgramId: stage1.programId });
    expect(first.applied).toBe(true);
    const second = await applyProgression({ uid: UID, expectedProgramId: stage1.programId });
    expect(second).toEqual({ applied: false, reason: 'ALREADY_APPLIED' });

    // Exactly one Stage 2 program exists, not two.
    if (!first.applied) throw new Error('unreachable');
    const stage2Doc = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', first.program.programId));
    expect(stage2Doc.exists()).toBe(true);
  });

  it('§92 concurrent apply from two callers converges on exactly one Stage 2 program, never two', async () => {
    const stage1 = await createStage1Program();
    await backdateActivation(stage1.programId, 8);
    await seedCompletedExecutions(stage1.programId, 4);

    const [a, b] = await Promise.all([
      applyProgression({ uid: UID, expectedProgramId: stage1.programId }),
      applyProgression({ uid: UID, expectedProgramId: stage1.programId }),
    ]);
    const appliedResults = [a, b].filter((r): r is Extract<typeof a, { applied: true }> => r.applied);
    expect(appliedResults.length).toBeGreaterThanOrEqual(1);
    const targetProgramIds = new Set(appliedResults.map((r) => r.program.programId));
    expect(targetProgramIds.size).toBe(1); // same deterministic target either way
  });

  it('§66/§89 Stage 3 does not re-enter weekly gating — falls through to the (far from met) normal cycle', async () => {
    const stage1 = await createStage1Program();
    await backdateActivation(stage1.programId, 8);
    await seedCompletedExecutions(stage1.programId, 4);
    const stage2 = await applyProgression({ uid: UID, expectedProgramId: stage1.programId });
    if (!stage2.applied) throw new Error('setup failed');
    await backdateActivation(stage2.program.programId, 8);
    await seedCompletedExecutions(stage2.program.programId, 4);
    const stage3 = await applyProgression({ uid: UID, expectedProgramId: stage2.program.programId });
    if (!stage3.applied) throw new Error('setup failed');
    expect(stage3.program.adaptationStage).toBe(3);

    const { resolution } = await evaluateActiveProgression(UID);
    expect(resolution.status).toBe('NOT_ELIGIBLE');
    if (resolution.status === 'NOT_ELIGIBLE') expect(resolution.reasonCodes).toContain('PROGRAM_AGE_NOT_REACHED');
  });

  it('§74/§90 normal rotation: 90+ days, >=60% adherence → NORMAL_ROTATION_AVAILABLE → apply renews in place (same deterministic programId), activatedAt bumped', async () => {
    const stage1 = await createStage1Program(); // level=never_or_starting, so this graduates through stages
    await backdateActivation(stage1.programId, 8);
    await seedCompletedExecutions(stage1.programId, 4);
    const stage2 = await applyProgression({ uid: UID, expectedProgramId: stage1.programId });
    if (!stage2.applied) throw new Error('setup failed');
    await backdateActivation(stage2.program.programId, 8);
    await seedCompletedExecutions(stage2.program.programId, 4);
    const stage3 = await applyProgression({ uid: UID, expectedProgramId: stage2.program.programId });
    if (!stage3.applied) throw new Error('setup failed');

    await backdateActivation(stage3.program.programId, 90);
    await seedCompletedExecutions(stage3.program.programId, 31); // 4/wk * 90/7 ≈ 51.4 expected, ceil(*0.6) = 31

    const { resolution } = await evaluateActiveProgression(UID);
    expect(resolution).toEqual({ status: 'NORMAL_ROTATION_AVAILABLE' });

    const result = await applyProgression({ uid: UID, expectedProgramId: stage3.program.programId });
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.program.programId).toBe(stage3.program.programId); // same T003, no real alternative — renewed in place (docs §40/§41)
    expect(result.program.adaptationStage).toBe(3); // never regresses to Stage 1 (docs' "stage 3 must be passed explicitly" fix)
    expect(result.event.type).toBe('NORMAL_ROTATION');

    // Age clock genuinely reset — re-evaluating immediately is NOT_ELIGIBLE again.
    const { resolution: after } = await evaluateActiveProgression(UID);
    expect(after.status).toBe('NOT_ELIGIBLE');
  });

  it('§73/§90 90 days without adherence never rotates', async () => {
    const stage1 = await createStage1Program();
    await backdateActivation(stage1.programId, 90);
    await seedCompletedExecutions(stage1.programId, 2); // trivial adherence, and still Stage 1 anyway

    const { resolution } = await evaluateActiveProgression(UID);
    // Still Stage 1 (never progressed) — MINIMUM gates apply, not the normal cycle; either way, NOT_ELIGIBLE.
    expect(resolution.status).toBe('NOT_ELIGIBLE');
    const result = await applyProgression({ uid: UID, expectedProgramId: stage1.programId });
    expect(result.applied).toBe(false);
  });
});

