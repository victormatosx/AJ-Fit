import { describe, expect, it } from 'vitest';
import { REST_ACTIVITY_NEXT_ACTION } from '../../types/restLiveActivity';
import { materializeRestNextAction } from '../restActivityProjection';

describe('workout-owned rest activity projection', () => {
  it('materializes the actual next one-based set without native set math', () => {
    expect(materializeRestNextAction({
      completedSetIndex: 1,
      totalSets: 4,
      nextExerciseName: null,
      nextExerciseTotalSets: null,
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
      nextExerciseTotalSets: 4,
    })).toEqual({
      nextAction: REST_ACTIVITY_NEXT_ACTION.NEXT_EXERCISE,
      nextExerciseName: 'Puxada alta',
      nextExerciseTotalSets: 4,
    });
  });

  // The Lock Screen's "Próximo" line renders `exerciseName` for NEXT_SET and
  // `nextExerciseName` for NEXT_EXERCISE (see `upcomingExerciseName` in
  // `AJFitRestActivityWidget.swift`). These pin the branch that decision
  // depends on, for the full life of one 3-set exercise.
  describe('"Próximo" stays on the current exercise until its last set is done', () => {
    const AGACHAMENTO_TOTAL_SETS = 3;

    it('after set 1/3 — still the same exercise', () => {
      expect(materializeRestNextAction({
        completedSetIndex: 0,
        totalSets: AGACHAMENTO_TOTAL_SETS,
        nextExerciseName: null,
      nextExerciseTotalSets: null,
      })).toEqual({
        nextAction: REST_ACTIVITY_NEXT_ACTION.NEXT_SET,
        nextSetIndex: 2,
      });
    });

    it('after set 2/3 — still the same exercise', () => {
      expect(materializeRestNextAction({
        completedSetIndex: 1,
        totalSets: AGACHAMENTO_TOTAL_SETS,
        nextExerciseName: null,
      nextExerciseTotalSets: null,
      })).toEqual({
        nextAction: REST_ACTIVITY_NEXT_ACTION.NEXT_SET,
        nextSetIndex: 3,
      });
    });

    it('after the final set 3/3 — and only then — the next exercise', () => {
      expect(materializeRestNextAction({
        completedSetIndex: 2,
        totalSets: AGACHAMENTO_TOTAL_SETS,
        nextExerciseName: 'Leg Press',
      nextExerciseTotalSets: 3,
      })).toEqual({
        nextAction: REST_ACTIVITY_NEXT_ACTION.NEXT_EXERCISE,
        nextExerciseName: 'Leg Press',
      nextExerciseTotalSets: 3,
      });
    });
  });

  it('refuses to invent a next exercise or accept impossible coordinates', () => {
    expect(() => materializeRestNextAction({
      completedSetIndex: 3,
      totalSets: 4,
      nextExerciseName: null,
      nextExerciseTotalSets: null,
    })).toThrow('next exercise must be materialized');
    expect(() => materializeRestNextAction({
      completedSetIndex: 4,
      totalSets: 4,
      nextExerciseName: 'Remada',
      nextExerciseTotalSets: 3,
    })).toThrow('invalid completed set coordinates');
  });
});
