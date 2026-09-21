import canonicalV127Json from '../../docs/workouts/AJ_Fit_T001_T102_workouts_canonical_v1_27_goal_routing_fixed.json';
import { resolveCanonicalExerciseId } from './canonicalExerciseIdentity';
import type { CanonicalExercise, CanonicalSession, CanonicalTemplate, TemplateId } from './types';

type AuthoringExercise = Omit<CanonicalExercise, 'sets' | 'cycleRange'> & { sets?: number | string };
type AuthoringSession = Omit<CanonicalSession, 'exercises'> & { exercises: AuthoringExercise[] };
type AuthoringTemplate = Omit<CanonicalTemplate, 'sessions'> & { sessions: AuthoringSession[] };

/** Converts only the two authored interval-cycle forms; unknown text fails closed. */
export function parseAuthoredSets(value: number | string | undefined): Pick<CanonicalExercise, 'sets' | 'cycleRange'> {
  if (value === undefined) return {};
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10) return { sets: value };
  if (typeof value === 'string') {
    const match = /^(5-7|6-8) ciclos$/.exec(value);
    if (match) {
      const [min, max] = match[1].split('-').map(Number);
      return { cycleRange: { min, max } };
    }
  }
  throw new Error(`UNSUPPORTED_AUTHORED_SETS:${String(value)}`);
}

/** Local opt-in adapter. No production catalog import points at v1.27 yet. */
export function parseCanonicalV127Template(raw: AuthoringTemplate): CanonicalTemplate {
  if (!raw.id || !/^T\d{3}$/.test(raw.id) || !raw.sessions?.length) throw new Error('INVALID_CANONICAL_TEMPLATE');
  return {
    id: raw.id,
    profile: { ...raw.profile },
    split: raw.split,
    rationale: raw.rationale,
    ...(raw.assumptions !== undefined ? { assumptions: raw.assumptions } : {}),
    ...(raw.safety !== undefined ? { safety: raw.safety } : {}),
    sessions: raw.sessions.map((session) => ({
      name: session.name,
      type: session.type,
      display_name: session.display_name ?? session.name,
      ...(session.notes ? { notes: session.notes } : {}),
      ...(session.technique_guideline ? { technique_guideline: session.technique_guideline } : {}),
      ...(session.effort_guideline ? { effort_guideline: session.effort_guideline } : {}),
      ...(session.rest_guideline ? { rest_guideline: session.rest_guideline } : {}),
      ...(session.progression_guideline ? { progression_guideline: session.progression_guideline } : {}),
      ...(session.cardio_finisher ? { cardio_finisher: session.cardio_finisher } : {}),
      exercises: session.exercises.map((exercise) => {
        const runtimeId = resolveCanonicalExerciseId(exercise.exercise_id);
        if (!runtimeId) throw new Error(`UNRESOLVED_CANONICAL_EXERCISE:${exercise.exercise_id}`);
        const { sets: _authoredSets, catalog_status: _catalogStatus,
          source_name_v1_1: _sourceV11, source_name_v1_2: _sourceV12,
          ...prescription } = exercise;
        // catalog_status and historical source names are authoring evidence,
        // not executable prescription fields. The identity matrix retains them.
        return {
          ...prescription,
          exercise_id: runtimeId,
          ...parseAuthoredSets(exercise.sets),
        };
      }),
    })),
  };
}

type RawCanonicalV127Catalog = { workouts: AuthoringTemplate[] };

const rawV127ById = new Map(
  (canonicalV127Json as unknown as RawCanonicalV127Catalog).workouts.map((workout) => [workout.id, workout]),
);

/**
 * Lazy, on-demand parse of a single v1.27 template by id — never eagerly
 * parses all 102 (some still reference exercise identities blocked in
 * `AJ_Fit_v1_27_exercise_identity_matrix.json`; selection must be able to
 * reach every template by profile alone without materializing its
 * exercises — see `selectorV127.ts`). Throws the same
 * `UNRESOLVED_CANONICAL_EXERCISE`/`INVALID_CANONICAL_TEMPLATE` errors as
 * `parseCanonicalV127Template` for a template that still has a blocked
 * exercise identity.
 */
export function getCanonicalTemplateV127ById(id: TemplateId): CanonicalTemplate {
  const raw = rawV127ById.get(id);
  if (!raw) throw new Error(`UNKNOWN_CANONICAL_V127_TEMPLATE:${id}`);
  return parseCanonicalV127Template(raw);
}
