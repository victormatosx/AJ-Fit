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
const OTHER_UID = 'mallory';
const PROGRAM_ID = 'wpg_12345678';
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

function scheduleConfigDoc(overrides: Record<string, unknown> = {}) {
  return {
    trainingDays: ['MON', 'WED', 'FRI'],
    timezone: 'America/Sao_Paulo',
    scheduleVersion: 1,
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function scheduleStateDoc(overrides: Record<string, unknown> = {}) {
  return {
    programId: PROGRAM_ID,
    nextSessionIndex: 0,
    cursorDate: '2026-08-03',
    lastCompletedAt: null,
    pendingMissDecision: null,
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function completedEventDoc(overrides: Record<string, unknown> = {}) {
  return {
    type: 'COMPLETED',
    sessionIndex: 0,
    scheduledDate: '2026-08-03',
    occurredAt: serverTimestamp(),
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
  });
});

describe('workoutProgramState/scheduleConfig', () => {
  it('lets the owner create and update their own weekday preference', async () => {
    const db = dbFor(UID);
    await assertSucceeds(setDoc(doc(db, 'users', UID, 'workoutProgramState', 'scheduleConfig'), scheduleConfigDoc()));
    await assertSucceeds(getDoc(doc(db, 'users', UID, 'workoutProgramState', 'scheduleConfig')));
    await assertSucceeds(setDoc(doc(db, 'users', UID, 'workoutProgramState', 'scheduleConfig'), scheduleConfigDoc({ trainingDays: ['MON', 'TUE'] })));
  });

  it('denies cross-user read/write', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutProgramState', 'scheduleConfig'), scheduleConfigDoc());
    });
    await assertFails(getDoc(doc(dbFor(OTHER_UID), 'users', UID, 'workoutProgramState', 'scheduleConfig')));
    await assertFails(setDoc(doc(dbFor(OTHER_UID), 'users', UID, 'workoutProgramState', 'scheduleConfig'), scheduleConfigDoc()));
  });

  it('rejects fewer than 2 or more than 7 training days, and extra fields', async () => {
    const db = dbFor(UID);
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutProgramState', 'scheduleConfig'), scheduleConfigDoc({ trainingDays: ['MON'] })));
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutProgramState', 'scheduleConfig'), scheduleConfigDoc({ trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'MON'] })));
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutProgramState', 'scheduleConfig'), { ...scheduleConfigDoc(), extra: true }));
  });

  it('rejects a fabricated updatedAt', async () => {
    await assertFails(setDoc(doc(dbFor(UID), 'users', UID, 'workoutProgramState', 'scheduleConfig'), scheduleConfigDoc({ updatedAt: Timestamp.now() })));
  });
});

describe('workoutPrograms/{programId}/scheduleState', () => {
  it('lets the owner create and update their own program-scoped cursor', async () => {
    const db = dbFor(UID);
    await assertSucceeds(setDoc(doc(db, 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleState', 'current'), scheduleStateDoc()));
    await assertSucceeds(setDoc(
      doc(db, 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleState', 'current'),
      scheduleStateDoc({ nextSessionIndex: 1, cursorDate: '2026-08-05' }),
    ));
  });

  it('denies cross-user access', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleState', 'current'), scheduleStateDoc());
    });
    await assertFails(getDoc(doc(dbFor(OTHER_UID), 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleState', 'current')));
    await assertFails(updateDoc(doc(dbFor(OTHER_UID), 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleState', 'current'), { nextSessionIndex: 3 }));
  });

  it('rejects a programId mismatched with the path, and a negative index', async () => {
    const db = dbFor(UID);
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleState', 'current'), scheduleStateDoc({ programId: 'wpg_other' })));
    await assertFails(setDoc(doc(db, 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleState', 'current'), scheduleStateDoc({ nextSessionIndex: -1 })));
  });

  it('never allows delete', async () => {
    const db = dbFor(UID);
    await setDoc(doc(db, 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleState', 'current'), scheduleStateDoc());
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleState', 'current')));
  });
});

describe('workoutPrograms/{programId}/scheduleEvents', () => {
  it('lets the owner append an immutable event', async () => {
    const db = dbFor(UID);
    await assertSucceeds(setDoc(
      doc(db, 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleEvents', 'completed_0_2026-08-03'),
      completedEventDoc(),
    ));
  });

  it('denies cross-user read/write', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleEvents', 'completed_0_2026-08-03'),
        completedEventDoc(),
      );
    });
    await assertFails(getDoc(doc(dbFor(OTHER_UID), 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleEvents', 'completed_0_2026-08-03')));
    await assertFails(setDoc(
      doc(dbFor(OTHER_UID), 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleEvents', 'forged'),
      completedEventDoc(),
    ));
  });

  it('rejects an unknown event type and a fabricated occurredAt', async () => {
    const db = dbFor(UID);
    await assertFails(setDoc(
      doc(db, 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleEvents', 'bad'),
      completedEventDoc({ type: 'BOGUS' }),
    ));
    await assertFails(setDoc(
      doc(db, 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleEvents', 'bad2'),
      completedEventDoc({ occurredAt: Timestamp.now() }),
    ));
  });

  it('is immutable — no update or delete', async () => {
    const db = dbFor(UID);
    const ref = doc(db, 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleEvents', 'completed_0_2026-08-03');
    await setDoc(ref, completedEventDoc());
    await assertFails(updateDoc(ref, { sessionIndex: 1 }));
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(ref));
  });
});
