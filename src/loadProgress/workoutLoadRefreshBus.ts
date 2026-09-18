export interface WorkoutLoadRefreshEvent {
  executionId: string;
}

export type WorkoutLoadRefreshListener = (event: WorkoutLoadRefreshEvent) => void | Promise<void>;

const listenersByUid = new Map<string, Set<WorkoutLoadRefreshListener>>();

export function subscribeToWorkoutLoadRefresh(
  uid: string,
  listener: WorkoutLoadRefreshListener,
): () => void {
  const listeners = listenersByUid.get(uid) ?? new Set<WorkoutLoadRefreshListener>();
  listeners.add(listener);
  listenersByUid.set(uid, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByUid.delete(uid);
  };
}

/** Invalidates load consumers only after Firestore confirms a set write. */
export function publishWorkoutLoadRefresh(uid: string, executionId: string): void {
  listenersByUid.get(uid)?.forEach((listener) => {
    void listener({ executionId });
  });
}
