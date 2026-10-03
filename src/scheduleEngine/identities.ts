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

/**
 * Same deterministic identity used when a workout execution is created.
 *
 * `occurrence` disambiguates a `flexible` schedule legitimately repeating the
 * SAME sessionIndex on the SAME scheduledLocalDate — flexible means freedom
 * of date, never freedom of sequence, so the rotation can wrap back onto an
 * index already completed earlier that same day (docs — agenda livre). A
 * `fixed` schedule never needs this: a given (sessionIndex, date) pair only
 * ever occurs once in a fixed rotation.
 *
 * Omitted (or `1`) reproduces the original id byte-for-byte — every `fixed`
 * call and every `flexible` schedule's FIRST occurrence of a session on a
 * date keep their historical id with no migration required. Only a genuine
 * same-day repeat (`occurrence >= 2`) gets a distinguishing suffix.
 */
export function workoutExecutionDocumentId(
  programOrInstanceId: string,
  sessionIndex: number,
  scheduledLocalDate: string,
  occurrence = 1,
): string {
  const base = `exec_${programOrInstanceId}_${sessionIndex}_${scheduledLocalDate}`;
  return occurrence > 1 ? `${base}_o${occurrence}` : base;
}
