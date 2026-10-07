import type { LocalDate } from '../scheduleEngine/calendar';
import { normalizeWeekdayOrder, weekdayOfLocalDate } from '../scheduleEngine/calendar';
import type { Weekday } from '../state/AppState';

interface RotationEvent {
  type: 'COMPLETED' | 'SKIPPED' | 'MISS_RESOLVED' | 'REPOSITIONED';
  programInstanceId?: string;
  sessionIndex: number;
  scheduledDate: string;
}

/**
 * Replays the authoritative COMPLETED/SKIPPED ledger to derive which session
 * index was actually expected on each prescribed calendar date — never
 * `execution.sessionIndex` itself, which is what the execution CLAIMS to
 * have performed, not what the rotation actually owed on that date
 * (docs/workout-lifecycle/v2/decisions/ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md
 * §Scheduled Opportunity Integrity). This is the client's optimistic mirror
 * of the same invariant the backend enforces authoritatively at write time
 * in `functions/src/workoutLifecycle/authorizeMutation.ts` (COMPLETE_SCHEDULE
 * only ever accepts the rotation's real next index) — this function only
 * has to agree with history that the backend already accepted, not
 * re-derive the rotation's full anchor/miss-decision machinery.
 *
 * `prescribedDates` must be sorted ascending. Returns the expected index for
 * every date in it — dates before any rotation activity still get the
 * anchor-derived value, matching the schedule resolver's own anchoring rule.
 */
export function buildExpectedSessionIndexByDate(input: {
  programInstanceId: string;
  prescribedDates: readonly LocalDate[];
  trainingDays: readonly Weekday[];
  sessionCount: number;
  rotationEvents: readonly RotationEvent[];
}): Map<LocalDate, number> {
  const result = new Map<LocalDate, number>();
  if (input.prescribedDates.length === 0 || input.sessionCount <= 0) return result;

  const orderedDays = normalizeWeekdayOrder(input.trainingDays);
  const anchorPosition = orderedDays.indexOf(weekdayOfLocalDate(input.prescribedDates[0]));
  let cursor = anchorPosition < 0 ? 0 : anchorPosition % input.sessionCount;

  const eventsByDate = new Map<string, number[]>();
  for (const event of input.rotationEvents) {
    if (event.programInstanceId !== input.programInstanceId) continue;
    // REPOSITIONED replays exactly like SKIPPED here: both mean the rotation
    // walked past this sessionIndex on this date without performing it, so
    // the cursor must still advance past it when reconstructing "what was
    // expected on date X" — never treated as a miss/skip for adherence
    // itself, only for this cursor replay mechanic.
    if (event.type !== 'COMPLETED' && event.type !== 'SKIPPED' && event.type !== 'REPOSITIONED') continue;
    const list = eventsByDate.get(event.scheduledDate) ?? [];
    list.push(event.sessionIndex);
    eventsByDate.set(event.scheduledDate, list);
  }

  for (const date of input.prescribedDates) {
    result.set(date, cursor);
    const remaining = eventsByDate.get(date);
    if (!remaining || remaining.length === 0) continue;
    // Greedily consume every event at this date whose sessionIndex matches
    // the current cursor. This replays a whole FOLLOW_SCHEDULE gap's SKIPPED
    // chain (which shares one date) plus a same-day COMPLETED, advancing the
    // cursor by exactly one rotation step per matching event, in order.
    let advanced = true;
    while (advanced) {
      advanced = false;
      const index = remaining.indexOf(cursor);
      if (index >= 0) {
        remaining.splice(index, 1);
        cursor = (cursor + 1) % input.sessionCount;
        advanced = true;
      }
    }
  }
  return result;
}
