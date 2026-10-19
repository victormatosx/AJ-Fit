/**
 * OPT-IN integration proof against the REAL Firestore Emulator — same
 * pattern as `completeWorkoutCardio.integration.test.ts`. Skipped by
 * default — only runs when `EXTERNAL_WORKOUT_ACTION_INTEGRATION=1` is set.
 *
 * Exercises the actual, unmodified `externalWorkoutActionHandler`, with
 * lightweight Express-shaped `req`/`res` doubles (method/headers/body in,
 * status/json out) — never a reimplementation of the handler's own logic.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';

import { externalWorkoutActionHandler } from '../externalWorkoutAction';
import { signWorkoutActionCapability } from '../workoutActionCapability';

const enabled = process.env.EXTERNAL_WORKOUT_ACTION_INTEGRATION === '1';
const UID = 'extaction-alice';
const SECRET = 'integration-test-secret';
const EXECUTION_ID = 'exec_extaction_test_0_2026-08-25';
const OTHER_EXECUTION_ID = 'exec_extaction_other_0_2026-08-25';

function executionDoc(overrides: Record<string, unknown> = {}) {
  return {
    programId: 'wpg_extaction_test',
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
      sets: [
        { setIndex: 0, status: 'PENDING', actualReps: null, weightKg: null, actualDurationSeconds: null },
        { setIndex: 1, status: 'SKIPPED', actualReps: null, weightKg: null, actualDurationSeconds: null },
      ],
    }],
    executionSchemaVersion: 1,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

function capability(executionId: string, overrides: Partial<{ uid: string; exp: number }> = {}) {
  const iat = Date.now();
  return signWorkoutActionCapability({
    uid: overrides.uid ?? UID,
    executionId,
    iat,
    exp: overrides.exp ?? iat + 60_000,
  }, SECRET);
}

function mockRequest(body: unknown): Request {
  return { method: 'POST', headers: {}, body } as unknown as Request;
}

function mockResponse(): Response & { statusCode: number; jsonBody: unknown } {
  const res = {
    statusCode: 200,
    jsonBody: undefined as unknown,
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.jsonBody = body; return res; },
  };
  return res as unknown as Response & { statusCode: number; jsonBody: unknown };
}

async function call(db: Firestore, body: unknown) {
  const req = mockRequest(body);
  const res = mockResponse();
  await externalWorkoutActionHandler(req, res, { firestore: db, secret: SECRET });
  return res;
}

describe.skipIf(!enabled)('externalWorkoutAction (complete_set) — real Firestore Emulator integration', () => {
  let app: App;
  let db: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'external-workout-action-integration');
    db = getFirestore(app);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  beforeEach(async () => {
    await db.recursiveDelete(db.collection('users').doc(UID)).catch(() => {});
    await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID).set(executionDoc());
    await db.collection('users').doc(UID).collection('workoutExecutions').doc(OTHER_EXECUTION_ID).set(executionDoc());
  });

  // D. Valid capability completes a PENDING set.
  it('1) completes a PENDING set and persists weightKg/actualReps', async () => {
    const token = capability(EXECUTION_ID);
    const res = await call(db, {
      action: 'complete_set', token, executionId: EXECUTION_ID,
      exerciseIndex: 0, setIndex: 0, weightKg: 42.5, actualReps: 11,
    });
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({
      status: 'completed_now', executionId: EXECUTION_ID, exerciseIndex: 0, setIndex: 0, weightKg: 42.5, actualReps: 11,
    });

    const snapshot = await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID).get();
    const set = snapshot.data()!.exercises[0].sets[0];
    expect(set).toMatchObject({ status: 'COMPLETED', weightKg: 42.5, actualReps: 11 });
  });

  // E. Duplicate request returns already_completed.
  it('2) a duplicate request (retry) returns already_completed with the SAME original values', async () => {
    const token = capability(EXECUTION_ID);
    const first = await call(db, {
      action: 'complete_set', token, executionId: EXECUTION_ID,
      exerciseIndex: 0, setIndex: 0, weightKg: 42.5, actualReps: 11,
    });
    expect(first.jsonBody).toMatchObject({ status: 'completed_now' });

    const retry = await call(db, {
      action: 'complete_set', token, executionId: EXECUTION_ID,
      exerciseIndex: 0, setIndex: 0, weightKg: 42.5, actualReps: 11,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.jsonBody).toEqual({
      status: 'already_completed', executionId: EXECUTION_ID, exerciseIndex: 0, setIndex: 0, weightKg: 42.5, actualReps: 11,
    });
  });

  // F. A second request with DIFFERENT values never overwrites the first.
  it('3) a second request with different weightKg/actualReps does not overwrite the first', async () => {
    const token = capability(EXECUTION_ID);
    await call(db, {
      action: 'complete_set', token, executionId: EXECUTION_ID,
      exerciseIndex: 0, setIndex: 0, weightKg: 40, actualReps: 10,
    });
    const second = await call(db, {
      action: 'complete_set', token, executionId: EXECUTION_ID,
      exerciseIndex: 0, setIndex: 0, weightKg: 999, actualReps: 99,
    });
    expect(second.jsonBody).toEqual({
      status: 'already_completed', executionId: EXECUTION_ID, exerciseIndex: 0, setIndex: 0, weightKg: 40, actualReps: 10,
    });
    const snapshot = await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID).get();
    expect(snapshot.data()!.exercises[0].sets[0]).toMatchObject({ weightKg: 40, actualReps: 10 });
  });

  // G. Two genuinely concurrent completions — only one first writer.
  it('4) two concurrent requests for the same set: exactly one completed_now, the other already_completed with the SAME values', async () => {
    const token = capability(EXECUTION_ID);
    const [a, b] = await Promise.all([
      call(db, { action: 'complete_set', token, executionId: EXECUTION_ID, exerciseIndex: 0, setIndex: 0, weightKg: 40, actualReps: 10 }),
      call(db, { action: 'complete_set', token, executionId: EXECUTION_ID, exerciseIndex: 0, setIndex: 0, weightKg: 45, actualReps: 12 }),
    ]);
    const results = [a.jsonBody, b.jsonBody] as Array<{ status: string; weightKg: number; actualReps: number }>;
    const completedNow = results.filter((r) => r.status === 'completed_now');
    const alreadyCompleted = results.filter((r) => r.status === 'already_completed');
    expect(completedNow).toHaveLength(1);
    expect(alreadyCompleted).toHaveLength(1);
    // The loser observes exactly the winner's values — never a blend, never its own.
    expect(alreadyCompleted[0].weightKg).toBe(completedNow[0].weightKg);
    expect(alreadyCompleted[0].actualReps).toBe(completedNow[0].actualReps);

    const snapshot = await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID).get();
    const persisted = snapshot.data()!.exercises[0].sets[0];
    expect(persisted.weightKg).toBe(completedNow[0].weightKg);
    expect(persisted.actualReps).toBe(completedNow[0].actualReps);
  });

  // H. Capability for execution A never acts on execution B.
  it('5) a capability for EXECUTION_ID cannot be used against OTHER_EXECUTION_ID, even by editing the request body', async () => {
    const token = capability(EXECUTION_ID);
    const res = await call(db, {
      action: 'complete_set', token, executionId: OTHER_EXECUTION_ID,
      exerciseIndex: 0, setIndex: 0, weightKg: 40, actualReps: 10,
    });
    expect(res.statusCode).toBe(403);
    const otherSnapshot = await db.collection('users').doc(UID).collection('workoutExecutions').doc(OTHER_EXECUTION_ID).get();
    expect(otherSnapshot.data()!.exercises[0].sets[0].status).toBe('PENDING');
  });

  // I. Expired capability rejected.
  it('6) an expired capability is rejected (401)', async () => {
    const token = capability(EXECUTION_ID, { exp: Date.now() - 1_000 });
    const res = await call(db, {
      action: 'complete_set', token, executionId: EXECUTION_ID, exerciseIndex: 0, setIndex: 0, weightKg: 40, actualReps: 10,
    });
    expect(res.statusCode).toBe(401);
  });

  // J. Invalid signature rejected.
  it('7) a capability signed with the wrong secret is rejected (401)', async () => {
    const iat = Date.now();
    const forged = signWorkoutActionCapability({ uid: UID, executionId: EXECUTION_ID, iat, exp: iat + 60_000 }, 'wrong-secret');
    const res = await call(db, {
      action: 'complete_set', token: forged, executionId: EXECUTION_ID, exerciseIndex: 0, setIndex: 0, weightKg: 40, actualReps: 10,
    });
    expect(res.statusCode).toBe(401);
  });

  // K. Invalid exerciseIndex rejected.
  it('8) an out-of-range exerciseIndex is rejected (400) without touching any set', async () => {
    const token = capability(EXECUTION_ID);
    const res = await call(db, {
      action: 'complete_set', token, executionId: EXECUTION_ID, exerciseIndex: 7, setIndex: 0, weightKg: 40, actualReps: 10,
    });
    expect(res.statusCode).toBe(400);
  });

  // L. Invalid setIndex rejected.
  it('9) an out-of-range setIndex is rejected (400)', async () => {
    const token = capability(EXECUTION_ID);
    const res = await call(db, {
      action: 'complete_set', token, executionId: EXECUTION_ID, exerciseIndex: 0, setIndex: 9, weightKg: 40, actualReps: 10,
    });
    expect(res.statusCode).toBe(400);
  });

  // M. A SKIPPED target set rejected.
  it('10) a SKIPPED target set is rejected (409) and left untouched', async () => {
    const token = capability(EXECUTION_ID);
    const res = await call(db, {
      action: 'complete_set', token, executionId: EXECUTION_ID, exerciseIndex: 0, setIndex: 1, weightKg: 40, actualReps: 10,
    });
    expect(res.statusCode).toBe(409);
    const snapshot = await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID).get();
    expect(snapshot.data()!.exercises[0].sets[1].status).toBe('SKIPPED');
  });

  // N. Execution finished between capability issuance and the request.
  it('11) an execution that finished AFTER the capability was issued is rejected (409), never completes', async () => {
    const token = capability(EXECUTION_ID);
    await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID)
      .update({ status: 'ABANDONED', finishedAt: Timestamp.now() });
    const res = await call(db, {
      action: 'complete_set', token, executionId: EXECUTION_ID, exerciseIndex: 0, setIndex: 0, weightKg: 40, actualReps: 10,
    });
    expect(res.statusCode).toBe(409);
    const snapshot = await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID).get();
    expect(snapshot.data()!.exercises[0].sets[0].status).toBe('PENDING');
  });

  // O. Invalid payloads rejected.
  it('12) malformed/invalid payloads are all rejected with 400, before any Firestore access', async () => {
    const token = capability(EXECUTION_ID);
    const base = { action: 'complete_set' as const, token, executionId: EXECUTION_ID, exerciseIndex: 0, setIndex: 0 };
    const invalidPayloads = [
      { ...base, weightKg: -1, actualReps: 10 },
      { ...base, weightKg: Number.NaN, actualReps: 10 },
      { ...base, weightKg: 40, actualReps: 0 },
      { ...base, weightKg: 40, actualReps: -5 },
      { ...base, weightKg: 40, actualReps: 1.5 },
      { ...base, weightKg: '40', actualReps: 10 },
      { action: 'adjust_weight', token, executionId: EXECUTION_ID, exerciseIndex: 0, setIndex: 0, weightKg: 40, actualReps: 10 },
      { ...base, weightKg: 40, actualReps: 10, extraField: 'nope' },
      {},
    ];
    for (const payload of invalidPayloads) {
      const res = await call(db, payload);
      expect(res.statusCode).toBe(400);
    }
    const snapshot = await db.collection('users').doc(UID).collection('workoutExecutions').doc(EXECUTION_ID).get();
    expect(snapshot.data()!.exercises[0].sets[0].status).toBe('PENDING');
  });

  it('13) a non-POST method is rejected (405)', async () => {
    const req = { method: 'GET', headers: {}, body: {} } as unknown as Request;
    const res = mockResponse();
    await externalWorkoutActionHandler(req, res, { firestore: db, secret: SECRET });
    expect(res.statusCode).toBe(405);
  });

  it('14) an execution that does not exist is rejected (404)', async () => {
    const token = signWorkoutActionCapability(
      { uid: UID, executionId: 'exec_does_not_exist', iat: Date.now(), exp: Date.now() + 60_000 }, SECRET,
    );
    const res = await call(db, {
      action: 'complete_set', token, executionId: 'exec_does_not_exist', exerciseIndex: 0, setIndex: 0, weightKg: 40, actualReps: 10,
    });
    expect(res.statusCode).toBe(404);
  });

  it('15) bodyweight (weightKg: 0) and no reps informed (actualReps: null) are both valid', async () => {
    const token = capability(EXECUTION_ID);
    const res = await call(db, {
      action: 'complete_set', token, executionId: EXECUTION_ID, exerciseIndex: 0, setIndex: 0, weightKg: 0, actualReps: null,
    });
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toMatchObject({ status: 'completed_now', weightKg: 0, actualReps: null });
  });
});
