/**
 * OPT-IN integration proof against the REAL Firestore Emulator — same
 * pattern as `workoutProgramReconciliation.integration.test.ts`.
 *
 * BUGFIX REGRESSION — first-app-entry `INVALID_CONFIGURATION`
 * ────────────────────────────────────────────────────────────
 * A real device reproduced: anonymous onboarding generation succeeded
 * (T003, SUCCESS), but the SAME questionnaire, once persisted and reloaded
 * post-authentication, failed automatic reconciliation with
 * `INVALID_CONFIGURATION` — even though `answers.days`/frequency/selection
 * all resolved identically on both paths (proven separately in
 * `workoutPrescription/__tests__`).
 *
 * Root cause: `prepareWorkoutProgram` (`workoutPrograms.ts`) ALWAYS reads
 * `limitationDatasetState/active` to stamp `limitationDatasetVersion`/
 * `limitationDatasetHash` on every plan — even for a user with NO
 * limitations. That document's Firestore Rule required
 * `hasVerifiedEmailForPrivateAccess()`, which denies any signed-in
 * Email/Password account before it verifies its email — a completely
 * normal state right after signup. The resulting permission-denied was
 * swallowed by a generic catch and reported as `INVALID_CONFIGURATION`,
 * with no way to tell it apart from a genuinely broken questionnaire.
 * `prepareWorkoutProgramLocally` (pre-auth, anonymous onboarding) never
 * touches Firestore, so it never observed the failure — this exact
 * anonymous-succeeds/authenticated-fails split was the reported symptom.
 *
 * Fix: `limitationDatasetState/active`'s read gate widened to `isSignedIn()`
 * (it holds only a version string + content hash, never clinical/PII data —
 * see `firestore-tests/limitationDatasetState.rules.test.ts` for the Rules
 * proof, including that `exercises` keeps its stronger gate unchanged).
 *
 * This file exercises the REAL flow that broke end to end: onboarding
 * answers → `toPersistedAnswers` → Firestore questionnaire →
 * `getLatestQuestionnaire` (real deserialization/normalization) →
 * `generateAndPersistWorkoutProgram` (`source: 'automatic_reconciliation'`)
 * → persistence → `loadActiveWorkoutProgram` → `resolveWorkoutSchedule` —
 * as a NOT-yet-verified Email/Password account, which is what the real
 * Firestore Rules are actually evaluating.
 *
 * Skipped by default — only runs when
 * `FIRST_PROGRAM_GENERATION_INTEGRATION=1` is set (see the
 * `test:integration:firstProgramGeneration` npm script).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp } from 'firebase/firestore';

import { buildSeedDocuments } from '../../../scripts/seedWorkoutTemplates';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import { toPersistedAnswers } from '../../lib/questionnaireAnswers';
import {
  CANONICAL_LIMITATION_DATASET_HASH,
  CANONICAL_LIMITATION_DATASET_VERSION,
} from '../../workoutPrescription/limitationDataset';
import { resolveWorkoutSchedule } from '../../scheduleEngine/resolver';
import type { Weekday } from '../../state/AppState';
import type { WorkoutDayState } from '../../workoutPrescription/types';
import {
  setWorkoutLifecycleAuthorityAuthorizerForTests,
  WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
} from '../../workoutLifecycle/authorityProvider';
import {
  resetWorkoutLifecycleTelemetryLogger,
  setWorkoutLifecycleTelemetryLogger,
  type WorkoutLifecycleTelemetryEvent,
} from '../../workoutLifecycle/telemetry';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'dave';
const QUESTIONNAIRE_ID = 'q1';

const enabled = process.env.FIRST_PROGRAM_GENERATION_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({
  get db() { return mocks.db; },
}));

import { contentIdentityFor, generateAndPersistWorkoutProgram, loadActiveWorkoutProgram } from '../workoutPrograms';
import { getLatestQuestionnaire } from '../userProfile';
import { ensureScheduleConfigFromQuestionnaire } from '../workoutSchedule';
import { enableWorkoutLifecycleRollout } from './workoutLifecycleRolloutFixture';
import {
  installWorkoutLifecycleAuthorityFixture,
  resetWorkoutLifecycleAuthorityFixture,
  setWorkoutLifecycleCanonicalResponseOverrideForTests,
} from './workoutLifecycleAuthorityFixture';

const T003_SEED = buildSeedDocuments().find((t) => t.id === 'T003');
if (!T003_SEED) throw new Error('T003 fixture missing from catalog — cannot run this integration test');

// Exact reported scenario: male, gym, hypertrophy/body composition,
// beginner, availability 7, no limitations.
const ORIGINAL_SCENARIO_ANSWERS = completeAnswers({
  sex: 'm',
  goal: 'gain_muscle',
  level: 'beginner',
  days: 7,
  place: 'gym',
  specialConditions: ['none'],
});

async function seedUserAndQuestionnaire() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    await setDoc(doc(rawDb, 'users', UID), {
      profile: { name: 'Dave', email: 'dave@example.com' },
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
      answers: toPersistedAnswers(ORIGINAL_SCENARIO_ANSWERS),
      version: 1,
      createdAt: Timestamp.now(),
    });
  });
}

/**
 * Simulates an account that already had a program before Workout Lifecycle
 * V2 existed: a legacy `workoutProgramState/active` pointer + a real
 * `workoutPrograms/{id}` doc, but NO `workoutLifecycleState/current`. Real
 * new accounts can never reach this shape anymore — `saveAndActivateWorkoutProgram`
 * now enrolls every brand-new account in V2 unconditionally (the fix this
 * suite protects) — so this fixture deliberately bypasses the app's own
 * generation path and writes the legacy shape directly, the only way to
 * reproduce a genuine pre-V2 account for the migration-only tests below.
 */
