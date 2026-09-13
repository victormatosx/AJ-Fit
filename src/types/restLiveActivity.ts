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
    }>
  | Readonly<{
      nextAction: typeof REST_ACTIVITY_NEXT_ACTION.NEXT_EXERCISE;
      nextSetIndex?: never;
      /** Already localized/materialized by the workout session. */
      nextExerciseName: string;
    }>;

/**
 * Presentation-ready snapshot shared with optional native rest surfaces.
 * Time is absolute; native consumers render the countdown from `endsAt`.
 */
type RestActivityStateBase = Readonly<{
  /** Concrete workout execution id, never a T001-T090 template id. */
  sessionId: string;
  /** Epoch milliseconds. */
  startedAt: number;
  /** Epoch milliseconds and the shared countdown source of truth. */
  endsAt: number;
  /** Already localized/materialized by the workout layer. */
  exerciseName: string;
  /** One-based presentation index. */
  setIndex: number;
  totalSets: number;
}>;

export type RestActivityState = Readonly<
  RestActivityStateBase & (
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
  RestActivityStateBase & {
    phase:
      | typeof REST_ACTIVITY_PHASE.CARDIO_RUNNING
      | typeof REST_ACTIVITY_PHASE.CARDIO_PAUSED
      | typeof REST_ACTIVITY_PHASE.CARDIO_COMPLETED;
    nextAction: typeof REST_ACTIVITY_NEXT_ACTION.FINISH_WORKOUT;
    nextSetIndex?: never;
    nextExerciseName?: never;
  }
>;

export type WorkoutActivityState = RestActivityState | CardioActivityState;

export type RestActivityUpdateOptions = Readonly<{
  /** Requests system emphasis only for an on-time, natural rest completion. */
  alert?: boolean;
}>;

export type RestActivityEndReason =
  | 'completed'
  | 'cancelled'
  | 'workout_ended';
