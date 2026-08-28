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
import { doc, setDoc, Timestamp } from 'firebase/firestore';

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

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'dave';
const QUESTIONNAIRE_ID = 'q1';

const enabled = process.env.FIRST_PROGRAM_GENERATION_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({
  get db() { return mocks.db; },
}));

import { generateAndPersistWorkoutProgram, loadActiveWorkoutProgram } from '../workoutPrograms';
import { getLatestQuestionnaire } from '../userProfile';
import { ensureScheduleConfigFromQuestionnaire } from '../workoutSchedule';

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
  });

  afterAll(async () => testEnv.cleanup());
  beforeEach(async () => testEnv.clearFirestore());

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
