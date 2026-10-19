/**
 * OPT-IN integration proof against the REAL Firestore Emulator — same
 * pattern as `completeWorkoutCardio.integration.test.ts`. Skipped by
 * default — only runs when `ISSUE_WORKOUT_ACTION_CAPABILITY_INTEGRATION=1`
 * is set (see `completeWorkoutCardio.integration.test.ts`'s own doc comment
 * for why: a separate named Admin app auto-connects via
 * `FIRESTORE_EMULATOR_HOST`, exercising the actual, unmodified handler).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { issueWorkoutActionCapabilityHandler } from '../workoutActionCapability';
import { verifyWorkoutActionCapability } from '../workoutActionCapability';

const enabled = process.env.ISSUE_WORKOUT_ACTION_CAPABILITY_INTEGRATION === '1';
const UID = 'capability-alice';
const OTHER_UID = 'capability-mallory';
const EXECUTION_ID = 'exec_capability_test_0_2026-08-25';
const SECRET = 'integration-test-secret';

function executionDoc(overrides: Record<string, unknown> = {}) {
  return {
    programId: 'wpg_capability_test',
    templateId: 'T003',
    sessionIndex: 0,
    sessionName: 'A',
    scheduledLocalDate: '2026-08-25',
    status: 'IN_PROGRESS',
    startedAt: Timestamp.now(),
    finishedAt: null,
    cardio: null,
    exercises: [{
      exerciseIndex: 0, exerciseId: 'bench_press', prescribedSets: 3, prescribedReps: '8-12',
      prescribedDuration: null, prescribedCycles: null,
      sets: [{ setIndex: 0, status: 'PENDING', actualReps: null, weightKg: null, actualDurationSeconds: null }],
    }],
    executionSchemaVersion: 1,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

function callableRequest(uid: string | null, data: unknown): CallableRequest {
  return (uid ? { auth: { uid }, data } : { data }) as never;
}

describe.skipIf(!enabled)('issueWorkoutActionCapability — real Firestore Emulator integration', () => {
  let app: App;
  let db: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'issue-workout-action-capability-integration');
    db = getFirestore(app);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  beforeEach(async () => {
    await db.recursiveDelete(db.collection('users').doc(UID)).catch(() => {});
    await db.recursiveDelete(db.collection('users').doc(OTHER_UID)).catch(() => {});
    await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID).set(executionDoc());
  });

  // A. Capability only issued for the authenticated owner.
  it('1) issues a capability scoped to the authenticated uid and the requested executionId', async () => {
    const result = await issueWorkoutActionCapabilityHandler(
      callableRequest(UID, { executionId: EXECUTION_ID }),
      { firestore: db, secret: SECRET, endpointUrl: 'https://example.test/externalWorkoutAction' },
    );
    expect(result.executionId).toBe(EXECUTION_ID);
    expect(result.endpointUrl).toBe('https://example.test/externalWorkoutAction');
    expect(result.expiresAtMs).toBeGreaterThan(Date.now());

    const verification = verifyWorkoutActionCapability(result.token, SECRET);
    expect(verification.valid).toBe(true);
    if (verification.valid) {
      expect(verification.claims.uid).toBe(UID);
      expect(verification.claims.executionId).toBe(EXECUTION_ID);
      expect(verification.claims.purpose).toBe('workout_action');
    }
  });

  it('2) unauthenticated request: DENIED (unauthenticated)', async () => {
    await expect(issueWorkoutActionCapabilityHandler(
      callableRequest(null, { executionId: EXECUTION_ID }), { firestore: db, secret: SECRET },
    )).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  // B. Execution belonging to another uid rejected.
  it('3) execution belongs to a DIFFERENT uid: DENIED as not-found — never discloses that it exists for someone else', async () => {
    await expect(issueWorkoutActionCapabilityHandler(
      callableRequest(OTHER_UID, { executionId: EXECUTION_ID }), { firestore: db, secret: SECRET },
    )).rejects.toMatchObject({ code: 'not-found' });
  });

  it('4) execution does not exist: DENIED as not-found', async () => {
    await expect(issueWorkoutActionCapabilityHandler(
      callableRequest(UID, { executionId: 'exec_does_not_exist' }), { firestore: db, secret: SECRET },
    )).rejects.toMatchObject({ code: 'not-found' });
  });

  // C. Execution not IN_PROGRESS rejected at issuance.
  it('5) execution is ABANDONED: DENIED (execution_not_in_progress)', async () => {
    await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID)
      .update({ status: 'ABANDONED', finishedAt: Timestamp.now() });
    await expect(issueWorkoutActionCapabilityHandler(
      callableRequest(UID, { executionId: EXECUTION_ID }), { firestore: db, secret: SECRET },
    )).rejects.toMatchObject({ code: 'failed-precondition', message: 'execution_not_in_progress' });
  });

  it('6) execution is COMPLETED: DENIED (execution_not_in_progress)', async () => {
    await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID)
      .update({ status: 'COMPLETED', finishedAt: Timestamp.now() });
    await expect(issueWorkoutActionCapabilityHandler(
      callableRequest(UID, { executionId: EXECUTION_ID }), { firestore: db, secret: SECRET },
    )).rejects.toMatchObject({ code: 'failed-precondition', message: 'execution_not_in_progress' });
  });

  it('7) malformed executionId is rejected before any Firestore read (invalid-argument)', async () => {
    await expect(issueWorkoutActionCapabilityHandler(
      callableRequest(UID, { executionId: 'not a valid id !!' }), { firestore: db, secret: SECRET },
    )).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(issueWorkoutActionCapabilityHandler(
      callableRequest(UID, {}), { firestore: db, secret: SECRET },
    )).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('8) unexpected extra fields (e.g. an attempted uid override) are rejected', async () => {
    await expect(issueWorkoutActionCapabilityHandler(
      callableRequest(UID, { executionId: EXECUTION_ID, uid: OTHER_UID }), { firestore: db, secret: SECRET },
    )).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('errors are real HttpsError instances', async () => {
    try {
      await issueWorkoutActionCapabilityHandler(
        callableRequest(UID, { executionId: 'exec_does_not_exist' }), { firestore: db, secret: SECRET },
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HttpsError);
    }
  });
});
