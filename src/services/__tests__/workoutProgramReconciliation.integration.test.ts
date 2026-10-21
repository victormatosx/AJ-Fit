/**
 * OPT-IN integration proof against the REAL Firestore Emulator — same
 * pattern as `workoutProgression.integration.test.ts`. Proves the automatic
 * reconciliation policy (`useWorkoutPrescription`'s `reload()`:
 * authenticated + valid questionnaire + no active program → generate) at
 * the service layer, driving the actual, unmodified
 * `generateAndPersistWorkoutProgram` the hook calls with
 * `source: 'automatic_reconciliation'`.
 *
 * Skipped by default — only runs when `WORKOUT_RECONCILIATION_INTEGRATION=1`
 * is set (see the `test:integration:workoutReconciliation` npm script).
 */
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { Timestamp,collection,doc,getDoc,getDocs,setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';

import { buildSeedDocuments } from '../../../scripts/seedWorkoutTemplates';
import { toPersistedAnswers } from '../../lib/questionnaireAnswers';
import { WEEKDAY_ORDER } from '../../state/AppState';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'bob';
const QUESTIONNAIRE_ID = 'q1';

const enabled = process.env.WORKOUT_RECONCILIATION_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({
  get db() {
    return mocks.db;
  },
}));

import { generateAndPersistWorkoutProgram } from '../workoutPrograms';
import { installWorkoutLifecycleAuthorityFixture,resetWorkoutLifecycleAuthorityFixture } from './workoutLifecycleAuthorityFixture';
import { enableWorkoutLifecycleRollout } from './workoutLifecycleRolloutFixture';

const T003_SEED = buildSeedDocuments().find((t) => t.id === 'T003');
if (!T003_SEED) throw new Error('T003 fixture missing from catalog — cannot run reconciliation integration tests');

const VALID_ANSWERS = completeAnswers({
  level: 'intermediate', days: 4, trainingDays: WEEKDAY_ORDER.slice(0, 4), place: 'gym', sex: 'm', goal: 'gain_muscle',
});

/**
 * `rawLegacyAnswers`, when given, is written to the questionnaire
 * subcollection VERBATIM (bypassing `toPersistedAnswers`) — that helper
 * assumes a fully-shaped current-schema `Quiz` and would itself throw on a
 * genuinely legacy/partial shape. A real pre-Safety-phase Firestore document
 * was written by an OLD app build with its OWN old serializer; this
 * reproduces that exact on-disk shape instead of routing it through today's.
 */
async function seedUserAndQuestionnaire(
  answers: typeof VALID_ANSWERS = VALID_ANSWERS,
  rawLegacyAnswers?: Record<string, unknown>,
) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    await setDoc(doc(rawDb, 'users', UID), {
      profile: { name: 'Bob', email: 'bob@example.com' },
      preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
      subscription: {},
      metadata: { role: 'user', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), commercialGateResolvedAt: Timestamp.now() },
    });
    await setDoc(doc(rawDb, 'workoutTemplates', 'T003'), T003_SEED);
    await setDoc(doc(rawDb, 'users', UID, 'questionnaires', QUESTIONNAIRE_ID), {
      answers: rawLegacyAnswers ?? toPersistedAnswers(answers),
      version: 1,
      createdAt: Timestamp.now(),
    });
  });
}

describe.skipIf(!enabled)('First Workout Program reconciliation — real Firestore Emulator integration', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
    });
    mocks.db = testEnv.authenticatedContext(UID, { email: 'bob@example.com', email_verified: true }).firestore();
    installWorkoutLifecycleAuthorityFixture(testEnv, UID);
  });

  afterAll(async () => {
    resetWorkoutLifecycleAuthorityFixture();
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await enableWorkoutLifecycleRollout(testEnv);
  });

  it('(B) authenticated + valid questionnaire + no active program → generates and activates the first program', async () => {
    await seedUserAndQuestionnaire();

    const result = await generateAndPersistWorkoutProgram({
      uid: UID,
      questionnaireId: QUESTIONNAIRE_ID,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      source: 'automatic_reconciliation',
    });

    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.program.status).toBe('active');
    expect(result.program.source).toBe('automatic_reconciliation');

    const activeState = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutProgramState', 'active'));
    expect(activeState.data()?.programId).toBe(result.program.programId);
  });

  it('(C) two concurrent reconciliation attempts converge on exactly one active program, never two', async () => {
    await seedUserAndQuestionnaire();

    const [a, b] = await Promise.all([
      generateAndPersistWorkoutProgram({
        uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
        answers: VALID_ANSWERS, source: 'automatic_reconciliation',
      }),
      generateAndPersistWorkoutProgram({
        uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
        answers: VALID_ANSWERS, source: 'automatic_reconciliation',
      }),
    ]);

    expect(a.status).toBe('SUCCESS');
    expect(b.status).toBe('SUCCESS');
    if (a.status !== 'SUCCESS' || b.status !== 'SUCCESS') return;
    // Same deterministic identity (questionnaire+template+prescription hash)
    // — both calls MUST target the same programId.
    expect(a.program.programId).toBe(b.program.programId);

    const programs = await getDocs(collection(mocks.db as never, 'users', UID, 'workoutPrograms'));
    expect(programs.size).toBe(1);
  });

  it('(D) reconciliation runs again after a program already exists → no new/duplicate program is created', async () => {
    await seedUserAndQuestionnaire();
    const first = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: VALID_ANSWERS, source: 'automatic_reconciliation',
    });
    expect(first.status).toBe('SUCCESS');
    if (first.status !== 'SUCCESS') return;

    // Simulates the next app open re-running reconciliation (e.g. `reload()`
    // fired again because `loadActiveWorkoutProgram` hadn't resolved yet).
    const second = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: VALID_ANSWERS, source: 'automatic_reconciliation',
    });
    expect(second.status).toBe('SUCCESS');
    if (second.status !== 'SUCCESS') return;
    expect(second.program.programId).toBe(first.program.programId);

    const programs = await getDocs(collection(mocks.db as never, 'users', UID, 'workoutPrograms'));
    expect(programs.size).toBe(1);
  });

  it('(E) a genuinely invalid questionnaire never generates a generic workout', async () => {
    const invalid = completeAnswers({ sex: null, goal: null, place: null });
    await seedUserAndQuestionnaire(invalid);

    const result = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: invalid, source: 'automatic_reconciliation',
    });

    expect(result.status).toBe('NEEDS_QUESTIONNAIRE_UPDATE');
    const programs = await getDocs(collection(mocks.db as never, 'users', UID, 'workoutPrograms'));
    expect(programs.size).toBe(0);
  });

  it('(F) a legacy questionnaire missing specialConditions/limits stays fail-closed — no program, no crash', async () => {
    const legacyRaw = { ...VALID_ANSWERS } as Record<string, unknown>;
    delete legacyRaw.specialConditions;
    delete legacyRaw.limits;
    await seedUserAndQuestionnaire(VALID_ANSWERS, legacyRaw);

    const result = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: legacyRaw as never, source: 'automatic_reconciliation',
    });

    expect(result.status).toBe('NEEDS_QUESTIONNAIRE_UPDATE');
    if (result.status !== 'NEEDS_QUESTIONNAIRE_UPDATE') return;
    expect(result.reasonCodes).toContain('QUESTIONNAIRE_SPECIAL_CONDITIONS_UNKNOWN');
    const programs = await getDocs(collection(mocks.db as never, 'users', UID, 'workoutPrograms'));
    expect(programs.size).toBe(0);
  });
});
