import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, deleteField, doc, getDoc, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

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
    // Minimal program doc — workoutExecutionCommonValid cross-checks the
    // identity and uses scheduleMode to keep the early-date exception fixed-only.
    await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', PROGRAM_ID), { programId: PROGRAM_ID, status: 'active', scheduleMode: 'fixed' });
    await setDoc(doc(context.firestore(), 'users', OTHER_UID, 'workoutPrograms', PROGRAM_ID), { programId: PROGRAM_ID, status: 'active', scheduleMode: 'fixed' });
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

  it('allows an optional performedLocalDate only on the scheduled day or exactly one civil day before', async () => {
    const db = dbFor(UID);
    await assertSucceeds(setDoc(doc(db, 'users', UID, 'workoutExecutions', 'performed-normal'), executionDoc({
      performedLocalDate: '2026-08-25',
    })));
    await assertSucceeds(setDoc(doc(db, 'users', UID, 'workoutExecutions', 'performed-advanced'), executionDoc({
      performedLocalDate: '2026-08-24',
    })));
    await assertSucceeds(setDoc(doc(db, 'users', UID, 'workoutExecutions', 'performed-month-boundary'), executionDoc({
      scheduledLocalDate: '2026-09-01', performedLocalDate: '2026-08-31',
    })));
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutions', 'performed-two-days'), executionDoc({
      performedLocalDate: '2026-08-23',
    })));
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutions', 'performed-after'), executionDoc({
      performedLocalDate: '2026-08-26',
    })));
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutions', 'performed-malformed'), executionDoc({
      performedLocalDate: '08/24/2026',
    })));
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutions', 'performed-impossible'), executionDoc({
      scheduledLocalDate: '2026-03-01', performedLocalDate: '2026-02-31',
    })));
  });

  it('allows the exact V2 advanced-start transaction payload (execution + current mutex)', async () => {
    const db = dbFor(UID);
    const executionRef = doc(db, 'users', UID, 'workoutExecutions', 'exec_wpg_12345678_1_2026-09-17');
    const stateRef = doc(db, 'users', UID, 'workoutExecutionState', 'current');
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'programInstances', 'wpi_fixed'), {
        programInstanceId: 'wpi_fixed', contentIdentity: PROGRAM_ID,
      });
    });

    await assertSucceeds(runTransaction(db, async (transaction) => {
      const now = serverTimestamp();
      transaction.set(executionRef, executionDoc({
        programInstanceId: 'wpi_fixed',
        sessionIndex: 1,
        scheduledLocalDate: '2026-09-17',
        performedLocalDate: '2026-09-16',
        executionSchemaVersion: 2,
        mutexProtocolVersion: 1,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      }));
      transaction.set(stateRef, {
        executionId: 'exec_wpg_12345678_1_2026-09-17',
        programId: PROGRAM_ID,
        programInstanceId: 'wpi_fixed',
        sessionIndex: 1,
        scheduledLocalDate: '2026-09-17',
        status: 'IN_PROGRESS',
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
    }));
  });

  // P0 regression lock (2026-09-18 incident). The ruleset live in production
  // omitted `performedLocalDate` from `workoutExecutionCommonValid`'s
  // `hasOnly`, while `startOrResumeWorkoutExecution` writes that field on
  // EVERY create (`input.performedLocalDate ?? scheduledLocalDate`,
  // src/services/workoutExecutions.ts) — so every single start would have been
  // denied. The advanced-start payload was covered; the two NORMAL starts,
  // which are the overwhelmingly common path, were not.
  it('allows the exact V2 normal-start transaction payload for a fixed program (execution + current mutex)', async () => {
    const db = dbFor(UID);
    const executionId = 'exec_wpg_12345678_1_2026-09-17';
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'programInstances', 'wpi_fixed'), {
        programInstanceId: 'wpi_fixed', contentIdentity: PROGRAM_ID,
      });
    });

    await assertSucceeds(runTransaction(db, async (transaction) => {
      const now = serverTimestamp();
      transaction.set(doc(db, 'users', UID, 'workoutExecutions', executionId), executionDoc({
        programInstanceId: 'wpi_fixed',
        sessionIndex: 1,
        scheduledLocalDate: '2026-09-17',
        performedLocalDate: '2026-09-17',
        executionSchemaVersion: 2,
        mutexProtocolVersion: 1,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      }));
      transaction.set(doc(db, 'users', UID, 'workoutExecutionState', 'current'), {
        executionId,
        programId: PROGRAM_ID,
        programInstanceId: 'wpi_fixed',
        sessionIndex: 1,
        scheduledLocalDate: '2026-09-17',
        status: 'IN_PROGRESS',
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
    }));
  });

  it('allows the exact V2 normal-start transaction payload for a flexible program (execution + current mutex)', async () => {
    const executionId = 'exec_wpg_12345678_2_2026-09-17';
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, 'users', UID, 'workoutPrograms', PROGRAM_ID), {
        programId: PROGRAM_ID, status: 'active', scheduleMode: 'flexible',
      });
      await setDoc(doc(database, 'users', UID, 'programInstances', 'wpi_flexible'), {
        programInstanceId: 'wpi_flexible', contentIdentity: PROGRAM_ID,
      });
    });
    const db = dbFor(UID);

    await assertSucceeds(runTransaction(db, async (transaction) => {
      const now = serverTimestamp();
      transaction.set(doc(db, 'users', UID, 'workoutExecutions', executionId), executionDoc({
        programInstanceId: 'wpi_flexible',
        sessionIndex: 2,
        scheduledLocalDate: '2026-09-17',
        // A flexible program has no calendar, so the scheduled day IS the
        // performed day — the one-civil-day exception never applies (see the
        // rejection case below).
        performedLocalDate: '2026-09-17',
        executionSchemaVersion: 2,
        mutexProtocolVersion: 1,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      }));
      transaction.set(doc(db, 'users', UID, 'workoutExecutionState', 'current'), {
        executionId,
        programId: PROGRAM_ID,
        programInstanceId: 'wpi_flexible',
        sessionIndex: 2,
        scheduledLocalDate: '2026-09-17',
        status: 'IN_PROGRESS',
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
    }));
  });

  it('rejects a performed date more than one civil day before the scheduled date', async () => {
    const db = dbFor(UID);
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutions', 'performed-too-early-real'), executionDoc({
      scheduledLocalDate: '2026-09-17', performedLocalDate: '2026-09-15',
    })));
  });

  it('does not permit the one-day exception for a flexible program', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', PROGRAM_ID), {
        programId: PROGRAM_ID, status: 'active', scheduleMode: 'flexible',
      });
    });
    await assertFails(setDoc(doc(dbFor(UID), 'users', UID, 'workoutExecutions', 'performed-flexible'), executionDoc({
      performedLocalDate: '2026-08-24',
    })));
  });
});

