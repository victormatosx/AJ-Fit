import { normalizeMusclePriorityInputV127,type MusclePriorityTargetV127 } from './canonicalMusclePriorityV127';
import { applyMusclePriorityV127,type MusclePriorityDecisionV127 } from './musclePriorityV127';
import type { CanonicalTemplate,FinalCardioFinisher,FinalWorkoutExercise,FinalWorkoutSession } from './types';

export interface CompositionContextV127 {
  musclePriority?: readonly string[];
}

export interface CompositionTraceV127 {
  templateId: CanonicalTemplate['id'];
  stagesApplied: 'muscle_priority'[];
  musclePriorityApplied: boolean;
  musclePriorityDecisions: MusclePriorityDecisionV127[];
}

export type CompositionResultV127 =
  | { status: 'COMPOSED'; sessions: FinalWorkoutSession[]; trace: CompositionTraceV127 };
function toFinalCardioFinisher(source: NonNullable<CanonicalTemplate['sessions'][number]['cardio_finisher']>): FinalCardioFinisher | undefined {
  // `mode: 'integrated'` cardio is already embedded in the session's own
  // exercises by the template author — there is nothing separate to carry.
  // Every other mode requires exerciseOptions/duration/intensity by the
  // v2.0 schema contract (`CanonicalCardioFinisher`); no v1.27 template
  // currently authors a non-integrated finisher, but this stays a faithful,
  // non-lossy passthrough rather than a silent drop if one ever does.
  if (source.mode === 'integrated' || !source.exercise_options?.length || !source.duration || !source.intensity) {
    return undefined;
  }
  return {
    mode: source.mode,
    exerciseOptions: [...source.exercise_options],
    duration: source.duration,
    intensity: source.intensity,
    required: source.required,
    ...(source.safety_gated !== undefined ? { safetyGated: source.safety_gated } : {}),
    ...(source.notes !== undefined ? { notes: source.notes } : {}),
  };
}

function identityMapSessions(baseTemplate: CanonicalTemplate): FinalWorkoutSession[] {
  return baseTemplate.sessions.map((session) => {
    const exercises: FinalWorkoutExercise[] = session.exercises.map((exercise) => ({
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
      // restSeconds intentionally absent: `restPrescription.ts` derives it
      // from `goalFamily`, which is a selector-only concern in v1.27 (see
      // Fase 4 scope — "goal -> restSeconds=180" is exactly the forbidden
      // post-selection effect). Rest guidance for v1.27 lives in the
      // session-level `rest_guideline` text until a future phase decides
      // numeric rest for this library.
    }));
    const cardioFinisher = session.cardio_finisher ? toFinalCardioFinisher(session.cardio_finisher) : undefined;
    return {
      name: session.name,
      type: session.type,
      notes: session.notes,
      ...(session.technique_guideline ? { techniqueGuideline: session.technique_guideline } : {}),
      ...(session.effort_guideline ? { effortGuideline: session.effort_guideline } : {}),
      ...(session.rest_guideline ? { restGuideline: session.rest_guideline } : {}),
      ...(session.progression_guideline ? { progressionGuideline: session.progression_guideline } : {}),
      exercises,
      ...(session.display_name ? { displayName: session.display_name } : {}),
      ...(cardioFinisher ? { cardioFinisher } : {}),
    };
  });
}

export function composeTemplateV127(
  baseTemplate: CanonicalTemplate,
  context: CompositionContextV127 = {},
): CompositionResultV127 {
  const identitySessions = identityMapSessions(baseTemplate);
  const musclePriorityTargets: MusclePriorityTargetV127[] = normalizeMusclePriorityInputV127(context.musclePriority ?? []);

  const trace: CompositionTraceV127 = {
    templateId: baseTemplate.id,
    stagesApplied: [
      ...(musclePriorityTargets.length ? (['muscle_priority'] as const) : []),
    ],
    musclePriorityApplied: musclePriorityTargets.length > 0,
    musclePriorityDecisions: [],
  };

  const musclePriorityResult = applyMusclePriorityV127(identitySessions, musclePriorityTargets);
  trace.musclePriorityDecisions = musclePriorityResult.decisions;
  return { status: 'COMPOSED', sessions: musclePriorityResult.sessions, trace };
}
