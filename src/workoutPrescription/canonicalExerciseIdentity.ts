import matrixJson from '../../docs/workouts/AJ_Fit_v1_27_exercise_identity_matrix.json';
import { EXERCISES_SEED } from '../data/exercisesSeedData';
import { CANONICAL_ACTIVITIES } from './canonicalActivities';

export type ExerciseIdentityStatus = 'EXACT_MATCH' | 'SEMANTIC_ALIAS_CONFIRMED' | 'TRULY_MISSING' | 'AMBIGUOUS';

type IdentityRow = {
  canonicalId: string;
  runtimeId: string | null;
  status: ExerciseIdentityStatus;
};

const rows = matrixJson.rows as IdentityRow[];
// Resistance exercises (EXERCISES_SEED) and cardio/mobility activities
// (CANONICAL_ACTIVITIES) are disjoint, separately-typed catalogs — see
// `canonicalActivities.ts`'s doc — but both are valid alias *targets* for
// v1.27 identity resolution.
const runtimeIds = new Set([
  ...EXERCISES_SEED.map((exercise) => exercise.id),
  ...CANONICAL_ACTIVITIES.map((activity) => activity.id),
]);
const byCanonicalId = new Map(rows.map((row) => [row.canonicalId, row]));

export function exerciseIdentityErrors(): string[] {
  const errors: string[] = [];
  if (byCanonicalId.size !== rows.length) errors.push('DUPLICATE_CANONICAL_ALIAS');
  for (const row of rows) {
    if (row.status === 'EXACT_MATCH' || row.status === 'SEMANTIC_ALIAS_CONFIRMED') {
      if (!row.runtimeId || !runtimeIds.has(row.runtimeId)) errors.push(`INVALID_ALIAS_TARGET:${row.canonicalId}`);
      if (row.runtimeId && byCanonicalId.has(row.runtimeId) && row.runtimeId !== row.canonicalId
        && !runtimeIds.has(row.runtimeId)) errors.push(`ALIAS_CHAIN:${row.canonicalId}`);
    } else if (row.runtimeId) errors.push(`UNCONFIRMED_ALIAS_TARGET:${row.canonicalId}`);
  }
  return errors;
}

/** Fixed, reviewed identities only. Never resolves by display text at runtime. */
export function resolveCanonicalExerciseId(id: string): string | null {
  const row = byCanonicalId.get(id);
  if (row) return row.runtimeId;
  return runtimeIds.has(id) ? id : null;
}

export function unresolvedCanonicalExerciseIds(): string[] {
  return rows.filter((row) => !row.runtimeId).map((row) => row.canonicalId);
}
