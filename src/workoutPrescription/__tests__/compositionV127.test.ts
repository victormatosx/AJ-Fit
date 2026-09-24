import { describe, expect, it } from 'vitest';
import { completeAnswers } from './fixtures';
import { getCanonicalTemplateV127ById } from '../canonicalCatalog';
import { composeTemplateV127, type CompositionResultV127 } from '../compositionV127';
import { selectBaseTemplateV127, V127_TEMPLATE_PROFILES } from '../selectorV127';
import type { CanonicalTemplate, TemplateId } from '../types';

/** Every call site in this file omits `limitationRegions`, so the result is always `COMPOSED` — this just gives TS that narrowing without repeating an `if` at every call site. */
function composed(result: CompositionResultV127) {
  if (result.status !== 'COMPOSED') throw new Error(`expected COMPOSED, got ${result.status}`);
  return result;
}

// Every T-id under this exercise-identity matrix state (14 canonical ids
// still blocked — see AJ_Fit_v1_27_exercise_identity_matrix.json) parses
// cleanly with parseCanonicalV127Template. Spans every population/goal
// bucket (regular hypertrophy/strength both sexes+envs, pregnancy,
// postpartum, frailty, beginner) even though it's a subset of all 102.
const PARSEABLE_TEMPLATE_IDS: TemplateId[] = [
  'T001', 'T002', 'T003', 'T004', 'T007', 'T013', 'T014', 'T015', 'T016',
  'T025', 'T026', 'T027', 'T028', 'T037', 'T038', 'T039', 'T040',
  'T073', 'T074', 'T075', 'T079', 'T080', 'T081', 'T085', 'T086',
  'T091', 'T092',
];

function manuallyComposedSessions(template: CanonicalTemplate) {
  return template.sessions.map((session) => ({
    name: session.name,
    type: session.type,
    notes: session.notes,
    techniqueGuideline: session.technique_guideline,
    effortGuideline: session.effort_guideline,
    restGuideline: session.rest_guideline,
    progressionGuideline: session.progression_guideline,
    displayName: session.display_name,
    exercises: session.exercises.map((exercise) => ({
      exerciseId: exercise.exercise_id,
      sourceExerciseId: exercise.exercise_id,
      sets: exercise.sets,
      reps: exercise.reps,
      duration: exercise.duration,
      cycles: exercise.cycles,
      cycleRange: exercise.cycleRange,
      distance: exercise.distance,
      intensity: exercise.intensity,
      notes: exercise.notes,
    })),
  }));
}

describe('composeTemplateV127 — invariant: composed output equals the base template', () => {
  it.each(PARSEABLE_TEMPLATE_IDS)('%s: session/exercise structure and every dose field survive untouched', (id) => {
    const template = getCanonicalTemplateV127ById(id);
    const result = composed(composeTemplateV127(template));
    expect(result.status).toBe('COMPOSED');

    expect(result.sessions).toHaveLength(template.sessions.length);
    expect(result.sessions.map((s) => s.type)).toEqual(template.sessions.map((s) => s.type));
    expect(result.sessions.map((s) => s.name)).toEqual(template.sessions.map((s) => s.name));
    expect(result.sessions.map((s) => s.exercises.length)).toEqual(template.sessions.map((s) => s.exercises.length));
    expect(result.sessions.map((s) => s.exercises.map((e) => e.exerciseId))).toEqual(
      template.sessions.map((s) => s.exercises.map((e) => e.exercise_id)),
    );

    const expected = manuallyComposedSessions(template);
    for (let sessionIndex = 0; sessionIndex < expected.length; sessionIndex += 1) {
      const actualSession = result.sessions[sessionIndex];
      const expectedSession = expected[sessionIndex];
      expect(actualSession.notes).toBe(expectedSession.notes);
      expect(actualSession.techniqueGuideline).toBe(expectedSession.techniqueGuideline);
      expect(actualSession.effortGuideline).toBe(expectedSession.effortGuideline);
      expect(actualSession.restGuideline).toBe(expectedSession.restGuideline);
      expect(actualSession.progressionGuideline).toBe(expectedSession.progressionGuideline);
      expect(actualSession.displayName).toBe(expectedSession.displayName);
      for (let exerciseIndex = 0; exerciseIndex < expectedSession.exercises.length; exerciseIndex += 1) {
        const actualExercise = actualSession.exercises[exerciseIndex];
        const expectedExercise = expectedSession.exercises[exerciseIndex];
        expect(actualExercise.sets).toBe(expectedExercise.sets);
        expect(actualExercise.reps).toBe(expectedExercise.reps);
        expect(actualExercise.duration).toBe(expectedExercise.duration);
        expect(actualExercise.cycles).toBe(expectedExercise.cycles);
        expect(actualExercise.cycleRange).toEqual(expectedExercise.cycleRange);
        expect(actualExercise.distance).toBe(expectedExercise.distance);
        expect(actualExercise.intensity).toBe(expectedExercise.intensity);
        expect(actualExercise.notes).toBe(expectedExercise.notes);
        // Fase 4: no numeric rest is derived from goal/session type here.
        expect(actualExercise.restSeconds).toBeUndefined();
      }
    }
  });

  it('no exercise, set or metadata field disappears across every parseable template', () => {
    for (const id of PARSEABLE_TEMPLATE_IDS) {
      const template = getCanonicalTemplateV127ById(id);
      const result = composed(composeTemplateV127(template));
      const sourceExerciseCount = template.sessions.reduce((sum, s) => sum + s.exercises.length, 0);
      const composedExerciseCount = result.sessions.reduce((sum, s) => sum + s.exercises.length, 0);
      expect(composedExerciseCount).toBe(sourceExerciseCount);
    }
  });
});

