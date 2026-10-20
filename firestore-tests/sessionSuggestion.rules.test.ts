import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

vi.mock('../src/lib/firebase', () => ({ db: {} }));

/**
 * New training model — free session selection on `scheduleState`.
 *
 * Two security claims are pinned here.
 *
 * 1. Selection is allowed WITHOUT a server-issued grant precisely because it
 *    cannot touch any completion-derived fact. `cursorDate`,
 *    `lastCompletedAt` and `lastPerformedLocalDate` must survive a selection
 *    byte-for-byte, and `suggestionVersion` must advance by exactly one.
 *
 * 2. The capability exists ONLY for an account enrolled in the controlled
 *    pilot. This is the claim a Function allowlist cannot make on its own:
 *    Rules are evaluated independently of any callable, so publishing them
 *    ungated would hand every account the ability to move its own rotation.
 *    `alice` is enrolled; `bob` is a second real account that is not.
 */

let env: RulesTestEnvironment;
const PROGRAM = 'prog1';
const INSTANCE = 'inst1';
const statePath = `users/alice/workoutPrograms/${PROGRAM}/scheduleState/${INSTANCE}`;
const bobStatePath = `users/bob/workoutPrograms/${PROGRAM}/scheduleState/${INSTANCE}`;
const db = (uid: string) => env.authenticatedContext(uid).firestore();

const stored = (overrides: Record<string, unknown> = {}) => ({
  programId: PROGRAM, programInstanceId: INSTANCE,
  nextSessionIndex: 0, suggestedSessionIndex: 0, suggestionVersion: 3, lastSelectedSessionIndex: 2,
  cursorDate: '2026-10-18', lastCompletedAt: '2026-10-18', lastPerformedLocalDate: '2026-10-18',
  pendingMissDecision: null, updatedAt: Timestamp.now(),
});
/** A well-formed selection write: moves only the suggestion. */
const selection = (overrides: Record<string, unknown> = {}) => ({
  programId: PROGRAM, programInstanceId: INSTANCE,
  nextSessionIndex: 2, suggestedSessionIndex: 2, suggestionVersion: 4, lastSelectedSessionIndex: 1,
  cursorDate: '2026-10-18', lastCompletedAt: '2026-10-18', lastPerformedLocalDate: '2026-10-18',
  pendingMissDecision: null, updatedAt: serverTimestamp(), ...overrides,
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
    await setDoc(doc(f, 'users/alice'), { accountStatus: 'active' });
    await setDoc(doc(f, 'users/bob'), { accountStatus: 'active' });
    await setDoc(doc(f, 'users/mallory'), { accountStatus: 'active' });
    // Pilot enrolment — server-written, one document per UID. Only `alice`.
    await setDoc(doc(f, 'workoutPilotEnrollment/alice'), { enabled: true });
    // V2 account: the lifecycle pointer exists, which is what turns on the
    // stricter branch of the scheduleState rules.
    await setDoc(doc(f, 'users/alice/workoutLifecycleState/current'), { activeProgramInstanceId: INSTANCE });
    await setDoc(doc(f, 'users/alice/programInstances/' + INSTANCE), { contentIdentity: PROGRAM, supersededAt: null });
    await setDoc(doc(f, statePath), stored());
    // `bob` is set up identically in every respect EXCEPT enrolment, so any
    // difference in outcome below is attributable to the gate alone.
    await setDoc(doc(f, 'users/bob/workoutLifecycleState/current'), { activeProgramInstanceId: INSTANCE });
    await setDoc(doc(f, 'users/bob/programInstances/' + INSTANCE), { contentIdentity: PROGRAM, supersededAt: null });
    await setDoc(doc(f, bobStatePath), stored());
  });
});

describe('the pilot gate is what grants selection at all', () => {
  it('denies an identical selection from a non-enrolled account', async () => {
    await assertFails(setDoc(doc(db('bob'), bobStatePath), selection()));
  });

  it('denies it when the enrolment document is absent', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'workoutPilotEnrollment/alice'));
    });
    await assertFails(setDoc(doc(db('alice'), statePath), selection()));
  });

  it('denies it when enrolment exists but is disabled', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'workoutPilotEnrollment/alice'), { enabled: false });
    });
    await assertFails(setDoc(doc(db('alice'), statePath), selection()));
  });

  it('denies it when `enabled` is a truthy non-boolean', async () => {
    // The flag is compared to boolean `true`, never coerced.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'workoutPilotEnrollment/alice'), { enabled: 'true' });
    });
    await assertFails(setDoc(doc(db('alice'), statePath), selection()));
  });

  it('no client may enrol itself, or read anyone else’s enrolment', async () => {
    await assertFails(setDoc(doc(db('bob'), 'workoutPilotEnrollment/bob'), { enabled: true }));
    await assertFails(setDoc(doc(db('alice'), 'workoutPilotEnrollment/alice'), { enabled: true }));
    await assertFails(getDoc(doc(db('bob'), 'workoutPilotEnrollment/alice')));
    // Its own flag stays readable — the client needs it to pick an experience.
    await assertSucceeds(getDoc(doc(db('alice'), 'workoutPilotEnrollment/alice')));
  });
});

