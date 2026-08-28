import { describe, expect, it } from 'vitest';
import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { getTemplateById, WORKOUT_TEMPLATES } from '../catalog';
import { generateWorkoutPrescription } from '../engine';
import { limitationReadinessFailure } from '../generationPolicy';
import { resolveModifiers } from '../modifiers';
import { evaluateSafety } from '../safety';
import { selectTemplate } from '../selection';
import { completeAnswers } from './fixtures';

describe('prescription pipeline and invariants', () => {
  it('marks the former DR-006 blanket gate as resolved', () => {
    expect(limitationReadinessFailure(completeAnswers({
      specialConditions: ['musculoskeletal_limitation'],
      limits: ['knee'],
    }))).toBeNull();
  });

  it('composes from the explicit runtime template without mutating the canonical fixture', () => {
    const answers = completeAnswers({ days: 4 });
    const selected = selectTemplate(answers);
    expect(selected.status).toBe('SELECTED');
    if (selected.status !== 'SELECTED') return;
    const original = getTemplateById(selected.decision.templateId);
    expect(original).toBeDefined();
    if (!original) return;
    const runtime = structuredClone(original);
    runtime.sessions[0].exercises[0].sets = 99;
    const generated = generateWorkoutPrescription(answers, { template: runtime });
    expect(generated.status).toBe('SUCCESS');
    if (generated.status === 'SUCCESS') expect(generated.plan.sessions[0].exercises[0].sets).toBe(99);
    expect(original.sessions[0].exercises[0].sets).not.toBe(99);
  });

  it('produces the same versioned snapshot for the same input', () => {
    const answers = completeAnswers();
    const first = generateWorkoutPrescription(answers);
    const second = generateWorkoutPrescription(answers);
    expect(first).toEqual(second);
    expect(first).toEqual(expect.objectContaining({ status: 'SUCCESS' }));
    if (first.status === 'SUCCESS') {
      expect(first.plan.templateId).toBe('T003');
      expect(first.plan.planId).toMatch(/^wp_[0-9a-f]{8}$/);
      expect(first.plan.versions.templateLibrary).toBe('2.0.0');
      expect(first.plan.versions.modifierRules).toBe('2.0.0');
      expect(first.plan.versions.compositionEngine).toBe('2.1.0');
      expect(first.plan.versions.limitationResolver).toBe('1.0.0');
      expect(first.plan.trace.limitationResolverVersion).toBe(1);
    }
  });

  it('never generates on requires-clearance or blocked outcomes', () => {
    const clearance = generateWorkoutPrescription(completeAnswers({
      specialConditions: ['dizziness_or_vertigo'],
      dizzinessScreening: { symptomFrequency: 'frequent', affectsBalance: 'no' },
    }));
    const blocked = generateWorkoutPrescription(completeAnswers({
      sex: 'f', specialConditions: ['pregnancy'],
      pregnancyScreening: { weeks: 20, prenatalCare: 'yes', exerciseRestriction: 'no', complication: 'no', warningSigns: ['chest_pain'] },
    }));
    expect(clearance.status).toBe('REQUIRES_CLEARANCE');
    expect(blocked.status).toBe('BLOCKED');
    expect('plan' in clearance).toBe(false);
    expect('plan' in blocked).toBe(false);
  });

  it('distinguishes incomplete legacy data from safety clearance', () => {
    expect(generateWorkoutPrescription(completeAnswers({ goal: 'perf' })).status).toBe('NEEDS_QUESTIONNAIRE_UPDATE');
    expect(generateWorkoutPrescription(completeAnswers({ duration: null })).status).toBe('NEEDS_QUESTIONNAIRE_UPDATE');
  });

  it('generates the simplified beginner + 30 minute plan', () => {
    const result = generateWorkoutPrescription(completeAnswers({ level: 'beginner', duration: '30' }));
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      expect(result.plan.sessions.map((session) => session.exercises.length)).toEqual([7, 6, 7, 6]);
      expect(result.plan.sessions.flatMap((session) => session.exercises).every((exercise) => (exercise.sets ?? 0) <= 2)).toBe(true);
      expect(result.plan.trace.unresolvedModifiers).toEqual([]);
    }
  });

  it('resolves all requested modifier domains in deterministic priority order', () => {
    const answers = completeAnswers({
      level: 'advanced', goal: 'return_to_training', duration: '30', muscleFocus: ['glutes', 'chest'],
    });
    const modifiers = resolveModifiers(answers, evaluateSafety(answers));
    expect(modifiers.map((value) => value.id)).toEqual([
      'goal:return_to_training', 'experience:advanced', 'duration:30',
      'muscle_priority:glutes', 'muscle_priority:chest',
    ]);
    expect(modifiers.every((value) => value.application !== 'RULE_DEFINITION_REQUIRED')).toBe(true);
  });

  it.each([
    ['never_or_starting', 'experience:never_or_starting'],
    ['beginner', 'experience:beginner'],
    ['intermediate', 'experience:intermediate'],
    ['advanced', 'experience:advanced'],
  ] as const)('resolves experience %s', (level, id) => {
    const answers = completeAnswers({ level });
    expect(resolveModifiers(answers, evaluateSafety(answers)).map((value) => value.id)).toContain(id);
  });

  it.each(['30', '45', '60', '90'] as const)('resolves duration %s', (duration) => {
    const answers = completeAnswers({ duration });
    expect(resolveModifiers(answers, evaluateSafety(answers)).map((value) => value.id)).toContain(`duration:${duration}`);
  });

  it.each(['lose_fat', 'body_composition', 'return_to_training'] as const)('resolves goal modifier %s', (goal) => {
    const answers = completeAnswers({ goal });
    expect(resolveModifiers(answers, evaluateSafety(answers)).map((value) => value.id)).toContain(`goal:${goal}`);
  });

  it('applies deterministic real-catalog equipment substitutions', () => {
    const result = generateWorkoutPrescription(completeAnswers({
      place: 'home', days: 3, equipment: ['dumbbells', 'bands', 'bench_or_box'],
    }));
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      expect(result.plan.trace.substitutions).toEqual([]);
      const allowed = new Set(['bodyweight', 'dumbbell', 'resistance_band', 'mini_band', 'bench', 'chair', 'step']);
      const catalog = new Map(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));
      for (const exercise of result.plan.sessions.flatMap((session) => session.exercises)) {
        expect(catalog.get(exercise.exerciseId)?.equipment.every((item) => allowed.has(item))).toBe(true);
      }
    }
  });

  it('fails explicitly when bodyweight-only has no documented safe substitute', () => {
    const result = generateWorkoutPrescription(completeAnswers({
      place: 'home', days: 2, equipment: ['bodyweight'],
    }));
    expect(result).toEqual(expect.objectContaining({
      status: 'INVALID_CONFIGURATION',
      reasonCodes: expect.arrayContaining([expect.stringContaining('NO_SAFE_EQUIPMENT_SUBSTITUTE')]),
    }));
  });

  it('all 2,116 canonical final references resolve to the real seeded exercise catalog', () => {
    const ids = new Set(EXERCISES_SEED.map((exercise) => exercise.id));
    const references = WORKOUT_TEMPLATES.flatMap((template) =>
      template.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exercise_id)),
    );
    expect(references).toHaveLength(2116);
    expect(references.filter((id) => !ids.has(id))).toEqual([]);
  });

  it('has no template outside T001-T090 and special templates never exceed four sessions', () => {
    expect(WORKOUT_TEMPLATES.every((template) => /^T(?:00[1-9]|0[1-8][0-9]|090)$/.test(template.id))).toBe(true);
    expect(WORKOUT_TEMPLATES.filter((template) => template.profile.special_population).every((template) => template.sessions.length <= 4)).toBe(true);
  });
});
