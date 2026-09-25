import { describe, expect, it } from 'vitest';
import { resolveConflicts } from '../conflicts';
import { generateWorkoutPrescription } from '../engine';
import { resolveModifiers } from '../modifiers';
import { evaluateSafety } from '../safety';
import { selectTemplate } from '../selection';
import { completeAnswers } from './fixtures';
import type { Quiz } from '../../state/AppState';

function conflictIds(overrides: Parameters<typeof completeAnswers>[0]): string[] {
  const answers = completeAnswers(overrides);
  const safety = evaluateSafety(answers);
  return resolveConflicts(answers, resolveModifiers(answers, safety)).map((value) => value.id);
}

describe('explicit conflict resolution', () => {
  it('advanced + return-to-training needs no synthetic conflict', () => {
    expect(conflictIds({ level: 'advanced', goal: 'return_to_training' })).not.toContain('return_over_advanced');
    expect(generateWorkoutPrescription(completeAnswers({ level: 'advanced', goal: 'return_to_training' })).status).toBe('SUCCESS');
  });

  it.each([
    ['glutes', 'knee'],
    ['chest', 'shoulder'],
  ])('%s priority cannot override %s safety', (focus, region) => {
    expect(conflictIds({
      muscleFocus: [focus], specialConditions: ['musculoskeletal_limitation'],
      limits: [region],
    })).toContain(`safety_over_priority:${focus}`);
  });

  it('30 minutes constrains both muscle priorities', () => {
    expect(conflictIds({ duration: '30', muscleFocus: ['glutes', 'chest'] })).toEqual(expect.arrayContaining([
      'duration_limits_priority_extra_set:glutes', 'duration_limits_priority_extra_set:chest',
    ]));
  });

  it('lipedema + knee limitation requires intersection of protected constraints', () => {
    expect(conflictIds({
      specialConditions: ['lipedema', 'musculoskeletal_limitation'],
      lipedemaScreening: { symptomImpact: 'interferes_with_exercises', professionalGuidance: 'no' },
      limits: ['knee'],
    })).toContain('lipedema_with_musculoskeletal_limitation');
  });

  it('beginner + 90 minutes never expands dose just to fill time', () => {
    expect(conflictIds({ level: 'beginner', duration: '90' })).toContain('beginner_over_available_time');
  });

  it.each([
    ['dizziness', {
      specialConditions: ['dizziness_or_vertigo'],
      dizzinessScreening: { symptomFrequency: 'occasional', affectsBalance: 'no' },
      place: 'home', equipment: ['dumbbells', 'bands', 'bench_or_box'],
    }],
    ['post-surgical', {
      specialConditions: ['post_surgical', 'musculoskeletal_limitation'],
      postSurgicalScreening: { recoveryStatus: 'in_progress', returnClearance: 'cleared_no_restrictions', bodyRegion: 'knee' },
      limits: ['knee'],
    }],
  ] as const)('%s adapted keeps P0 modifiers before lower priorities', (_name, overrides) => {
    const answers = completeAnswers(overrides as unknown as Partial<Quiz>);
    const modifiers = resolveModifiers(answers, evaluateSafety(answers));
    expect(modifiers[0].priority).toBe('P0');
    expect(generateWorkoutPrescription(answers).status).toBe('INVALID_CONFIGURATION');
  });

  it('bodyweight-only never fabricates an equipment match', () => {
    expect(generateWorkoutPrescription(completeAnswers({
      place: 'home', equipment: ['bodyweight'], days: 2,
    })).status).toBe('INVALID_CONFIGURATION');
  });

});
