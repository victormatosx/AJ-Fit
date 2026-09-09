import type { PendingMissDecision } from './types';

export interface DetectedMissedSessionGap {
  missedSessionIndex: number;
  calendarSessionIndex: number;
  missedScheduledDate: string;
}

export function pendingMissMatchesGap(
  pending: PendingMissDecision,
  gap: DetectedMissedSessionGap | null,
): boolean {
  return gap !== null
    && pending.missedSessionIndex === gap.missedSessionIndex
    && pending.calendarSessionIndex === gap.calendarSessionIndex
    && pending.missedScheduledDate === gap.missedScheduledDate;
}

/**
 * Revalidates a persisted decision against today's actual calendar walk.
 * A schedule/configuration change can make an old pending payload stale;
 * keeping it would trap the UI in a modal the backend correctly refuses.
 */
export function reconcilePendingMissDecision(
  pending: PendingMissDecision,
  gap: DetectedMissedSessionGap | null,
  todayLocalDate: string,
): PendingMissDecision | null {
  if (pendingMissMatchesGap(pending, gap)) return pending;
  if (!gap) return null;
  return { ...gap, detectedOnDate: todayLocalDate };
}
