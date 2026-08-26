import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const OTHER_UID = 'mallory';
const FROM_PROGRAM_ID = 'wpg_stage1';
// A fixed point far in the past — guaranteed never to equal `request.time`,
// unlike `Timestamp.now()` (which can occasionally coincide with the local
// emulator's own clock down to the millisecond, flaking these assertions).
const FABRICATED_TIMESTAMP = Timestamp.fromMillis(0);
let testEnv: RulesTestEnvironment;

function dbFor(uid: string) {
  return testEnv.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();
}

function userDocument(uid: string) {
  return {
    profile: { name: uid, email: `${uid}@example.com` },
    preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
    subscription: {},
    metadata: { role: 'user', createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
  };
}

function progressionEventDoc(overrides: Record<string, unknown> = {}) {
  return {
    type: 'BEGINNER_STAGE_TRANSITION',
    toProgramId: 'wpg_stage2',
    fromStage: 1,
    toStage: 2,
    reason: 'BEGINNER_STAGE_TIME_AND_SESSIONS_MET',
    occurredAt: serverTimestamp(),
    progressionEngineVersion: 1,
    ...overrides,
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
    await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', FROM_PROGRAM_ID), { programId: FROM_PROGRAM_ID, status: 'superseded' });
    await setDoc(doc(context.firestore(), 'users', OTHER_UID, 'workoutPrograms', FROM_PROGRAM_ID), { programId: FROM_PROGRAM_ID, status: 'superseded' });
  });
});

describe('users/{uid}/workoutPrograms/{programId}/progressionEvents', () => {
  it('lets the owner append an immutable progression event', async () => {
    const db = dbFor(UID);
    await assertSucceeds(setDoc(
      doc(db, 'users', UID, 'workoutPrograms', FROM_PROGRAM_ID, 'progressionEvents', 'beginner_stage_transition_2026-08-25'),
      progressionEventDoc(),
    ));
  });

  it('denies cross-user read/write', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'users', UID, 'workoutPrograms', FROM_PROGRAM_ID, 'progressionEvents', 'e1'),
        progressionEventDoc(),
      );
    });
    await assertFails(getDoc(doc(dbFor(OTHER_UID), 'users', UID, 'workoutPrograms', FROM_PROGRAM_ID, 'progressionEvents', 'e1')));
    await assertFails(setDoc(
      doc(dbFor(OTHER_UID), 'users', UID, 'workoutPrograms', FROM_PROGRAM_ID, 'progressionEvents', 'forged'),
      progressionEventDoc(),
    ));
  });

  it('accepts a NORMAL_ROTATION event with null stages (never-Beginner or already-graduated user)', async () => {
    const db = dbFor(UID);
    await assertSucceeds(setDoc(
      doc(db, 'users', UID, 'workoutPrograms', FROM_PROGRAM_ID, 'progressionEvents', 'normal_rotation_2026-08-25'),
      progressionEventDoc({ type: 'NORMAL_ROTATION', toProgramId: FROM_PROGRAM_ID, fromStage: null, toStage: null, reason: 'NORMAL_CYCLE_TIME_AND_ADHERENCE_MET' }),
    ));
  });

  it('rejects an unknown event type, an out-of-range stage, and a fabricated occurredAt', async () => {
    const db = dbFor(UID);
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutPrograms', FROM_PROGRAM_ID, 'progressionEvents', 'e2'), progressionEventDoc({ type: 'BOGUS' })));
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutPrograms', FROM_PROGRAM_ID, 'progressionEvents', 'e3'), progressionEventDoc({ toStage: 4 })));
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutPrograms', FROM_PROGRAM_ID, 'progressionEvents', 'e4'), progressionEventDoc({ occurredAt: FABRICATED_TIMESTAMP })));
  });

  it('rejects extra fields and a missing required field', async () => {
    const db = dbFor(UID);
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutPrograms', FROM_PROGRAM_ID, 'progressionEvents', 'e5'), { ...progressionEventDoc(), extra: true }));
    const { reason: _drop, ...missing } = progressionEventDoc();
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutPrograms', FROM_PROGRAM_ID, 'progressionEvents', 'e6'), missing));
  });

  it('is immutable — no update or delete', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutPrograms', FROM_PROGRAM_ID, 'progressionEvents', 'e7');
    await setDoc(ref, progressionEventDoc());
    await assertFails(updateDoc(ref, { toStage: 3 }));
    await assertFails(deleteDoc(ref));
  });
});

describe('workoutPrograms — automatic_progression source (Progression Engine V1)', () => {
  it('the widened source enum accepts automatic_progression on a program document', async () => {
    // workoutProgramCommonValid cross-checks against a live workoutTemplates
    // doc and the referenced questionnaire — exercising the full check is
    // covered by workoutPrograms.rules.test.ts; this only confirms the new
    // enum value itself isn't rejected by the `source in [...]` list.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'workoutTemplates', 'T003'), {
        id: 'T003', status: 'active', version: 1, sourceVersion: '1.3.0', contentHash: 'a'.repeat(64), sessions: [{}],
      });
      await setDoc(doc(db, 'users', UID, 'questionnaires', 'q1'), {
        answers: { specialConditions: ['none'], limits: [] }, version: 1, createdAt: Timestamp.now(),
      });
    });
    const db = dbFor(UID);
    const programDoc = {
      programId: 'wpg_auto1', planId: 'plan_1', prescriptionId: 'plan_1', templateId: 'T003', templateVersion: 1,
      templateSourceVersion: '1.3.0', templateContentHash: 'a'.repeat(64), questionnaireId: 'q1', questionnaireVersion: 1,
      status: 'active', source: 'automatic_progression', requestedDays: 4, prescribedStructuredDays: 4,
      population: 'convencional', environment: 'gym', goalFamily: 'hypertrophy_body_composition', split: 'ABCD',
      sessions: [{ name: 'A', type: 'strength', exercises: [] }],
      versions: { templateLibrary: '1.3.0', selectionEngine: '1.0.0', safetyRules: '1.0.0', modifierRules: '2.0.0', compositionEngine: '2.0.0' },
      trace: { safety: { status: 'CLEAR' }, unresolvedModifiers: [] },
      createdAt: serverTimestamp(), activatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    };
    await assertSucceeds(runTransaction(db, async (transaction) => {
      transaction.set(doc(db, 'users', UID, 'workoutPrograms', 'wpg_auto1'), programDoc);
      transaction.set(doc(db, 'users', UID, 'workoutProgramState', 'active'), { programId: 'wpg_auto1', updatedAt: serverTimestamp() });
    }));
  });
});
