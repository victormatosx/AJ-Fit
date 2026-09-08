import type { ScheduleEventType } from './types';

/** Shared persistence identity used by both the client and backend readers. */
export function scheduleEventDocumentId(input: {
  type: ScheduleEventType;
  sessionIndex: number;
  scheduledDate: string;
  programInstanceId?: string;
}): string {
  const legacyId = `${input.type.toLowerCase()}_${input.sessionIndex}_${input.scheduledDate}`;
  return input.programInstanceId ? `${input.programInstanceId}_${legacyId}` : legacyId;
}

/** Same deterministic identity used when a workout execution is created. */
export function workoutExecutionDocumentId(
  programOrInstanceId: string,
  sessionIndex: number,
  scheduledLocalDate: string,
): string {
  return `exec_${programOrInstanceId}_${sessionIndex}_${scheduledLocalDate}`;
}
