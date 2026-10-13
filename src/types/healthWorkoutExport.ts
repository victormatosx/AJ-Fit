import type { HealthPlatform } from './healthIntegration';

export type HealthWorkoutExportPlatform = HealthPlatform;

export type HealthWorkoutExportRecordStatus =
  | 'pending'
  | 'writing'
  | 'retryable_error'
  | 'permission_required'
  | 'unavailable'
  | 'blocked_invalid'
  | 'succeeded'
  | 'suppressed';

export type HealthWorkoutExportErrorCode =
  | 'permission_required'
  | 'unavailable'
  | 'native_error'
  | 'invalid_execution'
  | 'interrupted';

export interface HealthWorkoutExportRecord {
  executionId: string;
  finishedAtIso: string;
  status: HealthWorkoutExportRecordStatus;
  attemptCount: number;
  queuedAtIso: string;
  lastAttemptAtIso: string | null;
  nextAttemptAtIso: string | null;
  succeededAtIso: string | null;
  nativeRecordId: string | null;
  lastErrorCode: HealthWorkoutExportErrorCode | null;
}

export interface HealthWorkoutExportState {
  version: 1;
  platform: HealthWorkoutExportPlatform;
  /**
   * Only workouts whose server `finishedAt` is at/after this instant are
   * eligible. It is renewed after every disabled -> enabled transition, so
   * reconnecting never silently backfills workouts completed while disconnected.
   */
  enabledAtIso: string | null;
  lastIntent: 'not_configured' | 'enabled' | 'disabled';
  records: Record<string, HealthWorkoutExportRecord>;
}

export type HealthWorkoutExportUiStatus =
  | 'idle'
  | 'exporting'
  | 'success'
  | 'no_data'
  | 'permission_required'
  | 'unavailable'
  | 'error';

export interface HealthWorkoutExportRunResult {
  status: Exclude<HealthWorkoutExportUiStatus, 'idle' | 'exporting'>;
  exported: number;
  pending: number;
  lastSuccessfulAt: Date | null;
}

export interface HealthWorkoutNativePayload {
  executionId: string;
  sessionName: string;
  startDate: Date;
  endDate: Date;
}

