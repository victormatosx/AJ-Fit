/**
 * REGRESSION SUITE — Cardio Finisher Completion Recovery hardening,
 * Architecture B (2026-09 security audit).
 *
 * Originally written as CHARACTERIZATION tests proving that a client could
 * write `WorkoutExecution.cardio` directly (bypassing `completeCardioExecution`
 * entirely) under the old "shape only" Rules — see the security audit report
 * for the original 10/10-ALLOWED results. Every scenario below now asserts
 * the OPPOSITE: after Architecture B, the client can never write `cardio`
 * at all — only the `completeWorkoutCardio` callable (Admin SDK, bypasses
 * Rules) may. Item 10 proves that bypass explicitly, so this file also
 * doubles as proof the fix didn't accidentally lock the field forever.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const PROGRAM_ID = 'wpg_12345678';
const EXECUTION_ID = 'exec_wpg_12345678_0_2026-08-25';
const FABRICATED_TIMESTAMP = Timestamp.fromMillis(1_000_000_000_000);
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

/** Seeds an execution whose `cardio` is already COMPLETED — with Rules disabled, the same way only the Admin-SDK callable legitimately can. */
async function seedAlreadyCompletedCardio(ref: ReturnType<typeof doc>) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc({
      cardio: { status: 'COMPLETED', actualDurationSeconds: 900, completedAt: Timestamp.now() },
    }));
  });
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
    await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', PROGRAM_ID), { programId: PROGRAM_ID, status: 'active' });
  });
});

