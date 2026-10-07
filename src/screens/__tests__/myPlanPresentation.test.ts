import { describe, expect, it } from 'vitest';
import { buildAdaptationFlags, buildMyPlanEffectiveSessions, buildWeekView, currentPlanAvailableDays, hasAnyAdaptation } from '../myPlanPresentation';
import { generateWorkoutPrescription } from '../../workoutPrescription/engine';
import { completeAnswers } from '../../workoutPrescription/__tests__/fixtures';
import type { FinalWorkoutPlan, PrescriptionTrace } from '../../workoutPrescription/types';
import type { ScheduleResolution } from '../../scheduleEngine/types';
import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import type { LimitationCatalogExercise } from '../../workoutPrescription/limitationResolver';
import { equipmentContextFor } from '../../workoutPrescription/equipment';
import { resolvePermanentSubstitutionsForSession } from '../../workoutPrescription/manualSubstitutionResolver';
import type { ManualSubstitutionUserContext } from '../../services/exerciseSubstitutionCandidates';

const emptyTrace: PrescriptionTrace = {
  selectionReasons: [],
  safety: { status: 'CLEAR', reasons: [], requiredModifierIds: [], protectedConstraints: [] },
  appliedModifiers: [],
  unresolvedModifiers: [],
  conflicts: [],
  substitutions: [],
  limitationResolverVersion: 1,
  limitationDecisions: [],
  compositionDecisions: [],
  validationCodes: [],
};

const catalog = new Map<string, LimitationCatalogExercise>(
  EXERCISES_SEED.map((exercise) => [exercise.id, exercise]),
);
const gymContext: ManualSubstitutionUserContext = {
  regions: [],
  equipmentContext: equipmentContextFor(completeAnswers({ place: 'gym' }), 'gym'),
};

function planWithExercises(exerciseIds: readonly string[]): FinalWorkoutPlan {
  const result = generateWorkoutPrescription(completeAnswers({ place: 'gym' }));
  if (result.status !== 'SUCCESS') throw new Error(`fixture setup failed: ${result.status}`);
  return {
    ...result.plan,
    sessions: [{
      ...result.plan.sessions[0],
      exercises: exerciseIds.map((exerciseId) => ({
        exerciseId,
        sourceExerciseId: exerciseId,
        sets: 3,
        reps: '8-12',
        restSeconds: 90,
      })),
    }],
  };
}

function effectiveIds(
  plan: FinalWorkoutPlan,
  preferences: ReadonlyMap<string, string>,
  options: {
    userContext?: typeof gymContext | null;
    localCatalog?: ReadonlyMap<string, LimitationCatalogExercise>;
  } = {},
): string[] {
  return buildMyPlanEffectiveSessions({
    plan,
    preferences,
    userContext: options.userContext === undefined ? gymContext : options.userContext,
    catalog: options.localCatalog ?? catalog,
  })[0].exercises.map((exercise) => exercise.effectiveExerciseId);
}

describe('Meu Plano — disponibilidade atual após ADAPT', () => {
  it('5x → 4x shows 4, then 4x → 5x shows 5 without rewriting the historical questionnaire', () => {
    const historicalOnboardingDays = 5;
    const adaptedFour = { requestedDays: 4, prescribedTrainingFrequency: 4, prescribedStructuredDays: 4 };
    const adaptedFive = { requestedDays: 5, prescribedTrainingFrequency: 5, prescribedStructuredDays: 5 };
    expect(currentPlanAvailableDays(adaptedFour, historicalOnboardingDays)).toBe(4);
    expect(currentPlanAvailableDays(adaptedFive, historicalOnboardingDays)).toBe(5);
    expect(historicalOnboardingDays).toBe(5);
  });

  it('uses the active prescription frequency when a legacy plan lacks requestedDays', () => {
    expect(currentPlanAvailableDays({ prescribedTrainingFrequency: 4, prescribedStructuredDays: 4 }, 5)).toBe(4);
  });
});

