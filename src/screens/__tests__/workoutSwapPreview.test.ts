import { describe, expect, it } from 'vitest';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import { generateWorkoutPrescription } from '../../workoutPrescription/engine';
import type { FinalWorkoutPlan } from '../../workoutPrescription/types';
import {
  AJ_EXPANDED_SIZE,
  AJ_EXPANDED_TOP,
  AJ_SPEECH_BOTTOM_MARGIN,
  AJ_SPEECH_BOX,
  AJ_SPEECH_GAP,
  EXPANDED_SHEET_BOUNDS,
  expandedSheetHeight,
  planExerciseCount,
  planFrequency,
  sessionMuscleGroups,
  swapPreviewWeek,
  workoutSwapComparison,
} from '../workoutSwapPreview';

/** A real engine plan for N fixed training days — never a hand-built shape. */
function planForDays(days: number, trainingDays: readonly string[]): FinalWorkoutPlan {
  const result = generateWorkoutPrescription(completeAnswers({
    days,
    scheduleMode: 'fixed',
    trainingDays: trainingDays as never,
  }));
  if (result.status !== 'SUCCESS') throw new Error(`fixture setup failed: ${result.status}`);
  return result.plan;
}

const plan3 = planForDays(3, ['MON', 'WED', 'FRI']);
const plan5 = planForDays(5, ['MON', 'TUE', 'WED', 'THU', 'FRI']);

describe('planFrequency / planExerciseCount', () => {
  it('reports the frequency the plan actually prescribes', () => {
    expect(planFrequency(plan3)).toBe(3);
    expect(planFrequency(plan5)).toBe(5);
  });

  it('falls back to the session count when neither prescribed field is present', () => {
    const bare: FinalWorkoutPlan = {
      ...plan3,
      prescribedTrainingFrequency: undefined,
      prescribedStructuredDays: undefined as never,
    };
    expect(planFrequency(bare)).toBe(bare.sessions.length);
  });

  it('totals every exercise across every session', () => {
    expect(planExerciseCount(plan3)).toBe(
      plan3.sessions.reduce((sum, session) => sum + session.exercises.length, 0),
    );
    expect(planExerciseCount(plan3)).toBeGreaterThan(0);
  });
});

describe('workoutSwapComparison', () => {
  it('reports the real antes -> depois of a 3x -> 5x swap', () => {
    const comparison = workoutSwapComparison(plan3, plan5);
    expect(comparison.frequency).toEqual({ from: 3, to: 5, changed: true });
    expect(comparison.sessionCount.from).toBe(plan3.sessions.length);
    expect(comparison.sessionCount.to).toBe(plan5.sessions.length);
    expect(comparison.exerciseCount.from).toBe(planExerciseCount(plan3));
    expect(comparison.exerciseCount.to).toBe(planExerciseCount(plan5));
    expect(comparison.split).toEqual({
      from: plan3.split,
      to: plan5.split,
      changed: plan3.split !== plan5.split,
    });
  });

  it('marks a metric unchanged when both plans agree, so the UI can hide the arrow', () => {
    const comparison = workoutSwapComparison(plan3, plan3);
    expect(comparison.frequency.changed).toBe(false);
    expect(comparison.sessionCount.changed).toBe(false);
    expect(comparison.exerciseCount.changed).toBe(false);
    expect(comparison.split.changed).toBe(false);
  });
});

describe('swapPreviewWeek', () => {
  it('reads the plan\'s own sealed weeklySchedule, Monday first', () => {
    const week = swapPreviewWeek(plan3);
    expect(week.map((day) => day.weekday)).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
    const training = week.filter((day) => day.state === 'TRAINING').map((day) => day.weekday);
    expect(training).toEqual(['MON', 'WED', 'FRI']);
  });

  it('marks every weekday the plan did not prescribe as REST rather than dropping it', () => {
    const week = swapPreviewWeek(plan3);
    expect(week).toHaveLength(7);
    expect(week.find((day) => day.weekday === 'SUN')?.state).toBe('REST');
  });

  it('returns no weekdays for a flexible plan — the screen shows its frequency instead of guessing days', () => {
    expect(swapPreviewWeek({ ...plan3, scheduleMode: 'flexible' })).toEqual([]);
  });

  it('returns no weekdays when a plan carries no weeklySchedule at all', () => {
    expect(swapPreviewWeek({ ...plan3, weeklySchedule: [] })).toEqual([]);
    expect(swapPreviewWeek({ ...plan3, weeklySchedule: undefined })).toEqual([]);
  });
});