describe('selection is allowed with no grant', () => {
  it('accepts a write that only moves the suggestion', async () => {
    await assertSucceeds(setDoc(doc(db('alice'), statePath), selection()));
  });

  it('accepts selecting the session the pointer already offers (version still advances)', async () => {
    await assertSucceeds(setDoc(doc(db('alice'), statePath),
      selection({ nextSessionIndex: 1, suggestedSessionIndex: 1, lastSelectedSessionIndex: 0 })));
  });
});

describe('a selection can never author a completion fact', () => {
  it('rejects moving cursorDate', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath), selection({ cursorDate: '2026-10-19' })));
  });

  it('rejects moving lastCompletedAt', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath), selection({ lastCompletedAt: '2026-10-19' })));
  });

  it('rejects moving lastPerformedLocalDate', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath), selection({ lastPerformedLocalDate: '2026-10-19' })));
  });

  it('rejects dropping lastPerformedLocalDate to null', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath), selection({ lastPerformedLocalDate: null })));
  });
});

describe('suggestionVersion is strictly monotonic by one', () => {
  it('rejects a repeated version (lost update)', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath), selection({ suggestionVersion: 3 })));
  });

  it('rejects skipping ahead', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath), selection({ suggestionVersion: 5 })));
  });

  it('rejects going backwards', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath), selection({ suggestionVersion: 2 })));
  });

  it('rejects a non-integer version', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath), selection({ suggestionVersion: 4.5 })));
    await assertFails(setDoc(doc(db('alice'), statePath), selection({ suggestionVersion: '4' })));
  });
});

describe('structural bounds and coherence', () => {
  it('requires nextSessionIndex to mirror suggestedSessionIndex', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath), selection({ nextSessionIndex: 1 })));
  });

  it('rejects an absurd session index', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath),
      selection({ nextSessionIndex: 99, suggestedSessionIndex: 99 })));
    await assertFails(setDoc(doc(db('alice'), statePath),
      selection({ nextSessionIndex: -1, suggestedSessionIndex: -1 })));
  });

  it('requires lastSelectedSessionIndex on a selection', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath), selection({ lastSelectedSessionIndex: null })));
  });

  it('refuses to leave a pending missed-session decision standing', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath), selection({
      pendingMissDecision: { missedSessionIndex: 0, calendarSessionIndex: 1, missedScheduledDate: '2026-10-12', detectedOnDate: '2026-10-19' },
    })));
  });

  it('rejects a forged updatedAt', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath), selection({ updatedAt: Timestamp.fromMillis(0) })));
  });

  it('rejects unknown fields', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath), { ...selection(), injected: true }));
  });
});

describe('ownership and program identity are unchanged', () => {
  it('rejects another account writing the suggestion', async () => {
    await assertFails(setDoc(doc(db('mallory'), statePath), selection()));
  });

  it('rejects a state document whose instance does not belong to the program', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice/programInstances/other'), { contentIdentity: 'another-program' });
    });
    await assertFails(setDoc(
      doc(db('alice'), `users/alice/workoutPrograms/${PROGRAM}/scheduleState/other`),
      selection({ programInstanceId: 'other' }),
    ));
  });

  it('rejects a mismatched programId in the payload', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath), selection({ programId: 'someone-elses' })));
  });
});

describe('the first ever selection creates the document', () => {
  beforeEach(async () => {
    // The outer hook seeds an existing rotation; remove it so these cases
    // really exercise the `create` branch and not `update`.
    await env.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), statePath));
    });
  });

  it('accepts a fresh rotation at version 1 with no performed history', async () => {
    await assertSucceeds(setDoc(doc(db('alice'), statePath), {
      programId: PROGRAM, programInstanceId: INSTANCE,
      nextSessionIndex: 1, suggestedSessionIndex: 1, suggestionVersion: 1, lastSelectedSessionIndex: 0,
      cursorDate: '2026-10-11', lastCompletedAt: null, lastPerformedLocalDate: null,
      pendingMissDecision: null, updatedAt: serverTimestamp(),
    }));
  });

  it('rejects a create that claims a performed date', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath), {
      programId: PROGRAM, programInstanceId: INSTANCE,
      nextSessionIndex: 1, suggestedSessionIndex: 1, suggestionVersion: 1, lastSelectedSessionIndex: 0,
      cursorDate: '2026-10-11', lastCompletedAt: '2026-10-11', lastPerformedLocalDate: '2026-10-11',
      pendingMissDecision: null, updatedAt: serverTimestamp(),
    }));
  });

  it('rejects a create that starts the version beyond the first selection', async () => {
    await assertFails(setDoc(doc(db('alice'), statePath), {
      programId: PROGRAM, programInstanceId: INSTANCE,
      nextSessionIndex: 1, suggestedSessionIndex: 1, suggestionVersion: 7, lastSelectedSessionIndex: 0,
      cursorDate: '2026-10-11', lastCompletedAt: null, lastPerformedLocalDate: null,
      pendingMissDecision: null, updatedAt: serverTimestamp(),
    }));
  });
});
