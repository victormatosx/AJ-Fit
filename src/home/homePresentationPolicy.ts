import type { HomeInitialReadiness } from './homeInitialReadiness';
import type { FrequencyWindowViewModel } from './frequencyHeatmap';

/** Pure boundary shared by the initial write and post-workout refresh. */
export function canWriteHomePresentationSnapshot(input: {
  uid: string | null;
  programInstanceId: string | null;
  timezone: string | null;
  readiness: HomeInitialReadiness;
  activityLoading: boolean;
  frequencyLoading: boolean;
  frequency: FrequencyWindowViewModel | null;
}): boolean {
  const { readiness } = input;
  return Boolean(input.uid && input.programInstanceId && input.timezone && input.frequency &&
    input.frequency.isCurrentWindow && input.frequency.offsetWindows === 0 &&
    !input.activityLoading && !input.frequencyLoading &&
    readiness.today === 'SUCCESS' && readiness.evolution === 'SUCCESS' &&
    readiness.activitySnapshot === 'SUCCESS' && readiness.frequency === 'SUCCESS' &&
    readiness.supportInbox === 'SUCCESS');
}

/** A failed first fetch cannot replace a valid local visual with an empty fallback grid. */
export function chooseHomeFrequencyPresentation<T>(input: {
  current: T | null;
  currentReadSucceeded: boolean;
  cached: T | null;
}): { source: 'CACHE' | 'AUTHORITATIVE'; value: T | null } {
  if (input.currentReadSucceeded && input.current) return { source: 'AUTHORITATIVE', value: input.current };
  if (input.cached) return { source: 'CACHE', value: input.cached };
  return { source: 'AUTHORITATIVE', value: input.current };
}

/** The legacy no-snapshot fallback keeps its existing error/review UX. */
export function canUseTodayActions(input: {
  snapshotExists: boolean;
  todayStatus: HomeInitialReadiness['today'];
  programInstanceId: string | null;
  scheduleMatchesActiveProgram?: boolean;
}): boolean {
  return !input.snapshotExists || (input.todayStatus === 'SUCCESS' && Boolean(input.programInstanceId)
    && input.scheduleMatchesActiveProgram !== false);
}

/** After the first authoritative Home, refreshes preserve current-session visuals. */
export function shouldUseSnapshotPlaceholders(input: {
  snapshotAvailable: boolean;
  authoritativeNow: boolean;
  authoritativeReachedOnce: boolean;
}): boolean {
  return input.snapshotAvailable && !input.authoritativeNow && !input.authoritativeReachedOnce;
}
