import type { ScheduleResolution } from './types';

export type ScheduleRefreshError = {
  code?: string;
  errorClass: string;
};

export type ScheduleRefreshProjection = {
  resolution: ScheduleResolution;
  refreshError: ScheduleRefreshError | null;
};

export type ScheduleReloadOutcome =
  | { kind: 'success'; reloadId: number; resolution: ScheduleResolution }
  | { kind: 'failure'; reloadId: number; error: ScheduleRefreshError };

/**
 * Applies only the newest refresh. A transport/read failure is not a
 * Schedule answer, so it is represented separately and never replaces the
 * last authoritative resolution. A successful resolver response remains
 * authoritative even when that response is PROGRAM_NOT_AVAILABLE.
 */
export function applyScheduleReloadOutcome(
  current: ScheduleRefreshProjection,
  latestReloadId: number,
  outcome: ScheduleReloadOutcome,
): ScheduleRefreshProjection {
  if (outcome.reloadId !== latestReloadId) return current;
  if (outcome.kind === 'failure') {
    return { ...current, refreshError: outcome.error };
  }
  return { resolution: outcome.resolution, refreshError: null };
}
