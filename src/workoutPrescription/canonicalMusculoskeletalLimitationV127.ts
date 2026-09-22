import canonicalV127Json from '../../docs/workouts/AJ_Fit_T001_T102_workouts_canonical_v1_27_goal_routing_fixed.json';
import matrixJson from '../../docs/workouts/AJ_Fit_v1_27_exercise_identity_matrix.json';
import { EXERCISES_SEED } from '../data/exercisesSeedData';
import { CANONICAL_ACTIVITIES } from './canonicalActivities';
import { resolveCanonicalExerciseId } from './canonicalExerciseIdentity';
import { CANONICAL_LIMITATION_PROFILES } from './limitationDataset';
import type { TemplateEnvironment } from './types';

/**
 * Fase 5 — read-only data layer over the v1.27 canonical source's
 * `design_notes.musculoskeletal_limitation_modifier` (avoid-by-default per
 * region) and `design_notes.exercise_substitution_map` (A/B/C candidates).
 * Both are documentation-only fields on the raw JSON (see
 * `types.ts`'s `CanonicalTemplate.weekly_schedule`/`experience_modifiers`
 * doc for the same "not consumed structurally by the parsed
 * CanonicalTemplate" precedent) — this module is the one place that reads
 * them for the v1.27 substitution algorithm.
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

type RawAvoidEntry = { exercise_id: string; name: string; reason: string };
type RawRegionBlock = { label: string; avoid_by_default: RawAvoidEntry[] };
type RawMusculoskeletalLimitationModifier = { regions: Record<string, RawRegionBlock> };

type RawSubstitutionCandidate = {
  name: string;
  exercise_id: string;
  catalog_status: 'existing_library' | 'proposed_catalog_addition';
  environments: string[];
};
type RawSubstitutionEntry = {
  A_close_equivalent?: RawSubstitutionCandidate[];
  B_acceptable?: RawSubstitutionCandidate[];
  C_last_resort_target_preservation?: RawSubstitutionCandidate[];
};
type RawExerciseSubstitutionMap = { map: Record<string, RawSubstitutionEntry> };

type RawCanonicalV127 = {
  design_notes: {
    musculoskeletal_limitation_modifier: RawMusculoskeletalLimitationModifier;
    exercise_substitution_map: RawExerciseSubstitutionMap;
  };
};

const raw = canonicalV127Json as unknown as RawCanonicalV127;
const matrixRows = (matrixJson as unknown as { rows: { canonicalId: string; canonicalName: string; runtimeId: string | null }[] }).rows;

/**
 * Every region's avoid-by-default list, resolved from v1.27 canonical ids
 * to runtime ids — the same ids that already sit on a parsed
 * `CanonicalTemplate`'s `exercise_id` fields (`canonicalCatalog.ts` already
 * resolved them once at parse time). An id that fails to resolve here would
 * mean the identity matrix regressed; that is a data-integrity bug, not a
 * runtime condition to swallow, so it throws at module load rather than
 * silently dropping the avoid entry.
 */
function buildAvoidRuntimeIdsByRegion(): Record<MusculoskeletalLimitationRegionV127, ReadonlySet<string>> {
  const result = {} as Record<MusculoskeletalLimitationRegionV127, Set<string>>;
  for (const region of MUSCULOSKELETAL_LIMITATION_REGIONS_V127) result[region] = new Set();
  for (const [region, block] of Object.entries(raw.design_notes.musculoskeletal_limitation_modifier.regions)) {
    const normalized = normalizeLimitationRegionV127(region);
    if (!normalized) continue;
    for (const entry of block.avoid_by_default) {
      const runtimeId = resolveCanonicalExerciseId(entry.exercise_id);
      if (!runtimeId) throw new Error(`MUSCULOSKELETAL_AVOID_ENTRY_UNRESOLVED:${region}:${entry.exercise_id}`);
      result[normalized].add(runtimeId);
    }
  }
  return result;
}

export const AVOID_RUNTIME_IDS_BY_REGION_V127 = buildAvoidRuntimeIdsByRegion();

export interface SubstitutionCandidateV127 {
  runtimeId: string;
  name: string;
  catalogStatus: 'existing_library' | 'proposed_catalog_addition';
  environments: readonly TemplateEnvironment[];
}

export interface SubstitutionCandidatesV127 {
  A: readonly SubstitutionCandidateV127[];
  B: readonly SubstitutionCandidateV127[];
  C: readonly SubstitutionCandidateV127[];
}

function resolveCandidates(entries: RawSubstitutionCandidate[] | undefined): SubstitutionCandidateV127[] {
  if (!entries) return [];
  const resolved: SubstitutionCandidateV127[] = [];
  for (const entry of entries) {
    // Fase 5 §5: never use a `proposed_catalog_addition` candidate — it is
    // not yet catalogued/executable, independent of whether its id happens
    // to resolve. Excluded explicitly, not just by accidental non-resolution.
    if (entry.catalog_status !== 'existing_library') continue;
    const runtimeId = resolveCanonicalExerciseId(entry.exercise_id);
    // An `existing_library` candidate failing to resolve is a real
    // identity-matrix regression (every such candidate resolves today —
    // see canonicalMusculoskeletalLimitationV127.test.ts), so it fails
    // loudly rather than being silently dropped.
    if (!runtimeId) throw new Error(`MUSCULOSKELETAL_CANDIDATE_UNRESOLVED:${entry.exercise_id}`);
    resolved.push({
      runtimeId,
      name: entry.name,
      catalogStatus: entry.catalog_status,
      environments: entry.environments.filter((env): env is TemplateEnvironment => env === 'gym' || env === 'home'),
    });
  }
  return resolved;
}

/**
 * `exercise_substitution_map.map` is keyed by the v1.27 canonical *name*
 * (pt-BR) of the exercise it substitutes for — see
 * `canonicalV127SubstitutionMapUnification.test.ts` for how that map was
 * cleaned of duplicate/self-referential entries. Multiple v1.27 canonical
 * ids can resolve to the same runtime id (aliases, e.g. `farmer-walk`/
 * `caminhada-do-fazendeiro` both -> `farmers-walk`); after that cleanup,
 * exactly one survives as a map key per runtime id. This builds the
 * runtimeId -> candidates lookup once, at module load, deterministically.
 */
function buildSubstitutionCandidatesByRuntimeId(): ReadonlyMap<string, SubstitutionCandidatesV127> {
  const nameToCanonicalId = new Map(matrixRows.map((row) => [row.canonicalName, row.canonicalId]));
  const result = new Map<string, SubstitutionCandidatesV127>();
  for (const [key, entry] of Object.entries(raw.design_notes.exercise_substitution_map.map)) {
    const canonicalId = nameToCanonicalId.get(key);
    if (!canonicalId) continue;
    const runtimeId = resolveCanonicalExerciseId(canonicalId);
    if (!runtimeId) continue;
    result.set(runtimeId, {
      A: resolveCandidates(entry.A_close_equivalent),
      B: resolveCandidates(entry.B_acceptable),
      C: resolveCandidates(entry.C_last_resort_target_preservation),
    });
  }
  return result;
}

export const SUBSTITUTION_CANDIDATES_BY_RUNTIME_ID_V127 = buildSubstitutionCandidatesByRuntimeId();

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
