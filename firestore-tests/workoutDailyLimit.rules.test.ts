import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

vi.mock('../src/lib/firebase', () => ({ db: {} }));

/**
 * One credited workout per day — Rules layer.
 *
 * The claim this file pins: the marker is SERVER-OWNED. A client that could
 * write or delete it would be able to grant or revoke its own daily limit.
 * Reading it is allowed, because that is what lets the app show the friendly
 * "treino de hoje concluído" state and refuse to start a second session.
 *
 * Execution creation is deliberately NOT gated here — see the second block.
 */

let env: RulesTestEnvironment;
const TODAY = '2026-10-19';
const marker = (uid: string, localDate = TODAY) => `users/${uid}/workoutDailyCompletions/${localDate}`;
const db = (uid: string) => env.authenticatedContext(uid).firestore();

const execution = (overrides: Record<string, unknown> = {}) => ({
  programId: 'prog1',
  templateId: 'T001',
  sessionIndex: 0,
  sessionName: 'A',
  scheduledLocalDate: TODAY,
  performedLocalDate: TODAY,
  status: 'IN_PROGRESS',
  exercises: [{ exerciseIndex: 0, exerciseId: 'squat', sets: [{ setIndex: 0, status: 'PENDING' }] }],
  executionSchemaVersion: 1,
  cardio: null,
  startedAt: serverTimestamp(),
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  finishedAt: null,
  ...overrides,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'ajfit-rules-test',
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const f = context.firestore();
    for (const uid of ['alice', 'mallory']) await setDoc(doc(f, `users/${uid}`), { accountStatus: 'active' });
    await setDoc(doc(f, 'users/alice/workoutPrograms/prog1'), {
      programId: 'prog1', status: 'active',
      sessions: [{ name: 'A', exercises: [{ exerciseId: 'squat', sets: 1 }] }],
    });
  });
});

describe('the daily marker is server-owned', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), marker('alice')), {
        localDate: TODAY, executionId: 'exec_a', programInstanceId: 'inst1',
        sessionIndex: 0, completedAt: Timestamp.now(),
      });
    });
  });

  it('lets the owner read it — that is what powers the friendly "volte amanhã" state', async () => {
    await assertSucceeds(getDoc(doc(db('alice'), marker('alice'))));
  });

  it('never lets anyone else read it', async () => {
    await assertFails(getDoc(doc(db('mallory'), marker('alice'))));
  });

  it('refuses every client write — granting or revoking the limit is impossible', async () => {
    await assertFails(setDoc(doc(db('alice'), marker('alice', '2026-10-20')), {
      localDate: '2026-10-20', executionId: 'forged', programInstanceId: 'inst1',
      sessionIndex: 0, completedAt: serverTimestamp(),
    }));
    // Deleting it would re-open the day for a second workout.
    await assertFails(deleteDoc(doc(db('alice'), marker('alice'))));
    await assertFails(setDoc(doc(db('mallory'), marker('alice')), { localDate: TODAY }));
  });

  it('survives a rejected delete attempt', async () => {
    await assertFails(deleteDoc(doc(db('alice'), marker('alice'))));
    let stored: unknown;
    await env.withSecurityRulesDisabled(async (context) => {
      stored = (await getDoc(doc(context.firestore(), marker('alice')))).get('executionId');
    });
    expect(stored).toBe('exec_a');
  });
});

describe('Rules do NOT gate execution creation — documented on purpose', () => {
  /**
   * An `exists()` on the marker inside the execution-create clause exceeded
   * Firestore's 1000-expression ceiling (that clause already performs two
   * program lookups). The limit therefore lives where it is authoritative:
   * `finalizeWorkoutSession`'s transaction, which can never CREDIT a second
   * workout — see `freeSessionSelection.integration.test.ts`. The client also
   * refuses locally via `hasWorkoutDailyCompletion`, so an honest app never
   * starts a doomed session.
   */
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), marker('alice')), {
        localDate: TODAY, executionId: 'exec_a', programInstanceId: 'inst1',
        sessionIndex: 0, completedAt: Timestamp.now(),
      });
    });
  });

  it('allows creating an execution even on a claimed day, by design', async () => {
    await assertSucceeds(setDoc(doc(db('alice'), 'users/alice/workoutExecutions/exec_2'), execution()));
  });

  it('still refuses another account from creating an execution for alice', async () => {
    await assertFails(setDoc(doc(db('mallory'), 'users/alice/workoutExecutions/exec_3'), execution()));
  });

  it('keeps every pre-existing execution-shape guarantee intact', async () => {
    // A client-born execution may never arrive already terminal or with cardio.
    await assertFails(setDoc(doc(db('alice'), 'users/alice/workoutExecutions/exec_4'),
      execution({ status: 'COMPLETED' })));
    await assertFails(setDoc(doc(db('alice'), 'users/alice/workoutExecutions/exec_5'),
      execution({ cardio: { status: 'COMPLETED', actualDurationSeconds: 600 } })));
    await assertFails(setDoc(doc(db('alice'), 'users/alice/workoutExecutions/exec_6'),
      execution({ createdAt: Timestamp.fromMillis(0) })));
  });
});