describe('sessionMuscleGroups', () => {
  it('lists each muscle once, in the order it first appears in the session', () => {
    expect(sessionMuscleGroups([
      { target: 'chest' },
      { target: 'triceps' },
      { target: 'chest' },
      { target: 'front_deltoid' },
    ])).toEqual(['chest', 'triceps', 'front_deltoid']);
  });

  it('contributes nothing for an activity with no catalogued target', () => {
    expect(sessionMuscleGroups([{ target: '' }, { target: '  ' }, { target: 'quads' }]))
      .toEqual(['quads']);
    expect(sessionMuscleGroups([])).toEqual([]);
  });
});

describe('the session letter each weekday carries', () => {
  it('comes from the weekday the plan sealed, not from the list order', () => {
    // 4 days on MON/TUE/THU/FRI: the engine seals sessionIndex 0,1,2,3 onto
    // exactly those weekdays, so WED/SAT/SUN carry no letter at all.
    const plan = planForDays(4, ['MON', 'TUE', 'THU', 'FRI']);
    const week = swapPreviewWeek(plan);
    const letters = week.map((day) => (
      day.sessionIndex !== null ? String.fromCharCode(65 + day.sessionIndex) : null
    ));
    expect(letters).toEqual(['A', 'B', null, 'C', 'D', null, null]);
  });

  it('skips the rest day in the middle rather than shifting the letters onto it', () => {
    const week = swapPreviewWeek(planForDays(3, ['MON', 'WED', 'FRI']));
    expect(week.map((day) => day.sessionIndex)).toEqual([0, null, 1, null, 2, null, null]);
  });

  it('never invents a letter for a weekday the plan left as REST', () => {
    for (const day of swapPreviewWeek(planForDays(3, ['MON', 'WED', 'FRI']))) {
      if (day.state === 'REST') expect(day.sessionIndex).toBeNull();
      else expect(day.sessionIndex).not.toBeNull();
    }
  });
});

describe('expandedSheetHeight', () => {
  it('leaves exactly the room AJ and his lines need — no dead space below them', () => {
    const topArea = (safeTop: number) =>
      safeTop + AJ_EXPANDED_TOP + AJ_EXPANDED_SIZE + AJ_SPEECH_GAP
      + AJ_SPEECH_BOX + AJ_SPEECH_BOTTOM_MARGIN;
    // The common iPhone: the plan comes to rest right under the speech box.
    expect(expandedSheetHeight(844, 47)).toBe(844 - topArea(47));
    // Which is far more of the screen than the fraction this replaced (52%).
    expect(expandedSheetHeight(844, 47) / 844).toBeGreaterThan(0.65);
  });

  it('tracks the safe-area inset instead of assuming one', () => {
    expect(expandedSheetHeight(844, 59)).toBeLessThan(expandedSheetHeight(844, 47));
    expect(expandedSheetHeight(844, 47) - expandedSheetHeight(844, 59)).toBe(12);
  });

  it('never starves the plan on a very short screen', () => {
    // Below ~400pt the measured top area would leave the sheet smaller than
    // the floor, so the floor wins and the speech box is what gets squeezed.
    expect(expandedSheetHeight(400, 20)).toBe(400 * EXPANDED_SHEET_BOUNDS.min);
    // A normal small phone is still sized by the real measurement.
    expect(expandedSheetHeight(667, 20)).toBeGreaterThan(667 * EXPANDED_SHEET_BOUNDS.min);
  });

  it('never strands the lines in empty space on a tall screen', () => {
    expect(expandedSheetHeight(2000, 47)).toBe(2000 * EXPANDED_SHEET_BOUNDS.max);
  });

  it('always leaves the sheet smaller than the screen, so there is something to descend into', () => {
    for (const [h, inset] of [[667, 20], [844, 47], [932, 59], [1024, 24]] as const) {
      expect(expandedSheetHeight(h, inset)).toBeLessThan(h);
      expect(expandedSheetHeight(h, inset)).toBeGreaterThan(0);
    }
  });
});
