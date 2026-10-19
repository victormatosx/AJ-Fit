import { describe, expect, it } from 'vitest';
import canonical from '../../../docs/workouts/AJ_Fit_T001_T102_workouts_canonical_v1_33_peck_deck_runtime_id_fixed.json';
import matrix from '../../../docs/workouts/AJ_Fit_v1_27_exercise_identity_matrix.json';
import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { CANONICAL_ACTIVITIES } from '../canonicalActivities';
import { parseCanonicalV127Template } from '../canonicalCatalog';
import { resolveCanonicalExerciseId, unresolvedCanonicalExerciseIds } from '../canonicalExerciseIdentity';

/**
 * Every "same exercise, two v1.27 authoring identities" group closed in the
 * substitution map so far. Each entry: the ids no longer allowed to exist
 * as an independent map key or A/B/C candidate, the surviving canonical
 * map key (name) and canonical id, and the runtime id both sides share
 * (kept for backward compatibility on the losing ids via the resolver).
 */
const UNIFIED_GROUPS = [
  {
    losingIds: ['flexao-de-joelhos-com-elastico-e-apoio'],
    losingNames: ['Flexão de Joelhos com Elástico e Apoio'],
    canonicalKey: 'Flexão de Joelhos com Elástico',
    canonicalId: 'flexao-de-joelhos-com-elastico',
    runtimeId: 'resistance-band-standing-leg-curl',
    workoutIdsUsingLosingId: ['T088', 'T089', 'T090'],
  },
  {
    losingIds: ['agachamento-para-banco'],
    losingNames: ['Agachamento para Banco'],
    canonicalKey: 'Sentar e Levantar da Cadeira',
    canonicalId: 'sentar-e-levantar-da-cadeira',
    runtimeId: 'chair-sit-to-stand',
    workoutIdsUsingLosingId: ['T085', 'T086', 'T087'],
  },
  {
    losingIds: ['remada-com-elastico-pegada-aberta', 'remada-com-elastico-pegada-neutra'],
    losingNames: ['Remada com Elástico Pegada Aberta', 'Remada com Elástico Pegada Neutra'],
    canonicalKey: 'Remada com Elástico',
    canonicalId: 'remada-com-elastico',
    runtimeId: 'resistance-band-row',
    workoutIdsUsingLosingId: [],
  },
  {
    losingIds: ['farmer-walk'],
    losingNames: ['Farmer Walk'],
    canonicalKey: 'Caminhada do Fazendeiro',
    canonicalId: 'caminhada-do-fazendeiro',
    runtimeId: 'farmers-walk',
    workoutIdsUsingLosingId: [],
  },
] as const;

const ALL_LOSING_IDS = new Set<string>(UNIFIED_GROUPS.flatMap((g) => g.losingIds));
const ALL_LOSING_NAMES = new Set<string>(UNIFIED_GROUPS.flatMap((g) => g.losingNames));

const substitutionMap = canonical.design_notes.exercise_substitution_map.map as Record<string, {
  A_close_equivalent?: { name: string; exercise_id: string; catalog_status?: string }[];
  B_acceptable?: { name: string; exercise_id: string; catalog_status?: string }[];
  C_last_resort_target_preservation?: { name: string; exercise_id: string; catalog_status?: string }[];
  notes?: string;
}>;

const nameToCanonicalId = new Map(matrix.rows.map((row) => [row.canonicalName, row.canonicalId]));

const TIERS = ['A_close_equivalent', 'B_acceptable', 'C_last_resort_target_preservation'] as const;

function tierEntries(entry: (typeof substitutionMap)[string], tier: (typeof TIERS)[number]) {
  return entry[tier] ?? [];
}

function allEntries(entry: (typeof substitutionMap)[string]) {
  return TIERS.flatMap((tier) => tierEntries(entry, tier));
}

/** Resolves through the v1.27 alias layer, falling back to the id itself if it's already a runtime id. */
function resolveRuntimeId(id: string): string {
  return resolveCanonicalExerciseId(id) ?? id;
}

