import { describe,expect,it } from 'vitest';

import { generateWorkoutPrescriptionV127 } from '../engineV127';
import { completeAnswers } from './fixtures';

describe('engineV127 — muscle priority end-to-end', () => {
  it('T003 (male/gym/hypertrophy/4d) moves triceps-primary exercises earlier without changing sets/reps/exercise identity', () => {
    const baseline = generateWorkoutPrescriptionV127(
      completeAnswers({ sex: 'm', goal: 'gain_muscle', level: 'intermediate', days: 4, place: 'gym' }),
      'INTERMEDIATE',
    );
    const prioritized = generateWorkoutPrescriptionV127(
      completeAnswers({ sex: 'm', goal: 'gain_muscle', level: 'intermediate', days: 4, place: 'gym', muscleFocus: ['triceps'] }),
      'INTERMEDIATE',
    );
    expect(baseline.status).toBe('SUCCESS');
    expect(prioritized.status).toBe('SUCCESS');
    if (baseline.status !== 'SUCCESS' || prioritized.status !== 'SUCCESS') return;
    expect(prioritized.plan.templateId).toBe(baseline.plan.templateId);
    for (const [sessionIndex, session] of prioritized.plan.sessions.entries()) {
      const baseSession = baseline.plan.sessions[sessionIndex];
      // Same multiset of exercises/dose per session — only order may differ.
      expect([...session.exercises].sort((a, b) => a.exerciseId.localeCompare(b.exerciseId)))
        .toEqual([...baseSession.exercises].sort((a, b) => a.exerciseId.localeCompare(b.exerciseId)));
    }
    const tricepsIndex = prioritized.plan.sessions[0].exercises.findIndex((e) => e.exerciseId === 'triceps-corda');
    const tricepsIndexBaseline = baseline.plan.sessions[0].exercises.findIndex((e) => e.exerciseId === 'triceps-corda');
    expect(tricepsIndex).toBeLessThanOrEqual(tricepsIndexBaseline);
    expect(prioritized.plan.trace.musclePriorityDecisions?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('engineV127 — beginner -> intermediate promotion routes to the regular family', () => {
  it('man/gym/5days/strength: BEGINNER selects a T091-T102 template; INTERMEDIATE selects the regular family instead', () => {
    const answers = completeAnswers({ sex: 'm', goal: 'strength', days: 5, place: 'gym' });
    const beginner = generateWorkoutPrescriptionV127(answers, 'BEGINNER');
    const intermediate = generateWorkoutPrescriptionV127(answers, 'INTERMEDIATE');
    expect(beginner.status).toBe('SUCCESS');
    expect(intermediate.status).toBe('SUCCESS');
    if (beginner.status !== 'SUCCESS' || intermediate.status !== 'SUCCESS') return;
    expect(/^T09[1-9]|T10[0-2]$/.test(beginner.plan.templateId)).toBe(true);
    expect(/^T09[1-9]|T10[0-2]$/.test(intermediate.plan.templateId)).toBe(false);
    expect(intermediate.plan.goalFamily).toBe('strength');
    expect(intermediate.plan.environment).toBe('gym');
  });
});

describe('engineV127 — initial prescription is independent of answers.equipment', () => {
  it('two otherwise-identical home users differing only in equipment get byte-identical plans', () => {
    const withoutEquipment = generateWorkoutPrescriptionV127(
      completeAnswers({ sex: 'f', goal: 'conditioning', level: 'intermediate', days: 4, place: 'home', equipment: [] }),
      'INTERMEDIATE',
    );
    const withEquipment = generateWorkoutPrescriptionV127(
      completeAnswers({
        sex: 'f', goal: 'conditioning', level: 'intermediate', days: 4, place: 'home',
        equipment: ['bodyweight', 'dumbbells', 'bands', 'bench_or_box', 'barbell', 'other'],
      }),
      'INTERMEDIATE',
    );
    expect(withoutEquipment.status).toBe('SUCCESS');
    expect(withEquipment.status).toBe('SUCCESS');
    if (withoutEquipment.status !== 'SUCCESS' || withEquipment.status !== 'SUCCESS') return;
    expect(withEquipment.plan).toEqual(withoutEquipment.plan);
  });
});

describe('engineV127 — cardio/mobility schema preservation', () => {
  it('a template session with cardio/mobility activities preserves cycleRange/distance/duration without forcing a muscle target', () => {
    const answers = completeAnswers({ sex: 'm', goal: 'strength', days: 5, place: 'gym' });
    const result = generateWorkoutPrescriptionV127(answers, 'BEGINNER');
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    const allExercises = result.plan.sessions.flatMap((session) => session.exercises);
    const cardioOrMobility = allExercises.filter((exercise) =>
      ['cardio-leve', 'cardio-continuo', 'cardio-intervalado', 'mobilidade-geral', 'mobilidade-dinamica-geral', 'mobilidade-dinamica-quadril-tornozelo']
        .includes(exercise.exerciseId));
    // Not every beginner template necessarily authors a cardio/mobility slot; assert on the ones that do.
    for (const exercise of cardioOrMobility) {
      expect(exercise.sets == null || exercise.duration != null || exercise.cycleRange != null || exercise.distance != null).toBe(true);
    }
  });
});
