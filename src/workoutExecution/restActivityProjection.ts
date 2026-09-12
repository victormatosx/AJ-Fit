import {
  REST_ACTIVITY_NEXT_ACTION,
  type MaterializedRestNextAction,
} from '../types/restLiveActivity';

type MaterializeRestNextActionInput = Readonly<{
  /** Zero-based set currently being completed by the workout session. */
  completedSetIndex: number;
  totalSets: number;
  /** Resolved name at the head of the real remaining exercise queue. */
  nextExerciseName: string | null;
}>;

/**
 * Converts the already-materialized workout coordinates into presentation
 * data. Native surfaces consume this result and never inspect workout order.
 */
export function materializeRestNextAction(
  input: MaterializeRestNextActionInput,
): MaterializedRestNextAction {
  if (
    !Number.isInteger(input.completedSetIndex) ||
    input.completedSetIndex < 0 ||
    !Number.isInteger(input.totalSets) ||
    input.totalSets < 1 ||
    input.completedSetIndex >= input.totalSets
  ) {
    throw new RangeError('invalid completed set coordinates');
  }

  const nextZeroBasedSetIndex = input.completedSetIndex + 1;
  if (nextZeroBasedSetIndex < input.totalSets) {
    return {
      nextAction: REST_ACTIVITY_NEXT_ACTION.NEXT_SET,
      nextSetIndex: nextZeroBasedSetIndex + 1,
    };
  }

  const nextExerciseName = input.nextExerciseName?.trim();
  if (!nextExerciseName) {
    throw new RangeError('next exercise must be materialized after the final set');
  }
  return {
    nextAction: REST_ACTIVITY_NEXT_ACTION.NEXT_EXERCISE,
    nextExerciseName,
  };
}
