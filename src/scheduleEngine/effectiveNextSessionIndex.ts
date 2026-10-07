import type { ScheduleResolution } from './types';

/**
 * The rotation's current effective "next session" — used for manual
 * reposition (`REPOSITION_SCHEDULE_CURSOR`) and anywhere else the UI needs
 * "what session is the rotation on" independent of whether today happens to
 * be a training day. Mirrors the backend's own derivation byte-for-byte
 * (`functions/src/workoutLifecycle/authorizeMutation.ts`'s
 * `REPOSITION_SCHEDULE_CURSOR` branch) so the client's `expectedCurrent
 * NextSessionIndex` never disagrees with what the backend independently
 * recomputes from the authoritative cursor.
 */
export function effectiveNextSessionIndex(resolution: ScheduleResolution): number | null {
  switch (resolution.status) {
    case 'SESSION_READY':
      return resolution.sessionIndex;
    case 'REST_DAY':
    case 'ACTIVE_RECOVERY_DAY':
    case 'TODAY_COMPLETED':
      return resolution.nextSessionIndex;
    case 'MISSED_SESSION_DECISION_REQUIRED':
      return resolution.missedSessionIndex;
    default:
      return null;
  }
}