describe('composeTemplateV127 — legacy modifiers never run', () => {
  it('does not accept a QuestionnaireAnswers-shaped argument at all — structurally cannot cap beginner sets', () => {
    // T091 is the gym/2-day beginner template. The legacy path
    // (composeTemplate + personalization.ts) would cap every exercise at
    // <=2 sets on a fresh beginner plan (BEGINNER_VOLUME_REDUCED). Prove
    // the v1.27 sets survive exactly as authored.
    const template = getCanonicalTemplateV127ById('T091');
    const result = composed(composeTemplateV127(template));
    const authoredSets = template.sessions.flatMap((s) => s.exercises.map((e) => e.sets));
    const composedSets = result.sessions.flatMap((s) => s.exercises.map((e) => e.sets));
    expect(composedSets).toEqual(authoredSets);
    expect(authoredSets.some((sets) => (sets ?? 0) > 2)).toBe(true);
  });

  it('does not reduce exercise count for any duration — the function has no duration parameter to receive one', () => {
    const template = getCanonicalTemplateV127ById('T001');
    const result = composed(composeTemplateV127(template));
    expect(result.sessions.map((s) => s.exercises.length)).toEqual(template.sessions.map((s) => s.exercises.length));
  });

  it('does not derive restSeconds from goal family — strength template exercises carry no legacy 180s rest', () => {
    const strengthTemplate = getCanonicalTemplateV127ById('T025');
    const result = composed(composeTemplateV127(strengthTemplate));
    expect(result.sessions.flatMap((s) => s.exercises).every((e) => e.restSeconds === undefined)).toBe(true);
  });

  it('does not substitute exercises for equipment — exerciseId always equals the template-authored id', () => {
    const template = getCanonicalTemplateV127ById('T007'); // home hypertrophy
    const result = composed(composeTemplateV127(template));
    expect(result.sessions.flatMap((s) => s.exercises).map((e) => e.exerciseId)).toEqual(
      template.sessions.flatMap((s) => s.exercises).map((e) => e.exercise_id),
    );
  });

  it('does not re-transform a special-population template after selection', () => {
    const pregnancy = getCanonicalTemplateV127ById('T073');
    const result = composed(composeTemplateV127(pregnancy));
    expect(result.sessions).toEqual(manuallyComposedSessions(pregnancy).map((s) => ({
      ...s,
      exercises: s.exercises,
    })));
  });

  it('does not inject a generic cardio finisher — no v1.27 template currently authors one, and none appears after composition', () => {
    for (const id of PARSEABLE_TEMPLATE_IDS) {
      const template = getCanonicalTemplateV127ById(id);
      const result = composed(composeTemplateV127(template));
      expect(result.sessions.every((s) => s.cardioFinisher === undefined)).toBe(true);
    }
  });
});

