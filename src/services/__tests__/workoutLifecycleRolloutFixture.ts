import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

/** Existing lifecycle integration suites predate the production rollout gate. */
export async function enableWorkoutLifecycleRollout(testEnv: RulesTestEnvironment): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'workoutLifecycleRolloutConfig', 'active'), {
      schemaVersion: 1,
      enabled: true,
      percentage: 100,
    });
  });
}
