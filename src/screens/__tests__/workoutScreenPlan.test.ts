import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  canSkipExercise,
  resolveManualSubstitutionPresentation,
  workoutExercisesFromPlan,
} from '../workoutScreenPlan';
import { LEGACY_REST_SECONDS_FALLBACK, REST_SECONDS } from '../../workoutPrescription/restPrescription';
import { generateWorkoutPrescription } from '../../workoutPrescription/engine';
import { getTemplateById } from '../../workoutPrescription/catalog';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import type { FinalWorkoutPlan } from '../../workoutPrescription/types';

function realPlan(): FinalWorkoutPlan {
  const answers = completeAnswers({ days: 4, place: 'gym', sex: 'm', goal: 'gain_muscle', level: 'intermediate' });
  const result = generateWorkoutPrescription(answers);
  if (result.status !== 'SUCCESS') throw new Error(`fixture setup failed: ${result.status}`);
  return result.plan;
}

describe('canSkipExercise', () => {
  it('allows skipping only before the first set and when another exercise remains', () => {
    expect(canSkipExercise(0, 2)).toBe(true);
    expect(canSkipExercise(0, 1)).toBe(false);
    expect(canSkipExercise(1, 2)).toBe(false);
    expect(canSkipExercise(3, 4)).toBe(false);
  });
});

describe('resolveManualSubstitutionPresentation', () => {
  it('keeps the button visible while the context is loading', () => {
    expect(resolveManualSubstitutionPresentation({
      completedSets: 0, contextStatus: 'loading', candidateCount: 0, canRevert: false,
    })).toEqual({ buttonVisible: true, sheetState: 'loading' });
  });

  it('opens the existing options flow when candidates are available', () => {
    expect(resolveManualSubstitutionPresentation({
      completedSets: 0, contextStatus: 'ready', candidateCount: 2, canRevert: false,
    })).toEqual({ buttonVisible: true, sheetState: 'options' });
  });

  it('keeps the button visible and exposes the empty state with zero candidates', () => {
    expect(resolveManualSubstitutionPresentation({
      completedSets: 0, contextStatus: 'ready', candidateCount: 0, canRevert: false,
    })).toEqual({ buttonVisible: true, sheetState: 'empty' });
  });

  it('keeps the button visible and exposes a retryable context error', () => {
    expect(resolveManualSubstitutionPresentation({
      completedSets: 0, contextStatus: 'error', candidateCount: 0, canRevert: false,
    })).toEqual({ buttonVisible: true, sheetState: 'error' });
  });

  it('preserves revert as an available option even with zero replacement candidates', () => {
    expect(resolveManualSubstitutionPresentation({
      completedSets: 0, contextStatus: 'ready', candidateCount: 0, canRevert: true,
    })).toEqual({ buttonVisible: true, sheetState: 'options' });
  });

  it('hides the button after the current exercise has started', () => {
    expect(resolveManualSubstitutionPresentation({
      completedSets: 1, contextStatus: 'ready', candidateCount: 3, canRevert: true,
    })).toEqual({ buttonVisible: false, sheetState: 'unavailable' });
  });

  it('wires button visibility to presentation state, never candidate existence', () => {
    const source = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');
    expect(source).toContain('{substitutionPresentation.buttonVisible && <Pressable');
    expect(source).not.toContain('{(rankedCandidates.length > 0 || canRevert) && <Pressable');
    expect(source).toContain("substitutionPresentation.sheetState === 'loading'");
    expect(source).toContain("substitutionPresentation.sheetState === 'empty'");
    expect(source).toContain("substitutionPresentation.sheetState === 'error'");
    expect(source).toContain('onPress={onRetryManualSubstitutionContext}');
  });
});

