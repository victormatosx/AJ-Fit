import type { ExerciseMovement, MovementPattern } from '../types/exercise';
import type { GoalFamily } from './types';

/**
 * Legacy v2.0/T001-T090 rest prescription — read only by `composition.ts`'s
 * `composeTemplate`. The v1.27 pipeline (`compositionV127.ts`) does not
 * import this module; deriving `restSeconds` from `goalFamily` after
 * template selection is exactly the "goal modifier" effect Fase 4 forbids
 * on that path. See `compositionV127.ts`'s inline comment on `restSeconds`.
 */

/**
 * V1 rest prescription — deliberately a fixed lookup by category, not a
 * scientific engine. T001–T090 carry no numeric rest interval of their own
 * (confirmed: no `rest`/`restSeconds`/`restTime` field anywhere in the
 * canonical template JSON or `CanonicalExercise`) — this is the ONLY place
 * a rest duration is decided. `WorkoutScreen`'s timer must only ever
 * consume `FinalWorkoutExercise.restSeconds`, never infer one itself (see
 * that file's `workoutExercisesFromPlan`).
 *
 * Canonical values, one per category, on purpose — the ranges the product
 * spec gave (150–180s / 90–120s / 60–90s / 30–60s) are collapsed to a
 * single number per bucket rather than a second heuristic layer to pick a
 * point within the range; there is no reliable signal in the existing
 * catalog to justify anything finer than "which bucket". Do not add
 * RIR/RPE/%1RM or a goal×exercise×reps×level matrix here — see the Phase 2
 * task doc's explicit "simplicity > false precision" instruction.
 */
export const REST_SECONDS = {
  COMPOUND_STRENGTH: 180,
  COMPOUND: 120,
  ISOLATION: 90,
  CONDITIONING: 60,
  /**
   * Deliberate, explicit "no traditional between-set rest" — for movement
   * patterns that are not structured as discrete sets-with-rest at all
   * (mobility drills, balance work, breathing, treadmill/gait cardio,
   * stationary cycling). This is NOT the same thing as "no prescription
   * available" (see `restPrescriptionMissing` below, in `composition.ts`'s
   * caller) — it is a deliberate, documented value for a real category, so
   * the timer can treat it as "skip the rest screen for this exercise" on
   * purpose, not as an accidental default.
   */
  NO_TRADITIONAL_REST: 0,
} as const;

/** Movement patterns with no meaningful "rest between sets" concept (docs/types/exercise.ts `MovementPattern`). */
const NO_TRADITIONAL_REST_PATTERNS: ReadonlySet<MovementPattern> = new Set([
  'mobility',
  'balance',
  'breathing',
  'gait',
  'cycling',
]);

/** Session `type`s that are metabolic/circuit in nature — the exercise's own mechanic stops being the relevant signal once it's embedded in one of these (docs/workouts canonical schema `type`). */
const CONDITIONING_SESSION_TYPES: ReadonlySet<string> = new Set([
  'circuit',
  'interval',
  'cardio',
  'mixed',
  'balance_cardio',
]);

/** A compound lift prescribed at this rep count or below is being trained for strength, not hypertrophy — real, existing signal (`FinalWorkoutExercise.reps`, e.g. "4-6" vs "8-12"), not invented metadata. */
const LOW_REP_STRENGTH_THRESHOLD = 6;

function repsLowerBound(reps: string | undefined): number | null {
  if (!reps) return null;
  const match = /^(\d+)/.exec(reps);
  return match ? Number(match[1]) : null;
}

/**
 * Pure classification — uses only metadata that already exists in the real
 * exercise catalog (`movement.mechanic`, `movement.pattern`) and the
 * template/questionnaire (`reps`, session `type`, `goalFamily`). No new
 * metadata is invented on the catalog.
 *
 * Priority (most specific first):
 *   1. Movement pattern with no traditional rest concept → `NO_TRADITIONAL_REST`.
 *   2. Session embedded in a conditioning/circuit context → `CONDITIONING`,
 *      regardless of the individual exercise's own mechanic.
 *   3. Isolation → `ISOLATION`.
 *   4. Compound → `COMPOUND_STRENGTH` when the goal is strength OR the
 *      prescribed reps are a low-rep strength range; `COMPOUND` otherwise.
 *      This is the one, single, deliberately small "goal as a small
 *      adjustment" branch the task allows — not a matrix.
 */
export function prescribeRestSeconds(input: {
  movement: Pick<ExerciseMovement, 'mechanic' | 'pattern'>;
  sessionType: string;
  reps?: string;
  goalFamily?: GoalFamily | null;
}): number {
  if (NO_TRADITIONAL_REST_PATTERNS.has(input.movement.pattern)) {
    return REST_SECONDS.NO_TRADITIONAL_REST;
  }
  if (CONDITIONING_SESSION_TYPES.has(input.sessionType)) {
    return REST_SECONDS.CONDITIONING;
  }
  if (input.movement.mechanic === 'isolation') {
    return REST_SECONDS.ISOLATION;
  }
  // Compound (or any future mechanic value — defensively never 0; a real
  // lift always gets a real rest, at worst the generic COMPOUND bucket).
  const lowRep = repsLowerBound(input.reps);
  const isLowRepStrength = input.goalFamily === 'strength' || (lowRep != null && lowRep <= LOW_REP_STRENGTH_THRESHOLD);
  return isLowRepStrength ? REST_SECONDS.COMPOUND_STRENGTH : REST_SECONDS.COMPOUND;
}

/**
 * Legacy-snapshot fallback — a `WorkoutProgramSnapshot` persisted before
 * this field existed has `restSeconds: undefined` on every exercise. The
 * timer must never silently treat that as "0" (indistinguishable from the
 * deliberate `NO_TRADITIONAL_REST` value above); it must use this explicit,
 * documented constant instead. `COMPOUND` — the most common, safest
 * general-purpose value — not `0`.
 */
export const LEGACY_REST_SECONDS_FALLBACK = REST_SECONDS.COMPOUND;