describe('buildMyPlanEffectiveSessions — permanent substitution effective view', () => {
  it('shows the prescribed exercise when no permanent preference exists', () => {
    expect(effectiveIds(planWithExercises(['barbell-back-squat']), new Map()))
      .toEqual(['barbell-back-squat']);
  });

  it('shows a valid permanent A -> B preference while retaining both identities', () => {
    const view = buildMyPlanEffectiveSessions({
      plan: planWithExercises(['barbell-back-squat']),
      preferences: new Map([['barbell-back-squat', 'goblet-squat']]),
      userContext: gymContext,
      catalog,
    });
    expect(view[0].exercises[0]).toEqual({
      prescribedExerciseId: 'barbell-back-squat',
      effectiveExerciseId: 'goblet-squat',
    });
  });

  it('cannot leak a SESSION-only execution substitution because executions are not an input', () => {
    const activeExecution = { prescribedExerciseId: 'barbell-back-squat', exerciseId: 'goblet-squat', scope: 'SESSION' };
    expect(activeExecution.exerciseId).toBe('goblet-squat');
    expect(effectiveIds(planWithExercises(['barbell-back-squat']), new Map()))
      .toEqual(['barbell-back-squat']);
  });

  it('falls back to A when B is invalid for a declared limitation', () => {
    const invalid = { ...catalog.get('goblet-squat')!, limitationProfile: undefined };
    const localCatalog = new Map(catalog);
    localCatalog.set(invalid.id, invalid);
    expect(effectiveIds(
      planWithExercises(['barbell-back-squat']),
      new Map([['barbell-back-squat', 'goblet-squat']]),
      { userContext: { ...gymContext, regions: ['knee'] }, localCatalog },
    )).toEqual(['barbell-back-squat']);
  });

  it('falls back to A when B needs unavailable equipment', () => {
    const homeContext = {
      regions: [],
      equipmentContext: equipmentContextFor(
        completeAnswers({ place: 'home', equipment: ['bodyweight'] }),
        'home',
      ),
    };
    expect(effectiveIds(
      planWithExercises(['barbell-back-squat']),
      new Map([['barbell-back-squat', 'hack-squat-machine-variation']]),
      { userContext: homeContext },
    )).toEqual(['barbell-back-squat']);
  });

  it('falls back to A when B is unavailable for substitution', () => {
    const disabled = {
      ...catalog.get('goblet-squat')!,
      availability: { workoutGeneration: true, manualSelection: true, substitution: false },
    };
    const localCatalog = new Map(catalog);
    localCatalog.set(disabled.id, disabled);
    expect(effectiveIds(
      planWithExercises(['barbell-back-squat']),
      new Map([['barbell-back-squat', 'goblet-squat']]),
      { localCatalog },
    )).toEqual(['barbell-back-squat']);
  });

  it('resolves A -> X / B -> X by slot order and never displays X/X', () => {
    expect(effectiveIds(
      planWithExercises(['barbell-back-squat', 'hack-squat-machine-variation']),
      new Map([
        ['barbell-back-squat', 'goblet-squat'],
        ['hack-squat-machine-variation', 'goblet-squat'],
      ]),
    )).toEqual(['goblet-squat', 'hack-squat-machine-variation']);
  });

  it('is deterministic and exactly agrees with the new-execution resolver', () => {
    const plan = planWithExercises(['barbell-back-squat', 'hack-squat-machine-variation']);
    const preferences = new Map([
      ['barbell-back-squat', 'goblet-squat'],
      ['hack-squat-machine-variation', 'goblet-squat'],
    ]);
    const first = buildMyPlanEffectiveSessions({ plan, preferences, userContext: gymContext, catalog });
    const second = buildMyPlanEffectiveSessions({ plan, preferences, userContext: gymContext, catalog });
    expect(first[0].exercises).toEqual(second[0].exercises);

    const executionResolution = resolvePermanentSubstitutionsForSession({
      sessionExerciseIds: plan.sessions[0].exercises.map((exercise) => exercise.exerciseId),
      preferences,
      catalog,
      regions: gymContext.regions,
      equipmentContext: gymContext.equipmentContext,
    });
    expect(first[0].effectiveExerciseIds).toEqual(executionResolution);
  });

  it('returns from B to A when the preference disappears', () => {
    const plan = planWithExercises(['barbell-back-squat']);
    expect(effectiveIds(plan, new Map([['barbell-back-squat', 'goblet-squat']])))
      .toEqual(['goblet-squat']);
    expect(effectiveIds(plan, new Map())).toEqual(['barbell-back-squat']);
  });

  it('fails open to the prescription when user context cannot be loaded', () => {
    expect(effectiveIds(
      planWithExercises(['barbell-back-squat']),
      new Map([['barbell-back-squat', 'goblet-squat']]),
      { userContext: null },
    )).toEqual(['barbell-back-squat']);
  });

  it('does not mutate the canonical FinalWorkoutPlan, including exerciseId/sourceExerciseId', () => {
    const plan = planWithExercises(['barbell-back-squat']);
    const before = structuredClone(plan);
    buildMyPlanEffectiveSessions({
      plan,
      preferences: new Map([['barbell-back-squat', 'goblet-squat']]),
      userContext: gymContext,
      catalog,
    });
    expect(plan).toEqual(before);
  });
});

