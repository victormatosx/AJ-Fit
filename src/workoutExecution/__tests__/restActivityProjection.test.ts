import { describe, expect, it } from 'vitest';
import { REST_ACTIVITY_NEXT_ACTION } from '../../types/restLiveActivity';
import { materializeRestNextAction } from '../restActivityProjection';

describe('workout-owned rest activity projection', () => {
  it('materializes the actual next one-based set without native set math', () => {
    expect(materializeRestNextAction({
      completedSetIndex: 1,
      totalSets: 4,
      nextExerciseName: null,
    })).toEqual({
      nextAction: REST_ACTIVITY_NEXT_ACTION.NEXT_SET,
      nextSetIndex: 3,
    });
  });

  it('materializes the resolved next exercise after the final current set', () => {
    expect(materializeRestNextAction({
      completedSetIndex: 3,
      totalSets: 4,
      nextExerciseName: '  Puxada alta  ',
    })).toEqual({
      nextAction: REST_ACTIVITY_NEXT_ACTION.NEXT_EXERCISE,
      nextExerciseName: 'Puxada alta',
    });
  });

  it('refuses to invent a next exercise or accept impossible coordinates', () => {
    expect(() => materializeRestNextAction({
      completedSetIndex: 3,
      totalSets: 4,
      nextExerciseName: null,
    })).toThrow('next exercise must be materialized');
    expect(() => materializeRestNextAction({
      completedSetIndex: 4,
      totalSets: 4,
      nextExerciseName: 'Remada',
    })).toThrow('invalid completed set coordinates');
  });
});