describe('users/{uid}/workoutFinalizationAttempts — server-owned sidecar', () => {
  it('allows only the owner to read and denies every client write', async () => {
    const path = ['users', UID, 'workoutFinalizationAttempts', 'attempt_1'] as const;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), ...path), {
        executionId: EXECUTION_ID,
        checkpoints: { SERVER_ACCEPTED: new Date() },
      });
    });

    await assertSucceeds(getDoc(doc(dbFor(UID), ...path)));
    await assertFails(getDoc(doc(dbFor(OTHER_UID), ...path)));
    await assertFails(setDoc(doc(dbFor(UID), ...path), { checkpoints: { COMMITTED: new Date() } }));
    await assertFails(updateDoc(doc(dbFor(UID), ...path), { checkpoints: { COMMITTED: new Date() } }));
    await assertFails(deleteDoc(doc(dbFor(UID), ...path)));
  });
});

// `updateDoc` merges with the stored document, so fields not mentioned in
// the patch (programId, sessionIndex, startedAt, createdAt, ...) keep their
// exact original values — the correct way to exercise "must stay unchanged"
// rule constraints (unlike a full `setDoc` overwrite, which would submit a
// brand-new `serverTimestamp()` sentinel for every field every time).
describe('users/{uid}/workoutExecutions — update while IN_PROGRESS', () => {
  it('allows recordSetExecution-shaped updates for normal, advanced, and legacy documents', async () => {
    const db = dbFor(UID);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'programInstances', 'wpi_fixed'), {
        programInstanceId: 'wpi_fixed', contentIdentity: PROGRAM_ID,
      });
    });

    const cases = [
      { id: 'record-normal', override: { performedLocalDate: '2026-08-25' } },
      {
        id: 'record-advanced',
        override: {
          programInstanceId: 'wpi_fixed', sessionIndex: 1,
          scheduledLocalDate: '2026-09-17', performedLocalDate: '2026-09-16',
          executionSchemaVersion: 2, mutexProtocolVersion: 1, cardio: null,
        },
      },
      { id: 'record-legacy', override: {} },
    ];

    for (const { id, override } of cases) {
      const ref = doc(db, 'users', UID, 'workoutExecutions', id);
      await setDoc(ref, executionDoc(override));
      await assertSucceeds(updateDoc(ref, {
        exercises: [{
          exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3,
          prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null,
          sets: [{ setIndex: 0, status: 'COMPLETED', actualReps: 10, weightKg: 40, actualDurationSeconds: null }],
        }],
        updatedAt: serverTimestamp(),
      }));
    }
  });

  it('allows a flexible normal execution update when performedLocalDate equals scheduledLocalDate', async () => {
    const db = dbFor(UID);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', PROGRAM_ID), {
        programId: PROGRAM_ID, status: 'active', scheduleMode: 'flexible',
      });
    });
    const ref = doc(db, 'users', UID, 'workoutExecutions', 'record-flexible-normal');
    await setDoc(ref, executionDoc({ performedLocalDate: '2026-08-25' }));
    await assertSucceeds(updateDoc(ref, {
      exercises: [{
        exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3,
        prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null,
        sets: [{ setIndex: 0, status: 'COMPLETED', actualReps: 10, weightKg: 40, actualDurationSeconds: null }],
      }],
      updatedAt: serverTimestamp(),
    }));
  });

  it('reproduces the real seven-exercise shape and an eight-exercise stress update', async () => {
    const db = dbFor(UID);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'programInstances', 'wpi_28679d94'), {
        programInstanceId: 'wpi_28679d94', contentIdentity: PROGRAM_ID,
      });
    });
    const realExercises = [
      ['barbell-back-squat', '6-10'],
      ['dumbbell-stiff-leg-deadlift', '8-12'],
      ['leg-press-45', '10-15'],
      ['lying-leg-curl-machine', '10-15'],
      ['standing-calf-raise-machine', '10-20'],
      ['plank', '10-15'],
      // The first seven entries mirror the production execution; this eighth
      // entry is a bounded stress case above the catalog maximum.
      ['extra-test-exercise', '10-15'],
      ['extra-test-exercise-8', '10-15'],
    ].map(([exerciseId, prescribedReps], exerciseIndex) => ({
      exerciseIndex, exerciseId, prescribedExerciseId: exerciseId,
      prescribedSets: 2, prescribedReps, prescribedDuration: null, prescribedCycles: null,
      sets: [0, 1].map((setIndex) => ({
        setIndex, status: 'PENDING', actualReps: null, weightKg: null, actualDurationSeconds: null,
      })),
    }));
    const ref = doc(db, 'users', UID, 'workoutExecutions', 'exec_wpi_28679d94_1_2026-09-17');
    await setDoc(ref, executionDoc({
      programId: PROGRAM_ID, programInstanceId: 'wpi_28679d94', sessionIndex: 1,
      sessionName: 'Lower A', scheduledLocalDate: '2026-09-17', performedLocalDate: '2026-09-16',
      templateId: 'T003', mutexProtocolVersion: 1, executionSchemaVersion: 2,
      cardio: null, exercises: realExercises,
    }));
    const nextExercises = realExercises.map((exercise, index) => index === 0
      ? { ...exercise, sets: [{ ...exercise.sets[0], status: 'COMPLETED', actualReps: 10, weightKg: 40 }, exercise.sets[1]] }
      : exercise);
    await assertSucceeds(updateDoc(ref, { exercises: nextExercises, updatedAt: serverTimestamp() }));
  });

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

  it('keeps performedLocalDate immutable and keeps legacy documents compatible', async () => {
    const db = dbFor(UID);
    const current = doc(db, 'users', UID, 'workoutExecutions', 'performed-current');
    await setDoc(current, executionDoc({ performedLocalDate: '2026-08-24' }));
    await assertFails(updateDoc(current, { performedLocalDate: '2026-08-25', updatedAt: serverTimestamp() }));

    const legacy = doc(db, 'users', UID, 'workoutExecutions', 'performed-legacy');
    await setDoc(legacy, executionDoc());
    await assertSucceeds(updateDoc(legacy, { exercises: executionDoc().exercises, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(legacy, { performedLocalDate: '2026-08-25', updatedAt: serverTimestamp() }));
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

describe('users/{uid}/workoutExecutions — exercise identity fields are immutable to the client (exercise-substitution architecture audit, Fase 7)', () => {
  function substitutedExecutionDoc(overrides: Record<string, unknown> = {}) {
    return executionDoc({
      exercises: [
        {
          exerciseIndex: 0,
          exerciseId: 'machine_chest_press',
          prescribedExerciseId: 'bench_press',
          substitution: { scope: 'PERMANENT', appliedAt: Timestamp.now() },
          prescribedSets: 3,
          prescribedReps: '8-12',
          prescribedDuration: null,
          prescribedCycles: null,
          sets: oneSet(),
        },
      ],
      ...overrides,
    });
  }

  it('denies a client update changing exerciseId directly', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutExecutions', EXECUTION_ID), substitutedExecutionDoc());
    });
    const tampered = [{
      exerciseIndex: 0, exerciseId: 'attacker_chosen_exercise', prescribedExerciseId: 'bench_press',
      substitution: { scope: 'PERMANENT', appliedAt: Timestamp.now() },
      prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null, sets: oneSet(),
    }];
    await assertFails(updateDoc(ref, { exercises: tampered, updatedAt: serverTimestamp() }));
  });

  it('denies a client update changing prescribedExerciseId directly', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutExecutions', EXECUTION_ID), substitutedExecutionDoc());
    });
    const tampered = [{
      exerciseIndex: 0, exerciseId: 'machine_chest_press', prescribedExerciseId: 'attacker_chosen_anchor',
      substitution: { scope: 'PERMANENT', appliedAt: Timestamp.now() },
      prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null, sets: oneSet(),
    }];
    await assertFails(updateDoc(ref, { exercises: tampered, updatedAt: serverTimestamp() }));
  });

  it('denies changing every prescribed quantity/duration identity field', async () => {
    const db = dbFor(UID);
    for (const [field, value] of [
      ['prescribedSets', 99],
      ['prescribedReps', '1'],
      ['prescribedDuration', '999s'],
      ['prescribedCycles', 99],
    ] as const) {
      const ref = doc(db, 'users', UID, 'workoutExecutions', `identity-${field}`);
      await setDoc(ref, executionDoc());
      const tampered = [{
        ...executionDoc().exercises[0],
        [field]: value,
      }];
      await assertFails(updateDoc(ref, { exercises: tampered, updatedAt: serverTimestamp() }));
    }
  });

  it('denies a client update creating, changing, or removing the substitution marker', async () => {
    const db = dbFor(UID);

    // Create: a plain (non-substituted) doc where the client tries to sneak in `substitution` via an ordinary update.
    const plainRef = doc(db, 'users', UID, 'workoutExecutions', 'e-plain');
    await setDoc(plainRef, executionDoc());
    const forgedSubstitution = [{
      exerciseIndex: 0, exerciseId: 'bench_press', prescribedExerciseId: 'bench_press',
      substitution: { scope: 'PERMANENT', appliedAt: Timestamp.now() },
      prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null, sets: oneSet(),
    }];
    await assertFails(updateDoc(plainRef, { exercises: forgedSubstitution, updatedAt: serverTimestamp() }));

    // Change: an already-substituted doc where the client tries to change the scope.
    const subRef = doc(db, 'users', UID, 'workoutExecutions', 'e-sub');
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutExecutions', 'e-sub'), substitutedExecutionDoc());
    });
    const changedScope = [{
      exerciseIndex: 0, exerciseId: 'machine_chest_press', prescribedExerciseId: 'bench_press',
      substitution: { scope: 'SESSION', appliedAt: Timestamp.now() },
      prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null, sets: oneSet(),
    }];
    await assertFails(updateDoc(subRef, { exercises: changedScope, updatedAt: serverTimestamp() }));

    // Remove: the client tries to strip `substitution` back off (a fake "revert").
    const removed = [{
      exerciseIndex: 0, exerciseId: 'machine_chest_press', prescribedExerciseId: 'bench_press',
      prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null, sets: oneSet(),
    }];
    await assertFails(updateDoc(subRef, { exercises: removed, updatedAt: serverTimestamp() }));
  });

  it('allows a legitimate recordSetExecution-shaped update on a substituted exercise (identity fields unchanged, only sets change)', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutExecutions', EXECUTION_ID), substitutedExecutionDoc());
    });
    const loggedSet = await getDoc(ref).then((snap) => snap.data()!.exercises[0].substitution);
    const legitimateUpdate = [{
      exerciseIndex: 0, exerciseId: 'machine_chest_press', prescribedExerciseId: 'bench_press',
      substitution: loggedSet,
      prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null,
      sets: [{ setIndex: 0, status: 'COMPLETED', actualReps: 10, weightKg: 40, actualDurationSeconds: null }],
    }];
    await assertSucceeds(updateDoc(ref, { exercises: legitimateUpdate, updatedAt: serverTimestamp() }));
  });

  it('allows a legitimate skipExerciseExecution-shaped update on a substituted exercise', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutExecutions', EXECUTION_ID), substitutedExecutionDoc());
    });
    const loggedSubstitution = await getDoc(ref).then((snap) => snap.data()!.exercises[0].substitution);
    const skipUpdate = [{
      exerciseIndex: 0, exerciseId: 'machine_chest_press', prescribedExerciseId: 'bench_press',
      substitution: loggedSubstitution,
      prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null,
      sets: [{ setIndex: 0, status: 'SKIPPED', actualReps: null, weightKg: null, actualDurationSeconds: null }],
    }];
    await assertSucceeds(updateDoc(ref, { exercises: skipUpdate, updatedAt: serverTimestamp() }));
  });

  it('allows a legitimate finish (sweep-to-SKIPPED + terminal status) on a substituted exercise', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutExecutions', EXECUTION_ID), substitutedExecutionDoc());
    });
    const loggedSubstitution = await getDoc(ref).then((snap) => snap.data()!.exercises[0].substitution);
    const finishedExercises = [{
      exerciseIndex: 0, exerciseId: 'machine_chest_press', prescribedExerciseId: 'bench_press',
      substitution: loggedSubstitution,
      prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null,
      sets: [{ setIndex: 0, status: 'SKIPPED', actualReps: null, weightKg: null, actualDurationSeconds: null }],
    }];
    await assertSucceeds(updateDoc(ref, {
      exercises: finishedExercises, status: 'PARTIALLY_COMPLETED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });

  it('denies changing exercise identity through the terminal-update fast path', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    const tamperedExercises = [{
      exerciseIndex: 0, exerciseId: 'attacker_chosen_exercise', prescribedSets: 3,
      prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null,
      sets: [{ setIndex: 0, status: 'SKIPPED', actualReps: null, weightKg: null, actualDurationSeconds: null }],
    }];
    await assertFails(updateDoc(ref, {
      exercises: tamperedExercises,
      status: 'PARTIALLY_COMPLETED',
      finishedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  it('denies changing immutable execution metadata through the terminal-update fast path', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    await assertFails(updateDoc(ref, {
      templateId: 'T999',
      status: 'COMPLETED',
      finishedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  it('a legacy document with neither prescribedExerciseId nor substitution stays updatable by legitimate operations', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    // executionDoc()'s default exercise has neither field — exactly a legacy shape.
    await setDoc(ref, executionDoc());
    const legitimateUpdate = [{
      exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12',
      prescribedDuration: null, prescribedCycles: null,
      sets: [{ setIndex: 0, status: 'COMPLETED', actualReps: 10, weightKg: 40, actualDurationSeconds: null }],
    }];
    await assertSucceeds(updateDoc(ref, { exercises: legitimateUpdate, updatedAt: serverTimestamp() }));
  });

  it('Admin SDK (Cloud Function trust boundary, simulated via withSecurityRulesDisabled) can still apply a substitution — this Rule only restricts the CLIENT SDK', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const ref = doc(context.firestore(), 'users', UID, 'workoutExecutions', EXECUTION_ID);
      await setDoc(ref, executionDoc());
      const applied = [{
        exerciseIndex: 0, exerciseId: 'machine_chest_press', prescribedExerciseId: 'bench_press',
        substitution: { scope: 'PERMANENT', appliedAt: Timestamp.now() },
        prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null, sets: oneSet(),
      }];
      await updateDoc(ref, { exercises: applied, updatedAt: serverTimestamp() });
      const snap = await getDoc(ref);
      expect(snap.data()?.exercises[0].exerciseId).toBe('machine_chest_press');
    });
  });
});

describe('users/{uid}/exerciseSubstitutionPreferences — read-only to the owning client', () => {
  it('lets the owner read their own preference', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'exerciseSubstitutionPreferences', 'bench_press'), {
        prescribedExerciseId: 'bench_press', preferredExerciseId: 'machine_chest_press',
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    });
    await assertSucceeds(getDoc(doc(dbFor(UID), 'users', UID, 'exerciseSubstitutionPreferences', 'bench_press')));
  });

  it('denies cross-user read', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'exerciseSubstitutionPreferences', 'bench_press'), {
        prescribedExerciseId: 'bench_press', preferredExerciseId: 'machine_chest_press',
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    });
    await assertFails(getDoc(doc(dbFor(OTHER_UID), 'users', UID, 'exerciseSubstitutionPreferences', 'bench_press')));
  });

  it('denies the client from creating, updating, or deleting a preference directly — only the Cloud Function (Admin SDK) may', async () => {
    const db = dbFor(UID);
    await assertFails(setDoc(doc(db, 'users', UID, 'exerciseSubstitutionPreferences', 'bench_press'), {
      prescribedExerciseId: 'bench_press', preferredExerciseId: 'attacker_chosen_exercise',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'exerciseSubstitutionPreferences', 'bench_press'), {
        prescribedExerciseId: 'bench_press', preferredExerciseId: 'machine_chest_press',
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    });
    await assertFails(updateDoc(doc(db, 'users', UID, 'exerciseSubstitutionPreferences', 'bench_press'), {
      preferredExerciseId: 'attacker_chosen_exercise',
    }));
    await assertFails(deleteDoc(doc(db, 'users', UID, 'exerciseSubstitutionPreferences', 'bench_press')));
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

// Cardio Finisher Completion Recovery hardening (2026-09,
// docs/workout-lifecycle/): the durable `cardio` field on `workoutExecutions`
// — see `CardioExecutionRecord` (src/workoutExecution/types.ts) and
// `completeCardioExecution` (src/services/workoutExecutions.ts).
// Cardio Finisher Completion Recovery hardening, Architecture B (2026-09
// security audit): `cardio` is now written EXCLUSIVELY by the
// `completeWorkoutCardio` Cloud Function (Admin SDK, bypasses these Rules
// entirely) — the client can never write it directly, full stop. The
// exhaustive allow/deny matrix (every mutation shape, every transition,
// create vs update, the Admin-SDK bypass proof, and the one legitimate
// restart-after-abandon exception) lives in the dedicated regression suite:
// `firestore-tests/workoutExecutionCardioSecurityAudit.rules.test.ts`. This
// block keeps only the two cases specific to ordinary execution mutation
// (legacy docs, and a plain recordSet never touching cardio).
describe('users/{uid}/workoutExecutions — cardio completion record', () => {
  it('a legacy document with no `cardio` field at all stays updatable by legitimate operations (record/skip/finish)', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    // executionDoc() has no `cardio` key at all — exactly a pre-hardening/legacy shape.
    await setDoc(ref, executionDoc());
    const loggedExercises = [{
      exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12',
      prescribedDuration: null, prescribedCycles: null,
      sets: [{ setIndex: 0, status: 'COMPLETED', actualReps: 10, weightKg: 40, actualDurationSeconds: null }],
    }];
    await assertSucceeds(updateDoc(ref, { exercises: loggedExercises, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { status: 'COMPLETED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });

  it('accepts an explicit `cardio: null` on create (not-yet-completed, written up front by startOrResumeWorkoutExecution)', async () => {
    const db = dbFor(UID);
    await assertSucceeds(setDoc(
      doc(db, 'users', UID, 'workoutExecutions', 'e-cardio-null'),
      executionDoc({ cardio: null }),
    ));
  });

  it('a legitimate finish (status -> COMPLETED) leaves an already-persisted cardio record untouched and succeeds', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await setDoc(ref, executionDoc());
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc({
        cardio: { status: 'COMPLETED', actualDurationSeconds: 900, completedAt: Timestamp.now() },
      }));
    });
    const cardioBefore = await getDoc(ref).then((snap) => snap.data()!.cardio);
    await assertSucceeds(updateDoc(ref, {
      exercises: executionDoc().exercises,
      cardio: cardioBefore,
      status: 'PARTIALLY_COMPLETED',
      finishedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });
});

// Phase 10E (P3, docs/workout-lifecycle/v2/architecture/
// 26_FINAL_INDEPENDENT_ADVERSARIAL_AUDIT_2.md §51): `exercises.size()` was
// bounded but each exercise's own `sets` array was not — capped only by
// Firestore's 1MB document limit. Real prescriptions cap sets at 1-10 per
// exercise; 15 is the Rules-enforced safe margin. Write-size hygiene only —
// session-qualification already requires an exact set-count match, so this
// was never able to earn false progression credit.
describe('users/{uid}/workoutExecutions — exercise sets array bound (item 51)', () => {
  const setsOf = (n: number) => Array.from({ length: n }, (_, i) => (
    { setIndex: i, status: 'PENDING', actualReps: null, weightKg: null, actualDurationSeconds: null }
  ));

  it('allows a normal prescribed sets count', async () => {
    const db = dbFor(UID);
    await assertSucceeds(setDoc(doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc({
      exercises: [{
        exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12',
        prescribedDuration: null, prescribedCycles: null, sets: setsOf(3),
      }],
    })));
  });

  it('allows a reasonable upper-bound sets count', async () => {
    const db = dbFor(UID);
    await assertSucceeds(setDoc(doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc({
      exercises: [{
        exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 15, prescribedReps: '8-12',
        prescribedDuration: null, prescribedCycles: null, sets: setsOf(15),
      }],
    })));
  });

  it('denies an absurdly large sets array on a single exercise', async () => {
    const db = dbFor(UID);
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc({
      exercises: [{
        exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12',
        prescribedDuration: null, prescribedCycles: null, sets: setsOf(16),
      }],
    })));
  });

  it('denies an absurdly large sets array on a later exercise in a multi-exercise session', async () => {
    const db = dbFor(UID);
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc({
      exercises: [
        { exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null, sets: setsOf(3) },
        { exerciseIndex: 1, exerciseId: 'squat', prescribedSets: 3, prescribedReps: '8-12', prescribedDuration: null, prescribedCycles: null, sets: setsOf(500) },
      ],
    })));
  });
});

// P0 integrity fix (2026-09, docs/workout-lifecycle/): the persistent
// mutex/pointer at `users/{uid}/workoutExecutionState/current` — see
// `WorkoutExecutionStatePointer` (src/workoutExecution/types.ts) and the
// Rules comment on the `workoutExecutionState` match block. These tests
// prove the delete rule's `getAfter()` check directly at the Rules layer
// (independent of `src/services/workoutExecutions.ts`'s own service-level
// integration coverage), using a raw `writeBatch` exactly the way a
// transaction commits two documents together.
describe('users/{uid}/workoutExecutionState/current — mutex release tied to terminalization', () => {
  function pointerDoc(overrides: Record<string, unknown> = {}) {
    return {
      executionId: EXECUTION_ID,
      programId: PROGRAM_ID,
      programInstanceId: null,
      sessionIndex: 0,
      scheduledLocalDate: '2026-08-25',
      status: 'IN_PROGRESS',
      schemaVersion: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...overrides,
    };
  }

  async function seedInProgressWithPointer() {
    const db = dbFor(UID);
    const executionRef = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    const stateRef = doc(db, 'users', UID, 'workoutExecutionState', 'current');
    await setDoc(executionRef, executionDoc());
    await assertSucceeds(setDoc(stateRef, pointerDoc()));
    return { db, executionRef, stateRef };
  }

  it('create validates only the pointer\'s OWN shape — it does NOT cross-check the referenced execution at all (no getAfter on this side; see the Rules comment on workoutExecutionStateValid)', async () => {
    const db = dbFor(UID);
    const stateRef = doc(db, 'users', UID, 'workoutExecutionState', 'current');
    // No execution document exists at all for this pointer's executionId —
    // this still succeeds, because `workoutExecutionStateValid` never reads
    // `workoutExecutions`. This is the documented, deliberate asymmetry
    // (task validation item #3/#4): the CREATE side of the mutex has no
    // getAfter() cross-check (dropped — pairing it with `workoutExecutions`'
    // update rule exceeded the Rules Emulator's expression-evaluation cap);
    // only the DELETE side (below) uses getAfter(). Real-world protection
    // against a fabricated/mismatched pointer comes from the CLIENT always
    // writing both documents together in one transaction
    // (`startOrResumeWorkoutExecution`) plus legacy-orphan detection on the
    // next start — never from this Rule alone.
    await assertSucceeds(setDoc(stateRef, pointerDoc({ executionId: 'exec_does_not_exist' })));
  });

  it('terminalizing the execution (COMPLETED) and deleting current in the SAME batch succeeds', async () => {
    const { db, executionRef, stateRef } = await seedInProgressWithPointer();
    const batch = writeBatch(db);
    batch.update(executionRef, { status: 'COMPLETED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.delete(stateRef);
    await assertSucceeds(batch.commit());
  });

  it('terminalizing the execution (ABANDONED) and deleting current in the SAME batch succeeds', async () => {
    const { db, executionRef, stateRef } = await seedInProgressWithPointer();
    const batch = writeBatch(db);
    batch.update(executionRef, { status: 'ABANDONED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.delete(stateRef);
    await assertSucceeds(batch.commit());
  });

  it('deleting current WITHOUT terminalizing the execution it tracks is denied — the execution is still IN_PROGRESS after the batch (getAfter, not the prior state)', async () => {
    const { stateRef } = await seedInProgressWithPointer();
    // No write to the execution at all — `getAfter()` on it resolves to its
    // unchanged, still-IN_PROGRESS post-batch state.
    await assertFails(deleteDoc(stateRef));
  });

  it('deleting current while separately (same batch) updating the execution but NOT away from IN_PROGRESS is still denied', async () => {
    const { db, executionRef, stateRef } = await seedInProgressWithPointer();
    const batch = writeBatch(db);
    // A same-batch set mutation that keeps status IN_PROGRESS throughout —
    // exactly the recordSet/skipSet shape, never a terminal transition.
    batch.update(executionRef, { updatedAt: serverTimestamp() });
    batch.delete(stateRef);
    await assertFails(batch.commit());
  });
});

describe('retired metadata is read-only compatibility', () => {
  it('rejects new executions carrying a retired policy field', async () => {
    await assertFails(setDoc(doc(dbFor(UID), 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc({ substitutionPolicySnapshot: 'v3' })));
  });
  it('keeps old sessions editable while preventing policy metadata changes', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc({ substitutionPolicySnapshot: 'v3' }));
    });
    const ref = doc(dbFor(UID), 'users', UID, 'workoutExecutions', EXECUTION_ID);
    await assertSucceeds(updateDoc(ref, { updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { substitutionPolicySnapshot: 'legacy', updatedAt: serverTimestamp() }));
  });
  it('does not let a restart introduce retired metadata into a current execution', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc({ status: 'ABANDONED', finishedAt: Timestamp.now() }));
    });
    await assertFails(updateDoc(doc(dbFor(UID), 'users', UID, 'workoutExecutions', EXECUTION_ID), {
      status: 'IN_PROGRESS', startedAt: serverTimestamp(), finishedAt: null, updatedAt: serverTimestamp(), substitutionPolicySnapshot: 'v3',
    }));
  });
});
