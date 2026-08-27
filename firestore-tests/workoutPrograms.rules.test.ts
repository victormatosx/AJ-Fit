import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const OTHER_UID = 'mallory';
const LIMITATION_DATASET_VERSION = 'phase3-limitation-profiles-v2';
const LIMITATION_DATASET_HASH = 'a'.repeat(64);
let testEnv: RulesTestEnvironment;

function dbFor(uid: string, admin = false) {
  return testEnv.authenticatedContext(uid, {
    email: `${uid}@example.com`,
    email_verified: true,
    ...(admin ? { admin: true } : {}),
  }).firestore();
}

function userDocument(uid: string, role: 'user' | 'admin' = 'user') {
  return {
    profile: { name: uid, email: `${uid}@example.com` },
    preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
    subscription: {},
    metadata: { role, createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
  };
}

function templateDocument() {
  return {
    id: 'T003', version: 1, sourceVersion: '1.3.0', libraryId: 'canonical',
    contentHash: 'a'.repeat(64), status: 'active',
    profile: { sex: 'male', environment: 'gym', primaryGoal: 'hypertrophy_body_composition', daysPerWeek: 4 },
    split: 'upper/lower', rationale: 'fixture',
    sessions: [{ name: 'A', type: 'strength', exercises: [{ exerciseId: 'squat', sets: 3, reps: '8-12' }] }],
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  };
}

function programDocument(programId = 'wpg_12345678') {
  return {
    programId, planId: 'wp_12345678', prescriptionId: 'wp_12345678', templateId: 'T003', templateVersion: 1,
    templateSourceVersion: '1.3.0', templateContentHash: 'a'.repeat(64),
    questionnaireId: 'q1', questionnaireVersion: 1, status: 'active', source: 'onboarding',
    requestedDays: 4, prescribedStructuredDays: 4, population: 'conventional', environment: 'gym',
    goalFamily: 'hypertrophy_body_composition', split: 'upper/lower',
    limitationDatasetVersion: LIMITATION_DATASET_VERSION,
    limitationDatasetHash: LIMITATION_DATASET_HASH,
    sessions: [{ name: 'A', type: 'strength', exercises: [{ exerciseId: 'squat', sourceExerciseId: 'squat', sets: 3, reps: '8-12' }] }],
    versions: { templateLibrary: '1.3.0', selectionEngine: '1.0.0', safetyRules: '1.0.0', modifierRules: '2.0.0', compositionEngine: '2.0.0', limitationResolver: '1.0.0' },
    trace: { selectionReasons: [], safety: { status: 'CLEAR', reasons: [], requiredModifierIds: [], protectedConstraints: [] }, appliedModifiers: [], unresolvedModifiers: [], conflicts: [], substitutions: [], limitationResolverVersion: 1, limitationDecisions: [] as Array<Record<string, unknown>>, compositionDecisions: [], validationCodes: [] },
    createdAt: serverTimestamp(), activatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});
afterAll(async () => testEnv.cleanup());
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', UID), userDocument(UID));
    await setDoc(doc(context.firestore(), 'users', OTHER_UID), userDocument(OTHER_UID));
    await setDoc(doc(context.firestore(), 'workoutTemplates', 'T003'), templateDocument());
    await setDoc(doc(context.firestore(), 'limitationDatasetState', 'active'), {
      datasetVersion: LIMITATION_DATASET_VERSION,
      limitationDatasetHash: LIMITATION_DATASET_HASH,
    });
    await setDoc(doc(context.firestore(), 'users', UID, 'questionnaires', 'q1'), {
      answers: { specialConditions: ['none'] }, version: 1, createdAt: Timestamp.now(),
    });
    await setDoc(doc(context.firestore(), 'users', OTHER_UID, 'questionnaires', 'q1'), {
      answers: { specialConditions: ['none'] }, version: 1, createdAt: Timestamp.now(),
    });
  });
});

