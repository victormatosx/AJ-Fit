import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { execFileSync } from 'node:child_process';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

vi.mock('../src/lib/firebase', () => ({ db: {} }));

/**
 * FORWARD COMPATIBILITY OF THE NEW APP BUILD AGAINST THE *PUBLISHED* RULES.
 *
 * The pilot needs a new app build on a real device. If that build reaches
 * production before (or without) the Rules deploy, it must degrade to legacy
 * — never break. The claim: every new read the client performs is DENIED by
 * the published Rules, and the client treats denial as "not enrolled"
 * (`loadWorkoutPilotEnrollment` catches and returns false;
 * `hasWorkoutDailyCompletion` fails open).
 *
 * The rules under test are the ones on `origin/main`, read straight from git
 * so the comparison can never drift from what is actually deployed. The file
 * skips itself when that ref is unavailable (shallow clone, no remote) rather
 * than silently testing the local rules against themselves.
 */
function publishedRules(): string | null {
  try {
    return execFileSync('git', ['show', 'origin/main:firestore.rules'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}
const PUBLISHED = publishedRules();
let env: RulesTestEnvironment;
const PILOT = 'eGchpV2PBdTc8sK8GScKCzLDCcr2';
const PROGRAM = 'prog1';
const INSTANCE = 'inst1';
const db = (uid: string) => env.authenticatedContext(uid).firestore();
const statePath = `users/${PILOT}/workoutPrograms/${PROGRAM}/scheduleState/${INSTANCE}`;

describe.skipIf(!PUBLISHED)('the new client degrades to legacy under the published Rules', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'ajfit-rules-test',
      firestore: { rules: PUBLISHED! },
    });
  });
  afterAll(async () => env.cleanup());
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const f = context.firestore();
      await setDoc(doc(f, `users/${PILOT}`), { accountStatus: 'active' });
      await setDoc(doc(f, `users/${PILOT}/workoutLifecycleState/current`), { activeProgramInstanceId: INSTANCE });
      await setDoc(doc(f, `users/${PILOT}/programInstances/${INSTANCE}`), { contentIdentity: PROGRAM, supersededAt: null });
      await setDoc(doc(f, statePath), {
        programId: PROGRAM, programInstanceId: INSTANCE, nextSessionIndex: 0,
        cursorDate: '2026-10-18', lastCompletedAt: '2026-10-18', lastPerformedLocalDate: '2026-10-18',
        pendingMissDecision: null, updatedAt: Timestamp.now(),
      });
      // Even if enrolment were somehow seeded, the published Rules have no rule
      // for the collection at all.
      await setDoc(doc(f, `workoutPilotEnrollment/${PILOT}`), { enabled: true });
      await setDoc(doc(f, `users/${PILOT}/workoutDailyCompletions/2026-10-19`), { executionId: 'e1' });
    });
  });

  it('cannot read its pilot enrolment -> loadWorkoutPilotEnrollment resolves false', async () => {
    await assertFails(getDoc(doc(db(PILOT), `workoutPilotEnrollment/${PILOT}`)));
  });

  it('cannot read a daily-completion marker -> hasWorkoutDailyCompletion fails open', async () => {
    await assertFails(getDoc(doc(db(PILOT), `users/${PILOT}/workoutDailyCompletions/2026-10-19`)));
  });

  it('cannot write a suggestion -> selectSession is unreachable anyway', async () => {
    await assertFails(setDoc(doc(db(PILOT), statePath), {
      programId: PROGRAM, programInstanceId: INSTANCE,
      nextSessionIndex: 2, suggestedSessionIndex: 2, suggestionVersion: 1, lastSelectedSessionIndex: 0,
      cursorDate: '2026-10-18', lastCompletedAt: '2026-10-18', lastPerformedLocalDate: '2026-10-18',
      pendingMissDecision: null, updatedAt: serverTimestamp(),
    }));
  });

  it('CAN still read its own scheduleState -> the legacy resolver keeps working', async () => {
    await assertSucceeds(getDoc(doc(db(PILOT), statePath)));
  });
});