describe('SECURITY REGRESSION — client-direct writes to WorkoutExecution.cardio must ALWAYS be denied (Architecture B)', () => {
  it('1) client null -> COMPLETED: DENIED', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    await assertFails(updateDoc(ref, {
      cardio: { status: 'COMPLETED', actualDurationSeconds: 900, completedAt: serverTimestamp() },
      updatedAt: serverTimestamp(),
    }));
  });

  it('2) client null -> COMPLETED with an arbitrary duration: DENIED', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    await assertFails(updateDoc(ref, {
      cardio: { status: 'COMPLETED', actualDurationSeconds: 36000, completedAt: serverTimestamp() },
      updatedAt: serverTimestamp(),
    }));
  });

  it('3) client arbitrary (non-server) completedAt: DENIED', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    await assertFails(updateDoc(ref, {
      cardio: { status: 'COMPLETED', actualDurationSeconds: 900, completedAt: FABRICATED_TIMESTAMP },
      updatedAt: serverTimestamp(),
    }));
  });

  it('4) client COMPLETED -> a DIFFERENT COMPLETED (rewriting an already-confirmed duration): DENIED', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await seedAlreadyCompletedCardio(ref);
    await assertFails(updateDoc(ref, {
      cardio: { status: 'COMPLETED', actualDurationSeconds: 1, completedAt: serverTimestamp() },
      updatedAt: serverTimestamp(),
    }));
  });

  it('5) client COMPLETED -> null (un-completing outside the restart-after-abandon path): DENIED', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await seedAlreadyCompletedCardio(ref);
    await assertFails(updateDoc(ref, { cardio: null, updatedAt: serverTimestamp() }));
  });

  it('6) cardio change bundled with a legitimate sets change in the SAME write: DENIED', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    const loggedExercises = [{
      exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12',
      prescribedDuration: null, prescribedCycles: null,
      sets: [{ setIndex: 0, status: 'COMPLETED', actualReps: 10, weightKg: 40, actualDurationSeconds: null }],
    }];
    await assertFails(updateDoc(ref, {
      exercises: loggedExercises,
      cardio: { status: 'COMPLETED', actualDurationSeconds: 900, completedAt: serverTimestamp() },
      updatedAt: serverTimestamp(),
    }));
    // Sanity: the sets-only half of that same write, without touching
    // cardio, still works exactly as before — this hardening never
    // regressed ordinary recordSet.
    await assertSucceeds(updateDoc(ref, { exercises: loggedExercises, updatedAt: serverTimestamp() }));
  });

  it('7) cardio change attempted AFTER WorkoutExecution is FINISHED (COMPLETED): DENIED', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    await updateDoc(ref, { status: 'COMPLETED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await assertFails(updateDoc(ref, {
      cardio: { status: 'COMPLETED', actualDurationSeconds: 900, completedAt: serverTimestamp() },
      updatedAt: serverTimestamp(),
    }));
  });

  it('7b) same denial after PARTIALLY_COMPLETED', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    await updateDoc(ref, { status: 'PARTIALLY_COMPLETED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await assertFails(updateDoc(ref, {
      cardio: { status: 'COMPLETED', actualDurationSeconds: 900, completedAt: serverTimestamp() },
      updatedAt: serverTimestamp(),
    }));
  });

  it('8) any client attempt to introduce/change cardio is denied regardless of shape (malformed or well-formed alike — the client simply has no path to this field anymore)', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    await assertFails(updateDoc(ref, {
      cardio: { status: 'IN_PROGRESS', actualDurationSeconds: 0, completedAt: serverTimestamp() },
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(ref, {
      cardio: { status: 'COMPLETED', actualDurationSeconds: -1, completedAt: serverTimestamp() },
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(ref, {
      cardio: { status: 'COMPLETED', actualDurationSeconds: 900, completedAt: serverTimestamp(), mode: 'run' },
      updatedAt: serverTimestamp(),
    }));
  });

  it('9) client CREATE with cardio already COMPLETED from the very first write: DENIED — create must always be born with cardio null/absent', async () => {
    const db = dbFor(UID);
    await assertFails(setDoc(
      doc(db, 'users', UID, 'workoutExecutions', 'exec_forged_from_birth'),
      executionDoc({ cardio: { status: 'COMPLETED', actualDurationSeconds: 999999, completedAt: serverTimestamp() } }),
    ));
    // Sanity: creating with cardio explicitly null (what startOrResumeWorkoutExecution always sends) still works.
    await assertSucceeds(setDoc(
      doc(db, 'users', UID, 'workoutExecutions', 'exec_born_clean'),
      executionDoc({ cardio: null }),
    ));
  });

  it('10) the Admin SDK (the completeWorkoutCardio callable, simulated via withSecurityRulesDisabled) is UNAFFECTED — Rules only restrict the CLIENT SDK', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const ref = doc(context.firestore(), 'users', UID, 'workoutExecutions', EXECUTION_ID);
      await setDoc(ref, executionDoc());
      await updateDoc(ref, {
        cardio: { status: 'COMPLETED', actualDurationSeconds: 900, completedAt: Timestamp.now() },
        updatedAt: Timestamp.now(),
      });
      const snap = await getDoc(ref);
      expect(snap.data()?.cardio).toMatchObject({ status: 'COMPLETED', actualDurationSeconds: 900 });
    });
  });

  it('11) restart-after-abandon still legitimately resets a stale COMPLETED cardio record back to null (the one client-side exception)', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await seedAlreadyCompletedCardio(ref);
    await updateDoc(ref, { status: 'ABANDONED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await assertSucceeds(updateDoc(ref, {
      status: 'IN_PROGRESS', finishedAt: null, cardio: null, updatedAt: serverTimestamp(),
    }));
  });

  it('11b) restart-after-abandon is still denied if it tries to smuggle a non-null cardio value in instead of null', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await seedAlreadyCompletedCardio(ref);
    await updateDoc(ref, { status: 'ABANDONED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await assertFails(updateDoc(ref, {
      status: 'IN_PROGRESS', finishedAt: null,
      cardio: { status: 'COMPLETED', actualDurationSeconds: 50, completedAt: serverTimestamp() },
      updatedAt: serverTimestamp(),
    }));
  });
});
