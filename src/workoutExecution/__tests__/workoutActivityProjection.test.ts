import { describe, expect, it } from 'vitest';
import {
  REST_ACTIVITY_NEXT_ACTION,
  REST_ACTIVITY_PHASE,
} from '../../types/restLiveActivity';
import { projectWorkoutActiveActivityState } from '../workoutActivityProjection';

describe('workout Live Activity start projection', () => {
  it('represents a freshly-started workout with zero completed sets', () => {
    expect(projectWorkoutActiveActivityState({
      executionId: 'execution-1',
      startedAt: 100_000,
      exercises: [
        { exerciseName: 'Supino reto', settledSets: 0, totalSets: 4 },
        { exerciseName: 'Crucifixo', settledSets: 0, totalSets: 3 },
      ],
    })).toEqual({
      sessionId: 'execution-1',
      startedAt: 100_000,
      exerciseName: 'Supino reto',
      setIndex: 0,
      totalSets: 4,
      phase: REST_ACTIVITY_PHASE.WORKOUT_ACTIVE,
      nextAction: REST_ACTIVITY_NEXT_ACTION.NEXT_SET,
      nextSetIndex: 1,
    });
  });

  it('projects resumed progress without creating a second logical identity', () => {
    expect(projectWorkoutActiveActivityState({
      executionId: 'execution-1',
      startedAt: 100_000,
      exercises: [
        { exerciseName: 'Supino reto', settledSets: 4, totalSets: 4 },
        { exerciseName: 'Crucifixo', settledSets: 1, totalSets: 3 },
      ],
    })).toMatchObject({
      sessionId: 'execution-1',
      exerciseName: 'Crucifixo',
      setIndex: 1,
      totalSets: 3,
      nextSetIndex: 2,
    });
  });

  it('does not fabricate an active strength state after every set is done', () => {
    expect(projectWorkoutActiveActivityState({
      executionId: 'execution-1',
      startedAt: 100_000,
      exercises: [{ exerciseName: 'Supino reto', settledSets: 4, totalSets: 4 }],
    })).toBeNull();
  });
});

describe('workout Live Activity re-sync after a skip/occupied requeue', () => {
  // The caller (WorkoutScreen) is responsible for passing exercises in
  // current QUEUE order (head = current), not fixed prescription order —
  // this function only ever picks the first entry with incomplete sets, so
  // a skipped-but-still-zero-settled exercise must already be behind the
  // one that became current or it would wrongly resurface as "current".
  it('projects the requeued exercise as current, not the skipped one still at zero', () => {
    // Exercise A was skipped (0 settled sets, moved to the tail); B is now
    // head of the queue.
    expect(projectWorkoutActiveActivityState({
      executionId: 'execution-1',
      startedAt: 100_000,
      exercises: [
        { exerciseName: 'Crucifixo (B)', settledSets: 0, totalSets: 3 },
        { exerciseName: 'Supino reto (A, pulado)', settledSets: 0, totalSets: 4 },
      ],
    })).toMatchObject({
      exerciseName: 'Crucifixo (B)',
      setIndex: 0,
      totalSets: 3,
    });
  });

  it('projects the third exercise as current after two consecutive skips', () => {
    expect(projectWorkoutActiveActivityState({
      executionId: 'execution-1',
      startedAt: 100_000,
      exercises: [
        { exerciseName: 'Remada (C)', settledSets: 0, totalSets: 3 },
        { exerciseName: 'Supino reto (A, pulado)', settledSets: 0, totalSets: 4 },
        { exerciseName: 'Crucifixo (B, pulado)', settledSets: 0, totalSets: 3 },
      ],
    })).toMatchObject({
      exerciseName: 'Remada (C)',
      setIndex: 0,
    });
  });
});
