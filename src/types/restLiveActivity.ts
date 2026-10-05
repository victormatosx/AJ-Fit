export type RestLiveSurface =
  | 'ios-live-activity'
  | 'android-live-update'
  | 'android-notification'
  | 'none';

export type RestLiveCapabilities = Readonly<{
  available: boolean;
  surface: RestLiveSurface;
}>;

export const REST_ACTIVITY_PHASE = Object.freeze({
  WORKOUT_ACTIVE: 'workout_active',
  RESTING: 'resting',
  NEXT_SET: 'next_set',
  NEXT_EXERCISE: 'next_exercise',
  CARDIO_RUNNING: 'cardio_running',
  CARDIO_PAUSED: 'cardio_paused',
  CARDIO_COMPLETED: 'cardio_completed',
} as const);

export type RestActivityPhase =
  typeof REST_ACTIVITY_PHASE[keyof typeof REST_ACTIVITY_PHASE];

export const REST_ACTIVITY_NEXT_ACTION = Object.freeze({
  NEXT_SET: REST_ACTIVITY_PHASE.NEXT_SET,
  NEXT_EXERCISE: REST_ACTIVITY_PHASE.NEXT_EXERCISE,
  FINISH_WORKOUT: 'finish_workout',
} as const);

export type RestActivityNextAction =
  typeof REST_ACTIVITY_NEXT_ACTION[keyof typeof REST_ACTIVITY_NEXT_ACTION];

export type MaterializedRestNextAction =
  | Readonly<{
      nextAction: typeof REST_ACTIVITY_NEXT_ACTION.NEXT_SET;
      /** One-based upcoming set decided by the workout session. */
      nextSetIndex: number;
      nextExerciseName?: never;
      nextExerciseTotalSets?: never;
    }>
  | Readonly<{
      nextAction: typeof REST_ACTIVITY_NEXT_ACTION.NEXT_EXERCISE;
      nextSetIndex?: never;
      /** Already localized/materialized by the workout session. */
      nextExerciseName: string;
      /**
       * The NEXT exercise's own set count — `totalSets` still describes the
       * exercise that just finished. Needed so the surface can say
       * "Série 1/N" for the exercise about to start.
       */
      nextExerciseTotalSets: number;
    }>;

/**
 * Presentation-ready snapshot shared with optional native workout surfaces.
 * Timed phases use absolute time; the initial workout phase has no deadline.
 */
type WorkoutActivityStateBase = Readonly<{
  /** Concrete workout execution id, never a T001-T090 template id. */
  sessionId: string;
  /** Epoch milliseconds. */
  startedAt: number;
  /**
   * Epoch milliseconds of the WORKOUT's start — not of this rest. Lets the
   * surface show session elapsed time. Optional so Activities published
   * before this field existed stay decodable.
   */
  workoutStartedAt?: number;
  /** Already resolved via `resolveSessionDisplayName` — never a raw T001-T090 `name`/`type`. */
  workoutName: string;
  /** Already localized/materialized by the workout layer. */
  exerciseName: string;
  /**
   * Display-ready load of the set that was just completed (e.g. `"20 kg"`),
   * already converted/formatted for the user's unit by the workout layer.
   * Absent — never `"0 kg"` — when no load was registered for that set.
   */
  lastSetLoadLabel?: string;
  /** Set progress; zero is valid only before the first set is complete. */
  setIndex: number;
  totalSets: number;
}>;

export type WorkoutActiveActivityState = Readonly<
  WorkoutActivityStateBase & {
    /** No timer exists before the first set; zero means no set is complete. */
    setIndex: number;
    phase: typeof REST_ACTIVITY_PHASE.WORKOUT_ACTIVE;
    nextAction: typeof REST_ACTIVITY_NEXT_ACTION.NEXT_SET;
    nextSetIndex: number;
    nextExerciseName?: never;
    endsAt?: never;
  }
>;

export type RestActivityState = Readonly<
  WorkoutActivityStateBase & { endsAt: number } & (
    | (Extract<
        MaterializedRestNextAction,
        { nextAction: typeof REST_ACTIVITY_NEXT_ACTION.NEXT_SET }
      > & {
        /** Current semantic presentation state; never inferred by native set math. */
        phase:
          | typeof REST_ACTIVITY_PHASE.RESTING
          | typeof REST_ACTIVITY_PHASE.NEXT_SET;
      })
    | (Extract<
        MaterializedRestNextAction,
        { nextAction: typeof REST_ACTIVITY_NEXT_ACTION.NEXT_EXERCISE }
      > & {
        /** Current semantic presentation state; never inferred by native set math. */
        phase:
          | typeof REST_ACTIVITY_PHASE.RESTING
          | typeof REST_ACTIVITY_PHASE.NEXT_EXERCISE;
      })
  )
>;

/**
 * Cardio reuses the workout's existing ActivityKit activity and wire shape.
 * `startedAt...endsAt` is the effective absolute countdown interval while
 * running; while paused its duration is the frozen remaining time. No native
 * timer owns cardio state.
 */
export type CardioActivityState = Readonly<
  WorkoutActivityStateBase & { endsAt: number } & {
    phase:
      | typeof REST_ACTIVITY_PHASE.CARDIO_RUNNING
      | typeof REST_ACTIVITY_PHASE.CARDIO_PAUSED
      | typeof REST_ACTIVITY_PHASE.CARDIO_COMPLETED;
    nextAction: typeof REST_ACTIVITY_NEXT_ACTION.FINISH_WORKOUT;
    nextSetIndex?: never;
    nextExerciseName?: never;
  }
>;

export type WorkoutActivityState =
  | WorkoutActiveActivityState
  | RestActivityState
  | CardioActivityState;

export type RestActivityUpdateOptions = Readonly<{
  /** Requests system emphasis only for an on-time, natural rest completion. */
  alert?: boolean;
}>;

export type RestActivityEndReason =
  | 'completed'
  | 'cancelled'
  | 'workout_ended';