describe('v1.27 exercise_substitution_map — closed identity unifications (no allowlist)', () => {
  it('every substitution candidate marked existing_library resolves to a real runtime exercise', () => {
    const runtimeItemIds = new Set([
      ...EXERCISES_SEED.map((exercise) => exercise.id),
      ...CANONICAL_ACTIVITIES.map((activity) => activity.id),
    ]);
    const unresolved: string[] = [];

    for (const [sourceName, entry] of Object.entries(substitutionMap)) {
      for (const tier of TIERS) {
        for (const candidate of tierEntries(entry, tier)) {
          if (candidate.catalog_status !== 'existing_library') continue;
          const runtimeId = resolveCanonicalExerciseId(candidate.exercise_id);
          if (!runtimeId || !runtimeItemIds.has(runtimeId)) {
            unresolved.push(`${sourceName}/${tier}: ${candidate.exercise_id} -> ${runtimeId ?? 'UNRESOLVED'}`);
          }
        }
      }
    }

    expect(unresolved).toEqual([]);
    expect(resolveCanonicalExerciseId('pec-deck-machine-fly')).toBe('pec-deck-machine-fly');
    expect(runtimeItemIds.has('pec-deck-machine-fly')).toBe(true);
  });

  it('none of the unified-away ids/names appear as a map key, or as a candidate name/exercise_id, anywhere', () => {
    expect(Object.keys(substitutionMap).some((key) => ALL_LOSING_NAMES.has(key))).toBe(false);
    for (const [key, entry] of Object.entries(substitutionMap)) {
      for (const candidate of allEntries(entry)) {
        expect(ALL_LOSING_IDS.has(candidate.exercise_id), `${key}: leftover id ${candidate.exercise_id}`).toBe(false);
        expect(ALL_LOSING_NAMES.has(candidate.name), `${key}: leftover name ${candidate.name}`).toBe(false);
      }
    }
  });

  it('every surviving canonical key exists exactly once and the runtime id it aliases to matches the closed decision', () => {
    for (const group of UNIFIED_GROUPS) {
      expect(substitutionMap[group.canonicalKey], group.canonicalKey).toBeDefined();
      expect(resolveRuntimeId(group.canonicalId)).toBe(group.runtimeId);
      for (const losingId of group.losingIds) {
        expect(resolveRuntimeId(losingId)).toBe(group.runtimeId);
      }
    }
  });

  it('1. no A/B/C candidate resolves, after canonicalization, to the canonical id of the entry it is listed under (global, zero exceptions)', () => {
    const selfSubstitutions: string[] = [];
    for (const [key, entry] of Object.entries(substitutionMap)) {
      const ownCanonicalId = nameToCanonicalId.get(key);
      expect(ownCanonicalId, `no matrix row for map key "${key}"`).toBeDefined();
      const ownRuntimeId = resolveRuntimeId(ownCanonicalId!);
      for (const candidate of allEntries(entry)) {
        if (resolveRuntimeId(candidate.exercise_id) === ownRuntimeId) {
          selfSubstitutions.push(`${key} -> ${candidate.name} (${candidate.exercise_id})`);
        }
      }
    }
    expect(selfSubstitutions).toEqual([]);
  });

  it('2. no tier contains two candidates that canonicalize to the same runtime id (global, per key per tier)', () => {
    const duplicates: string[] = [];
    for (const [key, entry] of Object.entries(substitutionMap)) {
      for (const tier of TIERS) {
        const seen = new Map<string, string>();
        for (const candidate of tierEntries(entry, tier)) {
          const runtimeId = resolveRuntimeId(candidate.exercise_id);
          if (seen.has(runtimeId)) {
            duplicates.push(`${key}/${tier}: ${seen.get(runtimeId)} and ${candidate.exercise_id} both -> ${runtimeId}`);
          } else {
            seen.set(runtimeId, candidate.exercise_id);
          }
        }
      }
    }
    expect(duplicates).toEqual([]);
  });

  it('3. every unified-away id still resolves correctly through the alias layer (backward compatibility for existing data)', () => {
    for (const group of UNIFIED_GROUPS) {
      for (const losingId of group.losingIds) {
        expect(resolveCanonicalExerciseId(losingId)).toBe(group.runtimeId);
      }
      expect(resolveCanonicalExerciseId(group.canonicalId)).toBe(group.runtimeId);
    }
  });

  it('4. all 79 directly referenced exercise ids remain resolved (79/79, zero unresolved — v1.33 adds pec-deck-machine-fly)', () => {
    const referenced = new Set(canonical.workouts.flatMap((workout) =>
      workout.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exercise_id))));
    expect(referenced.size).toBe(79);
    expect(unresolvedCanonicalExerciseIds()).toHaveLength(0);
    for (const id of referenced) {
      expect(resolveCanonicalExerciseId(id)).not.toBeNull();
    }
  });

  it('5. T001-T102 still materialize structurally with zero exercise-identity blocker', () => {
    expect(canonical.workouts).toHaveLength(102);
    for (const workout of canonical.workouts) {
      expect(() => parseCanonicalV127Template(workout as unknown as Parameters<typeof parseCanonicalV127Template>[0]))
        .not.toThrow();
    }
  });

  it('6. workouts/sessions/sets/reps are semantically unchanged — old ids still used verbatim in sessions, resolved only via the alias layer', () => {
    for (const group of UNIFIED_GROUPS) {
      for (const losingId of group.losingIds) {
        const usedIn = canonical.workouts.filter((workout) =>
          workout.sessions.some((session) => session.exercises.some((exercise) => exercise.exercise_id === losingId)));
        if (group.workoutIdsUsingLosingId.length) {
          expect(usedIn.map((w) => w.id).sort()).toEqual([...group.workoutIdsUsingLosingId].sort());
        }
      }
    }
    // Spot-check: the joelhos group's known usage sites keep their exact
    // exercise_id string — the map fix never rewrites `workouts`.
    const t088 = canonical.workouts.find((workout) => workout.id === 'T088');
    expect(t088?.sessions.some((session) =>
      session.exercises.some((exercise) => exercise.exercise_id === 'flexao-de-joelhos-com-elastico-e-apoio'))).toBe(true);
  });
});
