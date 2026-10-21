/**
 * OPT-IN integration proof against the REAL Firestore Emulator — same
 * pattern as `workoutProgramReconciliation.integration.test.ts`. Proves
 * Phase 2's `restSeconds` field survives the real persist path
 * (`generateAndPersistWorkoutProgram` → `saveAndActivateWorkoutProgram`)
 * unchanged, and that Workout Execution (Phase 1) keeps working
 * side-by-side with it untouched.
 *
 * Skipped by default — only runs when `WORKOUT_PROGRAM_REST_SECONDS_INTEGRATION=1`
 * is set (see the `test:integration:workoutProgramRestSeconds` npm script).
 */
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { Timestamp,doc,getDoc,setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';

import { buildSeedDocuments } from '../../../scripts/seedWorkoutTemplates';
import { toPersistedAnswers } from '../../lib/questionnaireAnswers';
import { WEEKDAY_ORDER } from '../../state/AppState';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'dana';
const QUESTIONNAIRE_ID = 'q1';

const enabled = process.env.WORKOUT_PROGRAM_REST_SECONDS_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({
  get db() {
    return mocks.db;
  },
}));

import { finishWorkoutExecution,recordSetExecution,startOrResumeWorkoutExecution } from '../workoutExecutions';
import { generateAndPersistWorkoutProgram } from '../workoutPrograms';
import { installWorkoutLifecycleAuthorityFixture,resetWorkoutLifecycleAuthorityFixture } from './workoutLifecycleAuthorityFixture';
import { enableWorkoutLifecycleRollout } from './workoutLifecycleRolloutFixture';

const T003_SEED = buildSeedDocuments().find((t) => t.id === 'T003');
if (!T003_SEED) throw new Error('T003 fixture missing — cannot run restSeconds integration tests');

const ANSWERS = completeAnswers({
  level: 'intermediate', days: 4, trainingDays: WEEKDAY_ORDER.slice(0, 4), place: 'gym', sex: 'm', goal: 'gain_muscle',
});

describe.skipIf(!enabled)('restSeconds persistence — real Firestore Emulator integration', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
    });
    mocks.db = testEnv.authenticatedContext(UID, { email: 'dana@example.com', email_verified: true }).firestore();
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
        profile: { name: 'Dana', email: 'dana@example.com' },
        preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
        subscription: {},
        metadata: { role: 'user', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), commercialGateResolvedAt: Timestamp.now() },
      });
      await setDoc(doc(rawDb, 'workoutTemplates', 'T003'), T003_SEED);
      await setDoc(doc(rawDb, 'users', UID, 'questionnaires', QUESTIONNAIRE_ID), {
        answers: toPersistedAnswers(ANSWERS),
        version: 1,
        createdAt: Timestamp.now(),
      });
    });
  });

  it('(9) a newly generated program persists restSeconds on every exercise, exactly as composed', async () => {
    const result = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: ANSWERS, source: 'automatic_reconciliation',
    });
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;

    const snapshot = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutPrograms', result.program.programId));
    const data = snapshot.data() as { sessions: Array<{ exercises: Array<{ restSeconds?: number }> }> };
    for (const session of data.sessions) {
      for (const exercise of session.exercises) {
        expect(exercise.restSeconds).toBeDefined();
        expect(typeof exercise.restSeconds).toBe('number');
      }
    }
    // Matches what the in-memory plan already carried — Rules accepted the
    // extra field without needing any Rules changes (no per-exercise key
    // allowlist exists for `sessions[].exercises[]`).
    expect(data.sessions[0].exercises[0].restSeconds).toBe(result.program.sessions[0].exercises[0].restSeconds);
  });

  it('(14)(15)(16) Workout Execution start/recordSet/finish keep working unaffected by the new restSeconds field', async () => {
    const result = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: ANSWERS, source: 'automatic_reconciliation',
    });
    if (result.status !== 'SUCCESS') throw new Error('fixture setup failed');

    const execution = await startOrResumeWorkoutExecution({
      uid: UID, program: result.program, sessionIndex: 0, scheduledLocalDate: '2026-08-31',
    });
    expect(execution.status).toBe('IN_PROGRESS');

    await recordSetExecution({ uid: UID, executionId: execution.executionId, exerciseIndex: 0, setIndex: 0, weightKg: 40, actualReps: 10 });

    const finished = await finishWorkoutExecution(UID, execution.executionId);
    expect(['COMPLETED', 'PARTIALLY_COMPLETED']).toContain(finished.status);

    // Idempotent — a second finish call on the same (now-terminal) execution
    // must not throw or change the outcome (Phase 2 Part F requirement).
    const finishedAgain = await finishWorkoutExecution(UID, execution.executionId);
    expect(finishedAgain.status).toBe(finished.status);
  });
});
