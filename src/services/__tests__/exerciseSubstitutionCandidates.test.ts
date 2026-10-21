import { describe,expect,it } from 'vitest';

import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import { equipmentContextFor } from '../../workoutPrescription/equipment';
import {
  canRevertToAnchor,
  exerciseDisplayName,
  exerciseDisplayTarget,
  resolveDisplayCandidates,
} from '../exerciseSubstitutionCandidates';

function userContext(overrides: Partial<Parameters<typeof completeAnswers>[0]> = {}) {
  const answers = completeAnswers(overrides);
  return { equipmentContext: equipmentContextFor(answers, answers.place === 'home' ? 'home' : 'gym') };
}

describe('resolveDisplayCandidates (client service wrapper)', () => {
  it('returns at most 3 candidates by default and never includes exercises already effective in the session', () => {
    const candidates = resolveDisplayCandidates({
      anchorExerciseId: 'barbell-back-squat',
      userContext: userContext({ place: 'gym' }),
      effectiveExerciseIdsInSession: new Set(['hack-squat-machine-variation']),
    });
    expect(candidates.length).toBeLessThanOrEqual(3);
    expect(candidates.map((c) => c.exerciseId)).not.toContain('hack-squat-machine-variation');
  });

  it('returns an empty array (never throws) for an anchor with zero eligible candidates', () => {
    const candidates = resolveDisplayCandidates({
      anchorExerciseId: 'does-not-exist',
      userContext: userContext({ place: 'gym' }),
      effectiveExerciseIdsInSession: new Set(),
    });
    expect(candidates).toEqual([]);
  });
});

describe('canRevertToAnchor', () => {
  it('is true when the anchor is still safe/executable and not duplicated', () => {
    expect(canRevertToAnchor({
      anchorExerciseId: 'barbell-back-squat',
      userContext: userContext({ place: 'gym' }),
      effectiveExerciseIdsInSession: new Set(),
    })).toBe(true);
  });

  it('is false when the anchor is already effectively present elsewhere in the session', () => {
    expect(canRevertToAnchor({
      anchorExerciseId: 'barbell-back-squat',
      userContext: userContext({ place: 'gym' }),
      effectiveExerciseIdsInSession: new Set(['barbell-back-squat']),
    })).toBe(false);
  });
});

describe('exerciseDisplayName / exerciseDisplayTarget', () => {
  it('resolves a real catalog exercise name/target and falls back to the raw id for an unknown one', () => {
    expect(exerciseDisplayName('barbell-back-squat', 'en')).toBe('Barbell Back Squat');
    expect(exerciseDisplayTarget('barbell-back-squat')).toBe('quads');
    expect(exerciseDisplayName('does-not-exist', 'en')).toBe('does-not-exist');
  });
});
