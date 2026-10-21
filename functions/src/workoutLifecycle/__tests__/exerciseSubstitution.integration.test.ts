/**
 * OPT-IN integration proof against the REAL Firestore Emulator — same
 * pattern as `completeWorkoutCardio.integration.test.ts`: a separate named
 * Admin app auto-connects via `FIRESTORE_EMULATOR_HOST`, exercising the
 * actual, unmodified `applyExerciseSubstitutionHandler`. The Admin SDK is
 * NOT subject to `firestore.rules` — this deliberately sidesteps the
 * pre-existing, already-documented "maximum of 1000 expressions to
 * evaluate" cap the client-SDK Rules-enforced suite
 * (`src/services/__tests__/workoutExecutions.integration.test.ts`) hits on
 * every `create`, even on its oldest, simplest, totally unrelated test (see
 * `docs/exercises-v3-production/etapa5c-5d-relatorio.md` §5 and
 * `firestore.rules` lines ~2650-2655, which already self-documents this
 * exact emulator limit for a different write path). This file validates the
 * real TRANSACTION/application logic the callable runs in production
 * (Cloud Functions always use the Admin SDK, never the client SDK) — it
 * does not, and cannot, prove anything about `firestore.rules` itself; that
 * remains the open gap this file's header comment discloses, not hides.
 *
 * `ACTIVE_SUBSTITUTION_POLICY` is never touched here — every V3-policy
 * scenario below seeds `substitutionPolicySnapshot: 'v3'` directly on the
 * EXECUTION document (exactly the Etapa 5A/6A pinning mechanism), proving
 * the callable honors the per-session pin without ever flipping the global
 * flag.
 *
 * Skipped by default — only runs when `EXERCISE_SUBSTITUTION_INTEGRATION=1`
 * is set (see the `test:integration:exerciseSubstitution` npm script).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { EXERCISES_SEED } from '../prescriptionEngine/data/exercisesSeedData';
import { applyExerciseSubstitutionHandler, validateMaterializedExecutionSubstitutions } from '../exerciseSubstitution';

const enabled = process.env.EXERCISE_SUBSTITUTION_INTEGRATION === '1';
const UID = 'subst-alice';
const OTHER_UID = 'subst-mallory';
const PROGRAM_ID = 'wpg_subst_test';
const INSTANCE_ID = 'inst_subst_test';
const EXECUTION_ID = 'exec_subst_test_0_2026-08-25';

// Real, catalog-backed anchor/candidates — the SAME pair Etapa 6A's unit
// tests use: approved editorially for gym-common, differs only in
// `movement.mechanic`, blocked by generic equivalence under legacy,
// eligible under v3 purely because of editorial approval.
const ANCHOR_ID = 'barbell-back-squat';
const CANDIDATE_ID = 'goblet-squat';
const UNAUTHORIZED_CANDIDATE_ID = 'barbell-flat-bench-press'; // real, catalog-backed, but never listed for this anchor at all.

function oneSet(status: 'PENDING' | 'COMPLETED' = 'PENDING') {
  return [{ setIndex: 0, status, actualReps: status === 'COMPLETED' ? 10 : null, weightKg: status === 'COMPLETED' ? 40 : null }];
}

function executionDoc(overrides: Record<string, unknown> = {}) {
  return {
    programId: PROGRAM_ID,
    programInstanceId: INSTANCE_ID,
    templateId: 'T001',
    sessionIndex: 0,
    sessionName: 'A',
    scheduledLocalDate: '2026-08-25',
    status: 'IN_PROGRESS',
    startedAt: Timestamp.now(),
    finishedAt: null,
    exercises: [
      { exerciseIndex: 0, exerciseId: ANCHOR_ID, prescribedExerciseId: ANCHOR_ID, prescribedSets: 3, prescribedReps: '8-12', sets: oneSet() },
      { exerciseIndex: 1, exerciseId: 'ez-bar-biceps-curl', prescribedExerciseId: 'ez-bar-biceps-curl', prescribedSets: 3, prescribedReps: '8-12', sets: oneSet() },
    ],
    executionSchemaVersion: 2,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

function programInstanceDoc() {
  return {
    prescriptionInputSnapshot: {
      inputs: {
        specialConditions: [], place: 'gym', equipment: [],
      },
    },
  };
}

function programDoc() {
  return { programId: PROGRAM_ID, environment: 'gym', templateSourceVersion: '1.27.0' };
}

function callableRequest(uid: string | null, data: unknown): CallableRequest {
  return (uid ? { auth: { uid }, data } : { data }) as never;
}

describe.skipIf(!enabled)('applyExerciseSubstitutionHandler — real Firestore Emulator integration (Admin SDK, Rules not involved)', () => {
  let app: App;
  let db: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'exercise-substitution-integration');
    db = getFirestore(app);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  beforeEach(async () => {
    await db.recursiveDelete(db.collection('users').doc(UID)).catch(() => {});
    await db.recursiveDelete(db.collection('users').doc(OTHER_UID)).catch(() => {});
    // `loadExerciseCatalog` requires every EXERCISES_SEED id present remotely.
    const batches: Promise<unknown>[] = [];
    let batch = db.batch();
    let opCount = 0;
    for (const exercise of EXERCISES_SEED) {
      batch.set(db.collection('exercises').doc(exercise.id), exercise);
      opCount += 1;
      if (opCount >= 450) { batches.push(batch.commit()); batch = db.batch(); opCount = 0; }
    }
    batches.push(batch.commit());
    await Promise.all(batches);
    await db.collection('users').doc(UID).collection('workoutPrograms').doc(PROGRAM_ID).set(programDoc());
    await db.collection('users').doc(UID).collection('programInstances').doc(INSTANCE_ID).set(programInstanceDoc());
    await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID).set(executionDoc());
  });

  it('rejects an unrelated exercise request', async () => {
    await expect(applyExerciseSubstitutionHandler(callableRequest(UID, { executionId: EXECUTION_ID, exerciseIndex: 0, requestedExerciseId: UNAUTHORIZED_CANDIDATE_ID, scope: 'SESSION' }), db)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('1) unauthenticated request: DENIED', async () => {
    await expect(applyExerciseSubstitutionHandler(callableRequest(null, { executionId: EXECUTION_ID, exerciseIndex: 0, requestedExerciseId: CANDIDATE_ID, scope: 'SESSION' }), db))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('2) execution belongs to a DIFFERENT uid: DENIED as not-found', async () => {
    await expect(applyExerciseSubstitutionHandler(callableRequest(OTHER_UID, { executionId: EXECUTION_ID, exerciseIndex: 0, requestedExerciseId: CANDIDATE_ID, scope: 'SESSION' }), db))
      .rejects.toMatchObject({ code: 'not-found' });
  });

  it.each(['SESSION', 'PERMANENT'] as const)('persists %s swaps, prescriptions and untouched history after reopening', async scope => {
    const ref = db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID);
    const before = (await ref.get()).data()!;
    await applyExerciseSubstitutionHandler(callableRequest(UID, { executionId: EXECUTION_ID, exerciseIndex: 0, requestedExerciseId: CANDIDATE_ID, scope }), db);
    const reopened = (await ref.get()).data()!;
    expect(reopened.exercises[0]).toMatchObject({ exerciseId: CANDIDATE_ID, prescribedExerciseId: ANCHOR_ID, prescribedSets: 3, prescribedReps: '8-12', sets: before.exercises[0].sets, substitution: { scope } });
    expect(reopened.exercises[1]).toEqual(before.exercises[1]);
    const preference = await db.collection('users').doc(UID).collection('exerciseSubstitutionPreferences').doc(ANCHOR_ID).get();
    expect(preference.exists).toBe(scope === 'PERMANENT');
    if (scope === 'PERMANENT') expect(preference.data()?.preferredExerciseId).toBe(CANDIDATE_ID);
  });

  it.each(['v3', 'legacy', null])('ignores historical policy %s and old unknown regions', async oldPolicy => {
    const root = db.collection('users').doc(UID);
    await root.collection('workoutExecutions').doc(EXECUTION_ID).update({ substitutionPolicySnapshot: oldPolicy });
    await root.collection('programInstances').doc(INSTANCE_ID).set({ prescriptionInputSnapshot: { inputs: { specialConditions: ['musculoskeletal_limitation'], limits: ['other', 'unknown'], equipment: [], place: 'gym' } } });
    const result = await applyExerciseSubstitutionHandler(callableRequest(UID, { executionId: EXECUTION_ID, exerciseIndex: 0, requestedExerciseId: CANDIDATE_ID, scope: 'SESSION' }), db);
    expect(result.exerciseId).toBe(CANDIDATE_ID);
  });

  it('reverts a permanent preference without losing recorded data', async () => {
    const request = (requestedExerciseId: string, scope: string) => callableRequest(UID, { executionId: EXECUTION_ID, exerciseIndex: 0, requestedExerciseId, scope });
    await applyExerciseSubstitutionHandler(request(CANDIDATE_ID, 'PERMANENT'), db);
    await applyExerciseSubstitutionHandler(request(ANCHOR_ID, 'SESSION'), db);
    const root = db.collection('users').doc(UID);
    expect((await root.collection('exerciseSubstitutionPreferences').doc(ANCHOR_ID).get()).exists).toBe(false);
    expect((await root.collection('workoutExecutions').doc(EXECUTION_ID).get()).data()?.exercises[0].substitution).toBeUndefined();
  });

  it('preserves completed sets by refusing a subsequent replacement', async () => {
    const doc = executionDoc();
    doc.exercises[0].sets = oneSet('COMPLETED');
    await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID).set(doc);
    await expect(applyExerciseSubstitutionHandler(callableRequest(UID, { executionId: EXECUTION_ID, exerciseIndex: 0, requestedExerciseId: CANDIDATE_ID, scope: 'SESSION' }), db)).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects equipment unavailable in a legacy home program', async () => {
    await db.collection('users').doc(UID).collection('workoutPrograms').doc(PROGRAM_ID).update({ environment: 'home', templateSourceVersion: '2.0.0' });
    await expect(applyExerciseSubstitutionHandler(callableRequest(UID, { executionId: EXECUTION_ID, exerciseIndex: 0, requestedExerciseId: CANDIDATE_ID, scope: 'SESSION' }), db)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('continues an already persisted historical swap without executing its retired policy', async () => {
    const ref = db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID);
    const old = executionDoc({ substitutionPolicySnapshot: 'v3' });
    old.exercises[0] = { ...old.exercises[0], prescribedExerciseId: 'hip-thrust', exerciseId: 'cable-glute-kickback', substitution: { scope: 'SESSION', appliedAt: Timestamp.now() } } as typeof old.exercises[number];
    await ref.set(old);
    expect(await validateMaterializedExecutionSubstitutions(UID, (await ref.get()).data()!, db)).toEqual({ valid: true });
    const modern = { ...old } as Record<string, unknown>;
    delete modern.substitutionPolicySnapshot;
    expect(await validateMaterializedExecutionSubstitutions(UID, modern, db)).toMatchObject({ valid: false, reason: 'substitution_not_eligible' });
  });
});
