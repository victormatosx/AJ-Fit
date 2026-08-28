import { describe, expect, it } from 'vitest';
import { getTemplateById } from '../catalog';
import { composeTemplate } from '../composition';
import { generateWorkoutPrescription } from '../engine';
import { keepCount } from '../personalization';
import { evaluateSafety } from '../safety';
import type { CanonicalTemplate, FinalWorkoutPlan, QuestionnaireAnswers } from '../types';
import { completeAnswers } from './fixtures';

function successfulPlan(
  answers: QuestionnaireAnswers,
  adaptationWeek?: number,
): FinalWorkoutPlan {
  const result = generateWorkoutPrescription(answers, { adaptationWeek });
  if (result.status !== 'SUCCESS') throw new Error(`${result.status}:${result.reasonCodes.join(',')}`);
  return result.plan;
}

function templateWith(exercises: CanonicalTemplate['sessions'][number]['exercises']): CanonicalTemplate {
  return {
    id: 'T001',
    profile: {
      sex: 'male', environment: 'gym', primary_goal: 'hypertrophy_body_composition', days_per_week: 1,
    },
    split: 'test',
    rationale: 'test',
    sessions: [{ name: 'A', type: 'resistance', exercises }],
  };
}

const clearAnswers = (overrides: Partial<QuestionnaireAnswers> = {}) => completeAnswers({
  days: 2,
  ...overrides,
});

describe('keepCount', () => {
  it.each([0.50, 0.70, 0.60, 0.80])('uses ceil deterministically for factor %s', (factor) => {
    for (let total = 1; total <= 11; total += 1) {
      expect(keepCount(total, factor)).toBe(Math.ceil(total * factor));
      expect(keepCount(total, factor)).toBe(keepCount(total, factor));
    }
  });

  it('preserves empty and clamps non-empty results to 1..total', () => {
    expect(keepCount(0, 0.5)).toBe(0);
    expect(keepCount(4, 0)).toBe(1);
    expect(keepCount(4, 2)).toBe(4);
  });
});

describe('beginner adaptation', () => {
  it.each([
    [1, [5, 6, 7]],
    [2, [5, 6, 7]],
    [3, [5, 6, 7]],
    [4, [5, 6, 7]],
  ] as const)('T002 week %s has the documented counts', (week, expected) => {
    const plan = successfulPlan(completeAnswers({ level: 'beginner', days: 3 }), week);
    expect(plan.templateId).toBe('T002');
    expect(plan.sessions.map((session) => session.exercises.length)).toEqual(expected);
  });

  it('normalizes Week 3+ to the same stable snapshot stage', () => {
    const week3 = successfulPlan(completeAnswers({ level: 'beginner', days: 3 }), 3);
    const week4 = successfulPlan(completeAnswers({ level: 'beginner', days: 3 }), 4);
    expect(week3).toEqual(week4);
    expect(week3.adaptationStage).toBe(3);
  });

  it('preserves exercise coverage while reducing beginner working sets', () => {
    const template = getTemplateById('T002');
    if (!template) throw new Error('T002 missing');
    const plan = successfulPlan(completeAnswers({ level: 'beginner', days: 3 }), 1);
    for (const [sessionIndex, session] of plan.sessions.entries()) {
      for (const exercise of session.exercises) {
        const source = template.sessions[sessionIndex].exercises.find((item) => item.exercise_id === exercise.sourceExerciseId);
        expect(exercise.sets).toBe(Math.min(source?.sets ?? 2, 2));
        expect(exercise.reps).toBe(source?.reps);
        expect(exercise.duration).toBe(source?.duration);
      }
    }
  });

  it('does not activate from return_to_training alone', () => {
    const plan = successfulPlan(completeAnswers({ goal: 'return_to_training', level: 'intermediate', days: 3 }));
    expect(plan.sessions.map((session) => session.exercises.length)).toEqual([5, 6, 7]);
    expect(plan.trace.unresolvedModifiers).toEqual([]);
  });
});

