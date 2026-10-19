import { EXERCISES_SEED } from '../data/exercisesSeedData';
import { CANONICAL_ACTIVITIES } from './canonicalActivities';
import { CANONICAL_LIMITATION_PROFILES } from './limitationDataset';

/**
 * Region vocabulary/normalization for the v1.27 musculoskeletal-limitation
 * modifier, plus the "is this runtime id reliably covered" checks the real
 * substitution path (`musculoskeletalLimitationV127.ts`'s
 * `resolveExerciseLimitationsFromCandidates` call) relies on. This module no
 * longer reads the canonical JSON's own `design_notes.musculoskeletal_limitation_modifier`/
 * `exercise_substitution_map` — that data layer was removed (dead since the
 * substitution rewrite that switched to `resolveExerciseLimitationsFromCandidates`;
 * see that module's doc comment for why the JSON-map approach was abandoned).
 */

export const MUSCULOSKELETAL_LIMITATION_REGIONS_V127 = [
  'knee', 'hip', 'spine', 'shoulder', 'elbow', 'wrist', 'ankle_foot',
] as const;

export type MusculoskeletalLimitationRegionV127 = (typeof MUSCULOSKELETAL_LIMITATION_REGIONS_V127)[number];

const REGION_SET = new Set<string>(MUSCULOSKELETAL_LIMITATION_REGIONS_V127);

/**
 * The legacy/runtime limitation vocabulary (`LimitationRegionId` in
 * `types/exercise.ts`) spells this region `back`; v1.27's canonical source
 * spells it `spine`. Normalizes only at this v1.27 boundary — the legacy
 * `back` region id used throughout `limitationResolver.ts`/Firestore
 * limitation profiles is untouched, and `back` as a `MuscleId` (a muscle
 * group, unrelated concept) is never touched here either. `other` and any
 * unrecognized value return `null` (Fase 5 does not implement `other`).
 */
export function normalizeLimitationRegionV127(region: string): MusculoskeletalLimitationRegionV127 | null {
  if (region === 'back') return 'spine';
  return REGION_SET.has(region) ? (region as MusculoskeletalLimitationRegionV127) : null;
}

const exercisesById = new Map(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));

/** "Ativo/executável" per Fase 5 §5 — same fields the legacy limitation resolver treats as generation-eligible (`status`/`availability.workoutGeneration`), without importing that module (see `compositionV127.ts`'s legacy-isolation doc). */
export function isRuntimeExerciseExecutableV127(runtimeId: string): boolean {
  const exercise = exercisesById.get(runtimeId);
  return Boolean(exercise && exercise.status === 'active' && exercise.availability.workoutGeneration);
}

/**
 * Fase 13 — the 76 exercise ids `CANONICAL_LIMITATION_PROFILES`
 * (`limitationDataset.ts`, the bundled `15_LIMITATION_PROFILES_TECHNICAL_v2.json`
 * artifact — the SAME source `assertPlanSafe`/Firestore's real
 * `limitationProfile` fields are seeded from) actually have a reviewed,
 * approved `limitationProfile` for today. Of the 7 v1.27 Fase 2 closure
 * exercises, NONE are in this set yet — see
 * `musculoskeletalLimitationProfileAuditV127.ts` for the per-exercise audit
 * (2 have a strong, precedented reuse candidate proposed for human
 * sign-off; 5 have no safe basis at all) — until any of them is actually
 * reviewed and published, every one of the 7 stays fail-closed here.
 */
export const CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127: ReadonlySet<string> =
  new Set(CANONICAL_LIMITATION_PROFILES.map((profile) => profile.exerciseId));

const CANONICAL_ACTIVITY_IDS_V127: ReadonlySet<string> =
  new Set(CANONICAL_ACTIVITIES.map((activity) => activity.id));

/**
 * Fase 13 — cardio/mobility activities (`CANONICAL_ACTIVITIES`) are a
 * disjoint, non-Firestore-backed catalog with no `limitationProfile`
 * concept at all (same exclusion `assertPlanSafe`'s backend check already
 * applies, Fase 11) — they never need one. Every OTHER (resistance)
 * exercise needs a confirmed entry in `CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127`.
 */
export function hasReliableLimitationProfileCoverageV127(runtimeId: string): boolean {
  return CANONICAL_ACTIVITY_IDS_V127.has(runtimeId) || CONFIRMED_LIMITATION_PROFILE_RUNTIME_IDS_V127.has(runtimeId);
}
