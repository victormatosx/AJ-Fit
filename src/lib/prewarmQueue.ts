/**
 * Pure sequencing logic for the prewarm queue, split out of the hook so it's
 * testable without a React Native rendering environment (see
 * vitest.config.mts — Node-only). `usePrewarmQueue`
 * (src/components/navigation/usePrewarmQueue.ts) is the only caller.
 */

/** First id in `order` that isn't in `completed` yet, or null if the queue is done. */
export function nextPrewarmRoute<T extends string>(
  order: readonly T[],
  completed: ReadonlySet<T>,
): T | null {
  for (const id of order) {
    if (!completed.has(id)) return id;
  }
  return null;
}

/** Adds `id` to `completed`, preserving referential identity if already present. */
export function withCompletedRoute<T extends string>(
  completed: ReadonlySet<T>,
  id: T,
): ReadonlySet<T> {
  if (completed.has(id)) return completed;
  const next = new Set(completed);
  next.add(id);
  return next;
}