async function seedLegacyV1Account() {
  await seedUserAndQuestionnaire();
  const loaded = await getLatestQuestionnaire(UID);
  const generated = await generateAndPersistWorkoutProgram({
    uid: UID, questionnaireId: loaded!.id, questionnaireVersion: loaded!.version,
    answers: loaded!.answers, source: 'automatic_reconciliation',
  });
  if (generated.status !== 'SUCCESS') throw new Error('seedLegacyV1Account setup failed');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    await deleteDoc(doc(rawDb, 'users', UID, 'workoutLifecycleState', 'current'));
    for (const instance of (await getDocs(collection(rawDb, 'users', UID, 'programInstances'))).docs) {
      await deleteDoc(instance.ref);
    }
    for (const cycle of (await getDocs(collection(rawDb, 'users', UID, 'trainingCycles'))).docs) {
      await deleteDoc(cycle.ref);
    }
  });
  return generated;
}

describe.skipIf(!enabled)('First program generation — real device regression, real Firestore Emulator', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
    });
    // The reported device account: signed in, Email/Password, NOT yet
    // verified — exactly the state the Rules gate discriminates on.
    mocks.db = testEnv.authenticatedContext(UID, {
      email: 'dave@example.com',
      email_verified: false,
      firebase: { identities: { email: ['dave@example.com'] }, sign_in_provider: 'password' },
    }).firestore();
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

  it('onboarding answers → persist → load → automatic reconciliation → SUCCESS, even before email verification', async () => {
    await seedUserAndQuestionnaire();

    // Real deserialization/normalization path — same function
    // `AuthContext`/`useWorkoutPrescription` call.
    const loaded = await getLatestQuestionnaire(UID);
    expect(loaded).not.toBeNull();
    expect(loaded?.answers.days).toBe(7);
    expect(loaded?.answers.level).toBe('beginner');

    const result = await generateAndPersistWorkoutProgram({
      uid: UID,
      questionnaireId: loaded!.id,
      questionnaireVersion: loaded!.version,
      answers: loaded!.answers,
      source: 'automatic_reconciliation',
    });

    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    const { program } = result;

    expect(program.availability).toEqual({ days: 7, weekdays: expect.arrayContaining(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']) });
    expect(program.prescribedTrainingFrequency).toBe(4);
    expect(program.templateId).toBe('T003');

    const weeklySchedule = program.weeklySchedule ?? [];
    const counts = weeklySchedule.reduce<Record<WorkoutDayState, number>>((acc, entry) => {
      acc[entry.state] = (acc[entry.state] ?? 0) + 1;
      return acc;
    }, { TRAINING: 0, ACTIVE_RECOVERY: 0, REST: 0 });
    expect(counts.TRAINING).toBe(4);
    expect(counts.ACTIVE_RECOVERY).toBe(0);
    expect(counts.REST).toBe(3);

    const lifecycleEvents = await getDocs(collection(
      mocks.db as never,
      'users', UID, 'workoutLifecycleEvents',
    ));
    expect(lifecycleEvents.size).toBe(1);
    expect(lifecycleEvents.docs[0].data().type).toBe('PROGRAM_STARTED');

    // Prove the V2 source of truth wins even if an admin/old deployment
    // leaves the compatibility mirror stale.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'workoutProgramState', 'active'), {
        programId: 'legacy-stale-pointer',
        updatedAt: Timestamp.now(),
      });
    });

    // Persisted AND reloadable — the exact step that was reported as
    // `active_workout_program_loaded { found: false }` on device.
    const reloaded = await loadActiveWorkoutProgram(UID);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.programId).toBe(program.programId);
    expect(reloaded?.templateId).toBe('T003');

    // Schedule Engine must be able to resolve this program — never
    // `PROGRAM_NOT_AVAILABLE` (the Home-screen-visible failure mode).
    const trainingWeekdays = weeklySchedule
      .filter((entry) => entry.state === 'TRAINING')
      .map((entry) => entry.weekday) as Weekday[];
    const config = await ensureScheduleConfigFromQuestionnaire(UID, trainingWeekdays, 'America/Sao_Paulo');
    expect(config).not.toBeNull();

    const trainingDate = '2026-08-31'; // Monday — a TRAINING day in the resolved schedule.
    const resolution = resolveWorkoutSchedule({
      hasActiveProgram: true,
      sessionCount: reloaded!.sessions.length,
      config,
      state: null,
      activatedAtLocalDate: trainingDate,
      todayLocalDate: trainingDate,
    });
    expect(resolution.status).not.toBe('PROGRAM_NOT_AVAILABLE');
  });

  it('10C catalog race INITIALIZE A→B persists only backend canonical B and its identities', async () => {
    await seedUserAndQuestionnaire();
    let candidateContentIdentity = '';
    let canonicalPlanId = '';
    let canonicalFirstExerciseSets = 0;
    setWorkoutLifecycleCanonicalResponseOverrideForTests((request, response) => {
      if (request.operation !== 'INITIALIZE') return response;
      candidateContentIdentity = String(request.targetContentIdentity);
      const targetPlan = JSON.parse(JSON.stringify(response.targetPlan)) as typeof response.targetPlan;
      targetPlan.planId = `${targetPlan.planId}_backend`;
      const firstExercise = targetPlan.sessions[0].exercises[0];
      firstExercise.sets = firstExercise.sets === 10 ? 9 : Number(firstExercise.sets ?? 1) + 1;
      canonicalPlanId = targetPlan.planId;
      canonicalFirstExerciseSets = firstExercise.sets;
      const targetContentIdentity = contentIdentityFor({
        questionnaireId: QUESTIONNAIRE_ID,
        questionnaireVersion: 1,
        plan: targetPlan,
        template: {
          id: targetPlan.templateId,
          version: response.targetTemplateVersion,
          contentHash: response.targetTemplateContentHash,
        },
      });
      return { ...response, targetPlan, targetContentIdentity, targetPrescriptionIdentity: targetPlan.planId };
    });

    const result = await generateAndPersistWorkoutProgram({
      uid: UID,
      questionnaireId: QUESTIONNAIRE_ID,
      questionnaireVersion: 1,
      answers: ORIGINAL_SCENARIO_ANSWERS,
      source: 'automatic_reconciliation',
    });
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;

    expect(result.program.planId).toBe(canonicalPlanId);
    expect(result.program.prescriptionId).toBe(canonicalPlanId);
    expect(result.program.sessions[0].exercises[0].sets).toBe(canonicalFirstExerciseSets);
    expect(result.program.programId).not.toBe(candidateContentIdentity);
    expect((await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', candidateContentIdentity))).exists())
      .toBe(false);
    expect((await loadActiveWorkoutProgram(UID))?.programId).toBe(result.program.programId);
  });

  it('10C INITIALIZE fails closed before persistence when canonical is missing', async () => {
    await seedUserAndQuestionnaire();
    setWorkoutLifecycleAuthorityAuthorizerForTests(async () => ({
      grantId: WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
      expiresAtMs: Date.now() + 60_000,
    }));
    try {
      await expect(generateAndPersistWorkoutProgram({
        uid: UID,
        questionnaireId: QUESTIONNAIRE_ID,
        questionnaireVersion: 1,
        answers: ORIGINAL_SCENARIO_ANSWERS,
        source: 'automatic_reconciliation',
      })).rejects.toThrow('WORKOUT_LIFECYCLE_CANONICAL_RESPONSE_MISSING:INITIALIZE');
      expect((await getDocs(collection(mocks.db as never, 'users', UID, 'workoutPrograms'))).size).toBe(0);
    } finally {
      installWorkoutLifecycleAuthorityFixture(testEnv, UID);
    }
  });

  it('a brand-new account enrolls in V2 immediately, regardless of rollout config (disabled/missing/malformed)', async () => {
    // Root-cause regression: `workoutLifecycleRolloutConfig/active` was
    // never provisioned in production, so every brand-new account silently
    // stuck on V1-compatible mode with no error. Rollout must only gate
    // genuine V1→V2 MIGRATIONS (an account with pre-existing legacy state),
    // never a first-ever signup — see `saveAndActivateWorkoutProgram`'s
    // `isBrandNewAccount` short-circuit.
    for (const rolloutState of [
      { label: 'disabled', doc: { schemaVersion: 1, enabled: false, percentage: 0 } },
      { label: 'missing', doc: null },
      { label: 'malformed', doc: { schemaVersion: 99, enabled: true, percentage: 100, unexpected: true } },
    ] as const) {
      await testEnv.clearFirestore();
      await seedUserAndQuestionnaire();
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        if (rolloutState.doc) {
          await setDoc(doc(ctx.firestore(), 'workoutLifecycleRolloutConfig', 'active'), rolloutState.doc);
        } else {
          await deleteDoc(doc(ctx.firestore(), 'workoutLifecycleRolloutConfig', 'active'));
        }
      });
      const loaded = await getLatestQuestionnaire(UID);
      const generated = await generateAndPersistWorkoutProgram({
        uid: UID, questionnaireId: loaded!.id, questionnaireVersion: loaded!.version,
        answers: loaded!.answers, source: 'automatic_reconciliation',
      });
      expect(generated.status, rolloutState.label).toBe('SUCCESS');
      if (generated.status !== 'SUCCESS') continue;
      expect(generated.program.programInstanceId, rolloutState.label).toMatch(/^wpi_/);
      expect(
        (await getDoc(doc(mocks.db as never, 'users', UID, 'workoutLifecycleState', 'current'))).exists(),
        rolloutState.label,
      ).toBe(true);
    }
  });

  it('uses the real enrollment hot path for OFF → ON and keeps an existing V2 account sticky after kill switch (legacy migration only)', async () => {
    await seedLegacyV1Account();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'workoutLifecycleRolloutConfig', 'active'), {
        schemaVersion: 1, enabled: false, percentage: 100,
      });
    });
    const beforeRollout = await loadActiveWorkoutProgram(UID);
    expect(beforeRollout?.programInstanceId).toBeUndefined();
    expect((await getDoc(doc(mocks.db as never, 'users', UID, 'workoutLifecycleState', 'current'))).exists()).toBe(false);

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'workoutLifecycleRolloutConfig', 'active'), {
        schemaVersion: 1, enabled: true, percentage: 100,
      });
    });
    const enrolled = await loadActiveWorkoutProgram(UID);
    expect(enrolled?.programInstanceId).toMatch(/^wpi_/);
    const lifecycleBeforeKillSwitch = (await getDoc(doc(
      mocks.db as never, 'users', UID, 'workoutLifecycleState', 'current',
    ))).data();

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'workoutLifecycleRolloutConfig', 'active'), {
        schemaVersion: 1, enabled: false, percentage: 0,
      });
    });
    const afterKillSwitch = await loadActiveWorkoutProgram(UID);
    expect(afterKillSwitch?.programInstanceId).toBe(enrolled?.programInstanceId);
    expect((await getDoc(doc(mocks.db as never, 'users', UID, 'workoutLifecycleState', 'current'))).data())
      .toEqual(lifecycleBeforeKillSwitch);
  });

  it('fails closed on missing or malformed config for a genuine legacy migration, without damaging workout execution data', async () => {
    await seedLegacyV1Account();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'workoutLifecycleRolloutConfig', 'active'));
    });
    expect((await loadActiveWorkoutProgram(UID))?.programInstanceId).toBeUndefined();
    expect((await getDoc(doc(mocks.db as never, 'users', UID, 'workoutLifecycleState', 'current'))).exists()).toBe(false);

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'workoutLifecycleRolloutConfig', 'active'), {
        schemaVersion: 99, enabled: true, percentage: 100, unexpected: true,
      });
    });
    expect((await loadActiveWorkoutProgram(UID))?.programInstanceId).toBeUndefined();
  });

  it('reports a real hot-path migration failure without emitting enrollment success', async () => {
    await seedLegacyV1Account();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', UID, 'questionnaires', QUESTIONNAIRE_ID), {
        answers: { ...toPersistedAnswers(ORIGINAL_SCENARIO_ANSWERS), level: 'unknown' },
        version: 1,
        createdAt: Timestamp.now(),
      });
      await setDoc(doc(ctx.firestore(), 'workoutLifecycleRolloutConfig', 'active'), {
        schemaVersion: 1, enabled: true, percentage: 100,
      });
    });
    const events: WorkoutLifecycleTelemetryEvent[] = [];
    setWorkoutLifecycleTelemetryLogger({ log: (event) => events.push(event) });
    try {
      await expect(loadActiveWorkoutProgram(UID))
        .rejects.toThrow('WORKOUT_LIFECYCLE_STARTING_LEVEL_UNKNOWN');
    } finally {
      resetWorkoutLifecycleTelemetryLogger();
    }
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'migration_failed' }),
      expect.objectContaining({ name: 'progression_failed', stage: 'MIGRATION' }),
    ]));
    expect(events.some(({ name }) => name === 'lifecycle_rollout_decision')).toBe(false);
    expect((await getDoc(doc(mocks.db as never, 'users', UID, 'workoutLifecycleState', 'current'))).exists()).toBe(false);
  });

  it('same scenario succeeds identically once the account IS email-verified (no regression for the happy path)', async () => {
    mocks.db = testEnv.authenticatedContext(UID, {
      email: 'dave@example.com',
      email_verified: true,
      firebase: { identities: { email: ['dave@example.com'] }, sign_in_provider: 'password' },
    }).firestore();
    await seedUserAndQuestionnaire();

    const loaded = await getLatestQuestionnaire(UID);
    const result = await generateAndPersistWorkoutProgram({
      uid: UID,
      questionnaireId: loaded!.id,
      questionnaireVersion: loaded!.version,
      answers: loaded!.answers,
      source: 'automatic_reconciliation',
    });

    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.program.templateId).toBe('T003');
    expect(result.program.prescribedTrainingFrequency).toBe(4);
  });
});
