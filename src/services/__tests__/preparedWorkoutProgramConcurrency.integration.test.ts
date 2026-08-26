/**
 * OPT-IN integration proof against the REAL Firestore Emulator. Proves
 * Phase 3, Part I: `persistPreparedWorkoutProgram` (signup-time) and
 * `generateAndPersistWorkoutProgramDeduped` (automatic_reconciliation)
 * racing for the SAME (uid, questionnaireId) converge on exactly one
 * active program — never two.
 *
 * Skipped by default — only runs when
 * `PREPARED_WORKOUT_PROGRAM_CONCURRENCY_INTEGRATION=1` is set (see the
 * `test:integration:preparedWorkoutProgramConcurrency` npm script).
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

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'erin';
const QUESTIONNAIRE_ID = 'q1';

const enabled = process.env.PREPARED_WORKOUT_PROGRAM_CONCURRENCY_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({
  get db() {
    return mocks.db;
  },
}));

import {
  generateAndPersistWorkoutProgramDeduped,
  persistPreparedWorkoutProgram,
  prepareWorkoutProgramLocally,
  saveAndActivateWorkoutProgram,
} from '../workoutPrograms';

const T003_SEED = buildSeedDocuments().find((t) => t.id === 'T003');
if (!T003_SEED) throw new Error('T003 fixture missing — cannot run this integration test');

const VALID_ANSWERS = completeAnswers({ level: 'intermediate', days: 4, place: 'gym', sex: 'm', goal: 'gain_muscle' });

describe.skipIf(!enabled)('prepared-persist + automatic_reconciliation concurrency — real Firestore Emulator', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
    });
    mocks.db = testEnv.authenticatedContext(UID, { email: 'erin@example.com', email_verified: true }).firestore();
  });

  afterAll(async () => testEnv.cleanup());

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const rawDb = ctx.firestore();
      await setDoc(doc(rawDb, 'users', UID), {
        profile: { name: 'Erin', email: 'erin@example.com' },
        preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
        subscription: {},
        metadata: { role: 'user', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), commercialGateResolvedAt: Timestamp.now() },
      });
      await setDoc(doc(rawDb, 'workoutTemplates', 'T003'), T003_SEED);
      await setDoc(doc(rawDb, 'users', UID, 'questionnaires', QUESTIONNAIRE_ID), {
        answers: toPersistedAnswers(VALID_ANSWERS),
        version: 1,
        createdAt: Timestamp.now(),
      });
    });
  });

  it('(21)(22) persistPreparedWorkoutProgram (signup) racing generateAndPersistWorkoutProgramDeduped (reconciliation) converge on exactly one active program', async () => {
    const prepared = await prepareWorkoutProgramLocally(VALID_ANSWERS);
    expect(prepared.status).toBe('SUCCESS');

    const [signupResult, reconciliationResult] = await Promise.all([
      persistPreparedWorkoutProgram({
        uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
        answers: VALID_ANSWERS, prepared, source: 'onboarding',
      }),
      generateAndPersistWorkoutProgramDeduped({
        uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
        answers: VALID_ANSWERS, source: 'automatic_reconciliation',
      }),
    ]);

    expect(signupResult.status).toBe('SUCCESS');
    expect(reconciliationResult.status).toBe('SUCCESS');
    if (signupResult.status !== 'SUCCESS' || reconciliationResult.status !== 'SUCCESS') return;
    // Same deterministic identity — both calls MUST target the same programId.
    expect(signupResult.program.programId).toBe(reconciliationResult.program.programId);

    const programs = await getDocs(collection(mocks.db as never, 'users', UID, 'workoutPrograms'));
    expect(programs.size).toBe(1);
    const activeState = await getDoc(doc(mocks.db as never, 'users', UID, 'workoutProgramState', 'active'));
    expect(activeState.data()?.programId).toBe(signupResult.program.programId);
  });

  it('(21) two concurrent persistPreparedWorkoutProgram calls (e.g. a double-invoked signup) never duplicate the program', async () => {
    const prepared = await prepareWorkoutProgramLocally(VALID_ANSWERS);
    expect(prepared.status).toBe('SUCCESS');

    const [a, b] = await Promise.all([
      persistPreparedWorkoutProgram({
        uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
        answers: VALID_ANSWERS, prepared, source: 'onboarding',
      }),
      persistPreparedWorkoutProgram({
        uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
        answers: VALID_ANSWERS, prepared, source: 'onboarding',
      }),
    ]);
    expect(a.status).toBe('SUCCESS');
    expect(b.status).toBe('SUCCESS');
    if (a.status !== 'SUCCESS' || b.status !== 'SUCCESS') return;
    expect(a.program.programId).toBe(b.program.programId);

    const programs = await getDocs(collection(mocks.db as never, 'users', UID, 'workoutPrograms'));
    expect(programs.size).toBe(1);
  });

  it('audit (item 8): two INDEPENDENT saveAndActivateWorkoutProgram transactions for the SAME deterministic programId — bypassing the in-process dedup registry entirely — never hit failed-precondition', async () => {
    // The two tests above race through `persistPreparedWorkoutProgram`/
    // `generateAndPersistWorkoutProgramDeduped`, which share ONE in-process
    // `inFlightGenerations` entry for the same (uid, questionnaireId) key —
    // they never actually reach Firestore as two separate transactions. This
    // test calls the lower-level `saveAndActivateWorkoutProgram` directly,
    // twice, via `Promise.all` — genuinely independent callers (as two
    // separate app processes/mounts racing after the dedup key has already
    // cleared would be) hitting the real transaction + `firestore.rules`
    // `workoutProgramCommonValid`/`workoutProgramState` preconditions at the
    // same time. This is the audit's most direct real-Firestore
    // reproduction attempt for the reported `failed-precondition` — see the
    // final report for what this does and does not prove.
    const prepared = await prepareWorkoutProgramLocally(VALID_ANSWERS);
    expect(prepared.status).toBe('SUCCESS');
    if (prepared.status !== 'SUCCESS') return;

    const input = {
      uid: UID,
      questionnaireId: QUESTIONNAIRE_ID,
      questionnaireVersion: 1,
      plan: prepared.plan,
      template: T003_SEED,
      source: 'onboarding' as const,
    };

    const results = await Promise.allSettled([
      saveAndActivateWorkoutProgram(input),
      saveAndActivateWorkoutProgram(input),
    ]);

    const rejected = results.filter((result) => result.status === 'rejected');
    const codes = rejected.map((result) => (result as PromiseRejectedResult).reason?.code);
    expect(codes.every((code) => code !== 'failed-precondition')).toBe(true);

    const fulfilled = results.filter((result) => result.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof saveAndActivateWorkoutProgram>>
    >[];
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const programIds = new Set(fulfilled.map((result) => result.value.programId));
    expect(programIds.size).toBe(1);

    const programs = await getDocs(collection(mocks.db as never, 'users', UID, 'workoutPrograms'));
    expect(programs.size).toBe(1);
    expect(programs.docs[0].data().status).toBe('active');
  });

  it('a fingerprint mismatch (prepared computed for different answers) discards prepared and regenerates authoritatively — no wrong plan persisted', async () => {
    // `never_or_starting` halves exercises-per-session at stage 1
    // (beginnerKeepFactor 0.50) — a reliable, already-tested structural
    // difference from `intermediate`'s unreduced sessions, used here purely
    // to PROVE which answers actually shaped the persisted plan.
    const staleAnswers = completeAnswers({ level: 'never_or_starting', days: 4, place: 'gym', sex: 'm', goal: 'gain_muscle' });
    const prepared = await prepareWorkoutProgramLocally(staleAnswers);
    expect(prepared.status).toBe('SUCCESS');
    if (prepared.status !== 'SUCCESS') return;

    const result = await persistPreparedWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1,
      answers: VALID_ANSWERS, // the ACTUALLY persisted questionnaire — `intermediate`, NOT reduced
      prepared, source: 'onboarding',
    });

    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    // If the mismatch had gone undetected, the beginner-reduced `prepared.plan`
    // would have been persisted verbatim. It wasn't — the persisted session
    // has MORE exercises than the stale prepared one, proving the
    // authoritative path (using `VALID_ANSWERS`) actually ran.
    expect(result.program.sessions[0].exercises.length).toBeGreaterThan(
      prepared.plan.sessions[0].exercises.length,
    );
  });
});
