import type {
  MissedSessionDecisionIdentity,
  ScheduleResolution,
} from './types';

export type MissResolutionOutcome =
  | { status: 'APPLIED'; resolution: ScheduleResolution }
  | { status: 'RECONCILED'; resolution: ScheduleResolution }
  | { status: 'FAILED'; resolution: ScheduleResolution | null };

export function missedDecisionIdentity(
  resolution: ScheduleResolution,
): MissedSessionDecisionIdentity | null {
  if (resolution.status !== 'MISSED_SESSION_DECISION_REQUIRED') return null;
  return {
    missedSessionIndex: resolution.missedSessionIndex,
    calendarSessionIndex: resolution.calendarSessionIndex,
    missedScheduledDate: resolution.missedScheduledDate,
  };
}

export function sameMissedDecision(
  left: MissedSessionDecisionIdentity | null,
  right: MissedSessionDecisionIdentity | null,
): boolean {
  return left !== null
    && right !== null
    && left.missedSessionIndex === right.missedSessionIndex
    && left.calendarSessionIndex === right.calendarSessionIndex
    && left.missedScheduledDate === right.missedScheduledDate;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : '';
}

/**
 * Only the two server answers that explicitly mean "the displayed identity
 * is no longer current" are reconcilable. Every other failed-precondition,
 * network error, and unknown failure remains retryable UI error.
 */
export function isReconcilableMissDecisionError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  const message = errorMessage(error);
  if (!code && message === 'STALE_MISSED_SESSION_DECISION') return true;
  if (code !== 'functions/failed-precondition' && code !== 'functions/aborted') return false;
  return message.includes('no_pending_missed_session_decision')
    || message.includes('stale_missed_session_decision');
}

export function classifyMissResolutionOutcome(input: {
  error: unknown | null;
  expected: MissedSessionDecisionIdentity;
  resolution: ScheduleResolution | null;
}): MissResolutionOutcome {
  if (!input.error) {
    return input.resolution
      ? { status: 'APPLIED', resolution: input.resolution }
      : { status: 'FAILED', resolution: null };
  }

  if (!isReconcilableMissDecisionError(input.error) || !input.resolution) {
    return { status: 'FAILED', resolution: input.resolution };
  }

  // If the exact same decision is still canonical, the server/client
  // disagreement is real. Do not hide it as idempotency.
  if (sameMissedDecision(input.expected, missedDecisionIdentity(input.resolution))) {
    return { status: 'FAILED', resolution: input.resolution };
  }

  return { status: 'RECONCILED', resolution: input.resolution };
}
