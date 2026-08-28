import { describe, expect, it } from 'vitest';
import { catalogInvariantErrors, getTemplateById, WORKOUT_TEMPLATES } from '../catalog';
import { generateWorkoutPrescription } from '../engine';
import { fromWorkoutTemplateDocument, toWorkoutTemplateDocumentBody } from '../templateDocument';
import type { WorkoutTemplateDocument } from '../templateDocument';
import { completeAnswers } from './fixtures';

function success(overrides: Parameters<typeof completeAnswers>[0], adaptationWeek?: number) {
  const result = generateWorkoutPrescription(completeAnswers(overrides), { adaptationWeek });
  expect(result.status).toBe('SUCCESS');
  if (result.status !== 'SUCCESS') throw new Error(result.reasonCodes.join(','));
  return result.plan;
}

describe('Phase 1 outcome quality gates', () => {
  it('QG-01: T004 beginner preserves 5/6/7/7/5 coverage and caps stage-1 sets', () => {
    const base = success({ sex: 'm', place: 'gym', goal: 'gain_muscle', days: 5, level: 'intermediate', duration: '60' });
    const beginner = success({ sex: 'm', place: 'gym', goal: 'gain_muscle', days: 5, level: 'beginner', duration: '60' }, 1);
    expect(base.templateId).toBe('T004');
    expect(base.sessions.map((session) => session.exercises.length)).toEqual([5, 6, 7, 7, 5]);
    expect(beginner.sessions.map((session) => session.exercises.length)).toEqual([5, 6, 7, 7, 5]);
    expect(beginner.sessions.flatMap((session) => session.exercises).every((exercise) => (exercise.sets ?? 0) <= 2)).toBe(true);
    expect(beginner.trace.compositionDecisions.some((decision) => decision.reasonCode === 'BEGINNER_VOLUME_REDUCED')).toBe(true);
  });

  it('QG-03/QG-04: catalog is complete and contextual strength sessions may remain at four exercises', () => {
    expect(catalogInvariantErrors()).toEqual([]);
    expect(WORKOUT_TEMPLATES).toHaveLength(90);
    const inadequateHypertrophy = WORKOUT_TEMPLATES.flatMap((template) => template.sessions.map((session) => ({ template, session })))
      .filter(({ template, session }) =>
        template.profile.primary_goal === 'hypertrophy_body_composition'
        && session.type === 'resistance'
        && session.exercises.length < 5);
    expect(inadequateHypertrophy).toEqual([]);
    const fourExerciseStrength = WORKOUT_TEMPLATES.flatMap((template) => template.sessions.map((session) => ({ template, session })))
      .filter(({ session }) => session.type === 'strength' && session.exercises.length === 4);
    expect(fourExerciseStrength).toHaveLength(16);
  });

  it.each(['30', '45', '60', '90'] as const)('QG-05: beginner duration %s preserves T004 movement coverage', (duration) => {
    const plan = success({ sex: 'm', place: 'gym', goal: 'gain_muscle', days: 5, level: 'beginner', duration }, 1);
    expect(plan.sessions.map((session) => session.exercises.length)).toEqual([5, 6, 7, 7, 5]);
  });

  it('QG-07: display/cardio fields survive template document round-trip', () => {
    const template = getTemplateById('T004');
    if (!template) throw new Error('T004 missing');
    const body = toWorkoutTemplateDocumentBody(template, '2.0.0', 'test-v2');
    const restored = fromWorkoutTemplateDocument({ ...body, contentHash: 'a'.repeat(64) } as WorkoutTemplateDocument);
    expect(restored.sessions.map((session) => session.display_name)).toEqual(template.sessions.map((session) => session.display_name));
    expect(restored.sessions.map((session) => session.cardio_finisher)).toEqual(template.sessions.map((session) => session.cardio_finisher));
  });

  it('QG-08: resistance gets cardio while conditioning/pure cardio do not duplicate it', () => {
    const resistance = success({ sex: 'm', place: 'gym', goal: 'gain_muscle', days: 5, level: 'intermediate' });
    expect(resistance.sessions.every((session) => session.cardioFinisher != null)).toBe(true);
    const conditioning = success({ sex: 'm', place: 'gym', goal: 'conditioning', days: 5, level: 'intermediate' });
    expect(conditioning.sessions.every((session) => session.cardioFinisher == null)).toBe(true);
  });

  it('QG-10: same v2 input is deterministic', () => {
    const answers = { sex: 'f', place: 'gym', goal: 'gain_muscle', days: 4, level: 'beginner' } as const;
    expect(success(answers, 1)).toEqual(success(answers, 1));
  });
});
