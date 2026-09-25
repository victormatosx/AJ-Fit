import { normalizeLimitationRegionV127, type MusculoskeletalLimitationRegionV127 } from './canonicalMusculoskeletalLimitationV127';
import { normalizeMusclePriorityInputV127, type MusclePriorityTargetV127 } from './canonicalMusclePriorityV127';
import { applyMusculoskeletalLimitationV127, type MusculoskeletalLimitationDecisionV127 } from './musculoskeletalLimitationV127';
import { applyMusclePriorityV127, type MusclePriorityDecisionV127 } from './musclePriorityV127';
import type { CanonicalTemplate, FinalCardioFinisher, FinalWorkoutExercise, FinalWorkoutSession } from './types';

/**
 * Fase 4/5/6 — v1.27 composition pipeline. Deliberately separate from
 * `composition.ts` (`composeTemplate`), which stays untouched and keeps
 * driving the active v2.0/T001-T090 runtime. Nothing in this module is
 * wired into `engine.ts`/`generateWorkoutPrescription` — see
 * `selectorV127.ts`'s file doc for the same "not production" boundary.
 *
 * Pipeline (both canonical v1.27 modifiers are now implemented):
 *
 *   base template (selectBaseTemplateV127 → getCanonicalTemplateV127ById)
 *     -> identity mapping             [Fase 4]
 *     -> musculoskeletal_limitation   [Fase 5]
 *     -> muscle_priority              [Fase 6 — this file]
 *     -> final plan
 *
 * No other legacy modifier — beginner volume reduction, duration-driven
 * exercise/set cuts, goal-based rest or cardio suppression, generic
 * equipment substitution, experience-level effects, or special-population
 * re-transformation — runs here. All of that already happened once,
 * structurally, in `selectBaseTemplateV127` (population/beginner/goal only
 * ever choose WHICH template, never reshape one). Equipment participates
 * only as an environment check on musculoskeletal substitution candidates
 * (Fase 5 §8) — never as a standalone modifier. Muscle priority changes
 * order only (Fase 6 §1) — never sets/reps/duration/distance/cycles/
 * intensity/rest/which exercises exist.
 */

export interface CompositionContextV127 {
  /**
   * Fase 5 (`musculoskeletal_limitation`). Region ids in either the v1.27
   * canonical vocabulary (`spine`, etc.) or the legacy `LimitationRegionId`
   * vocabulary (`back`) — normalized at this boundary only, see
   * `canonicalMusculoskeletalLimitationV127.ts`'s
   * `normalizeLimitationRegionV127`. Unrecognized values (including
   * `other`, not implemented yet) are dropped, not errors.
   */
  limitationRegions?: readonly string[];
  /**
   * Fase 6 (`muscle_priority`). Up to 2 raw questionnaire-shaped
   * `muscleFocus` values (the 10 canonical v1.27 target ids, or legacy
   * `arms`/`none`) — normalized at this boundary only, see
   * `canonicalMusclePriorityV127.ts`'s `normalizeMusclePriorityInputV127`.
   * Treated as a single merged priority set, not a ranked 1st/2nd order —
   * see that module's doc for why (the questionnaire data does not carry
   * rank semantics today).
   */
  musclePriority?: readonly string[];
}

export interface CompositionTraceV127 {
  templateId: CanonicalTemplate['id'];
  stagesApplied: ('musculoskeletal_limitation' | 'muscle_priority')[];
  /** True once the stage runs (i.e. at least one recognized active region was provided) — independent of whether any exercise actually needed substitution. */
  musculoskeletalLimitationApplied: boolean;
  /** True once the stage runs (i.e. at least one recognized target was provided) — independent of whether any session actually reordered. */
  musclePriorityApplied: boolean;
  limitationDecisions: MusculoskeletalLimitationDecisionV127[];
  musclePriorityDecisions: MusclePriorityDecisionV127[];
}

export type CompositionResultV127 =
  | { status: 'COMPOSED'; sessions: FinalWorkoutSession[]; trace: CompositionTraceV127 }
  /**
   * Fase 5 §10 fail-closed contract: at least one exercise was vetoed by an
   * active limitation region and no valid A/B/C candidate existed for it
   * (or it has no substitution-map entry at all). Mirrors the shape of
   * `composition.ts`'s own non-`'COMPOSED'` statuses — an analogous,
   * explicit "cannot safely proceed" result, not a v1.27-specific escape
   * hatch. `trace` still carries every decision made, including the
   * rejected candidates, for whichever exercises were actually vetoed.
   * Muscle priority never runs when this status is returned — there is no
   * final exercise set yet to reorder.
   */
  | { status: 'MUSCULOSKELETAL_SUBSTITUTION_UNAVAILABLE'; reasonCodes: string[]; trace: CompositionTraceV127 };

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

function normalizeActiveRegions(regions: readonly string[] | undefined): MusculoskeletalLimitationRegionV127[] {
  if (!regions?.length) return [];
  const normalized = regions.map(normalizeLimitationRegionV127).filter((region): region is MusculoskeletalLimitationRegionV127 => region != null);
  return [...new Set(normalized)];
}

/**
 * Pure, deterministic. Never receives `QuestionnaireAnswers` (or any goal/
 * duration/equipment-inventory/sex/days/schedule/experience-
 * shaped input) — there is structurally nothing for such a value to
 * influence. Never selects or re-selects a template; the only template it
 * can ever return sessions for is `baseTemplate` itself.
 */
export function composeTemplateV127(
  baseTemplate: CanonicalTemplate,
  context: CompositionContextV127 = {},
): CompositionResultV127 {
  const identitySessions = identityMapSessions(baseTemplate);
  const activeRegions = normalizeActiveRegions(context.limitationRegions);
  const limitationResult = applyMusculoskeletalLimitationV127(identitySessions, baseTemplate.profile.environment, activeRegions);

  const musclePriorityTargets: MusclePriorityTargetV127[] = normalizeMusclePriorityInputV127(context.musclePriority ?? []);

  const trace: CompositionTraceV127 = {
    templateId: baseTemplate.id,
    stagesApplied: [
      ...(activeRegions.length ? (['musculoskeletal_limitation'] as const) : []),
      ...(limitationResult.status === 'APPLIED' && musclePriorityTargets.length ? (['muscle_priority'] as const) : []),
    ],
    musculoskeletalLimitationApplied: activeRegions.length > 0,
    // Only meaningfully "applied" if it actually ran — it never runs when
    // the limitation stage blocked (there is no final exercise set yet).
    musclePriorityApplied: limitationResult.status === 'APPLIED' && musclePriorityTargets.length > 0,
    limitationDecisions: limitationResult.decisions,
    musclePriorityDecisions: [],
  };

  if (limitationResult.status === 'BLOCKED') {
    return { status: 'MUSCULOSKELETAL_SUBSTITUTION_UNAVAILABLE', reasonCodes: limitationResult.reasonCodes, trace };
  }

  const musclePriorityResult = applyMusclePriorityV127(limitationResult.sessions, musclePriorityTargets);
  trace.musclePriorityDecisions = musclePriorityResult.decisions;
  return { status: 'COMPOSED', sessions: musclePriorityResult.sessions, trace };
}
