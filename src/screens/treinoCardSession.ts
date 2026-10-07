import { effectiveNextSessionIndex } from '../scheduleEngine/effectiveNextSessionIndex';
import type { ScheduleResolution } from '../scheduleEngine/types';

/** A completed card names the finished session; other cards name the next one. */
export function treinoCardSession<T>(
  sessions: readonly T[],
  resolution: ScheduleResolution,
  completedTodaySessionIndex: number | null,
): T | null {
  const index = resolution.status === 'TODAY_COMPLETED'
    ? completedTodaySessionIndex : effectiveNextSessionIndex(resolution);
  return index != null ? sessions[index] ?? null : null;
}
