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
import type { LocalizedText } from '../types/exercise';
import { CANONICAL_ACTIVITIES } from '../workoutPrescription/canonicalActivities';
import { resolveCanonicalExerciseId } from '../workoutPrescription/canonicalExerciseIdentity';
import { LEGACY_REST_SECONDS_FALLBACK } from '../workoutPrescription/restPrescription';
import type { FinalWorkoutPlan } from '../workoutPrescription/types';

export type SetData = { r: string; w: number };
export type SubOption = { name: string; target: string; db: string };
export type ManualSubstitutionContextStatus = 'loading' | 'ready' | 'error';
export type ManualSubstitutionSheetState = 'unavailable' | 'loading' | 'options' | 'empty' | 'error';

export function resolveManualSubstitutionPresentation(input: {
  completedSets: number;
  contextStatus: ManualSubstitutionContextStatus;
  candidateCount: number;
  canRevert: boolean;
}): { buttonVisible: boolean; sheetState: ManualSubstitutionSheetState } {
  if (input.completedSets !== 0) return { buttonVisible: false, sheetState: 'unavailable' };
  if (input.contextStatus === 'loading') return { buttonVisible: true, sheetState: 'loading' };
  if (input.contextStatus === 'error') return { buttonVisible: true, sheetState: 'error' };
  return {
    buttonVisible: true,
    sheetState: input.candidateCount > 0 || input.canRevert ? 'options' : 'empty',
  };
}

export type Exercise = {
  id: string;
  /** Canonical identity of this slot in FinalWorkoutPlan. */
  prescribedExerciseId: string;
  /** Exercise whose visual metadata is being presented. */
  effectiveExerciseId: string;
  name: string;
  target: string;
  db: string;
  sets: SetData[];
  doseKind: 'reps' | 'duration' | 'distance' | 'cycles';
  notes?: string;
  intensity?: string;
  doseDetail?: string;
  rest: number;
  subs: SubOption[];
};

type CatalogDisplayEntry = { name: LocalizedText; targetMuscle: string | null };

/**
 * Resistance exercises (`EXERCISES_SEED`) and cardio/mobility activities
 * (`CANONICAL_ACTIVITIES`) are disjoint, separately-typed catalogs (see
 * `canonicalActivities.ts`) — this map is only the small display slice
 * `workoutExercisesFromPlan` actually needs from either one, so this file
 * never has to narrow a shared union at every read site. An activity has no
 * muscle target (`targetMuscle: null`, not a fabricated one) — v1.27 is not
 * wired into any production plan today, but a plan that eventually
 * references `cardio-leve`/`mobilidade-geral`/etc. resolves here already.
 */
const catalogDisplayById = new Map<string, CatalogDisplayEntry>([
  ...EXERCISES_SEED.map((exercise): [string, CatalogDisplayEntry] =>
    [exercise.id, { name: exercise.name, targetMuscle: exercise.target.primaryMuscle }]),
  ...CANONICAL_ACTIVITIES.map((activity): [string, CatalogDisplayEntry] =>
    [activity.id, { name: activity.name, targetMuscle: null }]),
]);

/**
 * Fase 8 — read-boundary alias resolution (§4: "resolver na leitura/
 * fronteira apropriada", never by regravating a persisted document). A
 * v1.27-generated plan is always persisted with the already-resolved
 * runtime id (`canonicalCatalog.ts`'s `parseCanonicalV127Template` fails
 * closed on anything unresolved before composition even runs), so this
 * fallback is defensive rather than a real production path today — it
 * exists so an older/synthetic snapshot that still carries a unified-away
 * v1.27 canonical id (e.g. `flexao-de-joelhos-com-elastico-e-apoio`,
 * `agachamento-para-banco`, `farmer-walk`) keeps resolving instead of
 * throwing `Missing catalog exercise`.
 */
function resolveCatalogDisplayEntry(exerciseId: string): CatalogDisplayEntry | undefined {
  const direct = catalogDisplayById.get(exerciseId);
  if (direct) return direct;
  const aliasedRuntimeId = resolveCanonicalExerciseId(exerciseId);
  return aliasedRuntimeId ? catalogDisplayById.get(aliasedRuntimeId) : undefined;
}

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

/**
 * An exercise may only be moved behind another one before the user starts
 * it. Once one set is complete, keeping it current prevents a partially
 * performed exercise from being silently deferred through either the main
 * skip action or the workout queue.
 */
export function canSkipExercise(completedSets: number, remainingExerciseCount: number): boolean {
  return completedSets === 0 && remainingExerciseCount > 1;
}

export function workoutExercisesFromPlan(
  plan: FinalWorkoutPlan,
  language: string,
  sessionIndex: number,
  effectiveExerciseIds?: ReadonlyMap<number, string>,
): Exercise[] {
  const session = plan.sessions[sessionIndex] ?? plan.sessions[0];
  if (!session) return [];
  const locale = language === 'pt-BR' ? 'ptBR' : language === 'es' ? 'es' : 'en';
  return session.exercises.map((prescribed, exerciseIndex) => {
    const effectiveExerciseId = effectiveExerciseIds?.get(exerciseIndex) ?? prescribed.exerciseId;
    const catalog = resolveCatalogDisplayEntry(effectiveExerciseId);
    if (!catalog) throw new Error(`Missing catalog exercise ${effectiveExerciseId}`);
    const count = prescribed.sets ?? 1;
    const doseKind = prescribed.cycleRange ? 'cycles'
      : prescribed.distance ? 'distance'
        : prescribed.reps ? 'reps' : 'duration';
    const target = prescribed.cycleRange
      ? `${prescribed.cycleRange.min}–${prescribed.cycleRange.max}`
      : prescribed.distance ?? prescribed.reps ?? prescribed.duration ?? '—';
    return {
      id: effectiveExerciseId,
      prescribedExerciseId: prescribed.exerciseId,
      effectiveExerciseId,
      name: catalog.name[locale],
      // Cardio/mobility activities have no muscle target — '' (not a
      // fabricated muscle) is the correct display value until Fase 4's UI
      // work (out of scope here) decides how to badge them.
      target: catalog.targetMuscle ?? '',
      db: effectiveExerciseId,
      doseKind,
      notes: prescribed.notes,
      intensity: prescribed.intensity,
      doseDetail: prescribed.cycleRange ? prescribed.duration : undefined,
      // Keep the canonical range/duration verbatim. Rendering only the lower
      // bound would silently change "8-12" into a prescription of 8.
      sets: Array.from({ length: count }, () => ({
        r: target,
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
