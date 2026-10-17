/**
 * P0-C hardening plan (2026-09, docs/workout-lifecycle/) — Rules coverage
 * for the STRICT-mode behavior of the `workoutExecutions` <-> `workoutExecutionState/current`
 * mutex, gated behind `workoutExecutionProtocolConfig/active.requireMutexOnCreate`
 * (`workoutExecutionMutexHardeningEnabled()` in firestore.rules).
 *
 * Kept in its own file, separate from `workoutExecutions.rules.test.ts`,
 * because every test here explicitly turns the flag on first — the default
 * (flag absent) "compatible mode" behavior is that file's job to prove
 * stays unchanged.
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
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'alice';
const PROGRAM_ID = 'wpg_12345678';
const EXECUTION_ID = 'exec_wpg_12345678_0_2026-08-25';
let testEnv: RulesTestEnvironment;

function dbFor(uid: string) {
  return testEnv.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();
}

function userDocument(uid: string) {
  return {
    profile: { name: uid, email: `${uid}@example.com` },
    preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
    subscription: {},
    metadata: { role: 'user', createdAt: new Date(), updatedAt: new Date() },
  };
}

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
    exercises: [{
      exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12',
      prescribedDuration: null, prescribedCycles: null,
      sets: [{ setIndex: 0, status: 'PENDING', actualReps: null, weightKg: null, actualDurationSeconds: null }],
    }],
    executionSchemaVersion: 1,
    mutexProtocolVersion: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

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
    // Hardening OFF by default — each test that needs it turns it on explicitly.
  });
});

async function enableHardening() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'workoutExecutionProtocolConfig', 'active'), {
      schemaVersion: 1, requireMutexOnCreate: true, enabledAt: new Date(),
    });
  });
}

describe('workoutExecutionProtocolConfig — hardening flag itself', () => {
  it('is readable by any signed-in user, never client-writable', async () => {
    await enableHardening();
    const db = dbFor(UID);
    await assertSucceeds(getDoc(doc(db, 'workoutExecutionProtocolConfig', 'active')));
    await assertFails(setDoc(doc(db, 'workoutExecutionProtocolConfig', 'active'), { requireMutexOnCreate: false }));
  });
});

describe('strict mode (hardening ON) — workoutExecutions create requires a paired current', () => {
  it('create execution + current in the SAME batch, both matching, succeeds', async () => {
    await enableHardening();
    const db = dbFor(UID);
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc());
    batch.set(doc(db, 'users', UID, 'workoutExecutionState', 'current'), pointerDoc());
    await assertSucceeds(batch.commit());
  });

  it('create execution IN_PROGRESS WITHOUT current is denied once hardening is on', async () => {
    await enableHardening();
    const db = dbFor(UID);
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc()));
  });

  it('create execution declaring no mutexProtocolVersion (the pre-P0-C shape) is denied once hardening is on, even paired with current', async () => {
    await enableHardening();
    const db = dbFor(UID);
    const { mutexProtocolVersion: _drop, ...legacyShape } = executionDoc();
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID), legacyShape);
    batch.set(doc(db, 'users', UID, 'workoutExecutionState', 'current'), pointerDoc());
    await assertFails(batch.commit());
  });

  it('the exact same "execution without current" write that is denied in strict mode is ALLOWED when hardening is off (compatible mode, the default)', async () => {
    // No enableHardening() call — proves the flag is what changed the outcome, not something else.
    const db = dbFor(UID);
    await assertSucceeds(setDoc(doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc()));
  });
});

describe('strict mode (hardening ON) — workoutExecutionState/current create cross-checks the referenced execution', () => {
  it('create current pointing at an execution that does not exist is denied', async () => {
    await enableHardening();
    const db = dbFor(UID);
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutionState', 'current'), pointerDoc()));
  });

  it('create current pointing at an execution that is already COMPLETED is denied', async () => {
    await enableHardening();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'users', UID, 'workoutExecutions', EXECUTION_ID),
        executionDoc({ status: 'COMPLETED', finishedAt: new Date() }),
      );
    });
    const db = dbFor(UID);
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutionState', 'current'), pointerDoc()));
  });

  it('current pointing at an execution with a mismatched programInstanceId is denied', async () => {
    await enableHardening();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'users', UID, 'workoutExecutions', EXECUTION_ID),
        executionDoc(), // no programInstanceId (V1 shape)
      );
    });
    const db = dbFor(UID);
    await assertFails(setDoc(
      doc(db, 'users', UID, 'workoutExecutionState', 'current'),
      pointerDoc({ programInstanceId: 'wpi_bogus' }),
    ));
  });

  it('current pointing at an execution with a mismatched sessionIndex/scheduledLocalDate is denied', async () => {
    await enableHardening();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutExecutions', EXECUTION_ID), executionDoc());
    });
    const db = dbFor(UID);
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutExecutionState', 'current'), pointerDoc({ sessionIndex: 1 })));
  });

  it('in compatible mode (hardening off, the default) a pointer to a nonexistent execution is still allowed — the documented pre-hardening gap', async () => {
    const db = dbFor(UID);
    await assertSucceeds(setDoc(doc(db, 'users', UID, 'workoutExecutionState', 'current'), pointerDoc({ executionId: 'exec_does_not_exist' })));
  });
});

describe('strict mode (hardening ON) — terminalization and restart still behave correctly', () => {
  it('terminalizing (COMPLETED) + deleting current in the same batch still succeeds under hardening', async () => {
    await enableHardening();
    const db = dbFor(UID);
    const executionRef = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    const stateRef = doc(db, 'users', UID, 'workoutExecutionState', 'current');
    const seed = writeBatch(db);
    seed.set(executionRef, executionDoc());
    seed.set(stateRef, pointerDoc());
    await assertSucceeds(seed.commit());
    const batch = writeBatch(db);
    batch.update(executionRef, { status: 'COMPLETED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.delete(stateRef);
    await assertSucceeds(batch.commit());
  });

  it('deleting current without terminalizing is still denied under hardening', async () => {
    await enableHardening();
    const db = dbFor(UID);
    const executionRef = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    const stateRef = doc(db, 'users', UID, 'workoutExecutionState', 'current');
    const seed = writeBatch(db);
    seed.set(executionRef, executionDoc());
    seed.set(stateRef, pointerDoc());
    await assertSucceeds(seed.commit());
    await assertFails(deleteDoc(stateRef));
  });

  // Key open question from the hardening design (docs §6/§7's own Rules
  // comment): does pairing the execution UPDATE rule (restart-after-abandon,
  // already expensive) with current's CREATE rule's now-active
  // getAfter() cross-check reproduce the Rules Emulator's "maximum
  // expressions" failure this P0's earlier debugging hit? Empirically: no —
  // this passes. (Only the EXECUTION create rule's own getAfter — the
  // `workoutExecutions` match block — is gated to skip when hardening is
  // off; `workoutExecutionStatePointsAtRealExecution` on the CURRENT side
  // is a separate, comparatively cheap function with no grant-consumption
  // checks, so this specific pairing stays under budget.)
  it('restart-after-abandon (execution UPDATE + current CREATE, paired) still succeeds under hardening', async () => {
    await enableHardening();
    const db = dbFor(UID);
    const executionRef = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    const stateRef = doc(db, 'users', UID, 'workoutExecutionState', 'current');
    const seed = writeBatch(db);
    seed.set(executionRef, executionDoc());
    seed.set(stateRef, pointerDoc());
    await assertSucceeds(seed.commit());
    // Abandon: terminalize execution + delete current together (already proven above).
    const abandon = writeBatch(db);
    abandon.update(executionRef, { status: 'ABANDONED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    abandon.delete(stateRef);
    await assertSucceeds(abandon.commit());
    // Restart: execution UPDATE (ABANDONED -> IN_PROGRESS) + current CREATE, paired.
    const batch = writeBatch(db);
    batch.update(executionRef, {
      status: 'IN_PROGRESS', finishedAt: null, startedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    batch.set(stateRef, pointerDoc());
    await assertSucceeds(batch.commit());
  });
});

describe('strict mode (hardening ON) — progress updates on the legitimate current execution are never blocked', () => {
  it('recording a set on the current execution succeeds under hardening (progress updates never touch the create rule)', async () => {
    await enableHardening();
    const db = dbFor(UID);
    const executionRef = doc(db, 'users', UID, 'workoutExecutions', EXECUTION_ID);
    const stateRef = doc(db, 'users', UID, 'workoutExecutionState', 'current');
    const batch = writeBatch(db);
    batch.set(executionRef, executionDoc());
    batch.set(stateRef, pointerDoc());
    await batch.commit();

    await assertSucceeds(updateDoc(executionRef, {
      exercises: [{
        exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12',
        prescribedDuration: null, prescribedCycles: null,
        sets: [{ setIndex: 0, status: 'COMPLETED', actualReps: 10, weightKg: 40, actualDurationSeconds: null }],
      }],
      updatedAt: serverTimestamp(),
    }));
  });

  // Today's domain rule (unchanged by this hardening pass, section 14):
  // an UPDATE to an IN_PROGRESS execution is validated purely on that
  // document's own shape/ownership — it is NEVER cross-checked against
  // `current` at all, hardening on or off. In the new protocol this legacy
  // orphan case shouldn't arise (the mutex prevents a second simultaneous
  // IN_PROGRESS), but if one exists (pre-P0 data, or a hardening gap), its
  // own progress fields remain editable — restricting that further is out
  // of scope for this pass (see final report §18).
  it('a progress update on an IN_PROGRESS execution that is NOT the one current tracks is still allowed today, hardening on or off — documented gap, not a regression', async () => {
    await enableHardening();
    const db = dbFor(UID);
    const otherExecutionId = 'exec_wpg_12345678_1_2026-08-25';
    const otherRef = doc(db, 'users', UID, 'workoutExecutions', otherExecutionId);
    // Seeded directly (simulating a legacy orphan, or a hardening-era write
    // that never got a `current`) — not tracked by any pointer.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutExecutions', otherExecutionId), executionDoc({ sessionIndex: 1 }));
    });
    await assertSucceeds(updateDoc(otherRef, { updatedAt: serverTimestamp() }));
  });
});

// Nutrition's independent switch must not broaden workout configuration access.
describe('workoutExecutionProtocolConfig configuration scope', () => {
  it('denies non-active documents and anonymous access, even when documents exist', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      for (const id of ['active', 'onboardingAutomatic', 'unknown']) {
        await setDoc(doc(context.firestore(), 'workoutExecutionProtocolConfig', id), { schemaVersion: 1 });
      }
    });
    await assertSucceeds(getDoc(doc(dbFor(UID), 'workoutExecutionProtocolConfig', 'active')));
    for (const id of ['onboardingAutomatic', 'unknown']) {
      await assertFails(getDoc(doc(dbFor(UID), 'workoutExecutionProtocolConfig', id)));
      await assertFails(setDoc(doc(dbFor(UID), 'workoutExecutionProtocolConfig', id), { schemaVersion: 1 }));
    }
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'workoutExecutionProtocolConfig', 'active')));
  });
});
