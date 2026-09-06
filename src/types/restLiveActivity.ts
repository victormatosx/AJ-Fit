export type RestLiveSurface =
  | 'ios-live-activity'
  | 'android-live-update'
  | 'android-notification'
  | 'none';

export type RestLiveCapabilities = Readonly<{
  available: boolean;
  surface: RestLiveSurface;
}>;

/**
 * Presentation-ready snapshot shared with optional native rest surfaces.
 * Time is absolute; native consumers render the countdown from `endsAt`.
 */
export type RestActivityState = Readonly<{
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

export type RestActivityEndReason =
  | 'completed'
  | 'cancelled'
  | 'workout_ended';