describe('duration and composition limits', () => {
  it.each([
    ['30', [3, 4, 5]],
    ['45', [4, 5, 6]],
    ['60', [5, 6, 7]],
    ['90', [5, 6, 7]],
  ] as const)('T002 duration %s has the expected counts', (duration, expected) => {
    const plan = successfulPlan(completeAnswers({ days: 3, duration }));
    expect(plan.sessions.map((session) => session.exercises.length)).toEqual(expected);
  });

  it('uses set reductions before exercise removal for beginner short sessions', () => {
    const week1 = successfulPlan(completeAnswers({ level: 'beginner', days: 3, duration: '30' }), 1);
    const week2 = successfulPlan(completeAnswers({ level: 'beginner', days: 3, duration: '30' }), 2);
    expect(week1.sessions[1].exercises).toHaveLength(6);
    expect(week2.sessions[1].exercises).toHaveLength(6);
    expect(week1.sessions[1].exercises.some((exercise) => exercise.sets === 1)).toBe(true);
    expect(week2.sessions[1].exercises.some((exercise) => exercise.sets === 2)).toBe(true);
  });

  it('uses one fallback set normally and set-first reductions during beginner adaptation', () => {
    const template = templateWith([
      { name: 'A', exercise_id: 'barbell-back-squat', sets: 3, reps: '6-10' },
      { name: 'B', exercise_id: 'machine-flat-bench-press', sets: 3, reps: '6-10' },
      { name: 'C', exercise_id: 'iso-lateral-row-machine', sets: 3, reps: '8-12' },
      { name: 'D', exercise_id: 'ez-bar-biceps-curl', sets: 2, reps: '10-15' },
    ]);
    const answers = clearAnswers({ duration: '45' });
    const result = composeTemplate(template, answers, { safety: evaluateSafety(answers) });
    expect(result.status).toBe('COMPOSED');
    if (result.status === 'COMPOSED') {
      expect(result.sessions[0].exercises.map((exercise) => exercise.sets)).toEqual([3, 3, 3, 1]);
      expect(result.decisions.filter((decision) => decision.reasonCode === 'DURATION_SET_FALLBACK')).toHaveLength(1);
    }
    const beginnerAnswers = clearAnswers({ duration: '45', level: 'beginner' });
    const beginner = composeTemplate(template, beginnerAnswers, {
      adaptationWeek: 1,
      safety: evaluateSafety(beginnerAnswers),
    });
    expect(beginner.decisions.filter((decision) => decision.reasonCode === 'DURATION_SET_FALLBACK')).toHaveLength(1);
    expect(beginner.status === 'COMPOSED' && beginner.sessions[0].exercises).toHaveLength(4);
  });
});

