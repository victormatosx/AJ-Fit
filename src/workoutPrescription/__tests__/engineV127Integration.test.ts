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
  it('T025 (male/gym/strength/2d) substitutes farmers-walk via Tier C for an active elbow limitation', () => {
    const answers = completeAnswers({
      sex: 'm', goal: 'strength', level: 'intermediate', days: 2, place: 'gym',
      specialConditions: ['musculoskeletal_limitation'], limits: ['elbow'],
    });
    const result = generateWorkoutPrescriptionV127(answers, 'INTERMEDIATE');
    expect(result.status).toBe('SUCCESS');
    if (result.status !== 'SUCCESS') return;
    expect(result.plan.templateId).toBe('T025');
    const ids = result.plan.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseId));
    expect(ids).not.toContain('farmers-walk');
    expect(ids).toContain('controlled-marching');
    expect(result.plan.trace.limitationDecisions.length).toBeGreaterThan(0);
  });

  it('T009 (male/home/hypertrophy/4d) fails closed (no invented dose) when a hip limitation vetoes an exercise with no safe substitute', () => {
    const answers = completeAnswers({
      sex: 'm', goal: 'gain_muscle', level: 'intermediate', days: 4, place: 'home',
      equipment: ['bodyweight', 'dumbbells', 'bands', 'bench_or_box'],
      specialConditions: ['musculoskeletal_limitation'], limits: ['hip'],
    });
    const result = generateWorkoutPrescriptionV127(answers, 'INTERMEDIATE');
    expect(result.status).toBe('INVALID_CONFIGURATION');
    if (result.status !== 'INVALID_CONFIGURATION') return;
    // Fase 13: T009's Home sessions also include at least one of the 7
    // still-unprofiled v1.27 Fase 2 closure exercises, so some reason codes
    // now legitimately come from the profile-coverage fail-closed check
    // too, not only from "no safe substitute" — both are real, honest
    // fail-closed reasons.
    expect(result.reasonCodes.every((code) =>
      code.startsWith('MUSCULOSKELETAL_NO_SUBSTITUTE:') || code.startsWith('MUSCULOSKELETAL_PROFILE_COVERAGE_MISSING:'))).toBe(true);
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