async function createAndActivate(
  uid = UID,
  programId = 'wpg_12345678',
  program = programDocument(programId),
) {
  const db = dbFor(uid);
  await runTransaction(db, async (transaction) => {
    const targetRef = doc(db, 'users', uid, 'workoutPrograms', programId);
    const target = await transaction.get(targetRef);
    if (target.exists()) {
      transaction.update(targetRef, {
        status: 'active', activatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    } else {
      transaction.set(targetRef, program);
    }
    transaction.set(doc(db, 'users', uid, 'workoutProgramState', 'active'), {
      programId,
      updatedAt: serverTimestamp(),
    });
  });
}

describe('workoutTemplates', () => {
  it('allows authenticated reads and denies normal-client writes/deletes', async () => {
    await assertSucceeds(getDoc(doc(dbFor(UID), 'workoutTemplates', 'T003')));
    await assertFails(setDoc(doc(dbFor(UID), 'workoutTemplates', 'T004'), templateDocument()));
    await assertFails(updateDoc(doc(dbFor(UID), 'workoutTemplates', 'T003'), { split: 'forged' }));
  });
});

describe('workoutPrograms', () => {
  it('atomically creates the snapshot and pointer, and repeated activation stays one document', async () => {
    await assertSucceeds(createAndActivate());
    await assertSucceeds(createAndActivate());
    const state = await getDoc(doc(dbFor(UID), 'users', UID, 'workoutProgramState', 'active'));
    expect(state.data()?.programId).toBe('wpg_12345678');
  });

  it('denies a program without the matching parent-pointer transaction', async () => {
    await assertFails(setDoc(doc(dbFor(UID), 'users', UID, 'workoutPrograms', 'wpg_12345678'), programDocument()));
  });

  it('accepts a legacy program without identity, but rejects partial or non-active identity', async () => {
    const legacy = programDocument('wpg_legacy1') as Record<string, unknown>;
    delete legacy.limitationDatasetVersion;
    delete legacy.limitationDatasetHash;
    await assertSucceeds(createAndActivate(UID, 'wpg_legacy1', legacy as ReturnType<typeof programDocument>));

    const missing = programDocument() as Record<string, unknown>;
    delete missing.limitationDatasetHash;
    await assertFails(createAndActivate(UID, 'wpg_missing1', { ...missing, programId: 'wpg_missing1' } as ReturnType<typeof programDocument>));
    await assertFails(createAndActivate(UID, 'wpg_mismatch', {
      ...programDocument('wpg_mismatch'),
      limitationDatasetHash: 'b'.repeat(64),
    }));
  });

  it('isolates users and freezes prescription content', async () => {
    await assertSucceeds(createAndActivate());
    await assertFails(getDoc(doc(dbFor(OTHER_UID), 'users', UID, 'workoutPrograms', 'wpg_12345678')));
    await assertFails(updateDoc(doc(dbFor(OTHER_UID), 'users', UID, 'workoutPrograms', 'wpg_12345678'), { status: 'superseded' }));
    await assertFails(updateDoc(doc(dbFor(UID), 'users', UID, 'workoutPrograms', 'wpg_12345678'), { split: 'changed' }));
  });

  it('rejects blocked/unresolved safety snapshots', async () => {
    const blocked = programDocument();
    blocked.trace.safety.status = 'BLOCKED';
    const db = dbFor(UID);
    await assertFails(runTransaction(db, async (transaction) => {
      transaction.set(doc(db, 'users', UID, 'workoutPrograms', blocked.programId), blocked);
      transaction.set(doc(db, 'users', UID, 'workoutProgramState', 'active'), {
        programId: blocked.programId,
        updatedAt: serverTimestamp(),
      });
    }));
  });

  it('accepts a resolved musculoskeletal snapshot with versioned decision evidence', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'questionnaires', 'q1'), {
        answers: { specialConditions: ['musculoskeletal_limitation'], limits: ['knee'] },
        version: 1,
        createdAt: Timestamp.now(),
      });
    });
    const resolved = programDocument();
    resolved.trace.safety.status = 'ADAPTED';
    resolved.trace.limitationDecisions = [{
      sessionIndex: 0,
      originalExerciseId: 'squat',
      finalExerciseId: 'chair-squat',
      regionsEvaluated: ['knee'],
      resolution: 'adapted',
      reasonRegions: ['knee'],
      protocolVersion: 'musculoskeletal-v1',
      reviewBasis: 'product_policy',
    }];
    await assertSucceeds(createAndActivate(UID, resolved.programId, resolved));
  });

  it('fails closed when limitation resolution evidence is absent or unversioned', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'questionnaires', 'q1'), {
        answers: { specialConditions: ['musculoskeletal_limitation'], limits: ['knee'] },
        version: 1,
        createdAt: Timestamp.now(),
      });
    });
    const unresolved = programDocument();
    unresolved.trace.limitationDecisions = [];
    await assertFails(createAndActivate(UID, unresolved.programId, unresolved));
  });

  it('rejects an unmapped musculoskeletal region even with forged trace evidence', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'questionnaires', 'q1'), {
        answers: { specialConditions: ['musculoskeletal_limitation'], limits: ['other'] },
        version: 1,
        createdAt: Timestamp.now(),
      });
    });
    const forged = programDocument();
    forged.trace.limitationDecisions = [{}];
    await assertFails(createAndActivate(UID, forged.programId, forged));
  });

  it('fails closed for the legacy limits-only questionnaire shape', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'questionnaires', 'q1'), {
        answers: { limits: ['knee'] }, version: 1, createdAt: Timestamp.now(),
      });
    });
    await assertFails(createAndActivate());
  });
});