describe('workoutExercisesFromPlan — Phase 2, Part D (Rest Timer source of truth)', () => {
  it('(11)(12) the Rest Timer field ("rest") comes directly from the prescription\'s restSeconds — never hardcoded', () => {
    const plan = realPlan();
    const exercises = workoutExercisesFromPlan(plan, 'pt-BR', 0);
    const session = plan.sessions[0];
    expect(exercises.length).toBe(session.exercises.length);
    exercises.forEach((exercise, index) => {
      expect(exercise.rest).toBe(session.exercises[index].restSeconds);
    });
  });

  it('(7) every exercise in a real generated plan gets a defined restSeconds (never undefined at the source)', () => {
    const plan = realPlan();
    for (const session of plan.sessions) {
      for (const exercise of session.exercises) {
        expect(exercise.restSeconds).toBeDefined();
        expect(typeof exercise.restSeconds).toBe('number');
      }
    }
  });

  it('(10)(19) a legacy snapshot missing restSeconds entirely still resolves a usable, non-zero rest value', () => {
    const plan = realPlan();
    const legacyPlan: FinalWorkoutPlan = {
      ...plan,
      sessions: plan.sessions.map((session) => ({
        ...session,
        exercises: session.exercises.map(({ restSeconds: _drop, ...rest }) => rest),
      })),
    };
    const exercises = workoutExercisesFromPlan(legacyPlan, 'pt-BR', 0);
    for (const exercise of exercises) {
      expect(exercise.rest).toBe(LEGACY_REST_SECONDS_FALLBACK);
      expect(exercise.rest).toBeGreaterThan(0);
    }
  });

  it('a deliberate NO_TRADITIONAL_REST (0) prescription is preserved verbatim — never confused with the legacy fallback', () => {
    const plan = realPlan();
    const patched: FinalWorkoutPlan = {
      ...plan,
      sessions: plan.sessions.map((session, sIdx) => (sIdx === 0
        ? {
            ...session,
            exercises: session.exercises.map((exercise, index) => (index === 0
              ? { ...exercise, restSeconds: REST_SECONDS.NO_TRADITIONAL_REST }
              : exercise)),
          }
        : session)),
    };
    const exercises = workoutExercisesFromPlan(patched, 'pt-BR', 0);
    expect(exercises[0].rest).toBe(0);
  });

  it('(19) cold start/resume: recomputing from the same persisted plan (a fresh mount, not cached component state) yields the identical rest prescription every time', () => {
    const plan = realPlan();
    // `workoutExercisesFromPlan` has no internal memory of its own — the
    // ONLY input is `plan` (reloaded from Firestore on every cold
    // start/resume via `loadActiveWorkoutProgram`). Calling it repeatedly,
    // simulating N cold starts against the same snapshot, must never lose
    // or drift the rest prescription.
    const first = workoutExercisesFromPlan(plan, 'pt-BR', 0).map((e) => e.rest);
    const second = workoutExercisesFromPlan(plan, 'pt-BR', 0).map((e) => e.rest);
    const third = workoutExercisesFromPlan(structuredClone(plan), 'pt-BR', 0).map((e) => e.rest);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('sanity: T003 (used across the fixture suite) still resolves and every exercise has a real catalog entry', () => {
    expect(getTemplateById('T003')).toBeDefined();
    const plan = realPlan();
    expect(() => workoutExercisesFromPlan(plan, 'en', 0)).not.toThrow();
  });

  it('uses effective exercise metadata but retains prescribed sets/reps/rest and explicit slot identities', () => {
    const plan = realPlan();
    plan.sessions[0].exercises[0] = {
      exerciseId: 'barbell-back-squat',
      sourceExerciseId: 'barbell-back-squat',
      sets: 4,
      reps: '6-8',
      restSeconds: 123,
    };
    const exercises = workoutExercisesFromPlan(plan, 'pt-BR', 0, new Map([[0, 'goblet-squat']]));
    expect(exercises[0]).toMatchObject({
      id: 'goblet-squat',
      db: 'goblet-squat',
      name: 'Agachamento Goblet',
      prescribedExerciseId: 'barbell-back-squat',
      effectiveExerciseId: 'goblet-squat',
      rest: 123,
    });
    expect(exercises[0].sets).toHaveLength(4);
    expect(exercises[0].sets[0].r).toBe('6-8');
  });
});
