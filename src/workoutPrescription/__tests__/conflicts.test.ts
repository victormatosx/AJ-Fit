import { describe,expect,it } from 'vitest';
import { resolveConflicts } from '../conflicts';
import { generateWorkoutPrescription } from '../engine';
import { resolveModifiers } from '../modifiers';
import { evaluateSafety } from '../safety';
import { completeAnswers } from './fixtures';

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

  it('30 minutes constrains both muscle priorities', () => {
    expect(conflictIds({ duration: '30', muscleFocus: ['glutes', 'chest'] })).toEqual(expect.arrayContaining([
      'duration_limits_priority_extra_set:glutes', 'duration_limits_priority_extra_set:chest',
    ]));
  });

  it('beginner + 90 minutes never expands dose just to fill time', () => {
    expect(conflictIds({ level: 'beginner', duration: '90' })).toContain('beginner_over_available_time');
  });

  it('bodyweight-only never fabricates an equipment match', () => {
    expect(generateWorkoutPrescription(completeAnswers({
      place: 'home', equipment: ['bodyweight'], days: 2,
    })).status).toBe('INVALID_CONFIGURATION');
  });

});
