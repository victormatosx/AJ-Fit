import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import {
  resetCompleteCardioTransportForTests,
  setCompleteCardioTransportForTests,
} from '../workoutExecutions';

/**
 * Cardio Finisher Completion Recovery hardening, Architecture B (2026-09
 * security audit). Mirrors `workoutLifecycleAuthorityFixture.ts`'s own doc
 * comment exactly: integration tests in this directory exercise the real
 * client transaction/service code against real Rules but do not start the
 * Functions runtime. This fixture impersonates only the already-validated
 * backend output (`completeWorkoutCardioHandler`'s own idempotent write) by
 * writing `cardio` with Rules disabled — the real handler's full authority
 * chain (ownership, execution state, "this session really has a cardio
 * finisher", duration bounds) has its own dedicated Functions-side
 * integration suite:
 * `functions/src/workoutLifecycle/__tests__/completeWorkoutCardio.integration.test.ts`.
 * This fixture only needs to reproduce the ONE thing the rest of the app
 * (hydration, recovery, the finish chain) actually depends on: idempotency.
 */
export function installCompleteCardioFixture(testEnv: RulesTestEnvironment, uid: string): void {
  setCompleteCardioTransportForTests(async ({ executionId, actualDurationSeconds }) => {
    // `withSecurityRulesDisabled`'s callback is typed `Promise<void>` — its
    // return value is never propagated by the SDK, so the result has to be
    // captured in this outer binding instead (same pattern
    // `installWorkoutLifecycleAuthorityFixture` already uses for the same
    // reason).
    let result: { status: 'COMPLETED'; actualDurationSeconds: number } | undefined;
    let error: Error | undefined;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const fixtureDb = context.firestore();
      const ref = doc(fixtureDb, 'users', uid, 'workoutExecutions', executionId);
      const snapshot = await getDoc(ref);
      if (!snapshot.exists()) {
        error = new Error('execution_not_found');
        return;
      }
      const data = snapshot.data();
      const existingCardio = data.cardio as { status: string; actualDurationSeconds: number } | null | undefined;
      if (existingCardio && existingCardio.status === 'COMPLETED') {
        result = { status: 'COMPLETED', actualDurationSeconds: existingCardio.actualDurationSeconds };
        return;
      }
      if (data.status !== 'IN_PROGRESS') {
        error = new Error('execution_not_in_progress');
        return;
      }
      await setDoc(ref, {
        cardio: { status: 'COMPLETED', actualDurationSeconds, completedAt: serverTimestamp() },
        updatedAt: serverTimestamp(),
      }, { merge: true });
      result = { status: 'COMPLETED', actualDurationSeconds };
    });
    if (error) throw error;
    return result!;
  });
}

export function resetCompleteCardioFixture(): void {
  resetCompleteCardioTransportForTests();
}
