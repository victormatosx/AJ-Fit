export type AssessmentRefreshListener = () => void | Promise<void>;

const listenersByUid = new Map<string, Set<AssessmentRefreshListener>>();

/**
 * Keeps independently mounted assessment consumers coherent after a local
 * write. The custom router preserves both Assessment and Progress screens,
 * so each owns a separate `useAssessments` instance and needs an explicit
 * invalidation signal when either one changes the shared Firestore history.
 */
export function subscribeToAssessmentRefresh(
  uid: string,
  listener: AssessmentRefreshListener,
): () => void {
  const listeners = listenersByUid.get(uid) ?? new Set<AssessmentRefreshListener>();
  listeners.add(listener);
  listenersByUid.set(uid, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByUid.delete(uid);
  };
}

/** Starts every other mounted consumer's refresh immediately after a successful write. */
export function publishAssessmentRefresh(
  uid: string,
  origin?: AssessmentRefreshListener,
): void {
  listenersByUid.get(uid)?.forEach((listener) => {
    if (listener === origin) return;
    void listener();
  });
}
