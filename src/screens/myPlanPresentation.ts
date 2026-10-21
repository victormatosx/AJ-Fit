/**
 * Pure `WorkoutProgramSnapshot`/`ScheduleConfig` → "Meu Plano" view-model
 * derivation. Split out like `workoutScreenPlan.ts` so it is independently
 * testable in Node (Vitest never loads react-native here) and, more
 * importantly, so this screen can never grow its own copy of scheduling or
 * prescription logic — it only ever reshapes values the Schedule Engine and
 * the Prescription Engine already computed elsewhere.
 */
import { WEEKDAY_ORDER, type Weekday } from '../state/AppState';
import type { ScheduleResolution } from '../scheduleEngine/types';
import type { ManualSubstitutionUserContext } from '../services/exerciseSubstitutionCandidates';
import type { ExerciseCatalog } from '../workoutPrescription/exerciseCatalog';
import { resolvePermanentSubstitutionsForSession } from '../workoutPrescription/manualSubstitutionResolver';
import type { CompositionReasonCode, FinalWorkoutPlan, PrescriptionTrace, WorkoutDayState, WorkoutWeekdayPrescription } from '../workoutPrescription/types';

export interface MyPlanEffectiveExerciseIdentity {
  prescribedExerciseId: string;
  effectiveExerciseId: string;
}

export interface MyPlanEffectiveSession {
  exercises: MyPlanEffectiveExerciseIdentity[];
  /** Only effective overrides, keyed by the stable slot index. */
  effectiveExerciseIds: ReadonlyMap<number, string>;
}

/** The current prescription records adapted availability; onboarding answers are historical. */
export function currentPlanAvailableDays(
  plan: Partial<Pick<FinalWorkoutPlan, 'requestedDays' | 'prescribedTrainingFrequency' | 'prescribedStructuredDays'>> | null,
  historicalQuestionnaireDays: number | null,
): number | null {
  return plan?.requestedDays ?? plan?.prescribedTrainingFrequency
    ?? plan?.prescribedStructuredDays ?? historicalQuestionnaireDays;
}

/**
 * Builds Meu Plano's non-persisted effective view with the exact resolver
 * used for a new WorkoutExecution. It never reads an active execution and
 * never changes exerciseId/sourceExerciseId or any prescription parameter.
 */
export function buildMyPlanEffectiveSessions(input: {
  plan: FinalWorkoutPlan;
  preferences: ReadonlyMap<string, string>;
  userContext: ManualSubstitutionUserContext | null;
  catalog: ExerciseCatalog;
}): MyPlanEffectiveSession[] {
  return input.plan.sessions.map((session) => {
    const prescribedExerciseIds = session.exercises.map((exercise) => exercise.exerciseId);
    const effectiveExerciseIds = input.userContext
      ? resolvePermanentSubstitutionsForSession({
          sessionExerciseIds: prescribedExerciseIds,
          preferences: input.preferences,
          catalog: input.catalog,
          equipmentContext: input.userContext.equipmentContext,
        })
      : new Map<number, string>();
    return {
      effectiveExerciseIds,
      exercises: prescribedExerciseIds.map((prescribedExerciseId, exerciseIndex) => ({
        prescribedExerciseId,
        effectiveExerciseId: effectiveExerciseIds.get(exerciseIndex) ?? prescribedExerciseId,
      })),
    };
  });
}

export interface WeekDayViewModel {
  weekday: Weekday;
  isTrainingDay: boolean;
  state: WorkoutDayState;
  prescribedSessionIndex: number | null;
  isToday: boolean;
  /**
   * Only set for TODAY, and only when the Schedule Engine has already
   * resolved a session as due right now (`SESSION_READY`). Sessions rotate
   * by completion, not by calendar weekday (docs/workout-lifecycle/
   * 03_SCHEDULE_ENGINE.md) — so a future training day can never be labeled
   * with a specific session ahead of time without guessing.
   */
  dueSessionIndex: number | null;
}

/**
 * Builds a full Monday-first week strip. `trainingDays` marks which weekdays
 * the user actually trains on (their own `ScheduleConfig` preference); which
 * SESSION lands on today is only known via `resolution`, never inferred here.
 */
export function buildWeekView(
  trainingDays: readonly Weekday[],
  todayWeekday: Weekday,
  resolution: ScheduleResolution,
  weeklySchedule?: readonly WorkoutWeekdayPrescription[],
): WeekDayViewModel[] {
  const trainingDaySet = new Set(trainingDays);
  const prescriptionByDay = new Map(weeklySchedule?.map((day) => [day.weekday, day]));
  return WEEKDAY_ORDER.map((weekday) => {
    const isToday = weekday === todayWeekday;
    const prescribed = prescriptionByDay.get(weekday);
    const state = prescribed?.state ?? (trainingDaySet.has(weekday) ? 'TRAINING' : 'REST');
    const dueSessionIndex =
      isToday && resolution.status === 'SESSION_READY' ? resolution.sessionIndex : null;
    return {
      weekday,
      isTrainingDay: state === 'TRAINING',
      state,
      prescribedSessionIndex: prescribed?.sessionIndex ?? null,
      isToday,
      dueSessionIndex,
    };
  });
}

const BEGINNER_REASON_CODES: readonly CompositionReasonCode[] = [
  'BEGINNER_VOLUME_REDUCED',
  'PRIORITY_SET_SKIPPED_BEGINNER',
];

const DURATION_REASON_CODES: readonly CompositionReasonCode[] = [
  'DURATION_SESSION_REDUCED',
  'DURATION_SET_FALLBACK',
  'PRIORITY_SET_SKIPPED_DURATION',
];


export interface AdaptationFlags {
  equipment: boolean;
  experience: boolean;
  duration: boolean;
}

export function buildAdaptationFlags(trace: PrescriptionTrace): AdaptationFlags {
  return {
    equipment: trace.substitutions.length > 0,
    experience: trace.compositionDecisions.some((decision) =>
      BEGINNER_REASON_CODES.includes(decision.reasonCode),
    ),
    duration: trace.compositionDecisions.some((decision) =>
      DURATION_REASON_CODES.includes(decision.reasonCode),
    ),
  };
}

export function hasAnyAdaptation(flags: AdaptationFlags): boolean {
  return flags.equipment || flags.experience || flags.duration;
}
