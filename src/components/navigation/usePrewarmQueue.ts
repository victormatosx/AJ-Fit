import { useEffect, useState } from 'react';
import { schedulePrewarm } from '../../lib/prewarmScheduler';
import { nextPrewarmRoute, withCompletedRoute } from '../../lib/prewarmQueue';
import { PREWARM_ROUTE_IDS, type PrewarmRouteId } from '../../lib/prewarmRoutes';

/**
 * Drives the single centralized prewarm schedule (`PREWARM_ROUTE_IDS` in
 * src/lib/prewarmRoutes.ts — docs/23_navegacao_e_lifecycle.md §8) with one
 * hook call instead of a hand-chained `usePrewarm(prevPrewarmed, 'NEXT')`
 * per screen. Schedules routes strictly in order, one `requestIdleCallback`
 * window at a time — the next route is only scheduled after the previous
 * one's callback actually ran, so there's a real yield between each and no
 * risk of a mount spike.
 *
 * Returns a map screens read their own flag from:
 * `prewarmed.PROGRESS`, `prewarmed.SETTINGS`, etc.
 */
export function usePrewarmQueue(): Record<PrewarmRouteId, boolean> {
  const [completed, setCompleted] = useState<ReadonlySet<PrewarmRouteId>>(() => new Set());

  useEffect(() => {
    const next = nextPrewarmRoute(PREWARM_ROUTE_IDS, completed);
    if (next === null) return;
    return schedulePrewarm(() => {
      setCompleted((prev) => withCompletedRoute(prev, next));
    });
    // `completed` drives its own next iteration — each commit re-runs this
    // effect, schedules the next id, and the cycle continues until the
    // queue is exhausted.
  }, [completed]);

  return Object.fromEntries(
    PREWARM_ROUTE_IDS.map((id) => [id, completed.has(id)]),
  ) as Record<PrewarmRouteId, boolean>;
}
