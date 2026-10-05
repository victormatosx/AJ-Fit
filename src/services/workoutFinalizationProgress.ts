import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';

import { db } from '../lib/firebase';
import {
  serverCheckpointFromSidecar,
  type WorkoutFinalizationProgressStage,
} from '../workoutLifecycle/finalizationProgress';

/**
 * Read-only listener for the server-owned progress sidecar. Snapshot errors
 * are deliberately reported to the caller but never reject finalization.
 */
export function subscribeToWorkoutFinalizationProgress(
  uid: string,
  attemptId: string,
  onStage: (stage: WorkoutFinalizationProgressStage) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'users', uid, 'workoutFinalizationAttempts', attemptId),
    (snapshot) => {
      const data = snapshot.data();
      if (!data) return;
      const checkpoint = serverCheckpointFromSidecar(data);
      if (checkpoint) onStage(checkpoint);
    },
    (error) => onError?.(error),
  );
}
