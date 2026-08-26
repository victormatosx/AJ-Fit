import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const OTHER_UID = 'mallory';
const PROGRAM_ID = 'wpg_12345678';
const OTHER_PROGRAM_ID = 'wpg_other';
const EXECUTION_ID = 'exec_wpg_12345678_0_2026-08-25';
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

const oneSet = () => [{ setIndex: 0, status: 'PENDING', actualReps: null, weightKg: null, actualDurationSeconds: null }];

function executionDoc(overrides: Record<string, unknown> = {}) {
  return {
    programId: PROGRAM_ID,
    templateId: 'T003',
    sessionIndex: 0,
    sessionName: 'A',
    scheduledLocalDate: '2026-08-25',
    status: 'IN_PROGRESS',
    startedAt: serverTimestamp(),
    finishedAt: null,
    exercises: [
      {
        exerciseIndex: 0,
        exerciseId: 'bench_press',
        prescribedSets: 3,
        prescribedReps: '8-12',
        prescribedDuration: null,
        prescribedCycles: null,
        sets: oneSet(),
      },
    ],
    executionSchemaVersion: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
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
    // Minimal program doc — workoutExecutionCommonValid only cross-checks
    // `programId`, not the full workoutProgramCommonValid shape.
    await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', PROGRAM_ID), { programId: PROGRAM_ID, status: 'active' });
    await setDoc(doc(context.firestore(), 'users', OTHER_UID, 'workoutPrograms', PROGRAM_ID), { programId: PROGRAM_ID, status: 'active' });
  });
});

describe('users/{uid}/workoutExecutions — create', () => {
  it('lets the owner start an execution referencing their own program', async () => {
    const db = dbFor(UID);
    await assertSucceeds(setDoc(doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc()));
  });

  it('denies cross-user create/read', async () => {
    await assertFails(setDoc(doc(dbFor(OTHER_UID), 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc()));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc());
    });
    await assertFails(getDoc(doc(dbFor(OTHER_UID), 'users', UID, 'workoutExecutions', EXECUTION_ID)));
  });

  it('rejects an execution referencing a program that does not belong to this user (item 52)', async () => {
    const db = dbFor(UID);
    await assertFails(setDoc(
      doc(db, 'users', UID, 'workoutExecutions', 'exec_bogus'),
      executionDoc({ programId: OTHER_PROGRAM_ID }),
    ));
  });

  it('rejects a status other than IN_PROGRESS, a non-null finishedAt, or a fabricated startedAt', async () => {
    const db = dbFor(UID);
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutions', 'e1'), executionDoc({ status: 'COMPLETED' })));
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutions', 'e2'), executionDoc({ finishedAt: FABRICATED_TIMESTAMP })));
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutions', 'e3'), executionDoc({ startedAt: FABRICATED_TIMESTAMP })));
  });

  it('rejects extra fields and a missing required field', async () => {
    const db = dbFor(UID);
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutions', 'e4'), { ...executionDoc(), extra: true }));
    const { sessionName: _drop, ...missing } = executionDoc();
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutions', 'e5'), missing));
  });

  it('rejects an out-of-range sessionIndex and a malformed scheduledLocalDate', async () => {
    const db = dbFor(UID);
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutions', 'e6'), executionDoc({ sessionIndex: -1 })));
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutions', 'e7'), executionDoc({ scheduledLocalDate: '08/25/2026' })));
  });
});

// `updateDoc` merges with the stored document, so fields not mentioned in
// the patch (programId, sessionIndex, startedAt, createdAt, ...) keep their
// exact original values — the correct way to exercise "must stay unchanged"
// rule constraints (unlike a full `setDoc` overwrite, which would submit a
// brand-new `serverTimestamp()` sentinel for every field every time).
describe('users/{uid}/workoutExecutions — update while IN_PROGRESS', () => {
  it('lets the owner log sets and keep the execution IN_PROGRESS', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    const loggedExercises = [{
      exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12',
      prescribedDuration: null, prescribedCycles: null,
      sets: [{ setIndex: 0, status: 'COMPLETED', actualReps: 10, weightKg: 40, actualDurationSeconds: null }],
    }];
    await assertSucceeds(updateDoc(ref, { exercises: loggedExercises, updatedAt: serverTimestamp() }));
  });

  it('denies cross-user update', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc());
    });
    await assertFails(updateDoc(doc(dbFor(OTHER_UID), 'users', UID, 'workoutExecutions', EXECUTION_ID), { updatedAt: serverTimestamp() }));
  });

  it('rejects changing programId, sessionIndex, scheduledLocalDate, startedAt, or createdAt on update', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    await assertFails(updateDoc(ref, { sessionIndex: 1, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { scheduledLocalDate: '2026-08-26', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { startedAt: FABRICATED_TIMESTAMP, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { createdAt: FABRICATED_TIMESTAMP, updatedAt: serverTimestamp() }));
  });

  it('finishing requires finishedAt == request.time (no fabricated timestamp)', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    await assertFails(updateDoc(ref, { status: 'COMPLETED', finishedAt: FABRICATED_TIMESTAMP, updatedAt: serverTimestamp() }));
  });

  it('lets the owner finish as COMPLETED or PARTIALLY_COMPLETED, and abandon', async () => {
    const db = dbFor(UID);
    const completeRef = doc(db, 'users', UID, 'workoutExecutions', 'e-complete');
    await setDoc(completeRef, executionDoc());
    await assertSucceeds(updateDoc(completeRef, { status: 'COMPLETED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() }));

    const partialRef = doc(db, 'users', UID, 'workoutExecutions', 'e-partial');
    await setDoc(partialRef, executionDoc());
    await assertSucceeds(updateDoc(partialRef, { status: 'PARTIALLY_COMPLETED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() }));

    const abandonRef = doc(db, 'users', UID, 'workoutExecutions', 'e-abandon');
    await setDoc(abandonRef, executionDoc());
    await assertSucceeds(updateDoc(abandonRef, { status: 'ABANDONED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
});

describe('users/{uid}/workoutExecutions — immutability after finish (item 53)', () => {
  it('rejects any further update once COMPLETED', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    await updateDoc(ref, { status: 'COMPLETED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await assertFails(updateDoc(ref, { sessionName: 'B', updatedAt: serverTimestamp() }));
  });

  it('rejects any further update once PARTIALLY_COMPLETED', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    await updateDoc(ref, { status: 'PARTIALLY_COMPLETED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await assertFails(updateDoc(ref, { sessionName: 'B', updatedAt: serverTimestamp() }));
  });

  it('an ABANDONED execution CAN be restarted (status back to IN_PROGRESS)', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    await updateDoc(ref, { status: 'ABANDONED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await assertSucceeds(updateDoc(ref, { status: 'IN_PROGRESS', finishedAt: null, updatedAt: serverTimestamp() }));
  });

  it('never allows delete, regardless of status', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    await assertFails(deleteDoc(ref));
    await updateDoc(ref, { status: 'COMPLETED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await assertFails(deleteDoc(ref));
  });
});
