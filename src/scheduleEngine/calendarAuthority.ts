import { WEEKDAY_ORDER, type ScheduleMode, type Weekday } from '../state/AppState';

export interface CalendarAuthorityProgram {
  scheduleMode?: unknown;
  prescribedTrainingFrequency?: unknown;
  prescribedStructuredDays?: unknown;
  sessions?: unknown;
  weeklySchedule?: unknown;
}

export interface EffectiveCalendarAuthority {
  scheduleMode: ScheduleMode;
  trainingDays: Weekday[];
  activeRecoveryDays: Weekday[];
  source: 'SCHEDULE_CONFIG' | 'PROGRAM' | 'SNAPSHOT' | 'UNCONFIGURED';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scheduleMode(value: unknown): ScheduleMode | null {
  return value === 'fixed' || value === 'flexible' ? value : null;
}

function validWeekdays(value: unknown): Weekday[] | null {
  if (!Array.isArray(value)) return null;
  const valid = new Set<string>(WEEKDAY_ORDER);
  if (value.some((day) => typeof day !== 'string' || !valid.has(day))) return null;
  if (new Set(value).size !== value.length) return null;
  return value as Weekday[];
}

export function prescribedSessionCount(program: CalendarAuthorityProgram): number {
  // Rotation indexes address `sessions[]`, not training opportunities per
  // week. A five-session split may legitimately have a four-day prescribed
  // frequency; index 4 is still a valid session/cursor.
  if (Array.isArray(program.sessions) && program.sessions.length > 0) return program.sessions.length;
  for (const value of [program.prescribedTrainingFrequency, program.prescribedStructuredDays]) {
    if (Number.isInteger(value) && Number(value) > 0 && Number(value) <= 7) return Number(value);
  }
  return 0;
}

function prescribedTrainingDayCount(
  program: CalendarAuthorityProgram,
  snapshotInputs: Record<string, unknown>,
): number {
  for (const value of [program.prescribedTrainingFrequency, program.prescribedStructuredDays]) {
    if (Number.isInteger(value) && Number(value) > 0 && Number(value) <= 7) return Number(value);
  }
  const sealedTrainingDays = programDays(program, 'TRAINING');
  if (sealedTrainingDays && sealedTrainingDays.length > 0) return sealedTrainingDays.length;
  const snapshotTrainingDays = validWeekdays(snapshotInputs.trainingDays);
  if (snapshotTrainingDays && snapshotTrainingDays.length > 0) return snapshotTrainingDays.length;
  return Array.isArray(program.sessions) && program.sessions.length > 0 ? program.sessions.length : 0;
}

function programDays(program: CalendarAuthorityProgram, state: 'TRAINING' | 'ACTIVE_RECOVERY'): Weekday[] | null {
  if (!Array.isArray(program.weeklySchedule)) return null;
  const days = program.weeklySchedule.flatMap((item) => (
    isRecord(item) && item.state === state ? [item.weekday] : []
  ));
  return validWeekdays(days);
}

/**
 * One pure calendar-authority rule shared by the app, lifecycle Functions and
 * notifications. ScheduleConfig wins only when its complete shape is valid
 * for the prescribed frequency; otherwise the sealed program and immutable
 * ProgramInstance snapshot are migration fallbacks. ACTIVE_RECOVERY remains
 * program-owned guidance because ScheduleConfig intentionally stores only
 * user-selected TRAINING days.
 */
export function resolveEffectiveCalendarAuthority(input: {
  scheduleConfig: Record<string, unknown> | null;
  program: CalendarAuthorityProgram;
  snapshotInputs?: Record<string, unknown> | null;
}): EffectiveCalendarAuthority {
  const snapshot = input.snapshotInputs ?? {};
  // Training frequency and rotation size are different legacy concepts: a
  // two-session A/B split can legitimately be prescribed on more than two
  // weekdays. Prefer explicit frequency, then sealed/snapshot calendar
  // evidence, and only use sessions.length as the final legacy fallback.
  const trainingDayCount = prescribedTrainingDayCount(input.program, snapshot);
  const fallbackMode = scheduleMode(input.program.scheduleMode)
    ?? scheduleMode(snapshot.scheduleMode)
    ?? 'fixed';
  const configuredMode = scheduleMode(input.scheduleConfig?.scheduleMode);
  const configuredDays = validWeekdays(input.scheduleConfig?.trainingDays);
  const effectiveConfiguredMode = configuredMode ?? fallbackMode;
  const scheduleConfigValid = input.scheduleConfig !== null
    && configuredDays !== null
    && (effectiveConfiguredMode === 'flexible'
      ? configuredDays.length === 0
      : trainingDayCount > 0 && configuredDays.length === trainingDayCount);

  const sealedTrainingDays = programDays(input.program, 'TRAINING');
  const snapshotTrainingDays = validWeekdays(snapshot.trainingDays);
  // These are migration fallbacks, including for historical sealed programs
  // whose explicit frequency metadata drifted from their own non-empty
  // weeklySchedule. Prefer that immutable calendar over making the account
  // unusable; only ScheduleConfig is held to the current frequency contract.
  const sealedDaysValid = sealedTrainingDays !== null && sealedTrainingDays.length > 0;
  const snapshotDaysValid = snapshotTrainingDays !== null && snapshotTrainingDays.length > 0;

  const effectiveMode = scheduleConfigValid ? effectiveConfiguredMode : fallbackMode;
  let source: EffectiveCalendarAuthority['source'] = 'UNCONFIGURED';
  let trainingDays: Weekday[] = [];
  if (effectiveMode === 'flexible') {
    source = scheduleConfigValid ? 'SCHEDULE_CONFIG'
      : scheduleMode(input.program.scheduleMode) === 'flexible' ? 'PROGRAM'
        : scheduleMode(snapshot.scheduleMode) === 'flexible' ? 'SNAPSHOT' : 'UNCONFIGURED';
  } else if (scheduleConfigValid && configuredDays) {
    source = 'SCHEDULE_CONFIG';
    trainingDays = configuredDays;
  } else if (sealedDaysValid && sealedTrainingDays) {
    source = 'PROGRAM';
    trainingDays = sealedTrainingDays;
  } else if (snapshotDaysValid && snapshotTrainingDays) {
    source = 'SNAPSHOT';
    trainingDays = snapshotTrainingDays;
  }

  const trainingSet = new Set(trainingDays);
  const activeRecoveryDays = effectiveMode === 'fixed'
    ? (programDays(input.program, 'ACTIVE_RECOVERY') ?? []).filter((day) => !trainingSet.has(day))
    : [];

  return {
    scheduleMode: effectiveMode,
    trainingDays,
    activeRecoveryDays,
    source,
  };
}
