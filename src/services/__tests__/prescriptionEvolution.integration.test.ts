/** Opt-in real Firestore Emulator coverage for the Fase 3 Prescription Evolution Engine. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, setDoc, Timestamp } from 'firebase/firestore';

import { buildSeedDocuments } from '../../../scripts/seedWorkoutTemplates';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import { toPersistedAnswers } from '../../lib/questionnaireAnswers';
import { CANONICAL_LIMITATION_DATASET_HASH, CANONICAL_LIMITATION_DATASET_VERSION } from '../../workoutPrescription/limitationDataset';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'erin';
const QUESTIONNAIRE_ID = 'q1';
const enabled = process.env.PRESCRIPTION_EVOLUTION_INTEGRATION === '1';

let testEnv: RulesTestEnvironment;
const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../lib/firebase', () => ({ get db() { return mocks.db; } }));

import { generateAndPersistWorkoutProgram } from '../workoutPrograms';
import { evolvePrescription } from '../prescriptionEvolution';
import { enableWorkoutLifecycleRollout } from './workoutLifecycleRolloutFixture';
import { installWorkoutLifecycleAuthorityFixture, resetWorkoutLifecycleAuthorityFixture } from './workoutLifecycleAuthorityFixture';

const T003_SEED = buildSeedDocuments().find((t) => t.id === 'T003');
if (!T003_SEED) throw new Error('T003 fixture missing from catalog — cannot run this integration test');
const T004_SEED = buildSeedDocuments().find((t) => t.id === 'T004');
if (!T004_SEED) throw new Error('T004 fixture missing from catalog — cannot run this integration test');

const BEGINNER_ANSWERS = completeAnswers({
  sex: 'm', goal: 'gain_muscle', level: 'beginner', days: 4, place: 'gym', specialConditions: ['none'],
});

async function seedUserAndQuestionnaire() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const rawDb = ctx.firestore();
    await setDoc(doc(rawDb, 'users', UID), {
      profile: { name: 'Erin', email: 'erin@example.com' },
      preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
      subscription: {},
      metadata: { role: 'user', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), commercialGateResolvedAt: Timestamp.now() },
    });
    await setDoc(doc(rawDb, 'workoutTemplates', 'T003'), T003_SEED);
    await setDoc(doc(rawDb, 'workoutTemplates', 'T004'), T004_SEED);
    await setDoc(doc(rawDb, 'limitationDatasetState', 'active'), {
      datasetVersion: CANONICAL_LIMITATION_DATASET_VERSION,
      limitationDatasetHash: CANONICAL_LIMITATION_DATASET_HASH,
    });
    await setDoc(doc(rawDb, 'users', UID, 'questionnaires', QUESTIONNAIRE_ID), {
      answers: toPersistedAnswers(BEGINNER_ANSWERS),
      version: 1,
      createdAt: Timestamp.now(),
    });
  });
}

describe.skipIf(!enabled)('Prescription Evolution Engine (Fase 3) — real Firestore Emulator integration', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
    });
    mocks.db = testEnv.authenticatedContext(UID, { email: 'erin@example.com', email_verified: true }).firestore();
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

  it('LEVEL_PROMOTION: Beginner -> Intermediate preserves frequency=4 and never writes/activates anything', async () => {
    await seedUserAndQuestionnaire();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1, answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    expect(generated.status).toBe('SUCCESS');
    if (generated.status !== 'SUCCESS') return;

    const [instancesBefore, cyclesBefore] = await Promise.all([
      getDocs(collection(mocks.db as never, 'users', UID, 'programInstances')),
      getDocs(collection(mocks.db as never, 'users', UID, 'trainingCycles')),
    ]);

    const result = await evolvePrescription({ uid: UID, mode: 'LEVEL_PROMOTION', targetLevel: 'INTERMEDIATE' });
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS' || result.mode !== 'LEVEL_PROMOTION') return;
    expect(result.preservedFrequency).toBe(4);
    expect(result.plan.prescribedTrainingFrequency ?? result.plan.prescribedStructuredDays).toBe(4);

    const [instancesAfter, cyclesAfter] = await Promise.all([
      getDocs(collection(mocks.db as never, 'users', UID, 'programInstances')),
      getDocs(collection(mocks.db as never, 'users', UID, 'trainingCycles')),
    ]);
    // No activation, no new cycle/instance — Fase 3 only produces a candidate.
    expect(instancesAfter.size).toBe(instancesBefore.size);
    expect(cyclesAfter.size).toBe(cyclesBefore.size);
  });

  it('CYCLE_EVOLUTION: starts from the current prescription, preserves level/frequency/split, and never writes anything', async () => {
    await seedUserAndQuestionnaire();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1, answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    expect(generated.status).toBe('SUCCESS');
    if (generated.status !== 'SUCCESS') return;
    const original = generated.program;

    const [instancesBefore, cyclesBefore, eventsBefore] = await Promise.all([
      getDocs(collection(mocks.db as never, 'users', UID, 'programInstances')),
      getDocs(collection(mocks.db as never, 'users', UID, 'trainingCycles')),
      getDocs(collection(mocks.db as never, 'users', UID, 'workoutLifecycleEvents')),
    ]);

    const result = await evolvePrescription({ uid: UID, mode: 'CYCLE_EVOLUTION' });
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS' || result.mode === 'LEVEL_PROMOTION') return;

    expect(result.plan.split).toBe(original.split);
    expect(result.plan.environment).toBe(original.environment);
    expect(result.plan.goalFamily).toBe(original.goalFamily);
    expect(result.plan.prescribedTrainingFrequency ?? result.plan.prescribedStructuredDays)
      .toBe(original.prescribedTrainingFrequency ?? original.prescribedStructuredDays);
    expect(result.plan.sessions.length).toBe(original.sessions.length);
    result.plan.sessions.forEach((session, i) => {
      expect(session.exercises.length).toBe(original.sessions[i].exercises.length);
      // Movement anchor (first exercise of each session) never rotates.
      expect(session.exercises[0].exerciseId).toBe(original.sessions[i].exercises[0].exerciseId);
    });
    // No duplicate exerciseId within any single session (cross-session reuse
    // of the same exercise — e.g. squats on both Lower A and Lower B — is
    // normal programming and must not be flagged, docs §89).
    result.plan.sessions.forEach((session) => {
      const ids = session.exercises.map((e) => e.exerciseId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    const [instancesAfter, cyclesAfter, eventsAfter] = await Promise.all([
      getDocs(collection(mocks.db as never, 'users', UID, 'programInstances')),
      getDocs(collection(mocks.db as never, 'users', UID, 'trainingCycles')),
      getDocs(collection(mocks.db as never, 'users', UID, 'workoutLifecycleEvents')),
    ]);
    expect(instancesAfter.size).toBe(instancesBefore.size);
    expect(cyclesAfter.size).toBe(cyclesBefore.size);
    expect(eventsAfter.size).toBe(eventsBefore.size);
  });

  it('CYCLE_EVOLUTION is idempotent: same targetCycleIdentity twice -> exact same resulting plan', async () => {
    await seedUserAndQuestionnaire();
    const generated = await generateAndPersistWorkoutProgram({
      uid: UID, questionnaireId: QUESTIONNAIRE_ID, questionnaireVersion: 1, answers: BEGINNER_ANSWERS, source: 'onboarding',
    });
    expect(generated.status).toBe('SUCCESS');
    if (generated.status !== 'SUCCESS') return;

    const first = await evolvePrescription({ uid: UID, mode: 'CYCLE_EVOLUTION', targetCycleIdentity: 'fixed-key' });
    const second = await evolvePrescription({ uid: UID, mode: 'CYCLE_EVOLUTION', targetCycleIdentity: 'fixed-key' });
    expect(first).toEqual(second);
  });
});
