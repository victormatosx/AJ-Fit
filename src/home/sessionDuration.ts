import { LEGACY_REST_SECONDS_FALLBACK } from '../workoutPrescription/restPrescription';
import type { FinalCardioFinisher, FinalWorkoutExercise, FinalWorkoutSession } from '../workoutPrescription/types';

/**
 * Deterministic duration ESTIMATE for a prescribed session, derived only
 * from the prescription itself (sets, reps/duration, cycles and the
 * engine-prescribed `restSeconds`) — never a stored/measured fact and never
 * a fabricated constant per session.
 *
 * It exists because the "próximos treinos" list on Home has to answer "how
 * long will this take me?" before the session has ever been executed, and
 * the Workout Execution history only knows about sessions already done.
 * Every caller MUST present the result as approximate (the `~` in
 * `home:upcoming.meta`), because the only real number is the one the user
 * produces by training.
 */

/** Average seconds spent performing one repetition (concentric + eccentric + setup share). */
const SECONDS_PER_REP = 4;
/** Used only when `reps` carries no parsable number at all (e.g. "AMRAP", "máx"). */
const FALLBACK_REPS = 10;

/**
 * Every `n` / `n-m` quantity with a time unit inside a prescribed duration
 * string, summed. The v2.0.0 catalog authors these as free text and a single
 * value may carry more than one segment — "30-45 s forte + 60-90 s leve" is
 * ONE interval cycle (work + its own recovery), so both segments count.
 * A range always resolves to its midpoint; there is no reason to prefer
 * either bound. Returns null when the string carries no time quantity,
 * which is how `mode: "integrated"` cardio (no separate block) reads.
 */
export function parsePrescribedSeconds(value: string): number | null {
  // Longest-first alternation so "min" is never consumed by the bare "m"
  // branch and "seg" is never consumed by the bare "s" branch.
  const pattern = /(\d+(?:[.,]\d+)?)\s*(?:-\s*(\d+(?:[.,]\d+)?))?\s*(minutos?|min|m|segundos?|seg|s)\b/gi;
  let total = 0;
  let matched = false;
  for (const match of value.matchAll(pattern)) {
    const low = Number(match[1].replace(',', '.'));
    const high = match[2] === undefined ? low : Number(match[2].replace(',', '.'));
    if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
    const unitSeconds = /^m/i.test(match[3]) ? 60 : 1;
    total += ((low + high) / 2) * unitSeconds;
    matched = true;
  }
  return matched ? total : null;
}

/**
 * Working seconds for one set of a rep-based prescription. A unilateral
 * prescription ("10-12/lado", "8-12/perna") is performed twice per set —
 * once per side — so it genuinely costs twice the time.
 */
export function repsWorkSeconds(reps: string | undefined): number {
  const raw = reps?.trim() ?? '';
  const range = /^(\d+)(?:\s*-\s*(\d+))?/.exec(raw);
  const low = range ? Number(range[1]) : FALLBACK_REPS;
  const high = range && range[2] !== undefined ? Number(range[2]) : low;
  const unilateral = /\/\s*(lado|perna|braço|braco|side|leg|arm)/i.test(raw) ? 2 : 1;
  return ((low + high) / 2) * SECONDS_PER_REP * unilateral;
}

export function estimateExerciseSeconds(exercise: FinalWorkoutExercise): number {
  const sets = Math.max(1, exercise.sets ?? 1);
  const work = (exercise.duration ? parsePrescribedSeconds(exercise.duration) : null)
    ?? repsWorkSeconds(exercise.reps);

  // An interval prescription (`cycles`) already carries its own recovery
  // inside `duration` (the "leve"/easy segment) — adding `restSeconds` on
  // top of every cycle would double-count it.
  const cycles = exercise.cycles ?? null;
  if (cycles !== null && cycles > 0) return sets * cycles * work;

  // `restSeconds` is the engine's own prescription (`restPrescription.ts`);
  // `0` is the deliberate "no traditional rest" value, and `undefined` only
  // happens on a pre-Phase-2 snapshot — same documented fallback the Rest
  // Timer uses, never a silent 0.
  const rest = exercise.restSeconds ?? LEGACY_REST_SECONDS_FALLBACK;
  return sets * (work + rest);
}

export function estimateCardioFinisherSeconds(finisher: FinalCardioFinisher | undefined): number {
  if (!finisher || finisher.mode === 'integrated') return 0;
  return parsePrescribedSeconds(finisher.duration ?? '') ?? 0;
}

/** Rounded-to-the-minute estimate for a whole session. Never returns 0 for a session that has any content at all. */
export function estimateSessionMinutes(session: FinalWorkoutSession): number {
  const seconds = session.exercises.reduce((sum, exercise) => sum + estimateExerciseSeconds(exercise), 0)
    + estimateCardioFinisherSeconds(session.cardioFinisher);
  if (seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds / 60));
}