describe('muscle priority', () => {
  const priorityTemplate = templateWith([
    { name: 'Squat', exercise_id: 'barbell-back-squat', sets: 3, reps: '6-10' },
    { name: 'Chest', exercise_id: 'machine-flat-bench-press', sets: 3, reps: '6-10' },
    { name: 'Back', exercise_id: 'iso-lateral-row-machine', sets: 3, reps: '8-12' },
    { name: 'Arms', exercise_id: 'ez-bar-biceps-curl', sets: 2, reps: '10-15' },
  ]);

  it('protects the first exercise and orders two priorities by declaration', () => {
    const answers = clearAnswers({ muscleFocus: ['back', 'chest'] });
    const result = composeTemplate(priorityTemplate, answers, { safety: evaluateSafety(answers) });
    expect(result.status).toBe('COMPOSED');
    if (result.status === 'COMPOSED') {
      expect(result.sessions[0].exercises.map((exercise) => exercise.exerciseId)).toEqual([
        'barbell-back-squat', 'iso-lateral-row-machine', 'machine-flat-bench-press', 'ez-bar-biceps-curl',
      ]);
      expect(result.sessions[0].exercises.map((exercise) => exercise.sets)).toEqual([3, 4, 4, 2]);
      expect(new Set(result.sessions[0].exercises.map((exercise) => exercise.sourceExerciseId)).size).toBe(4);
    }
  });

  it.each(['60', '90'] as const)('allows one extra set per priority at %s', (duration) => {
    const answers = clearAnswers({ duration, muscleFocus: ['back', 'chest'] });
    const result = composeTemplate(priorityTemplate, answers, { safety: evaluateSafety(answers) });
    expect(result.decisions.filter((decision) => decision.reasonCode === 'MUSCLE_PRIORITY_SET_ADDED')).toHaveLength(2);
  });

  it.each([
    ['beginner', '60'],
    ['intermediate', '30'],
    ['intermediate', '45'],
  ] as const)('skips extra sets for %s at duration %s', (level, duration) => {
    const answers = clearAnswers({ level, duration, muscleFocus: ['chest'] });
    const result = composeTemplate(priorityTemplate, answers, {
      adaptationWeek: 1,
      safety: evaluateSafety(answers),
    });
    expect(result.decisions.some((decision) => decision.reasonCode === 'MUSCLE_PRIORITY_SET_ADDED')).toBe(false);
  });

  it('preserves all slots while keeping beginner priority volume capped', () => {
    const twoSlots = templateWith([
      { name: 'Squat', exercise_id: 'barbell-back-squat', sets: 3, reps: '6-10' },
      { name: 'Chest', exercise_id: 'machine-flat-bench-press', sets: 3, reps: '6-10' },
    ]);
    const answers = clearAnswers({ level: 'beginner', muscleFocus: ['chest'] });
    const result = composeTemplate(twoSlots, answers, { adaptationWeek: 1, safety: evaluateSafety(answers) });
    expect(result.status).toBe('COMPOSED');
    if (result.status === 'COMPOSED') {
      expect(result.sessions[0].exercises.map((exercise) => exercise.exerciseId)).toEqual([
        'barbell-back-squat', 'machine-flat-bench-press',
      ]);
      expect(result.sessions[0].exercises.map((exercise) => exercise.sets)).toEqual([2, 2]);
    }
  });

  it('uses the catalog movement pattern as a minimal diversity guard', () => {
    const template = templateWith([
      { name: 'Chest A', exercise_id: 'machine-flat-bench-press', sets: 3, reps: '6-10' },
      { name: 'Chest B', exercise_id: 'iso-lateral-incline-chest-press-machine', sets: 3, reps: '8-12' },
      { name: 'Squat', exercise_id: 'barbell-back-squat', sets: 3, reps: '6-10' },
    ]);
    const answers = clearAnswers({ level: 'beginner' });
    const result = composeTemplate(template, answers, { adaptationWeek: 1, safety: evaluateSafety(answers) });
    expect(result.status).toBe('COMPOSED');
    if (result.status === 'COMPOSED') {
      expect(result.sessions[0].exercises.map((exercise) => exercise.exerciseId)).toEqual([
        'machine-flat-bench-press', 'iso-lateral-incline-chest-press-machine', 'barbell-back-squat',
      ]);
    }
  });
});

describe('safety and snapshot regressions', () => {
  it('never adds priority sets to an adapted special population', () => {
    const plan = successfulPlan(completeAnswers({
      sex: 'f', level: 'intermediate', muscleFocus: ['glutes'],
      specialConditions: ['pregnancy'],
      pregnancyScreening: {
        weeks: 20, prenatalCare: 'yes', exerciseRestriction: 'no', complication: 'no', warningSigns: ['none'],
      },
    }));
    expect(plan.population).toBe('pregnancy');
    expect(plan.trace.compositionDecisions.some((decision) => decision.reasonCode === 'MUSCLE_PRIORITY_SET_ADDED')).toBe(false);
  });

  it('uses distinct immutable identities for Week 1 and Week 2', () => {
    const answers = completeAnswers({ level: 'beginner', days: 3 });
    const week1 = successfulPlan(answers, 1);
    const week2 = successfulPlan(answers, 2);
    expect(week1.planId).not.toBe(week2.planId);
    expect(week1.versions).toEqual(expect.objectContaining({ modifierRules: '2.0.0', compositionEngine: '2.1.0' }));
  });
});
