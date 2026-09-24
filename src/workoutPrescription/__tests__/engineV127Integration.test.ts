import { describe, expect, it } from 'vitest';

import { generateWorkoutPrescriptionV127 } from '../engineV127';
import { completeAnswers } from './fixtures';

/**
 * Fase 9 §5/§6/§7/§9/§10/§13 — proves the musculoskeletal-limitation and
 * muscle-priority modifiers, the beginner->intermediate promotion, cardio/
 * mobility schema preservation, and the §13 'other' fix all activate
 * correctly through the REAL end-to-end `generateWorkoutPrescriptionV127`
 * pipeline (answers -> selector -> template -> composeTemplateV127), not
 * just the already-covered isolated modifier unit suites.
 */
describe('engineV127 — musculoskeletal limitation end-to-end', () => {
  it('T025 (male/gym/strength/2d) keeps farmers-walk unchanged for an active elbow limitation — the app\'s OWN reviewed limitationProfile rates it "compatible" for elbow, unlike the pre-rewrite v1.27-only avoid list', () => {
    const answers = completeAnswers({
      sex: 'm', goal: 'strength', level: 'intermediate', days: 2, place: 'gym',
      specialConditions: ['musculoskeletal_limitation'], limits: ['elbow'],
    });
    const result = generateWorkoutPrescriptionV127(answers, 'INTERMEDIATE');
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.plan.templateId).toBe('T025');
    const ids = result.plan.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseId));
    // farmers-walk itself is reviewed-compatible with elbow — no substitution
    // decision is even logged for it (see musculoskeletalLimitationV127.ts's
    // "no decision for an unchanged/compatible exercise" contract).
    expect(ids).toContain('farmers-walk');
    const limitationDecisions = result.plan.trace.limitationDecisions as Array<{ exerciseId: string }>;
    expect(limitationDecisions.some((decision) => decision.exerciseId === 'farmers-walk')).toBe(false);
    // Other elbow-incompatible exercises in the same template DO still
    // substitute, resolved through the shared limitation resolver.
    expect(ids).toContain('wall-push-up');
    expect(ids).toContain('resistance-band-row');
    expect(result.plan.trace.limitationDecisions.length).toBeGreaterThan(0);
  });

  it('T009 (male/home/hypertrophy/4d) resolves the former hip collision through the reviewed low-step fallback', () => {
    const answers = completeAnswers({
      sex: 'm', goal: 'gain_muscle', level: 'intermediate', days: 4, place: 'home',
      equipment: ['bodyweight', 'dumbbells', 'bands', 'bench_or_box'],
      specialConditions: ['musculoskeletal_limitation'], limits: ['hip'],
    });
    const result = generateWorkoutPrescriptionV127(answers, 'INTERMEDIATE');
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.plan.trace.limitationDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        exerciseId: 'bench-step-up', outcome: 'SUBSTITUTED', substituteExerciseId: 'low-step-up',
      }),
    ]));
  });

  it('§13: an "other" limitation alone materializes the template unchanged (no INVALID_CONFIGURATION retry loop)', () => {
    const answers = completeAnswers({
      sex: 'm', goal: 'gain_muscle', level: 'intermediate', days: 4, place: 'home',
      equipment: ['bodyweight', 'dumbbells', 'bands', 'bench_or_box'],
      specialConditions: ['musculoskeletal_limitation'], limits: ['other'],
    });
    const result = generateWorkoutPrescriptionV127(answers, 'INTERMEDIATE');
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    const ids = result.plan.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseId));
    expect(ids).toContain('bench-step-up');
  });
});

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
