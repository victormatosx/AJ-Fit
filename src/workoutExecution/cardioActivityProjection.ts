import {
  computeCardioElapsedSeconds,
  remainingCardioSeconds,
  type CardioSession,
} from '../lib/cardioTimer';
import {
  REST_ACTIVITY_NEXT_ACTION,
  REST_ACTIVITY_PHASE,
  type CardioActivityState,
} from '../types/restLiveActivity';

/**
 * Projects the persisted cardio clock onto the existing Live Activity wire
 * contract. Dates are derived from the cardio timestamps; they never become
 * a second timer or a mutable native source of truth.
 */
export function projectCardioActivityState(input: {
  session: CardioSession;
  workoutSessionId: string;
  cardioName: string;
  nowMs: number;
}): CardioActivityState {
  const { session, nowMs } = input;
  const elapsedSeconds = computeCardioElapsedSeconds(session, nowMs);
  const remainingSeconds = remainingCardioSeconds(
    elapsedSeconds,
    session.targetDurationSeconds,
  );
  const completed = session.status === 'FINISHED' || remainingSeconds === 0;
  const phase = completed
    ? REST_ACTIVITY_PHASE.CARDIO_COMPLETED
    : session.status === 'PAUSED'
      ? REST_ACTIVITY_PHASE.CARDIO_PAUSED
      : REST_ACTIVITY_PHASE.CARDIO_RUNNING;

  // For running cardio this is an effective absolute interval: ActivityKit
  // owns only its rendering. For paused/completed cardio the same fields
  // encode a stable duration while preserving the existing schema shape.
  const startedAt = phase === REST_ACTIVITY_PHASE.CARDIO_RUNNING
    ? nowMs - elapsedSeconds * 1_000
    : nowMs;
  const endsAt = phase === REST_ACTIVITY_PHASE.CARDIO_RUNNING
    ? nowMs + remainingSeconds * 1_000
    : nowMs + Math.max(remainingSeconds, 1) * 1_000;

  return {
    sessionId: input.workoutSessionId,
    startedAt,
    endsAt,
    exerciseName: input.cardioName,
    setIndex: 1,
    totalSets: 1,
    phase,
    nextAction: REST_ACTIVITY_NEXT_ACTION.FINISH_WORKOUT,
  };
}
