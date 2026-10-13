export type HealthWeightRefreshListener = () => void | Promise<void>;

const listenersByUid = new Map<string, Set<HealthWeightRefreshListener>>();

export function subscribeToHealthWeightRefresh(
  uid: string,
  listener: HealthWeightRefreshListener,
): () => void {
  const listeners = listenersByUid.get(uid) ?? new Set();
  listeners.add(listener);
  listenersByUid.set(uid, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByUid.delete(uid);
  };
}

export function publishHealthWeightRefresh(uid: string): void {
  listenersByUid.get(uid)?.forEach((listener) => void listener());
}
