import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
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
const FABRICATED_TIMESTAMP = Timestamp.fromMillis(1);
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
  it('accepts the exact persisted flexible payload and keeps fixed weekday validation strict', async () => {
    const ref = doc(dbFor(UID), 'users', UID, 'workoutProgramState', 'scheduleConfig');
    await assertSucceeds(setDoc(ref, scheduleConfigDoc({ scheduleMode: 'flexible', trainingDays: [] })));
    await assertFails(setDoc(ref, scheduleConfigDoc({ scheduleMode: 'fixed', trainingDays: [] })));
    await assertFails(setDoc(ref, scheduleConfigDoc({ scheduleMode: 'flexible', trainingDays: ['MON'] })));
  });

  // Flexible has no weekday calendar at all, so the historical "at least 2
  // training days" floor must NOT apply to it — the deployed ruleset applied
  // that floor unconditionally AND rejected the `scheduleMode` key outright,
  // which is why no flexible account in production has a scheduleConfig.
  it('keeps the 2..7 weekday floor for fixed only, and accepts a legacy config with no scheduleMode', async () => {
    const ref = doc(dbFor(UID), 'users', UID, 'workoutProgramState', 'scheduleConfig');
    await assertSucceeds(setDoc(ref, scheduleConfigDoc({ scheduleMode: 'fixed', trainingDays: ['MON', 'THU'] })));
    await assertFails(setDoc(ref, scheduleConfigDoc({ scheduleMode: 'fixed', trainingDays: ['MON'] })));
    // Pre-scheduleMode documents keep their former fixed contract.
    await assertSucceeds(setDoc(ref, scheduleConfigDoc({ trainingDays: ['MON', 'WED', 'FRI'] })));
    await assertFails(setDoc(ref, scheduleConfigDoc({ scheduleMode: 'sometimes', trainingDays: ['MON', 'WED'] })));
  });

  it('documents the production payload boundary: updatedAt and lowercase timezone are required', async () => {
    const ref = doc(dbFor(UID), 'users', UID, 'workoutProgramState', 'scheduleConfig');
    await assertFails(setDoc(ref, {
      scheduleMode: 'flexible',
      trainingDays: [],
      timezone: 'America/Sao_Paulo',
      scheduleVersion: 1,
    }));
    await assertFails(setDoc(ref, {
      scheduleMode: 'flexible',
      trainingDays: [],
      timeZone: 'America/Sao_Paulo',
      scheduleVersion: 1,
      updatedAt: serverTimestamp(),
    }));
  });

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
    await assertFails(setDoc(doc(dbFor(UID), 'users', UID, 'workoutProgramState', 'scheduleConfig'), scheduleConfigDoc({ updatedAt: FABRICATED_TIMESTAMP })));
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

  // `performedLocalDate` is the advance-workout ("Adiantar treino") field.
  // It reached the client and the event schema but never the deployed
  // ruleset's `hasOnly`, so the whole feature was rejected in production.
  // The mode is read from the referenced program, exactly like
  // `workoutExecutionCommonValid` does for the execution document itself.
  async function seedProgram(scheduleMode: 'fixed' | 'flexible') {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'workoutPrograms', PROGRAM_ID), {
        programId: PROGRAM_ID, status: 'active', scheduleMode,
      });
    });
  }

  it('accepts performedLocalDate on the scheduled day, and one civil day early for a fixed program', async () => {
    await seedProgram('fixed');
    const db = dbFor(UID);
    await assertSucceeds(setDoc(
      doc(db, 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleEvents', 'completed_normal'),
      completedEventDoc({ performedLocalDate: '2026-08-03' }),
    ));
    await assertSucceeds(setDoc(
      doc(db, 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleEvents', 'completed_advanced'),
      completedEventDoc({ performedLocalDate: '2026-08-02' }),
    ));
  });

  it('rejects a performedLocalDate two days early, in the future, or malformed', async () => {
    await seedProgram('fixed');
    const db = dbFor(UID);
    for (const [id, performedLocalDate] of [
      ['too_early', '2026-08-01'], ['in_future', '2026-08-04'], ['malformed', '03/08/2026'],
    ] as const) {
      await assertFails(setDoc(
        doc(db, 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleEvents', id),
        completedEventDoc({ performedLocalDate }),
      ));
    }
  });

  it('accepts performedLocalDate == scheduledDate for a flexible program but never the one-day exception', async () => {
    await seedProgram('flexible');
    const db = dbFor(UID);
    await assertSucceeds(setDoc(
      doc(db, 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleEvents', 'flex_normal'),
      completedEventDoc({ performedLocalDate: '2026-08-03' }),
    ));
    await assertFails(setDoc(
      doc(db, 'users', UID, 'workoutPrograms', PROGRAM_ID, 'scheduleEvents', 'flex_advanced'),
      completedEventDoc({ performedLocalDate: '2026-08-02' }),
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
      completedEventDoc({ occurredAt: FABRICATED_TIMESTAMP }),
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
