import type { ScheduleMode } from '../state/AppState';
import { addDaysLocal, type LocalDate } from './calendar';
import type { ScheduleResolution } from './types';

export interface AdvancedWorkoutTarget {
  sessionIndex: number;
  scheduledLocalDate: LocalDate;
  performedLocalDate: LocalDate;
}

/**
 * V1's single, explicit exception to the fixed-calendar start gate.
 *
 * This does not turn a rest day into SESSION_READY. It only derives a
 * short-lived start target from the resolver's already-authoritative answer:
 * the next fixed opportunity, when and only when it is tomorrow.
 */
export function advancedWorkoutTarget(input: {
  scheduleMode: ScheduleMode;
  resolution: ScheduleResolution;
  todayLocalDate: LocalDate;
  sessionCount: number;
  hasIncompatibleExecution: boolean;
}): AdvancedWorkoutTarget | null {
  if (input.scheduleMode !== 'fixed'
    || input.hasIncompatibleExecution
    || input.resolution.status !== 'REST_DAY'
    || !Number.isInteger(input.resolution.nextSessionIndex)
    || input.resolution.nextSessionIndex < 0
    || input.resolution.nextSessionIndex >= input.sessionCount
    || input.resolution.nextWorkoutDate !== addDaysLocal(input.todayLocalDate, 1)) {
    return null;
  }

  return {
    sessionIndex: input.resolution.nextSessionIndex,
    scheduledLocalDate: input.resolution.nextWorkoutDate,
    performedLocalDate: input.todayLocalDate,
  };
}
