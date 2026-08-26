/**
 * Pure `FinalWorkoutPlan` → `WorkoutScreen`'s local UI shape conversion —
 * split out of `WorkoutScreen.tsx` (Phase 2, Part D) purely so it is
 * independently testable: this project's Vitest config
 * (`vitest.config.mts`) only collects `.test.ts` files in a Node
 * environment, and `WorkoutScreen.tsx` pulls in `react-native`/
 * `expo-linear-gradient` at import time, which cannot load outside RN.
 * Zero behavior change — `WorkoutScreen.tsx` imports these same
 * types/function from here instead of defining them inline.
 */
import { EXERCISES_SEED } from '../data/exercisesSeedData';
import { LEGACY_REST_SECONDS_FALLBACK } from '../workoutPrescription/restPrescription';
import type { FinalWorkoutPlan } from '../workoutPrescription/types';

export type SetData = { r: string; w: number };
export type SubOption = { name: string; target: string; db: string };
export type Exercise = {
  id: string;
  name: string;
  target: string;
  db: string;
  sets: SetData[];
  rest: number;
  subs: SubOption[];
};

const catalogExerciseById = new Map(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));

/**
 * `SetData.r` is a free-form display string — a plain rep count ("10"), a
 * range ("8-12"), or a duration ("30s") — never something i18next's
 * count-based pluralization can consume directly. Passing it straight as
 * `{ count: r }` was the exact cause of the `sets.summaryBodyweight`/
 * `sets.summaryWeighted` raw-key leak: i18next's plural-rule resolver only
 * accepts a real number, so a range like "8-12" made it fail to resolve
 * `_one`/`_other` at all and fall through to the bare (non-suffixed, and
 * therefore nonexistent) key. This derives the number pluralization itself
 * needs, independent of what's actually displayed (`{{reps}}` in the
 * template) — a clean single-rep string picks the real singular/plural
 * form, anything else (a range, a duration, missing data) reads as plural,
 * which is grammatically correct in every supported locale ("8-12 reps",
 * "30s de descanso" phrasing, etc.).
 */
export function pluralCountForReps(reps: string): number {
  return /^1$/.test(reps.trim()) ? 1 : 2;
}

export function workoutExercisesFromPlan(plan: FinalWorkoutPlan, language: string, sessionIndex: number): Exercise[] {
  const session = plan.sessions[sessionIndex] ?? plan.sessions[0];
  if (!session) return [];
  const locale = language === 'pt-BR' ? 'ptBR' : language === 'es' ? 'es' : 'en';
  return session.exercises.map((prescribed) => {
    const catalog = catalogExerciseById.get(prescribed.exerciseId);
    if (!catalog) throw new Error(`Missing catalog exercise ${prescribed.exerciseId}`);
    const count = prescribed.sets ?? 1;
    return {
      id: prescribed.exerciseId,
      name: catalog.name[locale],
      target: catalog.target.primaryMuscle,
      db: prescribed.exerciseId,
      // Keep the canonical range/duration verbatim. Rendering only the lower
      // bound would silently change "8-12" into a prescription of 8.
      sets: Array.from({ length: count }, () => ({
        r: prescribed.reps ?? prescribed.duration ?? '—',
        w: 0,
      })),
      // Prescribed by the engine (`restPrescription.ts`), never inferred
      // here — `0` is a deliberate "no traditional rest" value (mobility/
      // balance/breathing/gait/cycling), not a missing one. `undefined`
      // only happens on a snapshot persisted before this field existed
      // (Phase 2); that legacy case gets an explicit, documented,
      // non-zero fallback — never a silent 0.
      rest: prescribed.restSeconds ?? LEGACY_REST_SECONDS_FALLBACK,
      // Runtime substitutions cannot bypass the engine's equipment/safety
      // filters. The current plan contains only its already-approved final
      // exercise; future interactive alternatives must come from a
      // constraint-aware engine result, not the raw similarity graph.
      subs: [],
    };
  });
}