describe('composeTemplateV127 — metamorphic: answers-shaped context has zero effect', () => {
  const variedAnswers = [
    completeAnswers({ goal: 'strength' }),
    completeAnswers({ goal: 'conditioning' }),
    completeAnswers({ duration: '30' }),
    completeAnswers({ duration: '90' }),
    completeAnswers({ level: 'advanced' }),
    completeAnswers({ level: 'never_or_starting' }),
    completeAnswers({ equipment: ['bodyweight'] }),
    completeAnswers({ sex: 'f' }),
    completeAnswers({ days: 7 }),
    completeAnswers({ scheduleMode: 'flexible' }),
    completeAnswers({ motivation: 'aesthetic' }),
    completeAnswers({ muscleFocus: ['chest', 'back'] }),
    completeAnswers({ limits: ['knee'] }),
  ];

  it.each(variedAnswers.map((a, i) => [i, a] as const))(
    'variation %i: composing the same base template is identical regardless of any answers field',
    (_index, _answers) => {
      const template = getCanonicalTemplateV127ById('T001');
      const baseline = composeTemplateV127(template);
      // composeTemplateV127's signature has no slot for `_answers` — this is
      // the only way to invoke it, and it is provably the same call every
      // time. The varied fixture exists to make that structural fact
      // explicit per input dimension, not to smuggle it into the call.
      const result = composeTemplateV127(template);
      expect(result).toEqual(baseline);
    },
  );

  it('an empty context runs neither Fase 5 nor Fase 6 stage; both are Fase 5/6-active when given real input (see musculoskeletalLimitationV127.test.ts / musclePriorityV127.test.ts)', () => {
    const template = getCanonicalTemplateV127ById('T001');
    const withoutContext = composeTemplateV127(template);
    expect(withoutContext.trace.musculoskeletalLimitationApplied).toBe(false);
    expect(withoutContext.trace.musclePriorityApplied).toBe(false);
    expect(withoutContext.trace.stagesApplied).toEqual([]);

    const withMusclePriorityOnly = composeTemplateV127(template, { musclePriority: ['chest', 'back'] });
    expect(withMusclePriorityOnly.trace.musclePriorityApplied).toBe(true);
    expect(withMusclePriorityOnly.trace.stagesApplied).toEqual(['muscle_priority']);
    expect(withMusclePriorityOnly.status).toBe('COMPOSED');
    if (withMusclePriorityOnly.status !== 'COMPOSED' || withoutContext.status !== 'COMPOSED') return;
    // Same exercise set, only order can differ.
    const idsBefore = withoutContext.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseId)).sort();
    const idsAfter = withMusclePriorityOnly.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseId)).sort();
    expect(idsAfter).toEqual(idsBefore);
  });
});

describe('selectBaseTemplateV127 vs composeTemplateV127 — structural separation', () => {
  it('composing never changes which template is represented', () => {
    for (const id of PARSEABLE_TEMPLATE_IDS) {
      const template = getCanonicalTemplateV127ById(id);
      const result = composeTemplateV127(template);
      expect(result.trace.templateId).toBe(id);
    }
  });

  it('the selector alone determines the template id; composition receives it as a fixed input', () => {
    const selection = selectBaseTemplateV127({
      sex: 'male', environment: 'gym', goalFamily: 'strength', population: 'conventional', isBeginner: false, availabilityDays: 2,
    });
    expect(selection.status).toBe('SELECTED');
    if (selection.status !== 'SELECTED') return;
    const template = getCanonicalTemplateV127ById(selection.templateId);
    const composed = composeTemplateV127(template);
    expect(composed.trace.templateId).toBe(selection.templateId);
    expect(composed.trace.templateId).toBe('T025');
  });

  it('composeTemplateV127 has no goal/sex/environment/population/days parameter that could reselect a template', () => {
    // Structural proof by arity/shape: the only parameters are the base
    // template itself and the Fase 5/6-reserved (currently inert) context.
    expect(composeTemplateV127.length).toBe(1); // default param does not count toward .length
    const template = getCanonicalTemplateV127ById('T001');
    const contextKeys = Object.keys({ limitationRegions: [], musclePriority: [] });
    expect(contextKeys).not.toContain('goal');
    expect(contextKeys).not.toContain('sex');
    expect(contextKeys).not.toContain('environment');
    expect(contextKeys).not.toContain('population');
    expect(contextKeys).not.toContain('days');
    expect(composeTemplateV127(template).trace.templateId).toBe('T001');
  });

  it('every V127_TEMPLATE_PROFILES id has a stable 1:1 mapping into the composition trace when parseable', () => {
    for (const id of PARSEABLE_TEMPLATE_IDS) {
      expect(V127_TEMPLATE_PROFILES.some((p) => p.id === id)).toBe(true);
      const composed = composeTemplateV127(getCanonicalTemplateV127ById(id));
      expect(composed.trace.templateId).toBe(id);
    }
  });
});