describe('buildWeekView', () => {
  it('marks only the configured weekdays as training days, in Monday-first order', () => {
    const week = buildWeekView(['MON', 'WED', 'FRI'], 'MON', { status: 'REST_DAY', nextWorkoutDate: '2026-08-05', nextSessionIndex: 1 });
    expect(week.map((d) => d.weekday)).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
    expect(week.filter((d) => d.isTrainingDay).map((d) => d.weekday)).toEqual(['MON', 'WED', 'FRI']);
  });

  it('flags exactly one day as today', () => {
    const week = buildWeekView(['MON', 'WED', 'FRI'], 'WED', { status: 'REST_DAY', nextWorkoutDate: '2026-08-07', nextSessionIndex: 2 });
    expect(week.filter((d) => d.isToday)).toHaveLength(1);
    expect(week.find((d) => d.isToday)?.weekday).toBe('WED');
  });

  it('only attaches a due session to TODAY, and only when the Schedule Engine resolved SESSION_READY', () => {
    const resolution: ScheduleResolution = { status: 'SESSION_READY', sessionIndex: 2 };
    const week = buildWeekView(['MON', 'WED', 'FRI'], 'WED', resolution);
    for (const day of week) {
      if (day.isToday) expect(day.dueSessionIndex).toBe(2);
      else expect(day.dueSessionIndex).toBeNull();
    }
  });

  it('never guesses a due session for a non-SESSION_READY resolution, even today', () => {
    const week = buildWeekView(['MON'], 'MON', { status: 'SCHEDULE_SETUP_REQUIRED' });
    expect(week.every((d) => d.dueSessionIndex === null)).toBe(true);
  });
});

describe('buildAdaptationFlags', () => {
  it('reports no adaptation when the trace has no evidence at all', () => {
    const flags = buildAdaptationFlags(emptyTrace);
    expect(flags).toEqual({ equipment: false, limitations: false, experience: false, duration: false });
    expect(hasAnyAdaptation(flags)).toBe(false);
  });

  it('flags equipment only when a real substitution exists', () => {
    const trace: PrescriptionTrace = {
      ...emptyTrace,
      substitutions: [{ sessionIndex: 0, fromExerciseId: 'a', toExerciseId: 'b', reasonCode: 'EQUIPMENT_UNAVAILABLE' }],
    };
    expect(buildAdaptationFlags(trace).equipment).toBe(true);
  });

  it('flags experience only for beginner-driven composition decisions, not duration-driven ones', () => {
    const trace: PrescriptionTrace = {
      ...emptyTrace,
      compositionDecisions: [{ reasonCode: 'BEGINNER_VOLUME_REDUCED', sessionIndex: 0 }],
    };
    const flags = buildAdaptationFlags(trace);
    expect(flags.experience).toBe(true);
    expect(flags.duration).toBe(false);
  });

  it('a real generated plan\'s own trace shape is accepted without throwing', () => {
    const answers = completeAnswers({ days: 4, place: 'gym', sex: 'm', goal: 'gain_muscle', level: 'intermediate' });
    const result = generateWorkoutPrescription(answers);
    if (result.status !== 'SUCCESS') throw new Error(`fixture setup failed: ${result.status}`);
    expect(() => buildAdaptationFlags(result.plan.trace)).not.toThrow();
  });
});
